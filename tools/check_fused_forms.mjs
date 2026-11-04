// check_fused_forms.mjs — the ten DNA bodies, printed with their partners, pack and clip
// coverage, and checked for the three ways a fused body can lose the ability to play.
//
// Reads only shipped tables: jogress_scripts.json (the ten DNA actions), the model index,
// each fused pack's anim.json and web/fight/anim-donor-map.js (the donor rows). Prints one
// line per body and one line per fault; exits 1 only when there is a fault.
//
//   node tools/check_fused_forms.mjs
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { CLIP_NAMES, fusionFaults, fusionForms } from "../web/fusion-forms.js";
import { ANIM_DONOR_GAPS } from "../web/fight/anim-donor-map.js";

const ROOT = path.resolve(import.meta.dirname, "..");
const readJSON = (file) => JSON.parse(fs.readFileSync(file, "utf8"));

/** One printed line per row: action, clip, fused body, pack, partners, coverage, gaps. */
function rowLine(row, bodies) {
  const pack = bodies[row.folder];
  const slots = pack?.clips?.length ?? 0;
  const clips = `${row.presentClips.length}/${slots}`;
  const gaps = row.gaps.length
    ? row.gaps.map((gap) => {
        const name = `${gap.clip} ${CLIP_NAMES[gap.clip]}`;
        return gap.donor ? `${name} -> ${gap.donor} table ${gap.tables.join("+")}` : `${name} -> no donor`;
      }).join("; ")
    : "none";
  return `action ${row.actionId}  clip ${row.clip}  fused ${row.fusedModel}  pack ${row.folder}  ` +
    `partners ${row.partners.join(", ")}  clips ${clips}  tables ${row.tables}  frames ${row.frames}  gaps ${gaps}`;
}

/** The whole report: rows, faults, the lines to print, and the exit status they imply. */
export function fusedFormsReport(jogress, index, donors, bodies) {
  const rows = fusionForms(jogress, index, donors, bodies);
  const faults = fusionFaults(rows);
  const lines = rows.map((row) => rowLine(row, bodies));
  lines.push("");
  for (const fault of faults) lines.push(`fault: ${fault.message}`);
  if (!faults.length) lines.push("no faults");
  const authored = rows.filter((row) => row.presentClips.length > 0).length;
  lines.push(`${rows.length} DNA bodies: ${authored} authored, ${rows.length - authored} dataless, ${faults.length} faults`);
  return { rows, faults, lines, status: faults.length ? 1 : 0 };
}

/** The shipped tables: jogress actions, model index, donor map, and each fused pack. */
export function loadShipped(root = ROOT) {
  const jogress = readJSON(path.join(root, "web/assets/data/jogress_scripts.json"));
  const index = readJSON(path.join(root, "web/assets/battle/models/index.json"));
  const folders = new Set(index);
  const bodies = {};
  for (const action of Object.values(jogress.actions ?? {})) {
    const folder = action?.fusedPack?.folder;
    if (!folder || !folders.has(folder) || bodies[folder]) continue;
    const file = path.join(root, "web/assets/battle/models", folder, "anim.json");
    if (fs.existsSync(file)) bodies[folder] = readJSON(file);
  }
  return { jogress, index, donors: ANIM_DONOR_GAPS, bodies };
}

function main() {
  const { jogress, index, donors, bodies } = loadShipped();
  const report = fusedFormsReport(jogress, index, donors, bodies);
  for (const line of report.lines) console.log(line);
  process.exitCode = report.status;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
