import { chromium } from "playwright";
import { spawn } from "node:child_process";

const port = "8753";
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
    await page.goto(`http://127.0.0.1:${port}/music-remaster-lab.html`);
    await page.waitForFunction(
      () => window.__remasterLab?.manifest?.tracks?.length === 6,
      null,
      { timeout: 15000 },
    );

    const cards = await page.locator(".track").count();
    if (cards !== 6) throw new Error(`expected 6 track cards, got ${cards}`);
    await page.locator(".track").first().locator("[data-variant=a]").click();
    await page.waitForTimeout(300);
    const authentic = await page.evaluate(() => ({
      src: window.__remasterLab.audio?.src,
      time: window.__remasterLab.audio?.currentTime,
      paused: window.__remasterLab.audio?.paused,
    }));
    await page.locator(".track").first().locator("[data-variant=b]").click();
    await page.waitForTimeout(300);
    const remastered = await page.evaluate(() => ({
      src: window.__remasterLab.audio?.src,
      time: window.__remasterLab.audio?.currentTime,
      paused: window.__remasterLab.audio?.paused,
    }));
    if (!authentic.src?.includes("/assets/music/bgm001.ogg") || authentic.paused)
      throw new Error(`authentic playback failed: ${JSON.stringify(authentic)}`);
    if (!remastered.src?.includes("/assets/music-remastered/bgm001.ogg") || remastered.paused)
      throw new Error(`remastered playback failed: ${JSON.stringify(remastered)}`);
    if (remastered.time + 0.05 < authentic.time)
      throw new Error("A/B switch did not preserve playback position");
    if (errors.length) throw new Error(`page errors: ${errors.join("; ")}`);
    console.log(`music remaster lab: ${cards} tracks, A/B playback verified`);
  } finally {
    await browser.close();
  }
} finally {
  server.kill();
}
