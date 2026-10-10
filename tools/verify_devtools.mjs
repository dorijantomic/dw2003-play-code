// Prove the dev toolset (web/devtools.html) drives the REAL game: jump to a
// stage via the ?map= route, play one of that stage's own events, start a
// battle with a chosen enemy, and switch the asset mode with a live preview.
//
//   python3 -m http.server 8744   # from the REPOSITORY ROOT (so ../data/ and web/ resolve)
//   VERIFY_PORT=8744 tools/run-playwright.sh tools/verify_devtools.mjs [outdir]
//
// The server root must be the repository, because devtools.html lives under
// web/ and the disc's own stage names are at data/stage_names.json beside it.
// The page still works with the ui-lab root (web/) — stage names then fall back
// to the manifest's per-map names.
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";

const OUT = process.argv[2] ?? "captures/devtools-2026-10-07";
mkdirSync(OUT, { recursive: true });
const ROOT = baseUrl(Number(process.env.VERIFY_PORT || 8744));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e.message)));
const steps = [];
const check = (n, ok, d = "") => {
  const l = `${ok ? "PASS" : "FAIL"}  ${n}${d ? ` — ${d}` : ""}`;
  console.log(l); steps.push(l); return ok;
};
const gameFrame = () => page.frames().find((f) => /\bindex\.html/.test(f.url())) ?? page.mainFrame();
const gameState = (fn) => gameFrame().evaluate(fn);

try {
  await page.goto(`${ROOT}/web/devtools.html`, { waitUntil: "load", timeout: 60000 });
  await page.waitForFunction(() => {
    const w = document.getElementById("game")?.contentWindow;
    return w?.__dev && w.__state?.started === true;
  }, null, { timeout: 60000 });
  await page.waitForTimeout(1000);
  check("devtools boots and the real game starts in the iframe", true,
    await gameState(() => location.search));
  await page.screenshot({ path: `${OUT}/01-boot.png` });

  // ── 1. JUMP: click the s350 Jump button (the ?map= reload route) ──────────
  await page.click('#tabs button[data-tab="stages"]');
  const clickedJump = await page.evaluate(() => {
    for (const li of document.querySelectorAll("#pane-stages ul.list li")) {
      if (li.querySelector(".n")?.textContent.startsWith("s350")) {
        [...li.querySelectorAll("button")].find((b) => /jump/i.test(b.textContent))?.click();
        return true;
      }
    }
    return false;
  });
  check("stages tab lists every map and a Jump button", clickedJump);
  await page.waitForFunction(() => {
    const w = document.getElementById("game")?.contentWindow;
    return w?.__dev && w.__state?.started && w.__mapInfo?.().id === "s350";
  }, null, { timeout: 60000 });
  const jumped = await gameState(() => ({ map: window.__mapInfo().id, pos: window.__pos() }));
  check("jump loaded the requested stage (s350)", jumped.map === "s350", JSON.stringify(jumped));
  await page.screenshot({ path: `${OUT}/02-jump-s350.png` });

  // ── 1b. REGRESSION (p5): after a Jump the 'Stage events' panel must follow the
  //        stage the iframe loaded, and Play must keep the game on that stage.
  //        A boot-only panel selection left the *previous* stage's events listed,
  //        so Play sent the game back to that stale stage. ────────────────────
  await page.evaluate(() => {
    for (const li of document.querySelectorAll("#pane-stages ul.list li")) {
      if ((li.querySelector(".n b")?.textContent ?? "") === "s210") {
        [...li.querySelectorAll("button")].find((b) => /jump/i.test(b.textContent))?.click();
      }
    }
  });
  await page.waitForFunction(() => {
    const w = document.getElementById("game")?.contentWindow;
    return w?.__dev && w.__state?.started && w.__mapInfo?.().id === "s210";
  }, null, { timeout: 60000 });
  await page.waitForTimeout(1200); // watchReady's tick re-selects the panel
  const panelStage = await page.evaluate(() => ({
    hint: document.getElementById("evHint")?.textContent ?? "",
    ids: [...document.querySelectorAll("#evList ul.list li b")].map((b) => b.textContent),
  }));
  check("after a Jump the Stage-events panel follows the loaded stage (s210)",
    panelStage.hint.startsWith("s210:") && panelStage.ids.length > 0, panelStage.hint.slice(0, 24));
  const playedFromPanel = await page.evaluate(() => {
    const li = document.querySelector("#evList ul.list li");
    const label = li?.querySelector("b")?.textContent ?? "?";
    [...(li?.querySelectorAll("button") ?? [])].find((b) => /^play$/i.test(b.textContent.trim()))?.click();
    return label;
  });
  await page.waitForTimeout(1500);
  const mapAfterPanelPlay = await gameState(() => window.__mapInfo().id);
  check("Play on the panel keeps the game on the stage the panel describes (s210)",
    mapAfterPanelPlay === "s210", `clicked ${playedFromPanel}, map ${mapAfterPanelPlay}`);

  // ── 2. EVENT: play a stage event directly ────────────────────────────────
  await page.evaluate(() => {
    for (const li of document.querySelectorAll("#pane-stages ul.list li")) {
      if (li.querySelector(".n")?.textContent.startsWith("s200")) {
        [...li.querySelectorAll("button")].find((b) => /jump/i.test(b.textContent))?.click();
      }
    }
  });
  await page.waitForFunction(() => {
    const w = document.getElementById("game")?.contentWindow;
    return w?.__dev && w.__state?.started && w.__mapInfo?.().id === "s200";
  }, null, { timeout: 60000 });
  await page.click('#tabs button[data-tab="stages"]');
  const played = await page.evaluate(() => window.__dev.playEvent("s200", 50));
  await page.waitForTimeout(800);
  const cut = await gameState(() => ({
    cutscene: !!window.__cutscene?.isActive?.(),
    textbox: !!window.__textbox?.isOpen?.(),
  }));
  check("playEvent started the stage's own event (s200 #50)", played === true && (cut.cutscene || cut.textbox),
    JSON.stringify(cut));
  await page.screenshot({ path: `${OUT}/03-event-s200-50.png` });

  // ── 3. BATTLE: start one with a chosen enemy ─────────────────────────────
  await page.click('#tabs button[data-tab="battles"]');
  // choose a specific enemy so the check is not just the default
  await page.selectOption("#btEnemy", "Kuwagamon");
  const startClicked = await page.evaluate(() => {
    const b = [...document.querySelectorAll("#pane-battles button")].find((x) => /start battle/i.test(x.textContent));
    b?.click();
    return !!b;
  });
  check("battles tab exposes an enemy picker and a Start battle button", startClicked);
  await page.waitForFunction(() => {
    const w = document.getElementById("game")?.contentWindow;
    return w?.__battle?.isActive?.() === true;
  }, null, { timeout: 30000 });
  await page.waitForTimeout(1500);
  const peak = await gameState(() => window.__battle.peek());
  const bstate = await gameState(() => ({ active: window.__battle.isActive(), state: window.__battle.peek().state }));
  check("battle started with the chosen enemy", /Kuwagamon/i.test(String(peak?.enemy?.name ?? peak?.enemy)), JSON.stringify(peak?.enemy));
  await page.screenshot({ path: `${OUT}/04-battle.png` });

  // ── 4. ASSET MODE switch + live preview ──────────────────────────────────
  const wasBattle = bstate.active;
  await page.click('#tabs button[data-tab="assets"]');
  const hdClicked = await page.evaluate(() => {
    const b = [...document.querySelectorAll("#pane-assets button")].find((x) => /hd/i.test(x.textContent));
    b?.click();
    return !!b;
  });
  check("assets tab exposes the authentic/hd mode switch", hdClicked);
  await page.waitForFunction(() => localStorage.getItem("assetMode") === "hd", null, { timeout: 20000 });
  await page.waitForFunction(() => {
    const w = document.getElementById("game")?.contentWindow;
    return w?.__dev && w.__state?.started;
  }, null, { timeout: 60000 });
  await page.waitForTimeout(800);
  // view one map asset in the current (hd) mode
  await page.selectOption("#asGroup", "maps");
  await page.waitForTimeout(300);
  const viewed = await page.evaluate(() => {
    for (const li of document.querySelectorAll("#pane-assets ul.list li")) {
      if (li.querySelector(".n")?.textContent.includes("s200")) {
        [...li.querySelectorAll("button")].find((b) => /view/i.test(b.textContent))?.click();
        return true;
      }
    }
    return false;
  });
  await page.waitForTimeout(600);
  const preview = await page.evaluate(() => ({
    mode: localStorage.getItem("assetMode"),
    src: document.getElementById("preview")?.getAttribute("src"),
    path: document.getElementById("asPath")?.textContent,
  }));
  check("hd mode selected and the preview resolves to an assets-hd URL",
    preview.mode === "hd" && /assets-hd\//.test(String(preview.src)),
    JSON.stringify(preview));
  await page.screenshot({ path: `${OUT}/05-assets-hd.png` });

  // ── 5. STATE export ──────────────────────────────────────────────────────
  const snap = await page.evaluate(() => JSON.parse(window.__dev.exportJSON()));
  check("state inspector exports a live JSON snapshot",
    snap && snap.map === "s200" && Array.isArray(snap.party) && snap.party.length === 3,
    JSON.stringify({ map: snap?.map, party: snap?.party?.length, screen: snap?.screen }));
  await page.click('#tabs button[data-tab="state"]');
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/06-state.png` });

  check("no uncaught page errors", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | "));
  void wasBattle;
} catch (e) {
  check("devtools run completed", false, String(e));
} finally {
  await browser.close();
}

const fails = steps.filter((s) => s.startsWith("FAIL")).length;
writeFileSync(`${OUT}/devtools-report.txt`, steps.join("\n") + `\n\n${fails} FAILURE(S)\n`);
console.log(`\n${fails === 0 ? "ALL STEPS PASSED" : `${fails} FAILURE(S)`}`);
process.exit(fails === 0 ? 0 : 1);
