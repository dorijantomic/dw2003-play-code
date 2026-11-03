// Numbers check: the Arena Viewer (web/arena-viewer.html) keeps its camera and EVERY setting when anything is switched.
//  A free-camera pose (position / target / fov), "show Digimon" off, some layer switches, sky time, colour pass off and a
//  tuning-panel value are set. Then: look hd -> built -> authentic -> hd -> built (each one loads the page again), arena
//  next / previous (arrow keys), a page reload. After EVERY step: the live free camera eye / look / up / fov equal the
//  set pose within 1e-6, and the camera mode, Digimon tick, layers, post, sky time, digi light and panel value are the same
//  (live where the look has them, always in the saved state). Last: the Reset button gives the defaults.
//   VERIFY_PORT=8090 [ARENA=meft1002] tools/verify-lock.sh tools/run-playwright.sh tools/verify_viewer_keep_state.mjs
import { launch } from "./verify-launch.mjs";
import { baseUrl } from "./verify-base-url.mjs";

const ARENA = process.env.ARENA || "meft1002";
const URL_ = `${baseUrl(8090)}/arena-viewer.html?arena=${ARENA}&look=built&p=m373rena&e=m051kuwa`;
const TOL = 1e-6;
let fails = 0;
const check = (ok, msg) => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"} ${msg}`); };
const maxDiff = (a, b) => Math.max(...a.map((x, i) => Math.abs(x - b[i])));

const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: 1300, height: 760 } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));

// the page is ready when its renderer, the free camera (if it is to be free) and the built world / panel (if built) are there
const ready = (want) => page.waitForFunction((w) => {
  if (!window.__renderFrame || !window.__viewerState || !window.__r) return false;
  const S = window.__viewerState.get();
  if (S.cam === "free" && !window.__tools?.freeCam) return false;
  if (S.look === "built") {
    const B = window.__built; if (!B || B.missing || !window.__tools?.tuner) return false;
    if (w?.tuner && !window.__tools.tuner.ready) return false;
  }
  return true;
}, want, { timeout: 120000, polling: 250 });
const settle = async () => { await page.evaluate(() => { for (let i = 0; i < 3; i++) window.__renderFrame(performance.now()); }); };

const snap = () => page.evaluate(() => {
  const S = window.__viewerState.get(), $ = (id) => document.getElementById(id);
  const fc = window.__tools?.freeCam, v = fc?.view();
  const t = window.__tools?.tuner;
  return { S, look: $("look").value, arena: +$("arena").value, cam: $("cam").value, fighters: $("fighters").checked,
    view: v || null, layersLive: window.__layers?.on ? { ...window.__layers.on } : null, skyLive: window.__layers?.skyMode?.() ?? null,
    tuneReady: !!t?.ready, tuneLive: t?.ready ? Object.fromEntries(t.entries.filter((e) => e.touched).map((e) => [e.id, typeof e.targets[0].value === "number" ? e.targets[0].value : e.targets[0].value.toArray()])) : null,
    tuneRows: !!t };
});

// ---------- step 0: set the state ----------
await page.goto(URL_);
await ready();
await page.selectOption("#cam", "free");
await page.waitForFunction(() => !!window.__tools.freeCam, null, { timeout: 20000 });
const POSE = { eye: [1234.5, 876.25, -2345.125], look: [10.5, 20.25, 30.125], fov: 41.5 };
await page.evaluate((P) => {
  const fc = window.__tools.freeCam; fc.set(P.eye, P.look); fc.camera.fov = P.fov; fc.camera.updateProjectionMatrix();
}, POSE);
const pose = await page.evaluate(() => window.__tools.freeCam.view());   // what the controls really hold (set() runs controls.update())
await page.evaluate(() => {
  const f = document.getElementById("fighters"); f.checked = false; f.dispatchEvent(new Event("change"));
  window.__layers.set("rocks", false); window.__layers.set("trees", false); window.__layers.set("post", false);
  window.__layers.set("digiLight", false); window.__layers.setSkyMode("night");
});
// a tuning-panel value: open the panel, move the first live-free number control by 37 % of its range
const tune = await page.evaluate(() => {
  const t = window.__tools.tuner; t.setOpen(true);
  const e = t.entries.find((x) => x.kind === "num" && !x.live && x.ctls?.[0]);
  const c = e.ctls[0], val = c._min + (c._max - c._min) * 0.37;
  t.set(e.id, val); return { id: e.id, val };
});
await settle();
console.log(`INFO set: free pose eye ${JSON.stringify(pose.eye)} look ${JSON.stringify(pose.look)} fov ${pose.fovDeg}; Digimon hidden; rocks, trees, colour pass, digi light off; sky night; panel ${tune.id} = ${tune.val}`);

const base = await snap();
const expectSettings = { cam: "free", fighters: false, layers: { ...base.S.layers }, post: false, skyTime: "night", digiLight: false };
check(base.S.layers.rocks === false && base.S.layers.trees === false && base.S.cam === "free" && base.S.fighters === false && base.S.post === false
  && base.S.skyTime === "night" && base.S.digiLight === false && Math.abs(base.S.tuner?.[tune.id] - tune.val) < 1e-9 && base.S.tunerOpen === true,
  `state saved after the changes (localStorage): cam free, fighters off, rocks/trees/post/digiLight off, sky night, panel value ${base.S.tuner?.[tune.id]}, panel open`);

async function compare(tag, o = {}) {
  const s = await snap();
  const v = s.view, e = [];
  if (!v) e.push("no free camera");
  else {
    const d = Math.max(maxDiff(v.eye, pose.eye), maxDiff(v.look, pose.look), maxDiff(v.up, pose.up), Math.abs(v.fovDeg - pose.fovDeg));
    if (!(d <= TOL)) e.push(`camera differs by ${d}`);
    var camD = d;
  }
  const S = s.S;
  if (S.cam !== "free" || s.cam !== "free") e.push(`camera mode ${s.cam}/${S.cam}`);
  if (s.fighters !== false || S.fighters !== false) e.push("Digimon tick changed");
  if (S.post !== false || S.digiLight !== false || S.skyTime !== "night") e.push(`post/digiLight/sky ${S.post}/${S.digiLight}/${S.skyTime}`);
  if (S.layers.rocks !== false || S.layers.trees !== false || Object.entries(S.layers).some(([k, x]) => !["rocks", "trees"].includes(k) && x !== true)) e.push("layers changed " + JSON.stringify(S.layers));
  if (s.layersLive && (s.layersLive.rocks !== false || s.layersLive.trees !== false || s.skyLive !== "night")) e.push("live layers/sky changed");
  if (Math.abs((S.tuner?.[tune.id] ?? NaN) - tune.val) > 1e-9) e.push(`saved panel value ${S.tuner?.[tune.id]}`);
  if (S.tunerOpen !== true) e.push("panel not open in state");
  if (o.tuneLive && s.tuneReady && tune.id in s.tuneLive && Math.abs(s.tuneLive[tune.id] - tune.val) > 1e-9) e.push(`live panel value ${s.tuneLive[tune.id]}`);
  if (o.tuneLive && !(s.tuneReady && tune.id in s.tuneLive)) e.push("panel value not live on the new arena (id absent or panel not built)");
  if (o.look && s.look !== o.look) e.push(`look ${s.look} wanted ${o.look}`);
  check(e.length === 0, `${tag}: look ${s.look}, arena ${s.arena}, camera max diff ${camD !== undefined ? camD.toExponential(2) : "n/a"}${e.length ? " -- " + e.join("; ") : ""}`);
  return s;
}

async function switchLook(look) {
  await Promise.all([page.waitForNavigation({ timeout: 60000 }), page.selectOption("#look", look)]);
  await ready({ tuner: look === "built" });
  await settle();
  return compare(`look -> ${look}`, { look, tuneLive: look === "built" });
}
await compare("before switching", { look: "built", tuneLive: true });
await switchLook("hd");
await switchLook("built");
await switchLook("authentic");
await switchLook("hd");
await switchLook("built");

// arena next / previous (arrow keys, no reload)
const a0 = (await snap()).arena;
async function arrow(key) {
  const before = (await snap()).arena;
  await page.keyboard.press(key);
  await page.waitForFunction((b) => +document.getElementById("arena").value !== b, before, { timeout: 5000 });
  await page.waitForFunction(() => window.__built && !window.__built.missing && window.__built.info?.pack === document.getElementById("arena").selectedOptions[0].textContent.split(" ")[0], null, { timeout: 120000, polling: 250 }).catch(() => {});
  await page.waitForFunction(() => !!window.__tools?.tuner?.ready || window.__built?.missing, null, { timeout: 60000, polling: 250 }).catch(() => {});
  await settle();
  return before;
}
await page.mouse.move(5, 5);   // keys go to the page, not a select
await page.evaluate(() => document.activeElement?.blur?.());
await arrow("ArrowRight");
const s1 = await compare("arena next", { look: "built" });
check(s1.arena !== a0, `arena changed ${a0} -> ${s1.arena}`);
await arrow("ArrowLeft");
const s2 = await compare("arena previous", { look: "built" });
check(s2.arena === a0, `arena back to ${s2.arena} (was ${a0})`);

// reload
await page.reload();
await ready({ tuner: true });
await settle();
await compare("page reload", { look: "built", tuneLive: true });

// another camera mode and back must keep the free pose (the pose is only forgotten by Reset)
await page.selectOption("#cam", "director");
await settle();
const sd = await snap();
check(sd.S.cam === "director" && sd.S.free && maxDiff(sd.S.free.eye, pose.eye) <= TOL, `camera mode battle idle: free pose still saved (eye diff ${sd.S.free ? maxDiff(sd.S.free.eye, pose.eye).toExponential(2) : "none"})`);
await page.selectOption("#cam", "free");
await page.waitForFunction(() => !!window.__tools.freeCam, null, { timeout: 20000 });
await settle();
const sf = await snap();
check(!!sf.view && Math.max(maxDiff(sf.view.eye, pose.eye), maxDiff(sf.view.look, pose.look), Math.abs(sf.view.fovDeg - pose.fovDeg)) <= TOL, "free again: the same pose comes back");

// Reset
await Promise.all([page.waitForNavigation({ timeout: 60000 }), page.click("#resetAll")]);
await ready();
await settle();
const r0 = await snap();
const L = Object.values(r0.S.layers || {});
check(r0.S.cam === "director" && r0.cam === "director" && r0.fighters === true && r0.S.fighters === true && r0.look === "hd" && r0.S.look === "hd"
  && r0.S.post === true && r0.S.digiLight === true && r0.S.skyTime === "auto" && L.length > 0 && L.every((x) => x === true)
  && !r0.S.free && !r0.S.tuner && !r0.view,
  `Reset: defaults (camera ${r0.cam}, look ${r0.look}, Digimon ${r0.fighters}, layers all on ${L.every((x) => x)}, sky ${r0.S.skyTime}, post ${r0.S.post}, no saved free pose/panel values)`);
check(errors.length === 0, `no page errors (${errors.length}${errors.length ? ": " + [...new Set(errors)].slice(0, 2).join(" | ") : ""})`);
await browser.close();
console.log(fails ? `FAILED ${fails}` : "ALL PASS");
process.exit(fails ? 1 : 0);
