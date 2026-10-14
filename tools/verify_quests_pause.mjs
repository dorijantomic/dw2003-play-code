// Browser test: the QUESTS row on the pause home list. It is the game's own list with one more row (the disc's seven-row panel,
// the game's font and cursor), choosing it runs the quest log and the pause comes back on that row.
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
const label = () => ev(`(()=>{const s=${sess}; const at=s.banks.sources.get(0x7f00); if(!at) return null; let out=""; for(let i=0;;i++){const b=s.mem.read8(at+8+i); if(!b) break; if(b>=4&&b<=13) out+=String.fromCharCode(48+b-4); else if(b>=0x0e&&b<=0x27) out+=String.fromCharCode(65+b-0x0e); else if(b===1){i++; out+=" ";} } return out})()`);
const waitFor = async (expr, tries = 40) => { for (let i = 0; i < tries; i++) { if (await ev(expr)) return true; await sleep(250); } return false; };

for (let attempt = 0; attempt < 4; attempt++) {
  await boot("s330"); await ev("localStorage.clear()"); await boot("s330");
  if ((await ev("Object.keys(window.__quests.state.done).length")) === 0) break;
}
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
ok("choosing it closes the pause and opens the quest log", await waitFor("window.__quests.isLogOpen() && window.__choice.isOpen() && !window.__status.isOpen()", 30));
ok("the game is not left in menu mode while the log is up", (await ev("window.__state.menuOpen")) === false);
await key("ArrowUp", 300); await key("Enter", 300);        // wraps to "Close"
ok("closing the log brings the pause back", await waitFor("window.__status.isOpen() && window.__status._session && window.__state.menuOpen === true", 30));
await sleep(2000);
ok("...on the QUESTS row", (await cursor()) === 6 && (await rows()) === 7, `(cursor ${await cursor()}, rows ${await rows()})`);
ok("...and the log is closed", (await ev("!window.__quests.isLogOpen() && !window.__choice.isOpen()")) === true);
await key("x", 1500);
ok("Back closes the pause as ever", (await ev("!window.__status.isOpen() && window.__state.menuOpen === false")) === true);

// another row still opens its own page
await key("i", 2500); await key("ArrowDown", 300); await key("Enter", 100);
ok("a disc row (SORT) still opens its own page", await waitFor("window.__status.isOpen() && window.__status.diagnostics().entry === 'sort'", 30), await ev("window.__status.diagnostics().entry"));
await ev("window.__status.close()"); await sleep(500);          // leave the page (its own Back handling is not under test)

// quests off: the list is the disc's
await ev(`window.__setFx("quests", false)`);
await key("i", 500);
await waitFor(`window.__status.isOpen() && window.__status._session && window.__status._session.mem.read32(window.__status._session.root+0x5c) > 0`, 40); await sleep(1500);
ok("with quests switched off the pause home has the disc's six rows", (await rows()) === 6, `(${await rows()})`);
console.log("errors:", errs.join(" | ") || "none");
await ev(`localStorage.clear()`);
await fetch("http://127.0.0.1:9333/json/close/" + tab.id);
process.exit(0);
