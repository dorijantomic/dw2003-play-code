// frame time of the whole built arena at 960x720 (B.render, 600 frames, median of 3 runs). ARENA env.
import { launch } from "./verify-launch.mjs";
import { baseUrl } from "./verify-base-url.mjs";
const ARENA = process.env.ARENA || "meft1008";
const browser = await launch();
const page = await (await browser.newContext({ viewport: { width: 1300, height: 760 } })).newPage();
await page.goto(`${baseUrl(8090)}/arena-viewer.html?arena=${ARENA}&look=built`);
await page.waitForFunction(() => window.__built?.info?.triangles > 0 || window.__built?.missing, null, { timeout: 90000 }).catch(() => {});
await page.waitForTimeout(2000);
const r = await page.evaluate(() => {
  const B = window.__built, R = B.renderer, cv = R.domElement, kw = cv.width, kh = cv.height; cv.width = 960; cv.height = 720;
  const cam = window.__r.getCameraInfo().render, gl = R.getContext(), one = new Uint8Array(4);
  const time = (n) => { const t0 = performance.now(); for (let i = 0; i < n; i++) { B.render(cam); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, one); } return (performance.now() - t0) / n; };
  time(30); const a = [time(600), time(600), time(600)].sort((x, y) => x - y);
  cv.width = kw; cv.height = kh; return { ms: a, tris: B.info.triangles, calls: B.info.calls };
});
console.log(`FRAME ${ARENA} 960x720: median ${r.ms[1].toFixed(2)} ms (runs ${r.ms.map((x) => x.toFixed(2)).join(" ")}), tris ${r.tris}, calls ${r.calls}`);
await browser.close();
