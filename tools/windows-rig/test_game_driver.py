"""Adapter failure tests; substitutes are not evidence of actual gameplay."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('game_driver', HERE / 'game_driver.py')
g = importlib.util.module_from_spec(spec)
spec.loader.exec_module(g)


class AdapterTests(unittest.TestCase):
    def test_cli_and_mcp_results_and_exit_zero_refusal(self):
        value = {'windows': [{'pid': 2}]}
        self.assertEqual(g.unpack(value), value)
        self.assertEqual(g.unpack({'structuredContent': value}), value)
        self.assertEqual(g.unpack({'content': [{'type': 'text', 'text': json.dumps(value)}]}), value)
        for response in [{'isError': True}, {'status': 'refused', 'refusal': {'code': 'denied'}}]:
            with self.assertRaises(g.DriverError):
                g.unpack(response)

    def test_exact_window_selection_fails_on_dialog_or_ambiguity(self):
        window = dict(app_name='EmuHawk', title='Digimon World 2003', pid=2,
                      window_id=3, is_on_screen=True, minimized=False)
        self.assertEqual(g.select_window([window], 'EmuHawk', 'Digimon'), window)
        for windows in [[], [window, window], [dict(window, minimized=True)],
                        [dict(window, title='Open ROM')], [dict(window, app_name='Browser')]]:
            with self.assertRaises(g.DriverError):
                g.select_window(windows, 'EmuHawk', 'Digimon')
        with self.assertRaisesRegex(g.DriverError, 'Unexpected'):
            g.select_window([window, dict(window, title='Error', window_id=4)], 'EmuHawk', 'Digimon')

    def test_keyboard_uses_profile_not_controller_or_guessed_key(self):
        keys = g.keyboard_map({'AllTrollers': {'PSX Front Panel': {
            'P1 Cross': 'X1 A, Z', 'P1 Circle': 'J1 B1', 'P1 Start': 'Enter', 'P1 Up': 'Up'}}})
        self.assertEqual(keys['confirm'], 'z')
        self.assertEqual(keys['start'], 'return')
        self.assertEqual(keys['up'], 'up')
        self.assertNotIn('cancel', keys)

    def test_disabled_and_nonlead_never_call_driver(self):
        def forbidden(*a, **k):
            self.fail('Driver must not run')
        for config, env in [({'enabled': False}, {}), ({'enabled': True}, {'DW3_TEAM_ROLE': 'researcher'})]:
            with patch.dict(os.environ, env, clear=True):
                with self.assertRaises(g.DriverError):
                    g.GameComputerUse(config, execute=forbidden).call('list_windows')

    def test_missing_binary_and_timeout_surface(self):
        with self.assertRaises(g.DriverError):
            g.run(['/no/such/cua-driver'])
        with self.assertRaises(g.DriverError):
            g.run(['sleep', '1'], timeout=0.01)

    def test_read_transport_retries_once_but_actions_never_retry(self):
        for tool, expected in [('get_window_state', 2), ('press_key', 1)]:
            calls = []
            def execute(*a, **k):
                calls.append(a)
                raise g.DriverError('disconnected')
            game = g.GameComputerUse({'enabled': True, 'driver': '/driver', 'socket': 'private'}, execute=execute)
            with self.assertRaises(g.DriverError):
                game.call(tool)
            self.assertEqual(len(calls), expected)

    def test_input_timeout_is_not_retried(self):
        game = g.GameComputerUse({'emulator': 'bizhawk', 'profile': '/not/read'})
        before = {'emulator': 'control=agent', 'window': {'pid': 1, 'window_id': 2}}
        game.observe = lambda: before
        game.find_window = lambda: before['window']
        count = []
        def rpc(code):
            count.append(code)
            raise g.DriverError('RPC TIMEOUT')
        game.rpc = rpc
        with self.assertRaises(g.DriverError):
            game.press('confirm')
        self.assertEqual(len(count), 1)
        self.assertEqual(game.events[0]['status'], 'input_pending')

    def test_human_control_blocks_input(self):
        game = g.GameComputerUse({'emulator': 'bizhawk'})
        game.observe = lambda: {'emulator': 'control=human'}
        with self.assertRaisesRegex(g.DriverError, 'Human owns'):
            game.press('confirm')

    def test_shared_lock_reentrant_in_wrapper_but_excludes_other_owner(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(g, 'ROOT', Path(directory)), g.rig_lock() as fd:
            busy = subprocess.run(['flock', '-n', str(g.ROOT / '.dw3-research/windows-rig.lock'), 'true'])
            self.assertEqual(busy.returncode, 1)
            # Inherited open-file description can be flocked without deadlock.
            inherited = subprocess.run(['flock', '-n', str(fd)], pass_fds=(fd,))
            self.assertEqual(inherited.returncode, 0)

    def test_no_desktop_or_arbitrary_input_in_manifest_surface(self):
        self.assertNotIn('get_desktop_state', g.TOOLS)
        self.assertNotIn('type_text', g.TOOLS)
        self.assertNotIn('kill_app', g.TOOLS)
        game = g.GameComputerUse({'enabled': True})
        with self.assertRaises(g.DriverError):
            game.call('kill_app')

    def test_capture_readiness_does_not_hide_failed_screenshot_capability(self):
        checks = [{'name': n, 'status': 'pass'} for n in
                  ['binary_version', 'platform_supported', 'session_active', 'screen_capture_capability']]
        self.assertTrue(g.game_ready({'checks': checks + [{'name': 'ax_capability', 'status': 'fail'}]}))
        self.assertFalse(g.game_ready({'checks': checks[:-1]}))

    def test_restore_and_handoff_after_action_failure(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(g, 'ROOT', Path(directory)):
            root = Path(directory)
            rig = root / 'rig'
            (rig / 'states').mkdir(parents=True)
            game = g.GameComputerUse({'enabled': True, 'emulator': 'bizhawk', 'rig_root': str(rig)})
            calls = []
            game.call = lambda tool, args=None: calls.append(tool) or {}
            states = iter(['control=human', 'control=agent', 'control=human'])
            game.state = lambda: next(states)
            def rpc(code):
                calls.append(code)
                if code.startswith('savestate.save'):
                    (rig / 'states' / (game.session + '.State')).write_bytes(b'state')
                return 'OK'
            game.rpc = rpc
            with self.assertRaisesRegex(g.DriverError, 'input failed'):
                with game.experiment('failure', control=True):
                    raise g.DriverError('input failed')
            self.assertTrue(any('savestate.load' in c and 'rig_control("human")' in c for c in calls))
            self.assertEqual(calls[-1], 'end_session')
            result = json.loads((game.directory / 'experiment.json').read_text())
            self.assertEqual(result['status'], 'failed')
            self.assertEqual(result['metadata']['restored_emulator'], 'control=human')

    def test_missing_preservation_never_takes_control(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(g, 'ROOT', Path(directory)):
            game = g.GameComputerUse({'enabled': True, 'emulator': 'bizhawk', 'rig_root': directory})
            calls = []
            game.call = lambda *a: {}
            game.state = lambda: 'control=human'
            game.rpc = lambda code: calls.append(code)
            with self.assertRaisesRegex(g.DriverError, 'not saved'):
                with game.experiment('failure', control=True):
                    self.fail('Should not reach inputs')
            self.assertFalse(any('rig_control("agent")' in c for c in calls))

    def test_reusing_driver_preserves_separate_experiment_artifacts(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(g, 'ROOT', Path(directory)):
            game = g.GameComputerUse({'enabled': True})
            game.call = lambda *a: {}
            with game.experiment('repeat'):
                game.metadata['first'] = True
            first = game.directory
            with game.experiment('repeat'):
                self.assertNotIn('first', game.metadata)
            self.assertNotEqual(first, game.directory)
            self.assertTrue(json.loads((first / 'experiment.json').read_text())['metadata']['first'])


if __name__ == '__main__':
    unittest.main()
