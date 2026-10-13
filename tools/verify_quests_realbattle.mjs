// Plays a REAL Kunemon fight (real key presses) and checks the quest layer counted it through the game's own win path.
// Needs: the game served on PORT (default 8770) and Chrome with --remote-debugging-port=9333 (a separate, clean profile).
// Run:   PORT=8770 node tools/verify_quests_realbattle.mjs

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fs = await import("fs");
const URL = `http://localhost:${process.env.PORT || 8770}/index.html?skipTitle=1&noEncounters=1&map=s330`;
const tab = await (await fetch("http://127.0.0.1:9333/json/new?" + encodeURIComponent("about:blank"), { method: "PUT" })).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
let id = 0; const pend = new Map(); const errs = [];
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); }
  if (d.method === "Runtime.exceptionThrown") errs.push(JSON.stringify(d.params.exceptionDetails.exception?.description ?? d.params.exceptionDetails.text).slice(0, 240)); };
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (e) => (await send("Runtime.evaluate", { expression: e, awaitPromise: true, returnByValue: true, userGesture: true })).result?.result?.value;
const press = async (k, code, vk) => { await send("Input.dispatchKeyEvent", { type: "keyDown", key: k, code, windowsVirtualKeyCode: vk }); await sleep(60); await send("Input.dispatchKeyEvent", { type: "keyUp", key: k, code, windowsVirtualKeyCode: vk }); };
await send("Runtime.enable"); await send("Page.enable"); await send("Network.enable"); await send("Network.setCacheDisabled", { cacheDisabled: true });
await send("Emulation.setDeviceMetricsOverride", { width: 1000, height: 900, deviceScaleFactor: 1, mobile: false });
await send("Page.navigate", { url: URL });
for (let i = 0; i < 90; i++) { if (await ev("!!(window.__state && window.__state.started && window.__quests)")) break; await sleep(500); }
await ev('[...document.querySelectorAll("button")].find(b=>/Authentic PS1/.test(b.textContent))?.click()'); await sleep(2500);
await ev(`localStorage.removeItem("dw.quests.v1")`);
console.log("partners:", await ev(`JSON.stringify([...document.querySelector("#charSelect").options].map(o=>o.value))`));
await ev(`(()=>{const s=document.querySelector("#charSelect");const o=[...s.options].find(o=>/^p00[2-9]|^p01/.test(o.value));s.value=o.value;s.dispatchEvent(new Event("change",{bubbles:true}));})()`); await sleep(2500);
console.log("lead now:", await ev(`window.__state.manifest.characters[window.__state.charIdx].id`));
await ev(`(()=>{const c=document.querySelector('[data-fx="quests"]');c.checked=true;c.dispatchEvent(new Event("change",{bubbles:true}))})()`);
await ev(`window.__quests.accept("park_pest_control")`);
console.log("battle api:", await ev(`JSON.stringify(Object.keys(window.__battle).filter(k=>/start|active/i.test(k)))`));
console.log("progress before:", await ev(`JSON.stringify(window.__quests.state.active.park_pest_control.p)`));
// a real fight: one Kunemon, on Central Park, through the game's own party starter
await ev(`window.__fightLog=[]; window.__battle.startParty([{name:"Kunemon",level:1,hp:30,mp:10,stat_scale:16}], (r)=>window.__fightLog.push("win"), ()=>window.__fightLog.push("flee"), ()=>window.__fightLog.push("lose"), {screenId:1, mapId:"s330"})`);
let fought = false;
for (let i = 0; i < 160; i++) {
  await sleep(500);
  const active = await ev(`window.__battle.isActive ? window.__battle.isActive() : !!window.__battleB?.()`);
  if (i > 6 && !active) { fought = true; break; }
  if (i % 4 === 0) await ev(`(()=>{const b=window.__battleB&&window.__battleB(); if(b&&b.enemy&&b.enemy.hp>1) b.enemy.hp=1;})()`);   // keep the enemy one hit from beating
  await press("Enter", "Enter", 13);
}
console.log("battle finished:", fought, "callbacks:", await ev(`JSON.stringify(window.__fightLog)`));
console.log("progress after:", await ev(`JSON.stringify(window.__quests.state.active.park_pest_control.p)`));
const shot = await send("Page.captureScreenshot", { format: "png" });
fs.writeFileSync("realbattle_end.png", Buffer.from(shot.result.data, "base64"));
console.log("errors:", errs.join(" | ") || "none");
await ev(`localStorage.removeItem("dw.quests.v1"); localStorage.removeItem("dw.fx.v1")`);
await fetch("http://127.0.0.1:9333/json/close/" + tab.id); process.exit(0);
