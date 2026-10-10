import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";
const out = process.argv[2]; mkdirSync(out, { recursive: true });
const b = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const p = await b.newPage({ viewport: { width: 1100, height: 900 } });
p.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
await p.goto(`${baseUrl(8742)}/ui-lab.html`, { waitUntil: "load" });
await p.waitForFunction(() => { const f=document.getElementById("game"); return f?.contentWindow?.__labOpen && f.contentWindow.__state?.started; }, null, {timeout:45000});
await p.evaluate(() => { const w=document.getElementById("game").contentWindow; w.__labOpen("cardduel"); w.__labDuel.open(null,"Opponent",null,13); });
await p.waitForTimeout(1200);
const st = ()=>p.evaluate(()=>{const d=document.getElementById("game").contentWindow.__labDuel;
  return {o:d.openingScreen(),ph:d.phaseKey(),pl:d.play?.stage??null,se:d.setEndState()?.step??null,
          h:d.duel?.player.hand.length,f:d.duel?.player.field.length};});
async function shot(i,tag){const url=await p.evaluate(()=>{const w=document.getElementById("game").contentWindow;const c=w.document.createElement("canvas");c.width=320;c.height=240;const g=c.getContext("2d");g.imageSmoothingEnabled=false;w.__labDuel.draw(g,320,240);return c.toDataURL("image/png");});
  writeFileSync(`${out}/${String(i).padStart(3,"0")}_${tag}.png`, Buffer.from(url.split(",")[1],"base64"));}
// Play like a person: confirm to advance, square in the summon phase.
let i=0;
for (let step=0; step<150; step++) {
  const s = await st();
  const tag = `${s.o??s.ph??"-"}_${s.pl??s.se??"-"}`;
  await shot(i++, tag);
  if (s.ph === "summon" && s.pl === null) {
    // summon what we can, then end the turn
    await p.evaluate(()=>document.getElementById("game").contentWindow.focus());
    await p.keyboard.press("v"); await p.waitForTimeout(200);
    await shot(i++, tag+"_sq");
    await p.keyboard.press("Enter"); await p.waitForTimeout(220);
    continue;
  }
  await p.evaluate(()=>document.getElementById("game").contentWindow.focus());
  await p.keyboard.press("Enter");
  await p.waitForTimeout(220);
  if (i > 130) break;
}
console.log("frames", i, "final", JSON.stringify(await st()));
await b.close();
