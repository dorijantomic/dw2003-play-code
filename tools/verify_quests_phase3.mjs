// Browser test, phase 3: REAL challenge fights launched from the quest log (double trouble, leader rematch, hard version's scaled stats, a loss restoring the party), and the read-only story-flag gates.
// Needs: the game served on PORT (default 8770) and Chrome with --remote-debugging-port=9333 (a separate profile).
// Run:   PORT=8770 node tools/verify_quests_phase3.mjs

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PORT = process.env.PORT || 8770;
const base = (map) => `http://localhost:${PORT}/index.html?skipTitle=1&noEncounters=1&map=${map}`;
const tab = await (await fetch("http://127.0.0.1:9333/json/new?" + encodeURIComponent("about:blank"), { method: "PUT" })).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
let id = 0; const pend = new Map(); const errs = [];
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); }
  if (d.method === "Runtime.exceptionThrown") errs.push(JSON.stringify(d.params.exceptionDetails.exception?.description ?? d.params.exceptionDetails.text).slice(0, 220));
  if (d.method === "Runtime.consoleAPICalled" && d.params.type === "warning" && /\[quests\]|\[events\]/.test(JSON.stringify(d.params.args))) errs.push("WARN " + d.params.args.map((a) => a.value ?? a.description).join(" ").slice(0, 200)); };
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (e) => (await send("Runtime.evaluate", { expression: e, awaitPromise: true, returnByValue: true, userGesture: true })).result?.result?.value;
const press = async (k, code, vk) => { await send("Input.dispatchKeyEvent", { type: "keyDown", key: k, code, windowsVirtualKeyCode: vk }); await sleep(60); await send("Input.dispatchKeyEvent", { type: "keyUp", key: k, code, windowsVirtualKeyCode: vk }); };
await send("Runtime.enable"); await send("Page.enable"); await send("Network.enable"); await send("Network.setCacheDisabled", { cacheDisabled: true });
await send("Emulation.setDeviceMetricsOverride", { width: 1000, height: 900, deviceScaleFactor: 1, mobile: false });
const boot = async (map) => {
  await ev("window.__oldPage = 1");
  await send("Page.navigate", { url: base(map) });
  for (let i = 0; i < 90; i++) { await sleep(300); if (await ev("!window.__oldPage && !!(window.__state && window.__state.started && window.__quests)")) break; }
  await ev('[...document.querySelectorAll("button")].find(b=>/Authentic PS1/.test(b.textContent))?.click()'); await sleep(2500);
};
const goMap = async (mid) => {            // the game can ignore a map change made while it is still settling: retry until it takes
  for (let attempt = 0; attempt < 4; attempt++) {
    await ev(`(()=>{const s=document.getElementById("mapSelect");s.value="${mid}";s.dispatchEvent(new Event("change",{bubbles:true}))})()`);
    for (let i = 0; i < 20; i++) { await sleep(400); if ((await ev(`window.__quests.where().lastMap`)) === mid) return; }
  }
};
const st = (q) => ev(`window.__quests.status("${q}")`);
const ok = (name, cond, extra = "") => console.log(cond ? "PASS" : "FAIL", name, extra);
// play the open battle with real key presses, keeping the enemy one hit from losing (or, if lose=true, the player at 0)
const playOut = async (lose = false, maxIter = 220) => {
  for (let i = 0; i < maxIter; i++) {
    await sleep(450);
    const active = await ev(`!!window.__battle.isActive()`);
    if (i > 8 && !active) return true;
    if (i % 3 === 0) await ev(`(()=>{const b=window.__battleB&&window.__battleB(); if(!b) return; if(${lose}){ if(b.player&&b.player.hp>0) b.player.hp=0; } else if(b.enemy&&b.enemy.hp>1) b.enemy.hp=1;})()`);
    await press("Enter", "Enter", 13);
  }
  return false;
};

for (let attempt = 0; attempt < 4; attempt++) {     // a previous run's tab can still be rewriting its saved state as it closes: retry until genuinely clean
  await boot("s330");
  await ev(`localStorage.removeItem("dw.quests.v1"); localStorage.removeItem("dw.fx.v1")`);
  await boot("s330");
  if ((await ev(`Object.keys(window.__quests.state.active).length + Object.keys(window.__quests.state.done).length`)) === 0) break;
  await sleep(1500);
}
if ((await ev(`Object.keys(window.__quests.state.active).length + Object.keys(window.__quests.state.done).length`)) !== 0) { console.log("ABORT: dirty start"); process.exit(2); }
// a real partner, so a fight can start
await ev(`(()=>{const s=document.querySelector("#charSelect");const o=[...s.options].find(o=>/^p00[2-9]/.test(o.value));s.value=o.value;s.dispatchEvent(new Event("change",{bubbles:true}));})()`); await sleep(2500);
await ev(`window.__state.party=[window.__state.manifest.characters[window.__state.charIdx].id]`);   // the story normally gives you a field party
await ev(`(()=>{const c=document.querySelector('[data-fx="quests"]');c.checked=true;c.dispatchEvent(new Event("change",{bubbles:true}))})()`);
await sleep(800);
console.log("   where:", await ev(`JSON.stringify(window.__quests.where())`));

// ---- story-flag gates (read-only)
const f1 = await ev(`window.__storyFlags.get(16402)`), f2 = await ev(`window.__storyFlags.get(16414)`);
ok("the leader beat flags start unset in a fresh game", f1 !== 1 && f2 !== 1, `${f1}/${f2}`);
ok("rematch quest is locked until the story beat", (await st("seiryu_rematch")) === "locked");
ok("three-leaders quest is locked too", (await st("leaders_gauntlet")) === "locked");
const flagsBefore = await ev(`JSON.stringify(window.__state.flags)`);

// ---- double trouble: a real two-enemy fight launched from the quest log
ok("accept the double ambush at Central Park", (await ev(`window.__quests.accept("double_trouble_park")`)) === true);
ok("the open challenge can be begun here", (await ev(`window.__quests.entries().some(e=>e.id==="double_trouble_park" && e.status==="active")`)) === true);
await ev(`window.__quests.beginChallenge("double_trouble_park"); 0`); await sleep(5000);
const party = await ev(`(()=>{const b=window.__battleB&&window.__battleB();return b?JSON.stringify(b.party.map(e=>[e.enemyId,e.enemyLevel,e.enemyHp,e.enemyStatScale])):null})()`);
ok("a REAL two-enemy fight started with the real party", party === '[["Kunemon",1,120,16],["Tapirmon",1,120,16]]', party);
ok("no list is left open over the fight", (await ev(`!window.__quests.isLogOpen() && !window.__choice.isOpen()`)) === true);
ok("cannot start a second one meanwhile", (await ev(`window.__quests.beginChallenge("double_trouble_park")`)) === false);
const finished = await playOut(false);
ok("the fight ended", finished);
for (let i = 0; i < 20 && (await st("double_trouble_park")) !== "ready"; i++) await sleep(500);
ok("winning completes the challenge", (await st("double_trouble_park")) === "ready", await st("double_trouble_park"));
await ev(`window.__quests.claim("double_trouble_park")`);

// ---- the gated rematch + the hard version carries the scaled stats
await goMap("s420");
await ev(`window.__storyFlags.set(16402, true)`);
ok("rematch unlocks after the leader beat flag", (await st("seiryu_rematch")) === "available", await st("seiryu_rematch"));
ok("accept the rematch in Seiryu City", (await ev(`window.__quests.accept("seiryu_rematch")`)) === true);
ok("begin the rematch", (await ev(`window.__quests.beginChallenge("seiryu_rematch")`)) === true);
await sleep(5000);
const party3 = await ev(`(()=>{const b=window.__battleB&&window.__battleB();return b?JSON.stringify(b.party.map(e=>[e.enemyId,e.enemyLevel,e.enemyHp,e.enemyStatScale])):null})()`);
ok("the rematch is the leader's real three-fighter gauntlet, with the game's own stat scales", party3 === '[["Minotarumon",9,504,22],["Tyrannomon",11,576,23],["Apemon",14,684,20]]', party3);

// ---- a LOSS returns to the field and leaves the party as it was
const hpBefore = await ev(`JSON.stringify(window.__state.partnerStats)`);
const ended = await playOut(true, 260);
ok("the lost fight ended", ended);
await sleep(2500);
ok("a loss does NOT go to the title screen", (await ev(`window.__state.started === true && getComputedStyle(document.getElementById("title-screen")).display === "none"`)) === true);
ok("a lost challenge restores the party exactly as it was (the test forced HP to 0)", (await ev(`JSON.stringify(window.__state.partnerStats)`)) === hpBefore);
ok("the challenge stays open after a loss", (await st("seiryu_rematch")) === "active", await st("seiryu_rematch"));

// ---- hard version: scaled stats really reach the battle
await ev(`window.__quests.state.active.seiryu_rematch.p=[1]; window.__quests.claim("seiryu_rematch")`); await sleep(300);
ok("hard rematch unlocks once the first is done", (await st("seiryu_rematch_hard")) === "available", await st("seiryu_rematch_hard"));
await ev(`window.__quests.accept("seiryu_rematch_hard")`);
await ev(`window.__quests.beginChallenge("seiryu_rematch_hard")`); await sleep(5000);
const party4 = await ev(`(()=>{const b=window.__battleB&&window.__battleB();return b?JSON.stringify(b.party.map(e=>[e.enemyId,e.enemyHp,e.enemyStatScale])):null})()`);
ok("hard version: the game's own stat scales x22/16 (22,23,20 -> 30,32,28) and HP x1.5 reach the battle", party4 === '[["Minotarumon",756,30],["Tyrannomon",864,32],["Apemon",1026,28]]', party4);

// the story was only READ, never written (apart from the flag this test set itself)
await ev(`window.__storyFlags.set(16402, false)`);
const flagsAfter = await ev(`JSON.stringify(window.__state.flags)`);
ok("quests wrote no story flags of their own", flagsBefore === flagsAfter, "");
console.log("errors/warnings:", errs.join(" | ") || "none");
await ev(`localStorage.removeItem("dw.quests.v1"); localStorage.removeItem("dw.fx.v1")`);
await fetch("http://127.0.0.1:9333/json/close/" + tab.id); process.exit(0);
