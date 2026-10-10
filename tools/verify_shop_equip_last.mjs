// The last-copy Equip who? exit, in the real game route and in the opt-in
// original-code shop. Run through tools/run-playwright.sh with web/ served on
// VERIFY_PORT (default 8742):
//   VERIFY_PORT=8837 tools/run-playwright.sh tools/verify_shop_equip_last.mjs .bunny-scratch/shop-equip-last
//
// The browser route is the shipped translated merchant (engine/dw3/ui
// ShopRootSession), so the steps are waited for on the actor's own state word
// rather than on a fixed key count: the confirm key is CROSS and each fold
// animation has to finish before the next screen exists.
import { chromium } from "playwright";
import { mkdirSync, readFileSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";

const out = process.argv[2] ?? ".bunny-scratch/shop-equip-last";
mkdirSync(out, { recursive: true });
// The merchant's BUY tab actor's own tick address, as the shipped screen census
// recorded it (data/native_screen_roots.json -> web/assets/native/screens/
// manifest.json, pro/stitshop `tick`). The native route's buy screen is that
// object, so its `+0x10` is the same state word the translated route's buy actor
// carries, and both legs can wait on it instead of on a sleep.
const SHOP_BUY_TICK = JSON.parse(
  readFileSync("web/assets/native/screens/manifest.json", "utf8"),
).screens["pro/stitshop"].tick;
const browser = await chromium.launch();
let failures = 0;

/** The buy actor's own state word: 3 is its live item list, 39 the equipped result. */
for (const [name, native] of [["reference", true], ["browser", false]]) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const actorState = () => page.evaluate((tick) => {
    const session = window.__shop?._session;
    if (session) {
      const context = session.mem.read32(session.root + 0x24);
      const actor = session.mem.read32(context + 0x1c);
      return actor ? session.mem.read32(actor + 0x10) : null;
    }
    // Native route: the live object whose callback is the census's tick for this
    // screen. Nothing about the layout is assumed.
    const host = window.__shop?._host;
    const actor = (host?.rt?.world?.objects ?? []).find((o) => (o.cb >>> 0) === tick);
    return actor ? host.read((actor.addr >>> 0) + 0x10, 4) : null;
  }, SHOP_BUY_TICK);
  const waitActorState = (value, timeout = 20000) => page.waitForFunction(([tick, want]) => {
    const session = window.__shop?._session;
    if (session) {
      const context = session.mem.read32(session.root + 0x24);
      const actor = session.mem.read32(context + 0x1c);
      return !!actor && session.mem.read32(actor + 0x10) === want;
    }
    const host = window.__shop?._host;
    const actor = (host?.rt?.world?.objects ?? []).find((o) => (o.cb >>> 0) === tick);
    return !!actor && host.read((actor.addr >>> 0) + 0x10, 4) === want;
  }, [SHOP_BUY_TICK, value], { timeout });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  if (!native) await page.route("**/assets/native/**", route => route.abort());
  await page.goto(`${baseUrl(8742)}/index.html?skipTitle=1&noEncounters=1${native ? "&nativeShop=1" : ""}`);
  await page.waitForFunction(() => window.__state?.started);
  await page.evaluate(() => {
    window.__state.bits = 10000;
    window.__state.inventory = [];
    window.__state.equipment = [{}, {}, {}];
    window.__labOpen("shop", 0);
  });
  // One key down/up. What a press is followed by is the SCREEN's answer, never a
  // sleep: the native leg waits for the buy actor's own state word AND for the
  // native screen's own frame counter, because the merchant's fold and its card
  // read run on that counter. A wall-clock wait is what made the native leg read
  // 0 on two runs out of three - the box was shared, the page ran slower than
  // 60fps, and the next press landed on the previous screen.
  const press = async (key) => {
    await page.keyboard.down(key);
    await page.waitForTimeout(70);
    await page.keyboard.up(key);
    await page.waitForTimeout(120);
  };
  const nativeFrames = () => page.evaluate(() => window.__shop?._host?.state?.()?.frames ?? 0);
  // The merchant's own root state word: 3 is its BUY/SELL menu, the first screen
  // a player can press on (its state table is the 24 words at pro/stitshop.s file
  // 0x4e8; 0-2 are the greeting and the header fold).
  const waitRootState = (want, timeout = 30000) => page.waitForFunction((w) => {
    const host = window.__shop?._host;
    const root = host?.rt?.world?.objects?.[0]?.addr;
    return !!root && host.read((root >>> 0) + 0x10, 4) === w;
  }, want, { timeout });
  const settleNative = async (frames = 20) => {
    const at = await nativeFrames();
    await page.waitForFunction((k) => (window.__shop?._host?.state?.()?.frames ?? 0) >= k, at + frames, { timeout: 20000 });
  };
  if (native) {
    // The merchant opens on its BUY/SELL menu and has no BUY actor yet: the
    // first confirm spawns it (the shop's own root state table, pro/stitshop.s
    // file 0x4E8 entry 3 -> 0x14). Its states are the same words the translated
    // route's buy actor carries - 3 live list, 8 quantity, 17 Buy/No, 27
    // Equip?, 32 Equip who?, 39 Equipped, then 3 again.
    await waitRootState(3); await settleNative(40);   // the greeting fold has finished
    await press("c"); await waitActorState(3, 30000); await settleNative();   // BUY -> the item list
    await press("c"); await waitActorState(8, 30000); await settleNative();   // Short Sword -> quantity
    await press("c"); await waitActorState(17, 30000); await settleNative();  // quantity -> the Buy/No fold
    await press("c"); await waitActorState(27, 30000); await settleNative();  // Buy
    await page.locator("#game").screenshot({ path: `${out}/${name}-before-assign.png` });
    await press("c"); await waitActorState(32, 30000); await settleNative();  // Equip? Yes
    await page.locator("#game").screenshot({ path: `${out}/${name}-equipped.png` });
    await press("c"); await waitActorState(39, 30000); await settleNative();  // Equip who? -> Kotemon
    await press("c"); await waitActorState(3, 30000); await settleNative();   // dismiss "Equipped." and finish the list fold
  } else {
    // The translated merchant: root -> BUY -> list -> qty -> confirm -> Buy ->
    // Equip? Yes -> Equip who? -> equipped. Each screen is a state of the buy
    // actor, so wait for it instead of counting presses.
    await page.waitForFunction(() => window.__shop?._session
      && window.__shop._session.mem.read32(window.__shop._session.root + 0x10) === 3, null, { timeout: 20_000 });
    await press("c"); await waitActorState(3);      // BUY -> the item list
    await press("c"); await waitActorState(8);      // Short Sword -> quantity
    await press("c"); await waitActorState(17);     // quantity -> the Buy/No fold
    await press("c"); await waitActorState(27);     // Buy
    await page.locator("#game").screenshot({ path: `${out}/${name}-before-assign.png` });
    await press("c"); await waitActorState(32);     // Equip? Yes
    await page.locator("#game").screenshot({ path: `${out}/${name}-equipped.png` });
    await press("c"); await waitActorState(39);     // Equip who? -> Kotemon
    await press("c"); await waitActorState(3);      // dismiss "Equipped."
  }
  await page.locator("#game").screenshot({ path: `${out}/${name}-after-dismiss.png` });
  const result = await page.evaluate(() => ({
    screen: window.__shop.screen,
    infoView: window.__shop.infoView,
    itemCount: window.__state.inventory.find(s => s.id === 92)?.qty ?? 0,
    equipped: Object.values(window.__state.equipment?.[0] ?? {}).includes(92),
    nativeEquip: window.__shop._host?.read(0x80049860, 2) ?? null,
    text: window.__nativeScreenTextDump?.().flatMap(w => w.decoded?.map(x => x.text) ?? []).join(" ") ?? "",
    traps: window.__shop.diagnostics?.().host?.traps ?? 0,
    // The port's own result: the merchant's committed save fields.
    result: window.__shop._session?.result?.() ?? null,
  }));
  console.log(name, JSON.stringify(result), JSON.stringify(errors));
  if (errors.length || result.traps) failures++;
  // The bag and the equipment are read where each route commits them: the
  // reference writes the field record directly, the port keeps them in its own
  // save block until the merchant closes (`shop-translated.js` `_finish`).
  if (native) {
    if (result.itemCount !== 0) failures++;
    if (result.nativeEquip !== 92) failures++;
  } else {
    const saved = result.result ?? {};
    const equipped = Object.values(saved.equipment?.[0] ?? {}).includes(92);
    const stillHeld = (saved.inventory ?? []).some((slot) => slot.id === 92);
    if (stillHeld) { console.error(`${name}: the sword is still in the merchant's bag`); failures++; }
    if (saved.bits !== 9800 || !equipped) {
      console.error(`${name}: merchant save result ${JSON.stringify(saved)}`);
      failures++;
    }
    // Back on the BUY item list, not on a fold or a partner card: the walker's
    // `screen`/`infoView` pair used to say this, the port's actor state does.
    if (await actorState() !== 3) {
      console.error(`${name}: left on merchant screen ${await actorState()}, expected the item list (3)`);
      failures++;
    }
  }
  await page.close();
}
await browser.close();
if (failures) process.exitCode = 1;