import { chromium } from "playwright";
import { spawn } from "node:child_process";

const port = "8755";
const server = spawn("python3", ["-m", "http.server", port], {
  cwd: `${process.cwd()}/web`,
  stdio: "ignore",
});

try {
  await new Promise((resolve) => setTimeout(resolve, 700));
  const browser = await chromium.launch({
    args: ["--autoplay-policy=no-user-gesture-required"],
  });
  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${port}/asuka-hook-lab.html`);
    await page.waitForFunction(() => window.__asukaHookLab?.hooks?.length === 4);

    for (let index = 0; index < 4; index++) {
      await page.locator(`[data-hook="${index}"]`).click();
      await page.waitForTimeout(250);
      const state = await page.evaluate(() => ({
        active: window.__asukaHookLab.activeHook,
        playback: window.__asukaHookLab.playbackKind,
        time: window.__asukaHookLab.audioTime,
        paused: window.__asukaHookLab.audioPaused,
        activeButtons: document.querySelectorAll(".hook.active").length,
      }));
      if (
        state.active !== index ||
        state.playback !== "generated-wav" ||
        state.time <= 0 ||
        state.paused ||
        state.activeButtons !== 1
      )
        throw new Error(`hook ${index + 1} failed: ${JSON.stringify(state)}`);
    }

    await page.locator("#stop").click();
    if (await page.locator(".hook.active").count())
      throw new Error("Stop left an active hook button");
    if (errors.length) throw new Error(errors.join("; "));
    await page.screenshot({ path: "/tmp/asuka-hook-lab.png", fullPage: true });
    console.log("Asuka instant hook lab: four hooks and stop verified");
  } finally {
    await browser.close();
  }
} finally {
  server.kill();
}
