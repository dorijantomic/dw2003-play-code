import { chromium } from "playwright";
import { spawn } from "node:child_process";

const port = "8754";
const server = spawn("python3", ["-m", "http.server", port], {
  cwd: `${process.cwd()}/web`,
  stdio: "ignore",
});

try {
  await new Promise((resolve) => setTimeout(resolve, 800));
  const browser = await chromium.launch({
    args: ["--autoplay-policy=no-user-gesture-required"],
  });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${port}/music-hd-lab.html`);
    await page.waitForFunction(
      () =>
        window.__musicHdLab?.manifest?.sample_count === 16 &&
        window.__musicHdLab?.newManifest?.original_composition === true &&
        window.__musicHdLab?.newManifest?.tracks?.length === 3,
      null,
      { timeout: 15000 },
    );

    await page.locator("[data-version=a]").click();
    await page.waitForTimeout(300);
    const authentic = await page.evaluate(() => ({
      src: window.__musicHdLab.audio?.src,
      time: window.__musicHdLab.audio?.currentTime,
      paused: window.__musicHdLab.audio?.paused,
    }));
    await page.locator("[data-version=b]").click();
    await page.waitForTimeout(300);
    const hd = await page.evaluate(() => ({
      src: window.__musicHdLab.audio?.src,
      time: window.__musicHdLab.audio?.currentTime,
      paused: window.__musicHdLab.audio?.paused,
    }));

    if (!authentic.src?.includes("/assets/music/bgm001.ogg") || authentic.paused)
      throw new Error(`authentic playback failed: ${JSON.stringify(authentic)}`);
    if (!hd.src?.includes("/assets/music-hd/bgm001.ogg") || hd.paused)
      throw new Error(`HD playback failed: ${JSON.stringify(hd)}`);
    if (hd.time + 0.05 < authentic.time)
      throw new Error("A/B switch did not preserve playback position");
    let previousTime = hd.time;
    for (const [version, expected] of [
      ["c", "asuka-neon-promenade.ogg"],
      ["d", "asuka-chrome-circuit.ogg"],
      ["e", "asuka-pixel-skyline.ogg"],
    ]) {
      await page.locator(`[data-version=${version}]`).click();
      await page.waitForTimeout(300);
      const composed = await page.evaluate(() => ({
        src: window.__musicHdLab.audio?.src,
        time: window.__musicHdLab.audio?.currentTime,
        paused: window.__musicHdLab.audio?.paused,
      }));
      if (!composed.src?.includes(`/assets/music-new/${expected}`) || composed.paused)
        throw new Error(`variation ${version} playback failed: ${JSON.stringify(composed)}`);
      // Vorbis seeking is granule-aligned; allow a sub-120 ms snap while still
      // detecting a reset to the beginning during normal A/B/C switching.
      if (composed.time + 0.12 < previousTime)
        throw new Error(
          `${version} switch did not preserve playback position: ` +
          `${previousTime} -> ${composed.time}`,
        );
      previousTime = composed.time;
    }
    if (errors.length) throw new Error(`page errors: ${errors.join("; ")}`);
    console.log("Asuka audio lab: authentic / HD / three new variations verified");
  } finally {
    await browser.close();
  }
} finally {
  server.kill();
}
