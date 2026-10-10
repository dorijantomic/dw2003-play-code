// tools/verify_inn.mjs — the inn, reached the way a player reaches it.
//
// Walks the player up to the innkeeper (NPC 20, sprite p039tail) on two decoded
// inn maps, presses the confirm button, and shows that the rest prompt which
// opens carries THAT inn's decoded price: 8 BIT at the Asuka Inn (s235) and
// 32 BIT at the Swamp Inn (s470). Nothing in this script supplies a price or a
// name — both come from the record table the screen resolves off the current
// map (`D0x8003edcc`, see engine/dw3/inn.ts).
//
// It also confirms the shape of the trigger: the innkeeper speaks FIRST, and the
// rest screen opens when that box closes, because it is the dialogue state's
// `on_close` bank-0x7A write that launches it.
//
// Run with a web server on port 8742:
//   python3 -m http.server 8742 --directory web
//   tools/run-playwright.sh tools/verify_inn.mjs [output-directory]
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { baseUrl } from "./verify-base-url.mjs";

const origin = `${baseUrl(8742)}`;
const outDir = resolve(process.argv[2] ?? "/tmp/inn");
await mkdir(outDir, { recursive: true });

// [map, innkeeper x, y, decoded price per Digimon]
const STOPS = [
  ["s235", 188, 154, 8],
  ["s470", 357, 278, 32],
];

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 900, height: 700 },
  storageState: {
    cookies: [],
    origins: [{
      origin,
      localStorage: [
        { name: "engineSchema", value: "2" },
        // Without a saved mode the first-launch visual chooser covers the frame.
        { name: "assetMode", value: "authentic" },
        // Past the opening, so the field is interactive and the story bridge idle.
        { name: "progressOrdinal", value: "45" },
        { name: "charId", value: "p003pken" },
        { name: "party", value: JSON.stringify(["p003pken", "p005koet", "p004kogu"]) },
      ],
    }],
  },
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

const tap = (k) => page.evaluate((kk) => {
  window.dispatchEvent(new KeyboardEvent("keydown", { key: kk }));
  window.dispatchEvent(new KeyboardEvent("keyup", { key: kk }));
}, k);
const hold = async (k, ms) => {
  await page.evaluate((kk) =>
    window.dispatchEvent(new KeyboardEvent("keydown", { key: kk })), k);
  await page.waitForTimeout(ms);
  await page.evaluate((kk) =>
    window.dispatchEvent(new KeyboardEvent("keyup", { key: kk })), k);
};

let failed = 0;
for (const [map, nx, ny, price] of STOPS) {
  // Boot straight onto the inn map, past the title and the opening.
  await page.goto(`${origin}/?skipTitle=1&map=${map}&noEncounters=1`, { waitUntil: "load" });
  await page.waitForFunction(() => window.__state?.started && window.__talkTarget, null,
    { timeout: 40000 });
  await page.waitForTimeout(1000);
  // Clear anything the map-enter event put on screen.
  for (let i = 0; i < 40; i++) {
    const busy = await page.evaluate(() =>
      (window.__textbox?.isOpen?.() ?? false) || (window.__cutscene?.isActive?.() ?? false));
    if (!busy) break;
    await tap(" ");
    await page.waitForTimeout(150);
  }
  // Stand well below the innkeeper, then walk up so the player ends up facing it.
  await page.evaluate(([x, y]) => window.__teleport(x, y), [nx, ny + 30]);
  await page.waitForTimeout(500);
  await hold("ArrowUp", 150);
  await page.waitForTimeout(300);

  // Prove we are addressing the innkeeper and not whoever else is in the room.
  const target = await page.evaluate(() => window.__talkTarget());
  assert.equal(target?.npc, 20, `${map}: expected to be facing the innkeeper, got ${JSON.stringify(target)}`);

  await tap(" ");                       // opens the innkeeper's spoken line
  await page.waitForTimeout(500);
  const spoke = await page.evaluate(() => window.__textbox?.isOpen?.() ?? false);
  await page.screenshot({ path: resolve(outDir, `${map}-1-talk.png`) });

  // Close the box; its on_close is the bank-0x7A write that opens the rest screen.
  // The translated box needs one press per page, as the original does, so the
  // cap is a time limit (40 x 400 ms), not a page count.
  for (let i = 0; i < 40; i++) {
    if (await page.evaluate(() => !!window.__inn?.isOpen?.())) break;
    await tap(" ");
    await page.waitForTimeout(400);
  }
  await page.waitForTimeout(400);
  await page.screenshot({ path: resolve(outDir, `${map}-2-inn.png`) });

  const seen = await page.evaluate(() => {
    const i = window.__inn;
    // The translated inn (default) reports its record and painted text through
    // diagnostics(); ?legacyInn=1 keeps the old fields.
    const d = i?.diagnostics?.();
    return {
      open: !!i?.isOpen?.(),
      name: d?.inn?.name ?? i?._innName ?? "",
      price: d?.inn?.price ?? i?._price ?? null,
      sel: i?.selection?.() ?? null,
      options: d ? (d.painted ?? []) : (i?._data?.prompt?.options ?? []),
      cursor: d ? null : (i?._data?.layout?.cursor ?? null),
      clips: d ? [] : (i?._data?.layout?.windows ?? []).flatMap((w) => w.pieces.map((q) => q.clip)),
    };
  });
  const ok = seen.open && seen.price === price;
  console.log(`${map}: innkeeper-spoke=${spoke} inn-open=${seen.open} ` +
    `name=${JSON.stringify(seen.name)} price=${seen.price} sel=${seen.sel} ` +
    `options=${JSON.stringify(seen.options)} cursor=${JSON.stringify(seen.cursor)} ` +
    `clips=${JSON.stringify(seen.clips)} expect=${price} -> ${ok ? "OK" : "FAIL"}`);
  if (!ok) failed += 1;

  // The two-row selector: the cursor drops one 16px row onto "Do not stay".
  await tap("ArrowDown");
  await page.waitForTimeout(300);
  await page.screenshot({ path: resolve(outDir, `${map}-3-row2.png`) });
  const row2 = await page.evaluate(() => window.__inn?.selection?.());
  if (row2 !== 1) { console.log(`${map}: cursor did not move to row 1 (sel=${row2})`); failed += 1; }

  // Leave the screen closed before moving on.
  await tap("Escape");
  await page.waitForTimeout(300);
}

if (errors.length) console.log("PAGEERRORS:", errors);
await browser.close();
console.log(failed ? `${failed} stop(s) FAILED` : "all stops OK");
process.exit(failed || errors.length ? 1 : 0);
