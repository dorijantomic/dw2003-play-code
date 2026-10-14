// Checks web/dialogue-pack.js against the disc's own dialogue files: every plain-text line it can read must encode back
// to the SAME bytes, and a pack built from new text must be read back by the game's own text fetcher layout.
// Run: node tools/verify_dialogue_pack.mjs        (reads web/assets/data/dialogue-box/estalk00..09.bin)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { decodeLine, encodeLine, buildPack, paginate } from "../web/dialogue-pack.js";

// DIALOGUE_DIR overrides the folder (web/assets is a symlink on some setups that Windows cannot follow)
const dir = process.env.DIALOGUE_DIR || path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "web", "assets", "data", "dialogue-box");
let total = 0, readable = 0, exact = 0; const bad = [];
for (let f = 0; f < 10; f++) {
  const d = fs.readFileSync(path.join(dir, `estalk0${f}.bin`));
  const v = new DataView(d.buffer, d.byteOffset, d.byteLength);
  const n = v.getUint32(0, true);
  for (let i = 0; i < n; i++) {
    const s = v.getUint32(4 + i * 4, true);
    if (s >= d.length) continue;
    let e = s; while (e < d.length && d[e] !== 0) e++;
    const raw = d.subarray(s, e);
    total++;
    const dec = decodeLine(raw);
    if (!dec) continue;
    readable++;
    const back = encodeLine(dec.name, dec.pages);
    const same = back.length - 1 === raw.length && back.subarray(0, raw.length).every((b, k) => b === raw[k]);
    if (same) exact++; else if (bad.length < 5) bad.push(`estalk0${f}[${i}] ${JSON.stringify(dec).slice(0, 120)}`);
  }
}
const ok = (name, cond, extra = "") => console.log(cond ? "PASS" : "FAIL", name, extra);
console.log(`   ${total} lines on the disc, ${readable} use only codes this module knows`);
ok("a good share of the disc's lines are plain text this module can read (the rest use name codes, sprites or other escapes)", readable > total * 0.3, `(${readable}/${total})`);
ok("every readable line re-encodes to exactly the disc's bytes", exact === readable, `(${exact}/${readable})`);
if (bad.length) console.log("   first mismatches:", bad.join(" | "));

const pages = paginate("You have been keeping the park clear. That is good work.\n\nWill you do that?");
const pack = buildPack("Leomon", pages);
const pv = new DataView(pack.buffer);
const off = pv.getUint32(4, true);
ok("a built pack has the file layout (count, offsets, NUL-terminated string)", pv.getUint32(0, true) === 1 && off === 12 && pack[pack.length - 1] === 0 && pack.indexOf(0, off) === pack.length - 1);
const back = decodeLine(pack.subarray(off, pack.length - 1));
ok("and reads back as the same text", back && back.name === "Leomon" && JSON.stringify(back.pages) === JSON.stringify(pages), JSON.stringify(back));
ok("pages are at most three lines of 22 characters", pages.every((p) => p.length <= 3 && p.every((l) => l.length <= 22)));
