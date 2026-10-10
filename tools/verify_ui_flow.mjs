// Run: tools/run-playwright.sh tools/verify_ui_flow.mjs [capture-dir]
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { chromium } from "playwright";
import { UI_FLOWS, classifyFlowNode } from "../web/ui-flow-data.js";
import { baseUrl } from "./verify-base-url.mjs";

// The page's two badges come from the flow data, so the expected text is read from the same
// data rather than written here again. A hard-coded "MIPS + ours" outlives the route it was
// written for: the pause pages and the shop are our code now.
const runtimeLabel = { ours: "Our code", mixed: "MIPS + ours" };
const researchLabel = { compared: "Original captured", mapped: "Research mapped", partial: "Gaps remain" };
const badgesOf = (flowId, nodeId) => {
  const flow = UI_FLOWS.find((candidate) => candidate.id === flowId);
  const status = classifyFlowNode(flow, flow.nodes.find((node) => node.id === nodeId));
  return new RegExp(`${runtimeLabel[status.runtime]}.*${researchLabel[status.research]}`, "s");
};

const out = process.argv[2] ?? "/tmp/ddw3-ui-flow";
mkdirSync(out, { recursive: true });
const ownership = JSON.parse(readFileSync("docs/research/ui/current-ui-code-ownership.json", "utf8"));
const ownershipByName = new Map(ownership.surfaces.map((surface) => [surface.name, surface]));
for (const flow of UI_FLOWS) {
  const ids = new Set(flow.nodes.map((node) => node.id));
  assert.equal(ids.size, flow.nodes.length, `${flow.id}: duplicate screen`);
  for (const node of flow.nodes) {
    if (node.back !== "—") assert.ok(ids.has(node.back), `${flow.id}/${node.id}: missing Back destination`);
    const status = classifyFlowNode(flow, node);
    const surface = ownershipByName.get(status.surface);
    assert.ok(surface, `${flow.id}/${node.id}: no inventory surface ${status.surface}`);
    assert.equal(status.runtime, surface.ownership === "OURS" ? "ours" : "mixed",
      `${flow.id}/${node.id}: code badge disagrees with ownership inventory`);
    assert.match(status.evidence, /^.+\.md:\d+$/, `${flow.id}/${node.id}: missing research citation`);
    const [evidencePath, lineNumber] = status.evidence.match(/^(.+\.md):(\d+)$/).slice(1);
    assert.ok(existsSync(evidencePath), `${flow.id}/${node.id}: research file missing`);
    const evidenceLine = readFileSync(evidencePath, "utf8").split("\n")[Number(lineNumber) - 1];
    assert.ok(evidenceLine?.trim() && evidenceLine.trim() !== "---",
      `${flow.id}/${node.id}: research citation does not point to content`);
  }
  for (const [from, to] of flow.edges) {
    assert.ok(ids.has(from) && ids.has(to), `${flow.id}: broken ${from} → ${to}`);
  }
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
try {
  await page.goto(`${baseUrl(8742)}/ui-flow.html`, { waitUntil: "load" });
  await page.locator(".node").first().waitFor();
  assert.equal(await page.locator("#tabs button").count(), UI_FLOWS.length);
  assert.equal(await page.locator(".node").count(), UI_FLOWS[0].nodes.length);
  await page.locator('.node[data-node="items"]').click();
  assert.match(await page.locator("#details").innerText(), /Back \/ Escape → Pause menu/);
  assert.match(await page.locator('.node[data-node="items"]').innerText(), badgesOf("pause", "items"));
  const unlabeled = await page.addStyleTag({ content: ".badges,.statusBlock,.statusLegend{display:none!important}" });
  await page.screenshot({ path: `${out}/04-before-code-labels.png`, fullPage: true });
  await unlabeled.evaluate((style) => style.remove());
  await page.screenshot({ path: `${out}/05-after-code-labels.png`, fullPage: true });
  await page.screenshot({ path: `${out}/01-pause-menu-map.png`, fullPage: true });
  await page.locator("#later").click();
  await page.waitForTimeout(350);
  await page.screenshot({ path: `${out}/01b-pause-menu-later-steps.png`, fullPage: true });

  await page.getByRole("button", { name: "Item shops", exact: true }).click();
  assert.equal(await page.locator("#graphScroller").evaluate((wrap) => wrap.scrollLeft), 0);
  assert.equal(await page.locator(".node").count(), UI_FLOWS[1].nodes.length);
  await page.locator('.node[data-node="effects"]').click();
  assert.match(await page.locator("#details").innerText(), /Circle \/ Z → Buy list/);
  assert.match(await page.locator('.node[data-node="effects"]').innerText(), badgesOf("shop", "effects"));
  assert.ok((await page.locator("#wires path").count()) >= UI_FLOWS[1].edges.length);
  await page.screenshot({ path: `${out}/02-item-shop-map.png`, fullPage: true });

  await page.locator("#search").fill("weapon");
  assert.ok((await page.locator(".node:not(.dim)").count()) > 0);
  await page.getByRole("link", { name: /Open the real screen/ }).click();
  await page.waitForURL(/ui-lab\.html\?screen=shop/);
  await page.waitForFunction(() => document.getElementById("game")?.contentWindow?.__shop?.isOpen?.(), null, { timeout: 15000 });
  assert.ok(await page.getByRole("link", { name: /Screen route map/ }).isVisible());
  await page.goto(`${baseUrl(8742)}/ui-lab.html?screen=menu`, { waitUntil: "load" });
  await page.waitForFunction(() => {
    const game = document.getElementById("game")?.contentWindow;
    return game?.__state?.menuOpen && game?.__menu?.screen === "home";
  }, null, { timeout: 15000 });
  await page.locator(".maplink").evaluate((link) => { link.style.display = "none"; });
  await page.screenshot({ path: `${out}/00-before-lab-screen-list.png`, fullPage: true });
  await page.locator(".maplink").evaluate((link) => { link.style.display = ""; });
  await page.screenshot({ path: `${out}/03-after-lab-map-link.png`, fullPage: true });
  await page.frameLocator("#game").locator("#game").click();
  // The START list answers only once its boot has finished: root+0x10 is its phase word and
  // 3 is the live list, the same signal tools/verify_pause_home_buttons.mjs waits for. Until
  // then the press is swallowed by the boot pane, which is why this step used to time out.
  await page.waitForFunction(() => {
    const st = document.getElementById("game")?.contentWindow?.__status;
    const session = st?._session;
    return st?.diagnostics?.().entry === "home" && st.diagnostics().pending === false && session &&
      session.mem.read32(session.root + 0x10) === 3;
  }, null, { timeout: 40000 });
  await page.waitForTimeout(700);
  await page.keyboard.down("Enter"); // first START row: Items
  await page.waitForTimeout(120);
  await page.keyboard.up("Enter");
  await page.waitForFunction(() => document.getElementById("game")?.contentWindow?.__status?._entry === "items",
    null, { timeout: 20000 });
  assert.deepEqual(errors, []);
  console.log(`verify_ui_flow: OK — ${UI_FLOWS.length} routes, ${UI_FLOWS.reduce((n, f) => n + f.nodes.length, 0)} screens, live shop and Pause → Items`);
} finally {
  await browser.close();
}
