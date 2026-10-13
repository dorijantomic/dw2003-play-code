// Browser test, phase 1: switch off by default, F3 log, accept, objective counting (right/wrong map and species, both worlds, map variants), claim pays once, survives a reload, story/progress keys untouched.
// Needs: the game served on PORT (default 8770) and Chrome with --remote-debugging-port=9333 (a separate, clean profile).
// Run:   PORT=8770 node tools/verify_quests.mjs

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fs = await import("fs");
const PORT = process.env.PORT || 8770;
const base = (map) => `http://localhost:${PORT}/index.html?skipTitle=1&noEncounters=1&map=${map}`;
const tab = await (await fetch("http://127.0.0.1:9333/json/new?" + encodeURIComponent("about:blank"), { method: "PUT" })).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
let id = 0; const pend = new Map(); const errs = [];
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); }
  if (d.method === "Runtime.exceptionThrown") errs.push(JSON.stringify(d.params.exceptionDetails.exception?.description ?? d.params.exceptionDetails.text).slice(0, 220));
  if (d.method === "Runtime.consoleAPICalled" && d.params.type === "warning" && /\[quests\]|\[events\]/.test(JSON.stringify(d.params.args))) errs.push("WARN " + d.params.args.map((a) => a.value ?? a.description).join(" ").slice(0, 200)); };
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (e) => (await send("Runtime.evaluate", { expression: e, awaitPromise: true, returnByValue: true })).result?.result?.value;
await send("Runtime.enable"); await send("Page.enable"); await send("Network.enable"); await send("Network.setCacheDisabled", { cacheDisabled: true });
await send("Emulation.setDeviceMetricsOverride", { width: 1000, height: 900, deviceScaleFactor: 1, mobile: false });
const boot = async (map) => {
  await ev("window.__oldPage = 1");   // marks the page being replaced, so we never mistake it for the new one
  await send("Page.navigate", { url: base(map) });
  for (let i = 0; i < 90; i++) { await sleep(300); if (await ev("!window.__oldPage && !!(window.__state && window.__state.started && window.__quests)")) break; }
  await ev('[...document.querySelectorAll("button")].find(b=>/Authentic PS1/.test(b.textContent))?.click()'); await sleep(2500);
};
const key = (k) => ev(`window.dispatchEvent(new KeyboardEvent("keydown",{key:"${k}",bubbles:true}))`);
const win = (enemies, mapId) => ev(`import("/gameEvents.js").then(m=>m.emit("battleWon",{enemies:${JSON.stringify(enemies)},mapId:"${mapId}",screenId:1}))`);
const snap = () => ev(`(()=>{const s=window.__state;const keys=Object.keys(localStorage).filter(k=>!/^dw\\.(quests|fx)/.test(k)&&!/^(inventory|bits)$/.test(k)).sort();return JSON.stringify({flags:s.flags,ls:keys.map(k=>[k,localStorage.getItem(k)])})})()`);
const ok = (name, cond, extra = "") => console.log(cond ? "PASS" : "FAIL", name, extra);

await boot("s330");
await ev(`localStorage.removeItem("dw.quests.v1"); localStorage.removeItem("dw.fx.v1")`);   // start from a clean slate: quests off, no progress
await boot("s330");
const before = await snap();
const bits0 = await ev("window.__state.bits"), inv0 = await ev("JSON.stringify(window.__state.inventory)");
ok("layer present, switch off by default", (await ev("window.__fx.quests")) === false);
await key("F3"); await sleep(300);
ok("F3 does nothing while the switch is off", (await ev(`document.getElementById("quest-panel").hidden`)) === true);
await win(["Kunemon"], "s330");
ok("battle wins ignored while off", (await ev(`JSON.stringify(window.__quests.state.active)`)) === "{}");

// switch it on through the real F2 panel checkbox
await ev(`(()=>{const c=document.querySelector('[data-fx="quests"]');c.checked=true;c.dispatchEvent(new Event("change",{bubbles:true}))})()`);
ok("switch on via F2 panel", (await ev("window.__fx.quests")) === true);
await key("F3"); await sleep(300);
ok("F3 opens the log", (await ev(`document.getElementById("quest-panel").hidden`)) === false);
const titles = await ev(`JSON.stringify([...document.querySelectorAll("#quest-panel .qc b")].map(b=>b.textContent))`);
ok("the first quest is offered and the chained one is locked", titles.includes("Central Park pest control") && !titles.includes("Wire Forest survey"), titles);
await ev(`document.querySelector('[data-q="accept:park_pest_control"]').click()`); await sleep(200);
ok("accept via button", (await ev(`window.__quests.status("park_pest_control")`)) === "active");

await win(["Kunemon"], "s200");              // wrong map: must not count
await win(["Tapirmon"], "s330");             // wrong species: must not count
ok("wrong map / wrong species do not count", (await ev(`JSON.stringify(window.__quests.state.active.park_pest_control.p)`)) === "[0]");
await win(["Kunemon"], "s330"); await win(["Kunemon"], "s940");     // both worlds' Central Park count
ok("counts in either world's Central Park", (await ev(`JSON.stringify(window.__quests.state.active.park_pest_control.p)`)) === "[2]");
await win(["Kunemon"], "s330");
ok("ready after the third", (await ev(`window.__quests.status("park_pest_control")`)) === "ready");
await win(["Kunemon"], "s330");
ok("progress never exceeds the target", (await ev(`JSON.stringify(window.__quests.state.active.park_pest_control.p)`)) === "[3]");

await ev(`document.querySelector('[data-q="claim:park_pest_control"]').click()`); await sleep(300);
const bits1 = await ev("window.__state.bits"), inv1 = await ev("JSON.stringify(window.__state.inventory)");
ok("claim pays 300 BIT", bits1 - bits0 === 300, `(${bits0} -> ${bits1})`);
ok("claim adds the AntidoteDisk", inv1 !== inv0, "");
ok("quest is done", (await ev(`window.__quests.status("park_pest_control")`)) === "done");
await ev(`window.__quests.claim("park_pest_control")`);
ok("claiming twice pays nothing more", (await ev("window.__state.bits")) === bits1);

// reload: persisted, no double reward
await boot("s330");
ok("after reload: still done", (await ev(`window.__quests.status("park_pest_control")`)) === "done");
ok("after reload: no extra BIT", (await ev("window.__state.bits")) === bits1);
ok("second quest now unlocked", (await ev(`window.__quests.status("forest_gate_survey")`)) === "available");

// the visit quest, including a night variant of the same map
await ev(`window.__quests.accept("forest_gate_survey")`);
await boot("s336");                           // s336 is the night variant of s335
ok("variant of s335 counts as s335", (await ev(`JSON.stringify(window.__quests.state.active.forest_gate_survey.p)`)) === "[1,0]", await ev(`JSON.stringify(window.__quests.state.active.forest_gate_survey.p)`));
await boot("s350");
for (let i = 0; i < 24 && (await ev(`window.__quests.status("forest_gate_survey")`)) !== "ready"; i++) await sleep(500);   // a big map can take a few seconds to draw its first frame
ok("second visit counts, quest ready", (await ev(`window.__quests.status("forest_gate_survey")`)) === "ready");
await ev(`window.__quests.claim("forest_gate_survey")`); await sleep(200);

const after = await snap();
{
  const A = JSON.parse(before), B = JSON.parse(after);
  const changed = JSON.stringify(A.flags) === JSON.stringify(B.flags) ? [] : ["state.flags"];
  const am = Object.fromEntries(A.ls), bm = Object.fromEntries(B.ls);
  for (const k of new Set([...Object.keys(am), ...Object.keys(bm)])) if (am[k] !== bm[k]) changed.push(k);
  console.log("   keys that differ after the whole run:", JSON.stringify(changed));
  const storyKeys = changed.filter((k) => /flag|ordinal|chapter|b370|story|progress|party|roster|album|card/i.test(k));
  ok("no story/progress key touched", storyKeys.length === 0, JSON.stringify(storyKeys));
}
const shot = await send("Page.captureScreenshot", { format: "png" });
await ev(`window.__quests.togglePanel(true)`); await sleep(300);
const shot2 = await send("Page.captureScreenshot", { format: "png" });
fs.writeFileSync("quests_log.png", Buffer.from(shot2.result.data, "base64"));
console.log("errors/warnings:", errs.join(" | ") || "none");
await ev(`localStorage.removeItem("dw.quests.v1")`);
await fetch("http://127.0.0.1:9333/json/close/" + tab.id); process.exit(0);
