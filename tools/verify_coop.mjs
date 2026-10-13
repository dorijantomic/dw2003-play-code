// Browser test for co-op by remote play: a host tab (the game) and a guest tab (coop-guest.html) connected through the real invite / reply codes.
// Checks: off by default, F4 panel, connection, live video, input routing (spectator / shared), ownership by battle slot, the host's keys blocked while the guest holds control,
// a real tag-in handing control back, tougher enemies, a second wild enemy, and a clean disconnect.
// Needs: the game served on PORT (default 8770) and Chrome with --remote-debugging-port=9333 (a separate, clean profile). Both tabs run in ONE browser (loopback).
// Run:   PORT=8770 node tools/verify_coop.mjs

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PORT = process.env.PORT || 8770;
const errs = [];
async function openTab(url) {
  const tab = await (await fetch("http://127.0.0.1:9333/json/new?" + encodeURIComponent(url), { method: "PUT" })).json();
  const ws = new WebSocket(tab.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
  let id = 0; const pend = new Map();
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); }
    if (d.method === "Runtime.exceptionThrown") errs.push(url.slice(-20) + " " + JSON.stringify(d.params.exceptionDetails.exception?.description ?? d.params.exceptionDetails.text).slice(0, 200)); };
  const send = (method, params = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (e) => (await send("Runtime.evaluate", { expression: e, awaitPromise: true, returnByValue: true, userGesture: true })).result?.result?.value;
  await send("Runtime.enable"); await send("Page.enable"); await send("Network.enable"); await send("Network.setCacheDisabled", { cacheDisabled: true });
  await send("Emulation.setFocusEmulationEnabled", { enabled: true }).catch(() => {});
  const key = async (k, code, vk, type = "both") => { if (type !== "up") await send("Input.dispatchKeyEvent", { type: "keyDown", key: k, code, windowsVirtualKeyCode: vk }); if (type !== "down") await send("Input.dispatchKeyEvent", { type: "keyUp", key: k, code, windowsVirtualKeyCode: vk }); };
  return { id: tab.id, send, ev, key, close: () => fetch("http://127.0.0.1:9333/json/close/" + tab.id) };
}
const ok = (name, cond, extra = "") => console.log(cond ? "PASS" : "FAIL", name, extra);

const host = await openTab(`http://localhost:${PORT}/index.html?skipTitle=1&noEncounters=1&map=s330`);
for (let i = 0; i < 90; i++) { await sleep(400); if (await host.ev("!!(window.__state && window.__state.started && window.__coop)")) break; }
await host.ev('[...document.querySelectorAll("button")].find(b=>/Authentic PS1/.test(b.textContent))?.click()'); await sleep(2500);
await host.ev(`localStorage.removeItem("dw.fx.v1")`);
ok("co-op is off by default", (await host.ev("window.__fx.coop")) === false);
await host.ev(`(()=>{const c=document.querySelector('[data-fx="coop"]');c.checked=true;c.dispatchEvent(new Event("change",{bubbles:true}))})()`);
// a real two-member party
await host.ev(`(()=>{const s=document.querySelector("#charSelect");const o=[...s.options].find(o=>/^p00[2-9]/.test(o.value));s.value=o.value;s.dispatchEvent(new Event("change",{bubbles:true}));})()`); await sleep(2500);
await host.ev(`window.__state.party=["p003pken","p004kogu"]`);
await host.ev(`window.__seen=[]; window.addEventListener("keydown",(e)=>window.__seen.push([e.isTrusted,e.key]))`);   // where the game listens (bubble phase, after the co-op gate)

// ---- connection by copy and paste
await host.ev(`window.dispatchEvent(new KeyboardEvent("keydown",{key:"F4",bubbles:true}))`); await sleep(300);
ok("F4 opens the co-op panel", (await host.ev(`!document.getElementById("coop-panel").hidden`)) === true);
const invite = await host.ev(`window.__coop.createInvite()`);
ok("an invite code is produced", typeof invite === "string" && invite.length > 200, `(${invite && invite.length} chars)`);
const guest = await openTab(`http://localhost:${PORT}/coop-guest.html`);
await sleep(1000);
await guest.ev(`document.getElementById("invite").value=${JSON.stringify(invite)}; document.getElementById("make").click()`);
let reply = ""; for (let i = 0; i < 20 && !reply; i++) { await sleep(400); reply = await guest.ev(`document.getElementById("reply").value`); }
ok("the guest page produces a reply code", reply.length > 100, `(${reply.length} chars)`);
await host.ev(`window.__coop.acceptReply(${JSON.stringify(reply)})`);
for (let i = 0; i < 40 && !((await host.ev("window.__coop.connected")) && (await guest.ev("window.__guest.open"))); i++) await sleep(400);
ok("both sides report connected", (await host.ev("window.__coop.connected")) === true && (await guest.ev("window.__guest.open")) === true);

// ---- live video of the host's game
let w = 0; for (let i = 0; i < 40 && !w; i++) { await sleep(400); w = await guest.ev(`document.getElementById("video").videoWidth`); }
ok("the guest receives live video of the host's game", w >= 320, `(${w}px wide)`);
const t1 = await guest.ev(`document.getElementById("video").currentTime`); await sleep(1500);
const t2 = await guest.ev(`document.getElementById("video").currentTime`);
ok("the video is playing (time advances)", t2 > t1, `(${t1} -> ${t2})`);

// ---- input routing out of battle: the host drives, the guest is a spectator
const guestKey = async (k, code, vk) => guest.key(k, code, vk);
await host.ev(`window.__seen.length=0; window.__coop.log.length=0`);
await guestKey("Enter", "Enter", 13); await sleep(500);
ok("out of battle the guest's keys are dropped", (await host.ev(`JSON.stringify(window.__seen.filter(s=>!s[0]).length)`)) === "0", await host.ev(`JSON.stringify(window.__coop.log)`));
await host.ev(`window.__coop.setShared(true)`); await host.ev(`window.__seen.length=0; window.__coop.log.length=0`);
await guestKey("Enter", "Enter", 13); await sleep(500);
ok("with shared field control the guest's keys reach the game", (await host.ev(`window.__seen.filter(s=>!s[0]&&s[1]==="Enter").length`)) >= 1, await host.ev(`JSON.stringify(window.__coop.log)`));
await host.ev(`window.__coop.setShared(false)`);

// ---- ownership in battle: slot 0 is the host's, slot 1 the guest's
await host.ev(`window.__battle.startParty([{name:"Kunemon",level:1,hp:120,mp:9999,stat_scale:16}], ()=>{}, ()=>{}, ()=>{}, {screenId:34, mapId:"s330", kind:"scripted"})`); await sleep(5000);
ok("a real battle with a two-Digimon party is running", (await host.ev(`!!window.__battle.isActive() && window.__battleB().player && true`)) === true);
ok("front slot 0: the host holds the controls", (await host.ev(`window.__coop.controller()`)) === "host");
await host.ev(`window.__seen.length=0; window.__coop.log.length=0`);
await guestKey("Enter", "Enter", 13); await sleep(400);
ok("while the host's Digimon is in front, the guest's keys are dropped", (await host.ev(`window.__seen.filter(s=>!s[0]).length`)) === 0);
await host.ev(`window.__battleB().activePlayerIndex = 1`); await sleep(600);
ok("tag in slot 1: control passes to the guest", (await host.ev(`window.__coop.controller()`)) === "guest");
ok("the guest is told it is their turn", /Your turn/.test(await guest.ev(`document.getElementById("banner").textContent`)), await guest.ev(`document.getElementById("banner").textContent`));
await host.ev(`window.__seen.length=0; window.__coop.log.length=0`);
await host.key("Enter", "Enter", 13); await sleep(400);                         // the HOST presses (trusted)
ok("the host's own keys are blocked while the guest holds control", (await host.ev(`window.__seen.filter(s=>s[0]).length`)) === 0, await host.ev(`JSON.stringify(window.__coop.log)`));
await host.key("F2", "F2", 113); await sleep(200);
ok("...but F-keys still work for the host", (await host.ev(`window.__seen.filter(s=>s[0]&&s[1]==="F2").length`)) >= 1);
await guestKey("Enter", "Enter", 13); await sleep(500);
ok("the guest's key reaches the game", (await host.ev(`window.__seen.filter(s=>!s[0]&&s[1]==="Enter").length`)) >= 1, await host.ev(`JSON.stringify(window.__coop.log)`));

// ---- tougher enemies while connected
const eHp = await host.ev(`window.__battleB().party[0].enemyHp`), eSc = await host.ev(`window.__battleB().party[0].enemyStatScale`);
ok("enemy HP x1.6 and stats x1.25 while a friend is connected", eHp === 192 && eSc === 20, `(hp ${eHp}, scale ${eSc})`);

// ---- the guest PLAYS the fight: it is their Digimon in front (swapped exactly as a tag-in does: index AND record)
await host.ev(`(()=>{const b=window.__battleB(); b.activePlayerIndex=1; b.player=b.playerRecords[1];})()`); await sleep(600);
await host.ev(`window.__coop.log.length=0`);
let ended = false, handedBack = false;
for (let i = 0; i < 120; i++) {
  await sleep(450);
  if (!(await host.ev(`!!window.__battle.isActive()`))) { ended = i > 3; break; }
  if (i > 3 && (await host.ev(`window.__coop.controller()`)) === "host") { handedBack = true; break; }       // the game itself tagged the guest's Digimon out
  if (i % 3 === 0) await host.ev(`(()=>{const b=window.__battleB&&window.__battleB(); if(b&&b.enemy&&b.enemy.hp>1) b.enemy.hp=1;})()`);
  await guest.key("Enter", "Enter", 13);                                                   // real key presses in the GUEST's tab only
}
const gl = JSON.parse(await host.ev(`JSON.stringify(window.__coop.log)`));
ok("the guest's own key presses drove real battle decisions (the fight ended, or the game tagged them out)", ended || handedBack, `(ended=${ended}, handedBack=${handedBack})`);
ok("...with the host pressing nothing", gl.some((l) => l.injected) && !gl.some((l) => l.dropped === "host"), `(${gl.filter((l) => l.injected).length} guest keys injected)`);
if (handedBack) {
  ok("a real tag-in handed the controls back to the host", (await host.ev(`window.__battleB().activePlayerIndex`)) === 0);
  await host.ev(`window.__seen.length=0; window.__coop.log.length=0`);
  await host.key("Enter", "Enter", 13); await sleep(400);
  ok("after the handover the host's own keys reach the game again", (await host.ev(`window.__seen.filter(s=>s[0]&&s[1]==="Enter").length`)) >= 1, await host.ev(`JSON.stringify(window.__coop.log)`));
}
// end whatever fight is still open through the game's automatic defeat sequence, so the next check starts clean
for (let i = 0; i < 100 && (await host.ev(`!!window.__battle.isActive()`)); i++) { await sleep(450); await host.ev(`(()=>{const b=window.__battleB&&window.__battleB();if(b&&b.player&&b.player.hp>0)b.player.hp=0})()`); await host.key("Enter", "Enter", 13); }
ok("the open fight was ended", !(await host.ev(`!!window.__battle.isActive()`)));
await host.ev(`window.__coop.config.doubleChance = 1`);
await host.ev(`window.__battle.startParty([{name:"Kunemon",level:1,hp:120,mp:9999,stat_scale:16}], ()=>{}, ()=>{}, ()=>{}, {screenId:34, mapId:"s330", kind:"random"})`); await sleep(5000);
ok("a wild fight can bring a second enemy of the same kind", (await host.ev(`window.__battleB() && window.__battleB().party.length`)) === 2, await host.ev(`JSON.stringify(window.__battleB().party.map(e=>[e.enemyId,e.enemyHp]))`));

// ---- disconnect
await host.ev(`window.__coop.closeConnection()`); await sleep(500);
ok("disconnecting is clean", (await host.ev("window.__coop.connected")) === false);
await host.ev(`window.__seen.length=0`);
await host.key("Enter", "Enter", 13); await sleep(300);
ok("after disconnecting the gate is gone: the host's keys work again", (await host.ev(`window.__seen.filter(s=>s[0]).length`)) >= 1);

console.log("errors:", errs.join(" | ") || "none");
await host.ev(`localStorage.removeItem("dw.fx.v1"); localStorage.removeItem("party")`);
await guest.close(); await host.close(); process.exit(0);
