#!/usr/bin/env node
// A8: the learned form must appear in the Digimon Lab list (the production lab, pro/stgdglab).
// Seeds the A8 partner (current form an extra form, 135 extra forms learned), adds an owned base
// form the page would hide if the window were "the first 44 array entries", opens the real lab
// with __labOpen("dri") and reads the list the screen was given.
// Serves: python3 -m http.server 8109 --directory web
import { chromium } from "playwright";
import { baseUrl } from "./verify-base-url.mjs";

const ROOT = process.env.A8_ROOT || `${baseUrl(8109)}/`;
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
page.on("pageerror", (e) => console.error("PAGEERROR", e.message));

try {
  await page.goto(`${ROOT}?skipTitle=1&map=s320&noEncounters=1`, { waitUntil: "load", timeout: 90_000 });
  await page.waitForFunction(() => window.__state?.started, null, { timeout: 60_000 });
  for (let i = 0; i < 20; i++) {
    if (!(await page.evaluate(() => window.__textbox?.isOpen?.() ?? false))) break;
    await page.keyboard.press("Enter"); await page.waitForTimeout(90);
  }
  const learned = await page.evaluate(() => {
    const st = window.__state.partnerStats;
    st.formLedger ??= [];
    // A base form the partner learned (the report's Greymon, 12) before the extras were added.
    if (!st.formLedger.some((e) => Number(e.id) === 12)) {
      st.formLedger.push({ id: 12, formLevel: 1, dvexp: 0, techSlots: [0, 0, 0, 0, 0, 0] });
    }
    return st.formLedger.length;
  });
  await page.evaluate(async () => { await window.__extraRoster.learnAll(); });
  const count = await page.evaluate(() => window.__state.partnerStats.formLedger.length);
  await page.evaluate(() => window.__labOpen("dri"));
  await page.waitForFunction(() => window.__dri?.isOpen?.(), null, { timeout: 30_000 }).catch(() => {});
  await page.waitForTimeout(500);
  const view = await page.evaluate(() => {
    const g = window.__dri;
    const members = (g?._members ?? []).map((m) => ({
      current: Number(m?.stats?.digimonId), equipped: (m?.stats?.equippedForms ?? []).map(Number),
      shown: (m?.window ?? []).map((e) => ({ id: Number(e.id), level: Number(e.formLevel) })).slice(0, 50),
    }));
    const m = (g?._members ?? []).find((x) => Number(x?.stats?.digimonId) === 144) ?? (g?._members ?? [])[0];
    const ids = (m?.window ?? []).map((e) => Number(e.id));
    return { open: !!g?.isOpen?.(), pages: g?._ledgerPages ?? 0, members, ids };
  });
  const idList = view.ids;
  console.log("ledger before learnAll:", learned, "after:", count);
  console.log("lab:", JSON.stringify({ open: view.open, pages: view.pages }));
  for (const m of view.members) console.log(" member current", m.current, "first ids", JSON.stringify(m.shown.slice(0, 6).map((e) => e.id)));
  console.log("list page 0 (partner):", JSON.stringify(idList));
  console.log(`learned form 12 on the lab list: ${idList.includes(12) ? "YES" : "NO"}`);
  const rec = await page.evaluate(() => {
    const g = window.__dri;
    const v0 = g?._data?.value0 ?? [];
    const want = Number(v0[11] ?? 0); // walker id 12 -> the profile table's value0
    const r = g?._session?.record?.(3);
    const ledger = (r?.ledger ?? []).filter(Boolean);
    return { want, entries: ledger.length, first: ledger.slice(0, 6).map((e) => Number(e.value)),
      has: ledger.some((e) => Number(e.value) === want), current: Number(r?.currentForm ?? 0),
      equipped: (r?.equipped ?? []).map(Number) };
  });
  console.log("lab record slot 3:", JSON.stringify(rec));
} catch (e) {
  console.error("FATAL", e);
} finally {
  await browser.close();
}
