import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";
const out = process.argv[2] || "/tmp/opencode/pausemenu"; mkdirSync(out, { recursive: true });
const b = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const p = await b.newPage({ viewport: { width: 1100, height: 760 } });
p.on("pageerror", e => console.log("PAGEERROR:", e.message));
await p.goto(`${baseUrl(8742)}/ui-lab.html`, { waitUntil: "load" });
await p.waitForFunction(() => document.getElementById("game")?.contentWindow?.__labOpen
  && document.getElementById("game").contentWindow.__state?.started, null, { timeout: 30000 });
const shot = async n => { await p.screenshot({ path: `${out}/${n}.png` }); console.log("shot", n); };
const ev = (fn, ...a) => p.evaluate(fn, ...a);
const st = () => ev(() => {
  const w = document.getElementById("game").contentWindow, m = w.__menu;
  return { open: w.__state.menuOpen, screen: m?.screen, mode: m?.itemMode, cat: m?.itemCat,
           itemCursor: m?.itemCursor, statusCursor: m?.statusCursor,
           bag: (w.__state.inventory ?? []).map((s) => `${s.id}x${s.qty}`),
           worn: w.__state.equipment?.[0] ?? null };
});
// One press, then report where the menu actually landed -- the navigation is the
// thing being measured, so it is never assumed.
const key = async (k, label) => {
  await p.keyboard.press(k);
  await p.waitForTimeout(900);
  console.log(`  ${label ?? k} -> ${JSON.stringify(await st())}`);
};

await p.click('[data-scr="menu"]');
await p.waitForTimeout(1500);
await p.click("#game"); await p.waitForTimeout(400);

// One Short Sword in the bag, exactly what buying one at the armory leaves behind.
await ev(() => {
  const s = document.getElementById("game").contentWindow.__state;
  s.inventory = [{ id: 92, qty: 1 }];
});
console.log("p1 top list: EXPECT ITEMS/SORT/MAP/TECHNIQUES/STATUS(+CARD FOLDERS), three party cards left, BIT bottom-left");
await shot("p1-topmenu"); console.log(" ", JSON.stringify(await st()));

await key("z", "z on ITEMS");
await shot("p2-cats"); console.log("  EXPECT 'Which one?' + Items/Weapons/Armor/Accessories/Important Items");
await key("ArrowDown", "Down -> Weapons (cat should become 1)");
await key("z", "z on Weapons (bag has one Short Sword -> enter the list)");
await shot("p3-weapons"); console.log("  EXPECT the sword row + band 'Short Sword | Equip 0 | Items 1' + 'Short katana. Left or Right'");
await key("z", "z on the sword (the original's equip-who path)");
await shot("p3b-equipwho"); console.log("  EXPECT an equip target picker; worn.right must become 92 after confirming");
await key("z", "z confirm"); console.log(" ", JSON.stringify(await st()));

await key("x", "x back"); await key("x", "x back"); await key("x", "x back");
if (!(await st()).open) { console.log("  menu closed, reopening"); await ev(() => document.getElementById("game").contentWindow.__labOpen("menu")); await p.waitForTimeout(1200); }
for (let i = 0; i < 4; i++) await key("ArrowDown", `down${i + 1}`);
console.log("  EXPECT cursor on STATUS");
await key("z", "z on STATUS");
await shot("p4-status-choose"); console.log("  EXPECT 'Choose Digimon', cursor framed on the first card");

const wear = (on) => ev((v) => {
  const s = document.getElementById("game").contentWindow.__state;
  s.equipment = s.equipment || [];
  s.equipment[0] = v ? { right: 92 } : {};
}, on);

await wear(false); await p.waitForTimeout(400);
await key("z", "z on member");
await p.waitForTimeout(1400);
await shot("p5-sheet-bare"); console.log("  EXPECT bare sheet: one number per stat line, no arrow, no second colour");

await wear(true); await p.waitForTimeout(1400);
await shot("p6-sheet-worn"); console.log("  EXPECT the SAME sheet with POW +14 and CHR +15 only (claim EQUIP-C018)");
b.close();
