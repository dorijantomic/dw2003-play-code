// tools/ui_shot.mjs -- GPU-only game screenshots for the UI work (GLOSSARY / OPTIONS). Numbers and files; the main session looks.
//
//   tools/run-playwright.sh yourscript.mjs        (run-playwright.sh sets GALLIUM_DRIVER=d3d12 so Chromium gets the AMD GPU)
//   import { openGame, shot, padHold, rendererIsGpu } from "./ui_shot.mjs";
//
// openGame() launches Chromium through tools/verify-launch.mjs (HARDWARE args), prints the WebGL renderer string and THROWS if it
// is a software renderer (SwiftShader, llvmpipe) or not an AMD card. Serve the game first: python3 /home/dorij/serve_game.py (port 8090).
import { mkdirSync } from "node:fs";
import { launch } from "./verify-launch.mjs";

export const SHOT_DIR = "/home/dorij/ui-review/build/";

/** True for an AMD hardware renderer string; false for SwiftShader, llvmpipe, softpipe or anything that is not AMD / Radeon. */
export function rendererIsGpu(renderer) {
    const s = String(renderer ?? "");
    if (/swiftshader|llvmpipe|softpipe|software/i.test(s)) return false;
    return /AMD|Radeon/i.test(s);
}

/**
 * Start the game on `map` with the given F2 settings (written to localStorage before the page loads, so a dev switch is on
 * from the first frame) and a fake gamepad driven by window.__btn (a standard-mapping button index, -1 = none).
 */
export async function openGame({ fx = {}, map = "s580", port = 8090, width = 1280, height = 720, inventory = [], party = null } = {}) {
    mkdirSync(SHOT_DIR, { recursive: true });
    const browser = await launch();
    const context = await browser.newContext({ viewport: { width, height } });
    await context.addInitScript((settings) => {
        localStorage.setItem("assetMode", "authentic");
        localStorage.setItem("dw.fx.v1", JSON.stringify(settings));
        window.__btn = -1;
        navigator.getGamepads = () => {
            const buttons = Array.from({ length: 17 }, (_, i) => ({ pressed: i === window.__btn, touched: i === window.__btn, value: i === window.__btn ? 1 : 0 }));
            return [{ id: "fake", index: 0, connected: true, mapping: "standard", axes: [0, 0, 0, 0], buttons, timestamp: performance.now() }];
        };
    }, fx);
    const page = await context.newPage();
    await page.goto(`http://localhost:${port}/index.html?skipTitle=1&map=${map}`);
    await page.waitForFunction(() => window.__state?.started === true, null, { timeout: 90000 });
    await page.waitForTimeout(3000);
    await page.evaluate((items) => { for (const it of items) window.__state.inventory.push(it); }, inventory);
    // Optional seeded party (ids as in game.js line 2038, e.g. ["p003pken", "p009rena", "p010pata"]) so cards show names. Default: untouched.
    if (party) await page.evaluate((ids) => { window.__state.party = [...ids]; }, party);
    await page.evaluate(() => document.querySelector("canvas").scrollIntoView({ block: "start" }));
    const renderer = await page.evaluate(() => {
        const gl = document.createElement("canvas").getContext("webgl");
        const info = gl?.getExtension("WEBGL_debug_renderer_info");
        return info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : "no WebGL";
    });
    console.log(`WebGL renderer: ${renderer}`);
    if (!rendererIsGpu(renderer)) { await browser.close(); throw new Error(`NOT the AMD GPU (${renderer}): stop and report`); }
    return { browser, page, renderer };
}

/** Save only the game canvas (its bounding box) to /home/dorij/ui-review/build/<name>.png and return the path. */
export async function shot(page, name) {
    const path = `${SHOT_DIR}${name}.png`;
    const clip = await page.evaluate(() => { const r = document.querySelector("canvas").getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; });
    await page.screenshot({ path, clip });
    console.log(`saved ${path}`);
    return path;
}

/** A keyboard key down and up (Playwright key names: "i", "Enter", "ArrowDown", "Escape", "q", "e"). */
export async function press(page, key, ms = 120, after = 400) {
    await page.keyboard.down(key);
    await page.waitForTimeout(ms);
    await page.keyboard.up(key);
    await page.waitForTimeout(after);
}

/** Press a standard-mapping gamepad button (0 bottom = confirm, 3 top = back, 4 L1, 5 R1, 12-15 d-pad) for `ms`. */
export async function padHold(page, index, ms = 120, after = 300) {
    await page.evaluate((i) => { window.__btn = i; }, index);
    await page.waitForTimeout(ms);
    await page.evaluate(() => { window.__btn = -1; });
    await page.waitForTimeout(after);
}
