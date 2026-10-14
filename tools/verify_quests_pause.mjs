// Browser test: the QUESTS row and page on the pause menu. The row is the game's own list with one more row (the disc's seven-row panel, the
// game's font and cursor); choosing it opens a real pause page (top bar, list window with cursor, description band, backdrop, the folds)
// built from the same pieces as the disc's pages; Back returns to the list on that row.
// Needs: the game served on PORT (default 8770) from a checkout whose web/vendor/engine.js was built with tools/build_engine_local.sh,
// and Chrome with --remote-debugging-port=9333 (a separate, clean profile).
// Run:   PORT=8770 node tools/verify_quests_pause.mjs

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PORT = process.env.PORT || 8770;
const base = (map) => `http://localhost:${PORT}/index.html?skipTitle=1&noEncounters=1&map=${map}`;
const tab = await (await fetch("http://127.0.0.1:9333/json/new?" + encodeURIComponent("about:blank"), { method: "PUT" })).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
let id = 0; const pend = new Map(); const errs = [];
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); }
  if (d.method === "Runtime.exceptionThrown") errs.push(JSON.stringify(d.params.exceptionDetails.exception?.description ?? d.params.exceptionDetails.text).slice(0, 300));
  if (d.method === "Runtime.consoleAPICalled" && d.params.type === "error") errs.push("ERR " + d.params.args.map((a) => a.value ?? a.description).join(" ").slice(0, 200)); };
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (e) => (await send("Runtime.evaluate", { expression: e, awaitPromise: false, returnByValue: true })).result?.result?.value;
await send("Runtime.enable"); await send("Page.enable"); await send("Network.enable"); await send("Network.setCacheDisabled", { cacheDisabled: true });
const boot = async (map) => {
  await ev("window.__oldPage = 1");
  await send("Page.navigate", { url: base(map) });
  for (let i = 0; i < 90; i++) { await sleep(300); if (await ev("!window.__oldPage && !!(window.__state && window.__state.started && window.__quests)")) break; }
  await ev('[...document.querySelectorAll("button")].find(b=>/Authentic PS1/.test(b.textContent))?.click()'); await sleep(4000);
};
const VK = { i: 73, Enter: 13, ArrowDown: 40, ArrowUp: 38, x: 88 };
const key = async (k, wait = 450) => { await send("Input.dispatchKeyEvent", { type: "keyDown", key: k, code: k, windowsVirtualKeyCode: VK[k] }); await sleep(130); await send("Input.dispatchKeyEvent", { type: "keyUp", key: k, code: k, windowsVirtualKeyCode: VK[k] }); await sleep(wait); };
const ok = (name, cond, extra = "") => console.log(cond ? "PASS" : "FAIL", name, extra);
const sess = `window.__status._session`;
const rows = () => ev(`(()=>{const s=${sess}; return s ? s.mem.read32(s.root+0x5c) : null})()`);
const cursor = () => ev(`(()=>{const s=${sess}; return s ? s.mem.read32(s.root+0x58) : null})()`);
const entry = () => ev("window.__status.isOpen() ? window.__status.diagnostics().entry : null");
const page = (off) => ev(`(()=>{const s=${sess}; const p=s && s.pageObject(); return p ? s.mem.read32(p+${off}) : null})()`);
const painted = () => ev(`(()=>{const s=${sess}; return JSON.stringify(window.__status.diagnostics().painted ?? null)})()`);
const label = () => ev(`(()=>{const s=${sess}; const at=s.banks.sources.get(0x7f00); if(!at) return null; let out=""; for(let i=0;;i++){const b=s.mem.read8(at+8+i); if(!b) break; if(b>=4&&b<=13) out+=String.fromCharCode(48+b-4); else if(b>=0x0e&&b<=0x27) out+=String.fromCharCode(65+b-0x0e); else if(b===1){i++; out+=" ";} } return out})()`);
const waitFor = async (expr, tries = 40) => { for (let i = 0; i < tries; i++) { if (await ev(expr)) return true; await sleep(250); } return false; };

for (let attempt = 0; attempt < 4; attempt++) {
  await boot("s330"); await ev("localStorage.clear()"); await boot("s330");
  if ((await ev("Object.keys(window.__quests.state.done).length")) === 0) break;
}
await ev(`(()=>{const q=window.__quests; q.accept("park_pest_control", true); for(let i=0;i<3;i++) import("/gameEvents.js").then(m=>m.emit("battleWon",{enemies:["Kunemon"],mapId:"s330",screenId:1})); q.state.duelWins=1; q.announceUnlocks();})()`);
await sleep(500);
await key("i", 300);
ok("the pause opens", await waitFor("window.__status.isOpen() && window.__status._session && window.__status._session.root"));
await sleep(1500);
ok("the home list has seven rows (six of the disc's and QUESTS)", (await rows()) === 7, `(${await rows()})`);
ok("the extra row's label is QUESTS plus how many want attention", /^QUESTS( \d+)?$/.test(await label()), await label());
for (let i = 0; i < 6; i++) await key("ArrowDown", 250);
ok("the cursor walks down to the seventh row like on any other", (await cursor()) === 6, `(${await cursor()})`);
await key("ArrowDown", 300);
ok("and stops there", (await cursor()) === 6);
await key("Enter", 100);
ok("choosing it opens the QUESTS page inside the pause, as ITEMS or SORT do", await waitFor("window.__status.isOpen() && window.__status.diagnostics().entry === 'quests' && window.__status._session && window.__status._session.pageObject()", 40), await entry());
await sleep(1500);
ok("the pause stays open (menu mode) while the page is up", (await ev("window.__state.menuOpen")) === true);
const count = await page(0x5c);
ok("the page lists the open, ready and new quests", count >= 3, `(${count})`);
ok("the first quest is selected", (await page(0x60)) === 0);
await key("ArrowDown", 400);
ok("Down selects the next quest", (await page(0x60)) === 1, `(${await page(0x60)})`);
await key("ArrowUp", 400); await key("ArrowUp", 400);
ok("Up wraps to the last", (await page(0x60)) === count - 1, `(${await page(0x60)})`);
await key("ArrowDown", 400);
ok("Down wraps to the first", (await page(0x60)) === 0);
ok("no other layer is drawn over it: no log, no list, no dialogue", (await ev("!window.__quests.isLogOpen() && !window.__choice.isOpen() && !window.__dialogueBox.isOpen()")) === true);
await key("Enter", 500);
ok("Enter reads the selected quest's full text in the description band", (await page(0x10)) === 3 && (await page(0x68)) === 0, `(step ${await page(0x10)})`);
let turned = 0; for (let i = 0; i < 10 && (await page(0x10)) === 3; i++) { await key("Enter", 400); turned++; }
ok("Enter turns the pages and ends back at the list", (await page(0x10)) === 1 && turned >= 1, `(${turned} presses)`);
await key("Enter", 500); await key("x", 500);
ok("Back leaves reading without leaving the page", (await page(0x10)) === 1 && (await entry()) === "quests");
await key("x", 100);
ok("Back returns to the home list on the QUESTS row", await waitFor("window.__status.isOpen() && window.__status.diagnostics().entry === 'home' && window.__status._session && window.__status._session.mem.read32(window.__status._session.root+0x5c) === 7", 40));
await sleep(1500);
ok("...with the cursor still on QUESTS", (await cursor()) === 6, `(${await cursor()})`);
await key("x", 300);
ok("Back closes the pause as ever", await waitFor("!window.__status.isOpen() && window.__state.menuOpen === false", 40));

// another row still opens its own page
await sleep(1000); await key("i", 2500); await key("ArrowDown", 300); await key("Enter", 100);
ok("a disc row (SORT) still opens its own page", await waitFor("window.__status.isOpen() && window.__status.diagnostics().entry === 'sort'", 30), await entry());
await ev("window.__status.close()"); await sleep(500);

// quests off: the list is the disc's
await ev(`window.__setFx("quests", false)`);
await key("i", 500);
await waitFor(`window.__status.isOpen() && window.__status._session && window.__status._session.mem.read32(window.__status._session.root+0x5c) > 0`, 40); await sleep(1500);
ok("with quests switched off the pause home has the disc's six rows", (await rows()) === 6, `(${await rows()})`);
console.log("errors:", errs.join(" | ") || "none");
await ev(`localStorage.clear()`);
await fetch("http://127.0.0.1:9333/json/close/" + tab.id);
process.exit(0);
