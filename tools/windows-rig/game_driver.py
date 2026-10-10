#!/usr/bin/env python3
"""DW3's bounded computer-use capability. CUA owns windows; RPC owns emulation."""
import argparse
import base64
from contextlib import contextmanager
from datetime import datetime, timezone
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import signal
import subprocess
import sys
import time
import uuid

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
CONFIG = ROOT / '.dw3-research/game-driver.json'
TOOLS = ['start_session', 'end_session', 'list_windows',
         'get_window_state', 'bring_to_front', 'press_key', 'health_report']
BUTTONS = {'confirm': 'Cross', 'cancel': 'Circle', 'menu': 'Triangle',
           'up': 'Up', 'down': 'Down', 'left': 'Left', 'right': 'Right',
           'start': 'Start', 'select': 'Select', 'square': 'Square',
           'cross': 'Cross', 'circle': 'Circle', 'triangle': 'Triangle'}


class DriverError(RuntimeError):
    pass


def run(argv, *, data=None, timeout=20, env=None, pass_fds=()):
    try:
        p = subprocess.run([str(a) for a in argv], input=data, capture_output=True,
                           text=True, encoding='utf-8', errors='replace', timeout=timeout,
                           cwd=ROOT, env=env, pass_fds=pass_fds)
    except (OSError, subprocess.TimeoutExpired) as e:
        raise DriverError(f'{argv[0]}: {e}') from e
    if p.returncode:
        raise DriverError(f'{argv[0]} exited {p.returncode}: {p.stderr.strip()} {p.stdout.strip()}')
    return p.stdout.strip()


def winpath(path):
    return run(['wslpath', '-w', str(Path(path).resolve())])


def localpath(path):
    if re.match(r'^[A-Za-z]:[\\/]', path):
        return Path('/mnt') / path[0].lower() / path[3:].replace('\\', '/')
    return Path(path)


def host(action, request):
    return json.loads(run([os.environ.get('DW3_POWERSHELL', 'powershell.exe'),
                          '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
                          '-File', winpath(HERE / 'cua-host.ps1'), '-Action', action],
                         data=json.dumps(request)))


def save_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(path.name + '.' + uuid.uuid4().hex + '.tmp')
    temp.write_text(json.dumps(value, indent=2) + '\n')
    temp.replace(path)


def stamp():
    return datetime.now(timezone.utc).isoformat()


def game_ready(health):
    required = {'binary_version', 'platform_supported', 'session_active', 'screen_capture_capability'}
    passed = {c['name'] for c in health.get('checks', []) if c.get('status') == 'pass'}
    return required <= passed


def unpack(response):
    """CLI returns official MCP envelopes, including errors on exit zero."""
    if not isinstance(response, dict):
        raise DriverError('Invalid CUA response (expected MCP result)')
    if response.get('isError'):
        raise DriverError(json.dumps(response, ensure_ascii=False))
    if response.get('status') in ('refused', 'error') or response.get('refusal'):
        raise DriverError(json.dumps(response, ensure_ascii=False))
    value = response.get('structuredContent')
    if value is not None:
        return value
    for item in response.get('content', []):
        if item.get('type') == 'text':
            try:
                return json.loads(item['text'])
            except ValueError:
                continue
    # The CLI prints structuredContent directly (unlike stdio MCP).
    return response


def select_window(windows, app_name, title):
    candidates = [w for w in windows if w.get('app_name', '').casefold().removesuffix('.exe') == app_name.casefold().removesuffix('.exe')
                  and title.casefold() in w.get('title', '').casefold()]
    if len(candidates) != 1:
        raise DriverError(f'Expected one {app_name} game window matching {title!r}; found {len(candidates)}')
    w = candidates[0]
    dialogs = [v.get('title', '') for v in windows if v['pid'] == w['pid']
               and v['window_id'] != w['window_id'] and v.get('is_on_screen')
               and v.get('title') not in ('Lua Console',)]
    if dialogs:
        raise DriverError('Unexpected emulator window(s); inspect before input: ' + repr(dialogs))
    if w.get('minimized') or not w.get('is_on_screen'):
        raise DriverError('Game window is minimized or not on screen; restore it before observation')
    return w


def keyboard_map(profile):
    bindings = profile.get('AllTrollers', {}).get('PSX Front Panel', {})
    keys = {}
    for button, pad in BUTTONS.items():
        options = bindings.get('P1 ' + pad, '').split(',')
        for option in options:
            key = option.strip().lower()
            key = {'enter': 'return', 'esc': 'escape'}.get(key, key)
            if re.fullmatch(r'[a-z0-9]|up|down|left|right|return|space|tab|escape', key):
                keys[button] = key
                break
    return keys


def gameshark_pokes(text):
    """Expand PlayStation GameShark lines into (address, width, value) writes.

    Supports 30 (8-bit), 80 (16-bit) and the 50 serial repeater `5000ccss vvvv`
    (repeat the next code cc times, address step ss, value step vvvv). Any other
    type is refused rather than guessed.
    """
    pokes, repeat = [], None
    for raw in text.splitlines():
        line = raw.split('#', 1)[0].strip()
        if not line:
            continue
        m = re.fullmatch(r'([0-9A-Fa-f]{8})\s+([0-9A-Fa-f]{4})', line)
        if not m:
            raise DriverError('Not a GameShark line: ' + raw)
        code, value = int(m[1], 16), int(m[2], 16)
        kind = code >> 24
        if kind == 0x50:
            repeat = ((code >> 8) & 0xff, code & 0xff, value)
            continue
        if kind not in (0x30, 0x80):
            raise DriverError(f'Unsupported GameShark code type {kind:02X}: {raw}')
        width = 1 if kind == 0x30 else 2
        addr = 0x80000000 | (code & 0xffffff)
        count, step, inc = repeat or (1, 0, 0)
        for i in range(count):
            v = (value + i * inc) & (0xff if width == 1 else 0xffff)
            pokes.append((addr + i * step, width, v))
        repeat = None
    if repeat:
        raise DriverError('A 50 repeater ends the code list')
    return pokes


def lua_literal(value):
    """A Lua literal for a bool, number, string or list of those."""
    if isinstance(value, bool):
        return str(value).lower()
    if isinstance(value, (list, tuple)):
        return '{' + ', '.join(lua_literal(v) for v in value) + '}'
    if isinstance(value, (int, float, str)):
        return json.dumps(value)
    raise DriverError(f'No Lua literal for {value!r}')


@contextmanager
def rig_lock():
    path = ROOT / '.dw3-research/windows-rig.lock'
    path.parent.mkdir(exist_ok=True)
    with path.open('a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as e:
            raise DriverError('Windows rig is occupied; no action sent') from e
        yield lock.fileno()


class GameComputerUse:
    def __init__(self, config, *, execute=run):
        self.config, self.execute = config, execute
        self.session = 'dw3-' + uuid.uuid4().hex[:12]
        self.lock_fd = None
        self.last_rpc = 0
        self.directory = None
        self.events = []
        self.observations = []
        self.metadata = {}
        self.deadline = None

    def enabled(self):
        if os.environ.get('DW3_CUA_ENABLED', str(self.config.get('enabled', False))).lower() not in ('true', '1'):
            raise DriverError('CUA disabled. Run setup, or set DW3_CUA_ENABLED=true with an existing config.')
        role = os.environ.get('DW3_TEAM_ROLE', 'implementer')
        if role != 'implementer':
            raise DriverError(f'Live game capability is reserved for the implementation lead, not {role}')

    def call(self, tool, args=None):
        self.enabled()
        if tool not in TOOLS:
            raise DriverError('Tool not exposed by the game adapter: ' + tool)
        argv = [str(localpath(self.config['driver'])), 'call', tool, '--socket', self.config['socket']]
        # Only transport failures on pure reads may be retried. An action may
        # already have executed when its reply is lost.
        for attempt in range(2):
            try:
                raw = self.execute(argv, data=json.dumps(args or {}))
                break
            except DriverError:
                if attempt or tool not in ('list_windows', 'get_window_state', 'health_report'):
                    raise
                time.sleep(0.25)
        try:
            response = json.loads(raw)
        except ValueError as e:
            raise DriverError('Cua Driver returned non-JSON: ' + raw[:500]) from e
        unpack(response)
        return response

    def rpc(self, code):
        # Maintain the documented pacing; the bridge executes on frame end.
        time.sleep(max(0, self.config.get('rpc_interval', 5) - (time.monotonic() - self.last_rpc)))
        env = dict(os.environ, DW3_RIG_WIN_MOUNT=str(localpath(self.config['rig_root'])))
        fds = ()
        if self.lock_fd is not None:
            env['DW3_RIG_LOCK_FD'] = str(self.lock_fd)
            fds = (self.lock_fd,)
        wrapper = HERE / ('bizhawk-rpc' if self.config['emulator'] == 'bizhawk' else 'dw3-rpc')
        result = self.execute([wrapper, code, '8'], timeout=12, env=env, pass_fds=fds)
        self.last_rpc = time.monotonic()
        if 'ERROR:' in result or 'RPC TIMEOUT' in result:
            raise DriverError('Emulator bridge: ' + result)
        return result

    def find_window(self):
        processes = host('inspect', self.config)['processes']
        if len(processes) != 1:
            raise DriverError(f'Expected one configured emulator process; found {len(processes)}')
        value = unpack(self.call('list_windows', {'pid': processes[0]['pid']}))
        windows = value.get('windows', []) if isinstance(value, dict) else value
        return select_window(windows, self.config['app_name'], self.config['window_match'])

    def state(self, native_capture=None):
        code = ('rig_player_status(); print("SCENE " .. tostring(getSceneID()))'
                if self.config['emulator'] == 'bizhawk' else
                'assert(PCSX, "Redux bridge required"); print("SCENE " .. tostring(getSceneID()))')
        if native_capture and self.config['emulator'] == 'bizhawk':
            code += '; savestatePNG(' + json.dumps(native_capture) + ')'
        return self.rpc(code)

    def focus(self):
        w = self.find_window()
        value = unpack(self.call('bring_to_front', {'pid': w['pid'], 'window_id': w['window_id']}))
        hwnd = value.get('now_fg_hwnd')
        if isinstance(hwnd, str):
            hwnd = int(hwnd, 0)
        if hwnd != w['window_id']:
            raise DriverError('CUA did not verify game focus: ' + json.dumps(value))
        return value

    def observe(self, screenshot=True):
        w = self.find_window()
        native_name = self.session + '-' + uuid.uuid4().hex[:8] if screenshot else None
        result = {'timestamp': stamp(), 'window': w, 'emulator': self.state(native_name)}
        if native_name and self.config['emulator'] == 'bizhawk':
            source = localpath(self.config['rig_root']) / 'shots' / (native_name + '.png')
            if not source.is_file():
                raise DriverError('Emulator did not save its framebuffer screenshot')
            data = source.read_bytes()
            if not data.startswith(b'\x89PNG\r\n\x1a\n'):
                raise DriverError('Emulator framebuffer capture is not PNG')
            digest = hashlib.sha256(data).hexdigest()
            dest = self.directory / (digest + '.png')
            if not dest.exists():
                shutil.copyfile(source, dest)
            result.update(native_screenshot=str(dest.relative_to(ROOT)), native_screenshot_sha256=digest)
        if screenshot:
            response = self.call('get_window_state', dict(pid=w['pid'], window_id=w['window_id'],
                session=self.session, include_accessibility_tree=False, max_dimension=960))
            images = [c for c in response.get('content', []) if c.get('type') == 'image']
            encoded = images[0]['data'] if images else unpack(response).get('screenshot_png_b64')
            if not encoded:
                raise DriverError('CUA returned no window screenshot')
            data = base64.b64decode(encoded, validate=True)
            if not data.startswith(b'\x89PNG\r\n\x1a\n'):
                raise DriverError('CUA screenshot is not PNG')
            digest = hashlib.sha256(data).hexdigest()
            path = self.directory / (digest + '.png')
            if not path.exists():
                path.write_bytes(data)
            result.update(screenshot=str(path.relative_to(ROOT)), screenshot_sha256=digest)
        self.observations.append(result)
        self.flush()
        return result

    def press(self, button, transport='rpc', frames=4, foreground=False):
        if len(self.events) >= 8 or (self.deadline and time.monotonic() > self.deadline):
            raise DriverError('Experiment budget exhausted; stop, restore and inspect evidence')
        if (ROOT / '.dw3-research/game-use/STOP').exists():
            raise DriverError('Human STOP marker present; no more game input')
        if button not in BUTTONS:
            raise DriverError('Unknown game button ' + button)
        if not 1 <= frames <= 60:
            raise DriverError('Pad hold must be 1..60 frames')
        before = self.observe()
        if self.config['emulator'] == 'bizhawk' and 'control=agent' not in before['emulator']:
            raise DriverError('Human owns the game; begin an authorized experiment before inputs')
        w = self.find_window()
        if (w['pid'], w['window_id']) != (before['window']['pid'], before['window']['window_id']):
            raise DriverError('Game window changed during observation; no input sent')
        event = {'timestamp': stamp(), 'button': button, 'transport': transport,
                 'before': before, 'status': 'input_pending', 'interpretation': None,
                 'confidence': 'unassessed', 'unresolved_questions': ['Did the intended game transition occur?']}
        self.events.append(event)
        self.flush()
        if transport == 'cua':
            if self.config['emulator'] == 'bizhawk':
                keys = keyboard_map(json.loads(localpath(self.config['profile']).read_text(encoding='utf-8-sig')))
            else:
                keys = {}
            keys.update(self.config.get('keys', {}))
            if button not in keys:
                raise DriverError(f'No configured keyboard binding for {button}; use RPC or configure keys')
            if not re.fullmatch(r'[a-z0-9]|up|down|left|right|return|space|tab|escape', keys[button]):
                raise DriverError('Unsupported key binding; use a simple game key or frame-based RPC')
            event['key'] = keys[button]
            event['delivery_mode'] = 'foreground' if foreground else 'background'
            self.flush()
            event['response'] = unpack(self.call('press_key', dict(pid=w['pid'], window_id=w['window_id'],
                key=keys[button], session=self.session, delivery_mode=event['delivery_mode'])))
        else:
            token = {'Cross': 'X', 'Circle': 'CIRCLE', 'Triangle': 'TRIANGLE'}.get(BUTTONS[button], BUTTONS[button].upper())
            event['frames'] = frames
            event['response'] = self.rpc(f'press(BTN.{token}, {frames}); print("INPUT QUEUED")')
        event['status'] = 'sent_effect_unverified'
        self.flush()
        time.sleep(0.4)
        event['after'] = self.observe()
        event['pixels_changed'] = event['before']['screenshot_sha256'] != event['after']['screenshot_sha256']
        self.flush()
        return event

    def flush(self, **extra):
        if self.directory:
            save_json(self.directory / 'experiment.json', dict(session=self.session, events=self.events,
                observations=self.observations, metadata=self.metadata, **extra))

    @contextmanager
    def experiment(self, name, *, control=False, cua=True):
        self.enabled()
        if self.lock_fd is not None:
            raise DriverError('Nested game experiments are not supported')
        if not re.fullmatch(r'[a-zA-Z0-9_-]{1,64}', name):
            raise DriverError('Experiment name must be 1..64 letters, digits, hyphens or underscores')
        self.session = 'dw3-' + uuid.uuid4().hex[:12]
        self.events, self.observations, self.metadata = [], [], {}
        self.directory = ROOT / '.dw3-research/game-use' / (name + '-' + self.session)
        self.directory.mkdir(parents=True)
        with rig_lock() as self.lock_fd:
            self.deadline = time.monotonic() + 180
            begun, acquired = False, False
            status, failure, cleanup = 'complete', None, []
            try:
                # The explorer works through RPC only; a window session left idle
                # for its whole run expires (Cua's 30-minute idle timeout).
                if cua:
                    self.call('start_session', {'session': self.session})
                    begun = True
                if control:
                    if self.config['emulator'] != 'bizhawk':
                        raise DriverError('Redux observation supported; controlled experiments require the BizHawk player guard')
                    current = self.state()
                    if 'control=human' not in current:
                        raise DriverError('Rig already agent-owned or missing player guard; refusing takeover')
                    # A task-specific state, never a user quick-save slot.
                    state_path = self.config['rig_root'].replace('\\', '/') + '/states/' + self.session + '.State'
                    self.rpc('savestate.save(' + json.dumps(state_path) + '); print("PRESERVED")')
                    state_file = localpath(state_path)
                    if not state_file.is_file() or state_file.stat().st_size == 0:
                        raise DriverError('Starting state was not saved; no inputs sent')
                    self.metadata.update(starting_state=state_path,
                        starting_state_sha256=hashlib.sha256(state_file.read_bytes()).hexdigest(),
                        initial_emulator=current)
                    self.flush()
                    acquired = True  # Cleanup must also run if the handoff reply is lost.
                    self.rpc('rig_control("agent")')
                yield self
            except BaseException as e:
                status, failure = 'failed', str(e)
                raise
            finally:
                if acquired:
                    try:
                        current = self.state()
                        if 'control=agent' in current:
                            self.rpc('releaseAll(); savestate.load(' + json.dumps(state_path) + '); rig_control("human"); print("RESTORED")')
                            self.metadata['restored_emulator'] = self.state()
                            restored = self.metadata['restored_emulator']
                            original_scene = re.search(r'SCENE (\d+)', self.metadata['initial_emulator'])
                            restored_scene = re.search(r'SCENE (\d+)', restored)
                            if 'control=human' not in restored or (original_scene and
                                    (not restored_scene or original_scene[1] != restored_scene[1])):
                                raise DriverError('Restoration readback did not match initial scene/human control')
                        else:
                            cleanup.append('Control returned externally; did not reload over human play')
                    except BaseException as e:
                        cleanup.append('RESTORE/HANDOFF FAILED: ' + str(e))
                if begun:
                    try:
                        self.call('end_session', {'session': self.session})
                    except BaseException as e:
                        cleanup.append('CUA SESSION CLEANUP FAILED: ' + str(e))
                self.flush(status='failed' if cleanup else status, error=failure, cleanup=cleanup)
                self.lock_fd = None
                if cleanup and failure is None:
                    raise DriverError('; '.join(cleanup))

    def explore(self, name, *, minutes, speed, lua_cfg, resume=None):
        """Run pause-explorer.lua inside BizHawk and wait for its summary.

        Call inside experiment(control=True): that owns the lock, saved the
        starting moment, and restores it afterwards. The explorer keeps its own
        node/trial budget; this loop adds the wall-clock limit and the human STOP
        marker, both delivered as the run folder's STOP file.
        """
        if self.config['emulator'] != 'bizhawk':
            raise DriverError('The explorer needs the BizHawk rig')
        rig = localpath(self.config['rig_root'])
        rig_win = self.config['rig_root'].replace('\\', '/')
        run_id = self.session
        out = rig / 'dumps' / 'pause-explore' / run_id
        (out / 'shots').mkdir(parents=True)
        (rig / 'states' / ('pxp-' + run_id)).mkdir(parents=True)
        if resume:
            # Continue an earlier run: its logs and pictures come along so the new
            # folder holds the whole map, and the robot loads its resume.lua.
            prior = json.loads((Path(resume) / 'experiment.json').read_text())['metadata']['explore']
            prior_out = localpath(prior['rig_folder']) if ':' in prior['rig_folder'][:3] else Path(prior['rig_folder'])
            if not (prior_out / 'resume.lua').is_file():
                raise DriverError('The earlier run left no resume.lua: ' + str(prior_out))
            for item in ('nodes.jsonl', 'edges.jsonl', 'keys.jsonl', 'alts.jsonl', 'calibration.jsonl'):
                if (prior_out / item).is_file():
                    shutil.copyfile(prior_out / item, out / item)
            shutil.copytree(prior_out / 'shots', out / 'shots', dirs_exist_ok=True)
            lua_cfg = dict(lua_cfg, resume=rig_win + '/dumps/pause-explore/' + prior_out.name + '/resume.lua',
                           label=prior.get('cfg', {}).get('label'))
            lua_cfg.pop('pokes', None)
            if lua_cfg['label'] is None:
                lua_cfg.pop('label')
        spec = rig / 'pause-explorer-spec.lua'
        run([sys.executable, HERE.parent / 'build_pause_explorer_spec.py', '--out', spec], timeout=120)
        shutil.copyfile(HERE / 'pause-explorer.lua', rig / 'pause-explorer.lua')
        if lua_cfg.get('trace'):
            # Trace mode: the case list (saved moments and buttons) goes next to the robot.
            shutil.copyfile(lua_cfg['trace'], out / 'trace-cases.lua')
            lua_cfg = dict(lua_cfg, trace=rig_win + '/dumps/pause-explore/' + run_id + '/trace-cases.lua')
        cfg = dict(lua_cfg, run=run_id, speed=speed)
        body = ', '.join(f'{k} = {lua_literal(v)}' for k, v in cfg.items())
        self.metadata['explore'] = dict(run=run_id, rig_folder=str(out), minutes=minutes, cfg=cfg,
                                        states=rig_win + '/states/pxp-' + run_id)
        self.flush()
        armed = self.rpc('PAUSE_SPEC = nil; PAUSE_EXPLORE_CFG = { ' + body + ' }; '
                         'dofile(' + json.dumps(rig_win + '/pause-explorer.lua') + ')')
        if 'PXP ARMED' not in armed:
            raise DriverError('Explorer did not arm: ' + armed)
        self.metadata['explore']['armed'] = armed
        deadline = time.monotonic() + minutes * 60
        stop_reason = None
        try:
            while not (out / 'summary.json').exists():
                if stop_reason is None:
                    if (ROOT / '.dw3-research/game-use/STOP').exists():
                        stop_reason = 'human STOP marker'
                    elif time.monotonic() > deadline:
                        stop_reason = f'wall-clock limit of {minutes} minutes'
                    if stop_reason:
                        (out / 'STOP').write_text(stop_reason + '\n')
                        self.metadata['explore']['stop_requested'] = stop_reason
                        self.flush()
                        stop_deadline = time.monotonic() + 60
                elif time.monotonic() > stop_deadline:
                    raise DriverError('Explorer ignored its STOP file for 60 s')
                time.sleep(10)
                self.metadata['explore']['progress'] = self.rpc('PXP.status()')
                self.flush()
        finally:
            try:
                self.rpc('if PXP and not PXP.stopped then PXP.stop("driver exit") end; print("PXP IDLE")')
            except DriverError as e:
                self.metadata['explore']['stop_error'] = str(e)
            evidence = self.directory / 'explore'
            if out.exists():
                shutil.copytree(out, evidence, dirs_exist_ok=True)
            self.metadata['explore']['evidence'] = str(evidence.relative_to(ROOT))
            self.flush()
        summary = json.loads((out / 'summary.json').read_text())
        self.metadata['explore']['summary'] = summary
        self.flush()
        return summary

    def launch(self):
        self.enabled()
        with rig_lock() as self.lock_fd:
            try:
                if host('inspect', self.config)['processes']:
                    return {'window': self.find_window(), 'emulator': self.state(), 'already_running': True}
                host('launch', self.config)
                deadline = time.monotonic() + 30
                last_error = ''
                while time.monotonic() < deadline:
                    try:
                        window = self.find_window()
                        state = self.state()
                        return {'window': window, 'emulator': state}
                    except DriverError as e:
                        last_error = str(e)
                        time.sleep(1)
                raise DriverError('Launcher started but game window/bridge did not become ready: ' + last_error)
            finally:
                self.lock_fd = None


def setup(path, emulator, rig_root, rom):
    directory = path.parent / ('cua' if path.name == 'game-driver.json' else path.stem + '-cua')
    if path.exists():
        # Preserve operator customizations on repeated setup. Rebuild the policy
        # from the existing executable rather than silently broadening defaults.
        cfg = json.loads(path.read_text())
        if rig_root or emulator != cfg['emulator'] or rom != 'C:/dw3-rig/dw2003.cue':
            raise DriverError('Config exists; use --config with a new path for a different rig')
        exe = cfg['executable']
        manifest = {'version': 3, 'expires_after': '8h', 'idle_timeout': '30m',
                    'allow': {'tools': TOOLS}, 'resources': {'apps': [{'executable': exe, 'windows': 'all'}],
                                                           'desktop': {'display': False}}}
        save_json(directory / 'capabilities.json', manifest)
        return {'config': str(path), 'preserved': True, 'next': 'start --restart to load the refreshed policy'}
    info = host('discover', {})
    if not info['installed']:
        raise DriverError('Cua Driver unavailable. Install using docs/workflow/game-computer-use.md; no software installed automatically.')
    rig = rig_root or ('C:/bizhawk-rig' if emulator == 'bizhawk' else 'C:/dw3-rig')
    cfg = dict(enabled=True, driver=info['driver'], emulator=emulator, rig_root=rig,
               rom=rom, socket=r'\\.\pipe\dw3-cua-' + emulator,
               app_name='EmuHawk' if emulator == 'bizhawk' else 'pcsx-redux',
               window_match='Digimon' if emulator == 'bizhawk' else 'PCSX',
               profile=rig + '/player-config.ini',
               launcher=rig + ('/launch-player-bizhawk.ps1' if emulator == 'bizhawk' else '/launch-redux-windows.ps1'), keys={})
    exe = rig + ('/bizhawk-active/EmuHawk.exe' if emulator == 'bizhawk' else '/pcsx-redux-active/pcsx-redux.exe')
    cfg['executable'] = exe
    if not localpath(exe).is_file():
        raise DriverError('Configured emulator does not exist: ' + exe)
    directory.mkdir(parents=True, exist_ok=True)
    manifest = {'version': 3, 'expires_after': '8h', 'idle_timeout': '30m',
                'allow': {'tools': TOOLS}, 'resources': {'apps': [{'executable': exe, 'windows': 'all'}],
                                                       'desktop': {'display': False}}}
    # JSON is valid YAML; accepted by the official manifest loader.
    save_json(directory / 'capabilities.json', manifest)
    cfg.update(manifest=winpath(directory / 'capabilities.json'),
               stdout=winpath(directory / 'driver.stdout.log'), stderr=winpath(directory / 'driver.stderr.log'))
    save_json(path, cfg)
    return {'config': str(path), 'manifest': manifest, 'next': 'start, doctor, launch, observe'}


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--config', type=Path, default=Path(os.environ.get('DW3_GAME_DRIVER_CONFIG', CONFIG)))
    sub = p.add_subparsers(dest='command', required=True)
    s = sub.add_parser('setup')
    s.add_argument('--emulator', choices=['bizhawk', 'redux'], default='bizhawk')
    s.add_argument('--rig-root')
    s.add_argument('--rom', default='C:/dw3-rig/dw2003.cue')
    for name in ['start', 'doctor', 'launch', 'status', 'observe', 'focus', 'enable', 'disable']:
        s = sub.add_parser(name)
        if name == 'start':
            s.add_argument('--restart', action='store_true', help='Restart only the private CUA daemon, never the emulator')
        if name == 'observe':
            s.add_argument('--structured-only', action='store_true')
    s = sub.add_parser('experiment')
    s.add_argument('name')
    s.add_argument('--bench', type=int,
                   help='Speed test only: seconds per phase (bare, memory walk, sound hook, state loads)')
    s.add_argument('--sample-lists', action='store_true',
                   help='Inside the bag and the EQUIPMENT item list, try only Down, Right and Cross')
    s.add_argument('--buttons', nargs='+', choices=list(BUTTONS), required=True)
    s.add_argument('--transport', choices=['rpc', 'cua'], default='rpc')
    s.add_argument('--frames', type=int, default=4)
    s.add_argument('--control', action='store_true', required=True,
                   help='Attest this bounded action is authorized and the human is not playing')
    s.add_argument('--foreground-after-noop', action='store_true',
                   help='Use only after inspecting a failed background action')
    s.add_argument('--question', default='Verify the named game interaction', help='Bounded experimental question')
    s = sub.add_parser('explore', help='Map the pause menu with pause-explorer.lua (BizHawk only)')
    s.add_argument('name')
    s.add_argument('--control', action='store_true', required=True,
                   help='Attest the user asked for an unattended run and is not playing')
    s.add_argument('--minutes', type=float, default=20, help='Wall-clock limit (at most 60)')
    s.add_argument('--speed', type=int, default=800, help='Emulator speed percent during the run')
    s.add_argument('--max-nodes', type=int, default=300)
    s.add_argument('--max-trials', type=int, default=6000)
    s.add_argument('--max-depth', type=int, default=40)
    s.add_argument('--settle', type=int, default=30, help='Frames the screen key must hold still')
    s.add_argument('--hold', type=int, default=4, help='Frames each button is held')
    s.add_argument('--map-dpad', action='store_true', help='Also press the D-pad on the MAP page')
    s.add_argument('--expand-world', action='store_true',
                   help='Also explore screens reached after the save data changed (a swap, a heal)')
    s.add_argument('--bench', type=int,
                   help='Speed test only: seconds per phase (bare, memory walk, sound hook, state loads)')
    s.add_argument('--sample-lists', action='store_true',
                   help='Inside the bag and the EQUIPMENT item list, try only Down, Right and Cross')
    s.add_argument('--buttons', nargs='+', help='Pad names to try (default: all fourteen)')
    s.add_argument('--trace', type=Path,
                   help='Trace mode: a Lua file of functions and cases (saved moment, button); no search')
    s.add_argument('--resume', type=Path,
                   help='Continue an earlier explore run (its .dw3-research/game-use/<run> folder); same save and spec')
    s.add_argument('--codes', type=Path,
                   help='GameShark lines applied once to the robot\'s own copy of the moment (the user\'s moment is restored unchanged)')
    s.add_argument('--question', default='Map every pause screen and button edge reachable from this save')
    args = p.parse_args(argv)
    def interrupted(_number, _frame):
        raise KeyboardInterrupt('Interrupted; attempting owned-session cleanup')
    signal.signal(signal.SIGTERM, interrupted)
    try:
        if args.command == 'setup':
            result = setup(args.config, args.emulator, args.rig_root, args.rom)
        else:
            if not args.config.exists():
                raise DriverError('No CUA configuration. Run: python3 tools/windows-rig/game_driver.py setup')
            game = GameComputerUse(json.loads(args.config.read_text()))
            if args.command in ('enable', 'disable'):
                game.config['enabled'] = args.command == 'enable'
                save_json(args.config, game.config)
                print(json.dumps({'enabled': game.config['enabled']}))
                return 0
            game.enabled()
            if args.command == 'start':
                driver = localpath(game.config['driver'])
                if args.restart:
                    run([driver, 'stop', '--socket', game.config['socket']])
                    time.sleep(1)
                try:
                    health = unpack(game.call('health_report'))
                    result = {'already_running': True, 'health': health}
                except DriverError:
                    try:
                        result = host('start', game.config)
                    except DriverError as e:
                        # Windows Start-Process can outlive its launcher reply;
                        # readiness comes from the actual private daemon.
                        result = {'launcher_warning': str(e)}
                    for attempt in range(5):
                        try:
                            health = unpack(game.call('health_report'))
                            break
                        except DriverError:
                            if attempt == 4:
                                raise
                            time.sleep(0.5)
                    result['health'] = health
                if not game_ready(health):
                    raise DriverError('Driver is not desktop-ready: ' + json.dumps(health))
            elif args.command == 'doctor':
                result = {'version': run([localpath(game.config['driver']), '--version']),
                          'health': unpack(game.call('health_report'))}
                result['game_capture_ready'] = game_ready(result['health'])
                if not result['game_capture_ready']:
                    raise DriverError('Driver health check failed: ' + json.dumps(result))
            elif args.command == 'launch':
                result = game.launch()
            elif args.command == 'explore':
                if not 0 < args.minutes <= 60:
                    raise DriverError('Explorer wall-clock limit must be 0..60 minutes')
                lua_cfg = dict(max_nodes=args.max_nodes, max_trials=args.max_trials,
                               max_depth=args.max_depth, settle=args.settle, hold=args.hold,
                               map_dpad=args.map_dpad, expand_world=args.expand_world,
                               sample_lists=args.sample_lists)
                if args.buttons:
                    lua_cfg['buttons'] = args.buttons
                if args.bench:
                    lua_cfg['bench'] = args.bench
                if args.trace:
                    lua_cfg['trace'] = str(args.trace)
                if args.codes:
                    pokes = gameshark_pokes(args.codes.read_text())
                    lua_cfg['pokes'] = [v for poke in pokes for v in poke]
                    lua_cfg['label'] = 'cheat-filled save: ' + args.codes.name
                with game.experiment(args.name, control=True, cua=False):
                    game.metadata['question'] = args.question
                    summary = game.explore(args.name, minutes=args.minutes, speed=args.speed,
                                           lua_cfg=lua_cfg, resume=args.resume)
                result = {'result': summary, 'evidence': str(game.directory / 'experiment.json')}
            else:
                if args.command == 'experiment' and len(args.buttons) > 8:
                    raise DriverError('At most 8 buttons per experiment; inspect before continuing')
                with game.experiment(getattr(args, 'name', args.command), control=args.command == 'experiment'):
                    game.metadata['question'] = getattr(args, 'question', 'Inspect current emulator state')
                    if args.command == 'status':
                        result = {'window': game.find_window(), 'emulator': game.state()}
                    elif args.command == 'focus':
                        result = game.focus()
                    elif args.command == 'observe':
                        result = game.observe(not args.structured_only)
                    else:
                        result = [game.press(b, args.transport, args.frames, args.foreground_after_noop) for b in args.buttons]
                    game.metadata['result'] = result if args.command in ('status', 'focus') else 'See observations/events'
                result = {'result': result, 'evidence': str(game.directory / 'experiment.json')}
        print(json.dumps(result, indent=2))
        return 0
    except (DriverError, ValueError, OSError, KeyboardInterrupt) as e:
        print(json.dumps({'error': str(e)}), file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
