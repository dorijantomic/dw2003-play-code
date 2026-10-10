// The three Charisma items are what opens a tamer's duel when levelling has not.
//
// Charisma Chip (54) permanently raises the stat; Charisma Gem (302, +20) and Charisma
// Ring (303, +30) are accessories. All three exist for exactly one purpose: the bank-0x72
// ladder a roaming card tamer checks before agreeing to duel you
// (charisma-flag-bank-72-is-derived-party-charisma-threshold-predicate). Until this run
// none of them reached the sum — the gate read stored stats only, so levelling was the
// only way past a rung.
//
// The accessory AMOUNTS are the walker's own equipment model, a stated assumption: the
// native adds a per-item modifier from a table that is not decoded. The arithmetic around
// it is decoded, and that is what this checks — through the real ITEMS and EQUIP screens,
// driven by keys, not by writing the numbers in.
//
// The shots land in a scratch directory inside the worktree (.bunny-scratch/ is
// git-ignored), never in /tmp: the shots are evidence and /tmp is RAM.
//
//   python3 -m http.server 8742 --directory web
//   tools/run-playwright.sh tools/verify_charisma_items.mjs [out-dir]
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { baseUrl } from "./verify-base-url.mjs";

const origin = `${baseUrl(8742)}`;
const outDir = process.argv[2] ?? ".bunny-scratch/charisma-items";
mkdirSync(outDir, { recursive: true });

// Tamer Mitch at s335 sits on rung 9: party Charisma >= 1218, flag 0x7209.
const RUNG_FLAG = 0x7209;
const RUNG = 1218;
const PER_MEMBER = 400;          // 3 x 400 = 1200, eighteen short of the rung
const FOLDER_BAG = 402;          // his duelling variant only spawns if you carry it

const browser = await chromium.launch({
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const context = await browser.newContext({
  viewport: { width: 900, height: 700 },
  storageState: {
    cookies: [],
    origins: [{
      origin,
      localStorage: [
        { name: "engineSchema", value: "2" },
        { name: "assetMode", value: "authentic" },
        { name: "progressOrdinal", value: "20" },
        { name: "charId", value: "p003pken" },
        { name: "party", value: JSON.stringify(["p003pken", "p005koet", "p004kogu"]) },
      ],
    }],
  },
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

await page.goto(`${origin}/?skipTitle=1&map=s335&noEncounters=1`, { waitUntil: "load" });
await page.waitForFunction(() => window.__state?.started && window.__storyFlags, null,
  { timeout: 40000 });
await page.waitForFunction(() => window.__partyCharisma() != null, null, { timeout: 20000 });

const tap = (k) => page.evaluate((kk) => {
  window.dispatchEvent(new KeyboardEvent("keydown", { key: kk }));
  window.dispatchEvent(new KeyboardEvent("keyup", { key: kk }));
}, k);
const taps = async (...keys) => { for (const k of keys) { await tap(k); await page.waitForTimeout(60); } };
// The ported pause pages read the pad one frame behind the held word
// (web/status-translated.js:191), so they need a key that is genuinely held
// across a frame. Drive them the way verify_pause_walk does — a real keydown,
// a hold, a keyup — rather than with the synthetic tap above, which the walker
// menu consumed synchronously and the ported pages never saw.
const press = async (key, ms = 90) => {
  await page.keyboard.down(key);
  await page.waitForTimeout(ms);
  await page.keyboard.up(key);
  await page.waitForTimeout(320);
};
const charisma = () => page.evaluate(() => window.__partyCharisma());
const gate = () => page.evaluate((f) => window.__storyFlags.get(f), RUNG_FLAG);
const menuState = () => page.evaluate(() => ({
  screen: window.__menu.screen, focus: window.__menu.detailFocus,
  equipCursor: window.__menu.equipCursor, equipFocus: window.__menu.equipFocus,
  itemCursor: window.__menu.itemCursor, itemMode: window.__menu.itemMode,
}));

// ── the starting point: just short of the rung ─────────────────────────────
await page.evaluate(({ per, bag }) => {
  const s = window.__state;
  const put = (rec) => { if (rec) rec.stats = { ...(rec.stats ?? {}), chr: per }; };
  put(s.partnerStats);
  s.partyStats = s.partyStats ?? [];
  for (let i = 0; i < (s.party?.length ?? 0); i++) {
    s.partyStats[i] = s.partyStats[i] ?? {};
    put(s.partyStats[i]);
  }
  // The bag the tamer's duelling variant needs, plus one of each Charisma item to spend.
  s.inventory = [{ id: 54, qty: 1 }, { id: 303, qty: 1 }, { id: bag, qty: 1 }];
  s.equipment = (s.party ?? []).map(() => ({}));
}, { per: PER_MEMBER, bag: FOLDER_BAG });

const start = await charisma();
console.log(`stored Charisma only: ${start}`);
assert.equal(start, PER_MEMBER * 3, "the three deployed positions sum their stored stat");
assert.ok(start < RUNG, `${start} must sit below the rung ${RUNG}`);
assert.equal(await gate(), 0, "below the rung the gate reads 0");

// ── the tamer, before any item: the brush-off ───────────────────────────────
const faceTamer = async () => {
  await page.evaluate(() => window.__teleport(593, 319));
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp" })));
  await page.waitForTimeout(140);
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent("keyup", { key: "ArrowUp" })));
  await page.waitForTimeout(250);
};
const dismiss = async () => {
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(160);
    if (!(await page.evaluate(() => window.__textbox?.isOpen?.() ?? false))) break;
    await tap(" ");
  }
  await page.waitForTimeout(300);
};
const lineHere = async () => {
  await faceTamer();
  return page.evaluate(() => {
    const t = window.__talkTarget();
    const launch = (t?.state?.on_close ?? []).find((c) => ((c.id >> 8) & 0xfe) === 0x76);
    return { npc: t?.npc ?? null, index: t?.state?.dialogue?.index ?? null,
             duelFlag: launch ? `0x${launch.id.toString(16)}` : null };
  });
};

await faceTamer();
await tap(" ");
await dismiss();                      // past his first-meeting line

const before = await lineHere();
console.log("before any Charisma item:", JSON.stringify(before));
assert.equal(before.npc, 47, "the duelling variant must be the tamer standing here");
assert.equal(before.index, 112, "short of the rung he gives the brush-off line");
assert.equal(before.duelFlag, null, "and that line launches nothing");
await faceTamer();
await tap(" ");
await page.waitForTimeout(600);
await page.screenshot({ path: resolve(outDir, "1-brush-off-before-items.png") });
await dismiss();

// ── the Charisma Chip, eaten from the real ITEMS screen ─────────────────────
// START opens the pause home, and the home is the ported page's own home list
// (web/game.js:5152 status.openHome); the ITEMS row then hands the pad to the
// ported items page (web/game.js PAUSE_PAGE_ENTRIES, label -> "items"). This
// walks THAT page with real keys, the route verify_pause_walk drives:
//   ITEMS -> "Which one?" -> the Items bag -> the chip -> "Choose Digimon" -> the lead.
// The page holds the roster in its own RAM (F0x80048D34 + 0x3DC) and hands it back
// when it closes, so the bonus only reaches window.__state after Back out of it.
await press("i");                                  // START: the pause home
await page.waitForFunction(() => window.__status?.diagnostics?.().entry === "home",
    null, { timeout: 20000 });
// The home is up as soon as open() names it, but its own fold is still running and
// the pad is not read until the input step (F0x8001270c case 3, obj+0x10 == 3), so
// every wait here is on the page's own words rather than on a fixed key count.
const waitFor = async (read, want, what, tries = 400) => {
    let got = null;
    for (let i = 0; i < tries; i++) {
        got = await page.evaluate(read);
        if (JSON.stringify(got) === JSON.stringify(want)) return;
        await page.waitForTimeout(100);
    }
    throw new Error(`the ported pause page never reached ${what}: got ${JSON.stringify(got)}`);
};
// The pause home list: [0x0C main step, 0x10 sub-step]; 1/3 is the input step.
const HOME_STEP = () => {
    const s = window.__status, mem = s?._session?.mem, root = s?._session?.root;
    return mem && root ? [mem.read32(root + 0xc) | 0, mem.read32(root + 0x10) | 0] : null;
};
// The items page's own jump-table state word (F0x80090264): 0x0A "Which one?",
// 0x10 the bag grid, 0x19 "Choose Digimon", 0x65 the line the applied item printed.
const ITEMS_STATE = () => {
    const mem = window.__status?._session?.mem;
    const obj = window.__status?.diagnostics?.().page;
    return mem && obj ? (mem.read32(obj + 0x10) | 0) : null;
};
const waitHome = (what) => waitFor(HOME_STEP, [1, 3], `the pause home's input step (${what})`);
const waitItems = (want, what) => waitFor(ITEMS_STATE, want, `items state 0x${want.toString(16)} (${what})`);

await waitHome("before picking a row");
await press(" ");                                  // ITEMS is the first row
await page.waitForFunction(() => window.__status?.diagnostics?.().entry === "items",
    null, { timeout: 30000 });
assert.equal((await menuState()).screen, "home",
  "the ITEMS row must hand the pad to the ported page, not to a walker panel");

await waitItems(0x0a, '"Which one?" is up');
await press(" ");                                  // Items -> the bag grid
await waitItems(0x10, "the bag grid");
await press(" ");                                  // the chip -> "Choose Digimon"
await waitItems(0x19, '"Choose Digimon" is up');
// The bag hands the chosen item back on the page's own fields: the original
// writes parent unk7C = the cell index and unk78 = the item id when Circle is
// pressed on a usable row (spec 3.2, "Cursor restore ... by item id").
const picked = await page.evaluate(() => {
    const mem = window.__status?._session?.mem;
    const obj = window.__status?.diagnostics?.().page;
    return mem && obj ? { index: mem.read32(obj + 0x7c) | 0, item: mem.read32(obj + 0x78) | 0 } : null;
});
assert.equal(picked?.item, 54,
  `the bag must hand back the Charisma Chip (54), not ${JSON.stringify(picked)}`);
await page.waitForTimeout(900);   // let the window fold-open tween settle
await page.screenshot({ path: resolve(outDir, "2-items-charisma-chip.png") });
await press(" ");                                  // on the lead -> the chip applies
await waitItems(0x65, "the applied line is up");
await page.screenshot({ path: resolve(outDir, "2b-items-charisma-applied.png") });
await press(" ");                                  // back to "Which one?"
await waitItems(0x0a, '"Which one?" is up again');
// Back out of the page: it hands the roster it wrote to the walker's state and
// puts the pause home back up (web/status-translated.js:203).
await press("x");
await page.waitForFunction(() => window.__status?.diagnostics?.().entry === "home",
    null, { timeout: 30000 });
await waitHome("after Back");
await press("x");                                  // and Back closes the menu
await page.waitForFunction(() => window.__status?.isOpen?.() === false, null, { timeout: 30000 });
assert.equal(await page.evaluate(() => window.__state.menuOpen), false,
  "Back must leave the pause menu");

const afterChip = await charisma();
// Where the chip's permanent +CHR lands. The ported page writes the roster
// record's six core halfwords (record +0x30..+0x3A) and its read-back
// (web/status-translated.js readBack) copies them onto rec.core, so the member's
// effective Charisma is what the record now says.
const chipBonus = await page.evaluate(() => {
    const rec = window.__state.partnerStats;
    const core = Array.isArray(rec?.core) ? rec.core[5] : null;
    const stored = rec?.stats?.chr ?? 0;
    const chip = rec?.bonuses?.chr ?? 0;
    return { core, stored, chip, fromCore: core == null ? null : core - stored };
});
console.log(`after the Charisma Chip: ${afterChip} (chip bonus ${JSON.stringify(chipBonus)})`);
// Two halves of one number: the roster record's core halfword rose by the rolled
// amount (the original's own word, record +0x32), and the read-back folded that
// rise into bonuses.chr, which is where the bank-0x72 Charisma predicate reads it.
assert.ok(chipBonus.fromCore > 0,
  `the roster record's Charisma halfword must rise when a chip is eaten: ${JSON.stringify(chipBonus)}`);
assert.equal(chipBonus.core, chipBonus.stored + chipBonus.chip,
  "and the walker's stored stat plus its chip bonus must equal it");
assert.equal(chipBonus.chip, chipBonus.fromCore,
  "the read-back must fold the record's rise into bonuses.chr");
assert.equal(afterChip, start + chipBonus.chip, "and that bonus must reach the party total");
assert.ok(afterChip < RUNG, "the chip alone is still short of this tamer's rung");

// ── the Charisma Ring, equipped from the real EQUIP screen ──────────────────
// The STATUS row hands over to the ported STATUS page the same way ITEMS did, and
// the equipment window inside it is the original's own page (equip root
// F0x80088214, tick F0x8008744C): six slots, its slot cursor at obj+0x60, and the
// item list it offers at obj+0x78 with obj+0x78[0] = 0xFFFF, the "take it off"
// sentinel. All of those are read off the page rather than assumed.
const EQUIP_HANDLER = 0x80088214;
const equipWindow = () => page.evaluate((cid) => {
    const s = window.__status, mem = s?._session?.mem;
    for (const t of (s?._session?.tree?.tasks?.values?.() ?? [])) {
        if ((t.classId >>> 0) !== cid) continue;
        const a = t.address | 0;
        return {
            state: mem.read32(a + 0x10) | 0, slot: mem.read32(a + 0x60) | 0,
            count: mem.read32(a + 0x68) | 0,
            items: Array.from({ length: 8 }, (_, i) => mem.read16(a + 0x78 + i * 2)),
        };
    }
    return null;
}, EQUIP_HANDLER);
const waitEquip = async (want, what) => {
    let got = null;
    for (let i = 0; i < 400; i++) {
        got = await equipWindow();
        if (got && got.state === want) return got;
        await page.waitForTimeout(100);
    }
    throw new Error(`the equipment window never reached state 0x${want.toString(16)} (${what}): `
        + `got ${JSON.stringify(got)}`);
};

await press("i");                                  // START: the pause home again
await page.waitForFunction(() => window.__status?.diagnostics?.().entry === "home",
    null, { timeout: 30000 });
await waitHome("before picking STATUS");
// Walk the cursor onto STATUS by the home list's own row word (F0x8001270c obj+0x58)
// rather than counting presses: the pages read the pad one frame behind the held
// word, so a press can be missed and a fixed count would silently aim at the
// wrong row.
const homeRow = () => page.evaluate(() => {
    const mem = window.__status?._session?.mem, root = window.__status?._session?.root;
    return mem && root ? mem.read32(root + 0x58) | 0 : null;
});
let row = null;
for (let i = 0; i < 12 && row !== 4; i++) {
    await press("ArrowDown", 70);
    row = await homeRow();
}
assert.equal(row, 4, `the cursor must sit on STATUS, not row ${row}`);
await press(" ");                                  // STATUS
await page.waitForFunction(() => window.__status?.diagnostics?.().entry === "status",
    null, { timeout: 30000 });
await page.waitForTimeout(1500);   // the partner's cards fold open before the pad is read
await press(" ");                                  // the lead
await page.waitForTimeout(1500);
await press("ArrowDown", 70);                      // "See Equipment"
await press(" ");                                  // open the window
const slots = await waitEquip(3, "the six-slot list");
assert.equal(slots.slot, 0, `the slot list opens on slot 0, not ${slots.slot}`);
// The six equipment slots are walked the same way, on the window's own cursor
// (F0x8008744C obj+0x60); slot 4 is the first Accessory slot.
let slot = null;
for (let i = 0; i < 12 && slot !== 4; i++) {
    await press("ArrowDown", 70);
    slot = (await equipWindow())?.slot ?? null;
}
assert.equal(slot, 4, `the first Accessory slot is slot 4, not ${slot}`);
await page.waitForTimeout(600);
await page.screenshot({ path: resolve(outDir, "3-equip-accessory-slot.png") });
await press(" ");                                  // open the item list for that slot
await waitEquip(0xf, "the item list");
const offered = await equipWindow();
assert.equal(offered.items[0], 0xffff, "row 0 of an empty slot is the remove sentinel");
assert.ok(offered.items.includes(303),
  `the Charisma Ring must be offered for the accessory slot: ${JSON.stringify(offered.items)}`);
await page.waitForTimeout(900);
await page.screenshot({ path: resolve(outDir, "3-equip-accessory-list.png") });
await press("ArrowDown", 70);                      // off the sentinel onto the Ring
await press(" ");                                  // equip it
await waitEquip(3, "the slot list again");
// Back out of the window, the sheet, the picker, then the pause home; the page
// hands the worn gear back to the walker as it closes, so keep pressing until it
// is actually gone rather than counting backs.
for (let i = 0; i < 12; i++) {
    if (!(await page.evaluate(() => window.__status?.isOpen?.() ?? false))) break;
    await press("x");
    await page.waitForTimeout(900);
}
assert.equal(await page.evaluate(() => window.__status?.isOpen?.() ?? true), false,
  "Back must close the pause page");
assert.equal(await page.evaluate(() => window.__state.menuOpen), false,
  "and leave the pause menu");

const equipped = await page.evaluate(() => window.__state.equipment[0]?.acc0 ?? null);
assert.equal(equipped, 303, "the Charisma Ring must be in the accessory slot");
const afterRing = await charisma();
console.log(`after equipping the Charisma Ring: ${afterRing}`);
assert.equal(afterRing, afterChip + 30, "the Ring's +30 must reach the party total");
assert.ok(afterRing >= RUNG, `${afterRing} must now clear the rung ${RUNG}`);
await page.waitForTimeout(900);
await page.screenshot({ path: resolve(outDir, "4-equipped.png") });
assert.equal(await gate(), 1, "at the rung the gate must read 1");

// ── the same tamer, same level, now willing to duel ─────────────────────────
// The menu is already closed: the equipment leg pressed Back until the ported page
// reported itself gone. Assert it rather than count presses, so a tamer line read
// out of a still-open menu cannot pass for a field conversation.
assert.equal(await page.evaluate(() => window.__state.menuOpen), false,
  "the menu must be closed before talking");
await page.waitForTimeout(300);

const after = await lineHere();
console.log("after the chip and the ring:", JSON.stringify(after));
assert.equal(after.index, 113, "at the rung he challenges you instead");
assert.equal(after.duelFlag, "0x7606", "and that line writes his duel launcher");
await faceTamer();
await tap(" ");
await page.waitForTimeout(600);

// Dismiss the challenge box and let the on_close launch the duel; poll rather
// than assume a fixed delay.
let duelOpen = false, probe = null;
for (let i = 0; i < 60 && !duelOpen; i++) {
  await page.waitForTimeout(150);
  probe = await page.evaluate(() => ({
    duel: window.__cardDuel?.isOpen?.() ?? false,
    textbox: window.__textbox?.isOpen?.() ?? false,
    pendingDuelId: window.__state?.pendingDuelId ?? null,
  }));
  if (probe.duel) duelOpen = true;
  else if (probe.textbox) await tap(" ");
}
console.log("challenge probe:", JSON.stringify(probe));
assert.equal(duelOpen, true, "the challenge must launch the duel");
await page.screenshot({ path: resolve(outDir, "6-duel-launched.png") });

assert.deepEqual(errors, [], `page errors: ${errors.join(" | ")}`);
console.log(`charisma items OK: ${start} -> ${afterChip} -> ${afterRing}, rung ${RUNG} cleared -> ${outDir}`);
await browser.close();
