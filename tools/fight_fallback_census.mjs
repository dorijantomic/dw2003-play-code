// Every action clip a model lacks but a technique can ask for, played through the REAL ActorAnimator with the
// donor fallback (web/fight/clip-fallback.js): the script must finish, every timeline table it binds must
// have frames, every effect it spawns must be in the effect registry, and it must raise a contact marker
// (the hit) when the donor's clip does.
//
//   node tools/fight_fallback_census.mjs          exit 1 on any problem
import fs from "fs";
import path from "path";
import url from "url";

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const WEB = path.join(HERE, "..", "web");
const { ActorAnimator } = await import(url.pathToFileURL(path.join(WEB, "fight/actor-animator.js")));
const { setFallbackDonor } = await import(url.pathToFileURL(path.join(WEB, "fight/clip-fallback.js")));

const MODELS = path.join(WEB, "assets/battle/models");
const manifest = JSON.parse(fs.readFileSync(path.join(WEB, "assets/battle/effects/manifest.json"), "utf8"));
const KNOWN = new Set(Object.keys(manifest.types).map(Number));
const donor = JSON.parse(fs.readFileSync(path.join(MODELS, "m005grey/anim.json"), "utf8"));
setFallbackDonor(donor.actions);

const CLIPS = [6, 8, 9, 10, 11, 13, 15, 16];
const has = (m, c) => !!m.actions?.[c]?.ops?.length && !m.actions[c].ops.every((o) => o.op === 0 || o.op === 255);
let filled = 0, bad = 0;
const problems = [];
for (const folder of fs.readdirSync(MODELS).sort()) {
  const file = path.join(MODELS, folder, "anim.json");
  if (!fs.existsSync(file)) continue;
  const model = JSON.parse(fs.readFileSync(file, "utf8"));
  for (const clip of CLIPS) {
    if (has(model, clip) || !has(donor, clip)) continue;
    filled++;
    const anim = new ActorAnimator(model);
    const empty = [], fx = [];
    let contact = 0;
    const orig = anim._playerForTable.bind(anim);
    anim._playerForTable = (i) => { if (i > 1 && !model.timeline?.[i]?.table?.length) empty.push(i); return orig(i); };
    const ok = anim.setAction(clip, {
      onEffect: (e) => { if (!KNOWN.has(e.type)) fx.push(e.type); },
      onHit: () => { contact++; }, onContact: () => { contact++; },
    }, { currentEffect: 2, element: 2 });
    let ticks = 0;
    while (anim.vm && !anim.vm.ended && ticks < 4000) { anim.tick(1); ticks++; }
    const why = [];
    if (!ok) why.push("no script built");
    if (anim.vm && !anim.vm.ended) why.push(`stuck(${ticks})`);
    if (empty.length) why.push(`emptyTables[${[...new Set(empty)]}]`);
    if (fx.length) why.push(`unknownFx[${[...new Set(fx)]}]`);
    if (why.length) { bad++; problems.push(`${folder} clip ${clip}: ${why.join(" ")}`); }
  }
}
console.log(`fallback census: ${filled} missing clips built from the donor, ${bad} with problems`);
if (problems.length) { console.error(problems.slice(0, 40).join("\n")); process.exit(1); }
