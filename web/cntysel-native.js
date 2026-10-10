// Language selection, composed from the understood TypeScript screen ports.
// The historical export/debug names are retained for game.js and saved tools.
// There is no interpreter host or executable resource on this route.
import { ui, maskFromButtons } from "./vendor/engine.js";
import { createNativeScreenRenderer } from "./native-screen-render.js";
import { paintScreenDim } from "./screendim.js";
const { CountryScreen, MenuPadWords, MenuDisplayClock, createTaskState, setState0, countryScreenStartupTick } = ui;

export const CNTYSEL_ROOT_CB = 0x80083d18;
export const LANGUAGE_GLOBAL = 0x8005cca8;
let dataPromise;
function screenData() {
    return dataPromise ??= fetch("assets/data/country_screen.json")
        .then(r => {
            if (!r.ok) throw new Error(`Language screen data: HTTP ${r.status}`);
            return r.json();
        }).then(data => {
            if (data.schema !== 1 || data.dataBase !== 0x800843c0 || data.bytes?.length !== 107)
                throw new Error("Invalid language screen data");
            return data;
        }).catch(error => { dataPromise = null; throw error; });
}

export function createCntyselNative(sfx = null, music = null) {
    let open = false, pending = false, screen = null, onPick = null;
    let row = 0, language = 0, frames = 0, generation = 0, diagnostic = null;
    let pad = new MenuPadWords(), release = false;
    const queue = [], draws = [], contexts = [];
    let fade = 0;
    let clock = new MenuDisplayClock();
    let data = null, setup = null, startup = createTaskState();
    const previousMusic = () => music?.current ?? null;
    let restoreMusic = null;
    const renderer = createNativeScreenRenderer({ pack: "cntselwn" }, () => "cntselwn");
    const record = (method, ...args) => draws.push({ method, args });
    const host = {
        initDrawContext: () => contexts.push(draws.length),
        setLayer: (...a) => record("setLayer", ...a),
        setOrigin: (...a) => record("setOrigin", ...a),
        setDepth: (...a) => record("setDepth", ...a),
        setPos: (...a) => record("setPos", ...a),
        setScale: (...a) => record("setScale", ...a),
        setFrame: (...a) => record("m_0x88", ...a),
        drawSprite: (...a) => record("drawSprite", ...a),
        packResolve: handle => handle,
        emitFadePrim: level => { fade = level & 0xff; },
        playSound: id => { sfx?.playPacked(id); },
    };
    const startupHost = {
        // The browser's pre-rendered audio is ready without a console archive
        // transfer. Gesture-gated playback is handled by the existing player.
        audioPending: () => 0,
        prepareDisplay(config) { setup = config; },
        createScreen() {
            screen = new CountryScreen(Uint8Array.from(data.bytes), host, data.initialLanguage);
        },
        // Packed 0x60840002 selects bgm031 sequence 2; sound-system.md §SEP.
        playSound(id) {
            if (id !== 0x60840002) throw new Error(`Unknown language music ${id}`);
            restoreMusic = previousMusic();
            music?.play("bgm031");
        },
        stopSound(id) {
            if (id !== 0x60840002) throw new Error(`Unknown language music ${id}`);
            if (music?.current === "bgm031") music.play(restoreMusic);
        },
    };
    const finish = (confirmed) => {
        if (!open) return;
        open = pending = false;
        generation++;
        screen?.dispose();
        if (startup.state0 === 1) {
            setState0(startup, 3);
            countryScreenStartupTick(startup, startupHost);
        }
        const callback = onPick;
        const launchCode = screen?.transition?.id ?? 0;
        onPick = null;
        if (confirmed) callback?.(row, language, launchCode);
    };
    const api = {
        open(callback = null) {
            if (open) finish(false);
            generation++;
            const token = generation;
            open = pending = true;
            screen = null;
            data = setup = null;
            startup = createTaskState();
            onPick = callback;
            row = language = frames = fade = 0;
            clock = new MenuDisplayClock();
            diagnostic = null;
            pad = new MenuPadWords();
            release = false;
            queue.length = draws.length = contexts.length = 0;
            // Begin loading the existing atlas at the same time as table data.
            renderer.ready();
            screenData().then(loaded => {
                if (!open || generation !== token) return;
                data = loaded;
                language = data.initialLanguage;
                pending = false;
            }).catch(error => {
                if (open && generation === token) diagnostic = String(error.message ?? error);
            });
        },
        isOpen: () => open,
        isPending: () => pending || (open && !renderer.ready()),
        active: () => open && !!screen && renderer.ready(),
        press(button) {
            const mask = maskFromButtons([button]);
            if (mask && open) queue.push(mask);
            if (queue.length > 16) queue.shift();
        },
        update(dt, keys) {
            if (!open || !data || !renderer.ready()) return;
            if (!screen) countryScreenStartupTick(startup, startupHost);
            if (!screen) return;
            for (const { tick } of clock.advance(dt)) {
                if (!open) break;
                let held = keys ? maskFromButtons(keys) : 0;
                if (release) release = false;
                else if (queue.length) { held |= queue.shift(); release = true; }
                const words = pad.update(held, tick);
                draws.length = contexts.length = 0;
                fade = 0;
                screen.tick(words.pressed, words.repeated);
                frames++;
                row = screen.row;
                language = screen.language;
                if (screen.complete) finish(true);
            }
        },
        draw(ctx, viewW, _viewH) {
            if (!open || !screen || !renderer.ready()) return;
            const viewport = screen.rectangle(0);
            const dim = screen.rectangle(2);
            ctx.save();
            ctx.scale(viewW / viewport.width, viewW / viewport.width);
            ctx.fillStyle = `rgb(${setup.clear.join(",")})`;
            ctx.fillRect(viewport.x, viewport.y, setup.width, setup.height);
            renderer.draw(ctx, draws, null, [], contexts);
            if (fade) {
                ctx.save();
                ctx.translate(dim.x, dim.y);
                paintScreenDim(ctx, fade, dim.width, dim.height);
                ctx.restore();
            }
            ctx.restore();
        },
        // Closing the lab is cancellation, not a language choice.
        close: () => finish(false),
        diagnostics: () => ({
            open, pending, row, language, fade, queued: queue.length, traps: 0,
            lastDiagnostic: diagnostic,
            host: screen ? {
                module: "pro/cnty_sel", execution: "translated", frames,
                objects: screen.tree.tasks.size, state: screen.tree.state(screen.root),
                transition: screen.transition, renderer: renderer.stats,
            } : null,
        }),
    };
    return api;
}
