// Captures the stage-entry location title card as it plays, straight out of the
// real game.js on the real field. Run the lab server first:
//   python3 -m http.server 8742 --directory web
//   tools/run-playwright.sh tools/verify_placecard.mjs [outdir]
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";

const out = process.argv[2] ?? "/tmp/placecard";
mkdirSync(out, { recursive: true });

const b = await chromium.launch({
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const p = await b.newPage({ viewport: { width: 1100, height: 760 } });
p.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
await p.goto(`${baseUrl(8742)}/ui-lab.html`, { waitUntil: "load" });
await p.waitForFunction(() => {
    const f = document.getElementById("game");
    return f?.contentWindow?.__labOpen && f.contentWindow.__state?.started;
}, null, { timeout: 60000 });
console.log("game booted");

// Restart the card on the opening screen and watch it play.
await p.click('[data-scr="placecard"]');
await p.waitForFunction(
    () => document.getElementById("game").contentWindow.__labPlaceCard?.isActive(),
    null,
    { timeout: 10000 },
);

const probe = () => p.evaluate(() => {
    const s = document.getElementById("game").contentWindow.__labPlaceCard?.state();
    return s
        ? { phase: s.phase, step: s.step, area: s.area.revealed, place: s.place.revealed,
            bars: s.bars.filter((b) => b.enabled).length, clipH: s.clip.h }
        : null;
});
const hold = (on) => p.evaluate(
    (v) => document.getElementById("game").contentWindow.__labPlaceCard.hold(v), on);
const shot = async (name) => {
    console.log(name, JSON.stringify(await probe()));
    await p.screenshot({ path: `${out}/${name}.png` });
};

// Hold the card so the capture is of a known state, not of a race.
await hold(true);
await shot("01-typing");
await p.waitForFunction(() => {
    const s = document.getElementById("game").contentWindow.__labPlaceCard?.state();
    return s && s.phase === 2;
}, null, { timeout: 15000 });
await shot("02-complete");
await hold(false);
await p.waitForFunction(() => {
    const s = document.getElementById("game").contentWindow.__labPlaceCard?.state();
    return !s || s.clip.h < 200;
}, null, { timeout: 15000 });
await shot("03-wiping");
await p.waitForTimeout(600);
await shot("04-gone");

// And the same card on an ordinary ARRIVAL, driven by setMap rather than by the
// lab — this is what a player walking through a door actually gets.
const g = await b.newPage({ viewport: { width: 900, height: 620 } });
g.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
// A fresh profile has no saved visual mode, and its chooser would cover the card.
await g.addInitScript(() => localStorage.setItem("assetMode", "authentic"));
await g.goto(`${baseUrl(8742)}/index.html?skipTitle=1`, { waitUntil: "load" });
await g.waitForFunction(() => window.__state?.started, null, { timeout: 60000 });
const idx = await g.evaluate(
    () => window.__state.manifest.maps.findIndex((m) => m.id === "s260"));
await (await g.$("#mapSelect")).selectOption({ index: idx });
await g.waitForTimeout(900);
await g.screenshot({ path: `${out}/05-arrival.png` });
console.log("05-arrival on",
    await g.evaluate(() => window.__state.manifest.maps[window.__state.mapIdx].id));
await b.close();
