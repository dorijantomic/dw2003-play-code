import { chromium } from "playwright";
import { baseUrl } from "./verify-base-url.mjs";

// This exercises the HAND-AUTHORED folder editor (web/carddeck.js): the native
// pro/stcrddek route is the default now (tools/verify_native_deck.mjs), so this
// verifier asks for the ?legacyDeck=1 rollback.
const OUT = process.argv[2] || "captures/legacy-deck-lab";
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1100, height: 760 } });
p.on("pageerror", (e) => console.log("PAGE ERROR:", e.message));
await p.goto(`${baseUrl(8742)}/ui-lab.html?legacyDeck=1`);
await p.waitForTimeout(4000);

const frame = p.frames().find((f) => f.url().includes("index.html")) ?? p.mainFrame();

// The gate is "the player holds cards". Report what the game itself thinks.
const unlocked = await frame.evaluate(() => {
  const m = window.__menu ?? null;
  return { hasMenu: !!m, unlocked: m?.cardFolderUnlocked?.() ?? null };
});
console.log("gate:", JSON.stringify(unlocked));

// Open the status menu and drive to the last row.
await frame.evaluate(() => window.__labOpen && window.__labOpen("menu"));
await p.waitForTimeout(1200);

const rows = await frame.evaluate(() => {
  const m = window.__menu;
  if (!m) return null;
  return { screen: m.screen, cursor: m.mainCursor };
});
console.log("menu state:", JSON.stringify(rows));

await p.screenshot({ path: `${OUT}/menu-home.png` });

// Step the cursor down to CARD FOLDERS and confirm. The lab's list is the
// pause's own translated list (one list since 2026-10-04), so the row is read
// out of its RAM instead of counting blind key presses.
const canvas = await frame.$("canvas");
await canvas?.click();
const row = () => frame.evaluate(() => {
    const s = window.__status?._session;
    return s && window.__status?.diagnostics?.().entry === "home" ? (s.mem.read32(s.root + 0x58) | 0) : null;
});
const hold = async (key) => {
    await p.keyboard.down(key);
    await p.waitForTimeout(220);
    await p.keyboard.up(key);
    await p.waitForTimeout(260);
};
for (let n = 0; n < 12; n++) {
    const at = await row();
    if (at === 5) break;
    await hold(at === null || at < 5 ? "ArrowDown" : "ArrowUp");
}
console.log("cursor row:", await row());
await p.screenshot({ path: `${OUT}/menu-cursor-last.png` });
// The translated list samples the HELD pad once a frame, so a tap can fall
// between two frames; hold the key (BROWSER-NATIVE-SCREEN-INPUT-2026-09-21).
await p.keyboard.down("c"); // Cross confirms on the list, as on the disc
await p.waitForTimeout(250);
await p.keyboard.up("c");
// The page's data is fetched on open, so wait for its own root (0x80084a98)
// rather than for a fixed time.
await frame.waitForFunction(
    () => (window.__status?.diagnostics?.().classes ?? []).includes(0x80084a98),
    null, { timeout: 30000 },
).catch(() => {});

// Since 2026-10-04 the CARD FOLDERS row of the lab's list opens the PAUSE's own
// page (root 0x80084a98, translated) rather than web/menu.js's hand-drawn
// panel, so both are read here: menu.screen must NOT be "cardfolder" any more.
const after = await frame.evaluate(() => ({
  screen: window.__menu?.screen ?? null,
  pauseEntry: window.__status?.diagnostics?.().entry ?? null,
  pauseOpen: window.__status?.isOpen?.() ?? false,
  pageRoots: (window.__status?.diagnostics?.().classes ?? []).map((c) => `0x${c.toString(16)}`),
}));
console.log("after confirm:", JSON.stringify(after));
await p.screenshot({ path: `${OUT}/cardfolder.png` });

await b.close();
