// TEMP probe (deleted at the end): slot list + layers of one arena
import { launch } from "./verify-launch.mjs";
import { openViewer, grab } from "./verify_slots_frame.mjs";
const arena = process.env.ARENA || "meft1013";
const browser = await launch();
const { page, ctx, errors } = await openViewer(browser, arena);
await page.waitForTimeout(1500);
await grab(page, 1);
const r = await page.evaluate(() => { const B = window.__built; return { slots: B.slots.list().map((s) => `${s.id}:${s.count}${s.error ? " ERR " + s.error : ""}`), layers: B.layers.map((l) => l.id), missing: B.info.missingLayers, inst: B.info.instances, fol: B.foliage.children.length, ko: B.info.keepOut && B.info.keepOut.accepted }; });
console.log(JSON.stringify(r)); console.log("errors", errors.length, errors.slice(0, 3).join(" | "));
await ctx.close(); await browser.close();
