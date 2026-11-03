// Does loading a PNG the way battle3d.js loadTexture does (createImageBitmap(blob) -> texImage2D) keep the colour of
// fully transparent texels? Reads the uploaded texture back (framebuffer attach + readPixels) and compares the RGB of
// alpha-0 texels with the file's own, for the default bitmap and for premultiplyAlpha "none".
//   VERIFY_PORT=8090 [TEX=/assets-hd/battle/arenas/meft1001/floor_c48_r255.png] tools/run-playwright.sh tools/probe_texture_premultiply.mjs
import { chromium } from "playwright";
import { baseUrl } from "./verify-base-url.mjs";

const TEX = process.env.TEX || "/assets-hd/battle/arenas/meft1001/floor_c48_r255.png";
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage();
await page.addInitScript(() => localStorage.setItem("assetMode", "hd"));
await page.goto(`${baseUrl(8090)}/arena-viewer.html`);
const out = await page.evaluate(async (url) => {
  const blob = await (await fetch(url)).blob();
  const file = await createImageBitmap(blob, { premultiplyAlpha: "none" });
  const c2 = new OffscreenCanvas(file.width, file.height).getContext("2d");
  c2.drawImage(file, 0, 0);
  // the file's own RGB under alpha 0 (2D canvas is premultiplied too, so decode the PNG bytes instead)
  const gl = new OffscreenCanvas(4, 4).getContext("webgl");
  const read = async (opts) => {
    const bm = opts ? await createImageBitmap(blob, opts) : await createImageBitmap(blob);
    const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bm);
    const fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
    const px = new Uint8Array(bm.width * bm.height * 4);
    gl.readPixels(0, 0, bm.width, bm.height, gl.RGBA, gl.UNSIGNED_BYTE, px);
    let n = 0, s = [0, 0, 0];
    for (let i = 0; i < px.length; i += 4) if (px[i + 3] === 0) { n++; s[0] += px[i]; s[1] += px[i + 1]; s[2] += px[i + 2]; }
    return { transparent: n, rgbMean: s.map(v => Math.round(v / Math.max(1, n))) };
  };
  // the game's own loader (battle3d.js loadTexture) on the same sheet, through the HD asset path
  const { loadTexture } = await import("/battle3d.js");
  const real = await new Promise((res) => {
    const g2 = new OffscreenCanvas(4, 4).getContext("webgl");
    loadTexture(g2, url.replace("/assets-hd/", "assets/"), (t, w, h) => {
      const fb = g2.createFramebuffer(); g2.bindFramebuffer(g2.FRAMEBUFFER, fb);
      g2.framebufferTexture2D(g2.FRAMEBUFFER, g2.COLOR_ATTACHMENT0, g2.TEXTURE_2D, t, 0);
      const px = new Uint8Array(w * h * 4); g2.readPixels(0, 0, w, h, g2.RGBA, g2.UNSIGNED_BYTE, px);
      let n = 0, s = [0, 0, 0];
      for (let i = 0; i < px.length; i += 4) if (px[i + 3] === 0) { n++; s[0] += px[i]; s[1] += px[i + 1]; s[2] += px[i + 2]; }
      res({ size: w, transparent: n, rgbMean: s.map(v => Math.round(v / Math.max(1, n))) });
    });
  });
  return { asLoaded: await read(null), premultiplyNone: await read({ premultiplyAlpha: "none" }), game: real };
}, TEX);
console.log(TEX);
console.log("default bitmap        :", JSON.stringify(out.asLoaded));
console.log("premultiplyAlpha none :", JSON.stringify(out.premultiplyNone));
console.log("game loadTexture (HD) :", JSON.stringify(out.game));
await browser.close();
