// Step C: buy and equip at the ordinary merchant, then save and load that state.
// Run through tools/run-playwright.sh with web/ served on port 8742.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";

const out = process.argv[2] ?? "/tmp/shop-save-roundtrip";
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
const executableRequests = [];
let denyShopExecutables = true;
page.on("pageerror", (e) => errors.push(e.message));
page.route("**/assets/native/**", (route) => {
  if (denyShopExecutables) {
    executableRequests.push(route.request().url());
    return route.abort();
  }
  return route.continue();
});
const press = async (key, delay = 900) => {
  await page.keyboard.down(key);
  await page.waitForTimeout(80);
  await page.keyboard.up(key);
  await page.waitForTimeout(delay);
};
const check = (name, pass, detail = "") => {
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!pass) throw new Error(name);
};
const snapshot = () => page.evaluate(() => ({
  bits: window.__state.bits,
  inventory: window.__state.inventory,
  equipment: window.__state.equipment,
}));
const waitActorState = (value) => page.waitForFunction((expected) => {
  const session = window.__shop?._session;
  if (!session) return false;
  const rootContext = session.mem.read32(session.root + 0x24);
  const actor = session.mem.read32(rootContext + 0x1c);
  return actor && session.mem.read32(actor + 0x10) === expected;
}, value, { timeout: 10000 });
const waitRootChoices = () => page.waitForFunction(() =>
  window.__shop?._session?.mem.read32(window.__shop._session.root + 0x10) === 3,
  null, { timeout: 10000 });

try {
  await page.goto(`${baseUrl(8742)}/index.html?skipTitle=1&noEncounters=1`, { waitUntil: "load" });
  await page.waitForFunction(() => window.__state?.started && window.__state.shops);
  await page.evaluate(() => {
    window.__state.playerName = "KAI";
    window.__state.bits = 10000;
    window.__state.inventory = [];
    window.__state.equipment = [{}, {}, {}];
    for (let i = 0; i < 3; i++) localStorage.removeItem(`mcardSlot${i}`);
    window.__labOpen("shop", 0);
  });
  await waitRootChoices();
  check("ordinary merchant owns the screen", await page.evaluate(() => window.__shop === window.__shopTranslated));
  await page.locator("#game").screenshot({ path: `${out}/01-before-buy.png` });
  await press("c", 180); await waitActorState(3);
  await press("c", 180); await waitActorState(8);
  await press("c", 180); await waitActorState(17);
  await press("c", 180); await waitActorState(27);
  await press("c", 180); await waitActorState(32);
  await press("c", 180); await waitActorState(39);
  let s = await page.evaluate(() => window.__shop._session.result());
  check("one sword equipped", s.bits === 9800 && !s.inventory.some((x) => x.id === 92)
    && Object.values(s.equipment?.[0] ?? {}).includes(92), JSON.stringify(s));
  await page.locator("#game").screenshot({ path: `${out}/02-after-equip.png` });
  await press("c", 180); // dismiss Equipped.
  await waitActorState(3);
  await press("Escape", 180); // BUY list -> merchant menu
  await waitRootChoices();
  await press("Escape", 900); // leave merchant
  await page.waitForFunction(() => !window.__shop.isOpen(), { timeout: 10000 });
  check("merchant never requested executable assets", executableRequests.length === 0,
    executableRequests.join(" | "));

  // The save screen is the translated MemcardSession (Step E): executables stay
  // denied, and the walker's slot is committed when the screen closes.
  await page.evaluate(() => window.__labOpen("save"));
  await page.waitForFunction(() => window.__saveNative?.diagnostics?.()?.state?.window != null, { timeout: 30000 });
  await page.waitForTimeout(1800);
  await press("Enter", 2000); // choose empty card slot
  await press("Enter", 1500); // confirm save prompt
  await press("Enter", 2500); // write file
  await press("Enter", 600); // dismiss "Saved."
  await page.locator("#game").screenshot({ path: `${out}/03-saved-card.png` });
  // Leave the card with its own Back (pad bit 0xE = the word's 0x4000, which is
  // Escape or x on the keyboard; `c` confirms since 2026-10-03 and would drive
  // the card in circles here).
  for (let i = 0; i < 6 && await page.evaluate(() => window.__saveNative.isOpen()); i++) {
    await press("Escape", 1200);
  }
  await page.waitForFunction(() => !window.__saveNative.isOpen(), { timeout: 15000 });
  const saved = await page.evaluate(() => {
    const slot = window.__saveNative.diagnostics()?.savedSlot;
    const data = slot == null ? null : JSON.parse(localStorage.getItem(`mcardSlot${slot}`) || "null");
    return { slot, data };
  });
  check("file records the merchant wallet", saved.data?.record?.bits === 9800,
    `slot=${saved.slot} bits=${saved.data?.record?.bits}`);
  check("file records equipped sword", JSON.parse(saved.data?.data?.equipment || "[]")
    .some((slots) => Object.values(slots ?? {}).includes(92)));
  await page.evaluate(() => {
    window.__state.bits = 1;
    window.__state.inventory = [];
    window.__state.equipment = [{}, {}, {}];
    localStorage.setItem("bits", "1");
    localStorage.setItem("inventory", "[]");
    localStorage.setItem("equipment", "[{}, {}, {}]");
    window.__labOpen("load");
  });
  await page.waitForFunction(() => window.__saveNative?.diagnostics?.()?.state?.window != null, { timeout: 30000 });
  await page.waitForTimeout(1800);
  await press("Enter", 2200);
  const navigation = page.waitForNavigation({ timeout: 15000 });
  await press("Enter", 1800);
  await press("Enter", 2400);
  await navigation;
  await page.waitForFunction(() => window.__state?.started, { timeout: 30000 });
  s = await snapshot();
  check("load restores the merchant wallet", s.bits === 9800, `bits=${s.bits}`);
  check("load restores the equipped sword", Object.values(s.equipment?.[0] ?? {}).includes(92),
    JSON.stringify(s.equipment));
  check("no page errors", errors.length === 0, errors.join(" | "));
  await page.locator("#game").screenshot({ path: `${out}/04-after-load.png` });
  console.log("verify_shop_save_roundtrip: OK");
} finally {
  await browser.close();
}
