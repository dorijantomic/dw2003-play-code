import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";
const out = process.argv[2] || "/tmp/opencode/gearaccess"; mkdirSync(out, { recursive: true });
const b = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const p = await b.newPage({ viewport: { width: 1100, height: 760 } });
p.on("pageerror", e => console.log("PAGEERROR:", e.message));
await p.goto(`${baseUrl(8742)}/ui-lab.html`, { waitUntil: "load" });
await p.waitForFunction(() => document.getElementById("game")?.contentWindow?.__labOpen && document.getElementById("game").contentWindow.__state?.started, null, { timeout: 30000 });
await p.click('[data-scr="shop"]');
await p.waitForTimeout(1200);
await p.click("#game"); await p.waitForTimeout(300);
const key = async (k, ms = 700) => { await p.keyboard.press(k); await p.waitForTimeout(ms); };
const shot = async n => { await p.screenshot({ path: `${out}/${n}.png` }); console.log("shot", n); };
const party = await p.evaluate(() => document.getElementById("game").contentWindow.__state.party);
console.log("party:", JSON.stringify(party), "(Kotemon=0 Renamon=6 Patamon=7)");
await key("ArrowUp"); await key("c");            // BUY -> list, cursor on Short Sword (mask 0x01)
await shot("a1-list");
await key("z"); await shot("a2-shortsword");     // Effects cards
console.log("EXPECT shortsword: card0 Kotemon rows (POW 48->62 then CHR 1->16), card1 Renamon X, card2 Patamon X");
await key("ArrowDown"); await key("ArrowDown"); await key("ArrowDown"); await key("ArrowDown");
await shot("a3-bamboospear");                    // BambooSpear (mask 0xc0 -> Renamon+Patamon only)
console.log("EXPECT bamboo spear (if reached): Kotemon X, Renamon+Patamon rows");
// Bandanna is column 1, row 2 of the fresh BUY list: reopen the shop so the
// cursor is known, then step Right, Down, Down. The armour card leads with DEF
// and puts Charisma second, the same order a weapon card uses.
await p.click('[data-scr="shop"]');
await p.waitForTimeout(1200);
await p.click("#game"); await p.waitForTimeout(300);
await key("ArrowUp"); await key("c");            // BUY -> list, cursor Short Sword
await key("ArrowRight"); await key("ArrowDown"); await key("ArrowDown");
await key("z");
await shot("a4-bandanna");
console.log("EXPECT bandanna: all three cards readable, DEF row first then CHR row");
// The pawn shop (the lab's second Shop button) stocks accessories, whose card is
// laid out the other way round: Charisma first, then the stat the item codes.
await p.click('[data-scr="shop"][data-arg="1"]');
await p.waitForTimeout(1400);
await p.click("#game"); await p.waitForTimeout(300);
await key("ArrowUp"); await key("c");   // BUY -> list, cursor on Power Gem (fam 21)
await key("z");
await shot("a5-powergem");
console.log("EXPECT power gem: all three cards readable, CHR row first then the STR row");
b.close();
