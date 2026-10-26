// A8 probe 2: where does the translated fight report stall with a big extra-species ledger?
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { FightReportSession } from "../engine/dw3/ui/fight-report-session.ts";
import { registerExtraProfiles } from "../engine/dw3/ui/native/pause-status.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const D = join(root, "web/assets/data");
const bytes = (p) => new Uint8Array(readFileSync(join(D, p)));
const manifest = JSON.parse(readFileSync(join(D, "report/manifest.json"), "utf8"));
function resources(language = 2) {
  const banks = new Map();
  for (const [offset, dir] of [[0x55, "report"], [0x4e, "wizard"], [0x6a, "shop-banks"], [0xa2, "pause"]]) {
    banks.set(offset + language, bytes(`${dir}/${offset + language}.bin`));
  }
  return { tables: bytes("report/tables.bin"), profiles: bytes("digimon_profiles.bin"),
    textButtons: Uint8Array.from(manifest.textButtons.bytes), font: bytes("shop_font.bin"), banks };
}
registerExtraProfiles(new Uint8Array(readFileSync(join(D, "extra_profiles.bin"))));
const name = (text) => [...text].map((c) => (c >= "a" ? 40 + c.charCodeAt(0) - 97 : 14 + c.charCodeAt(0) - 65));
const host = () => ({ playSound() {}, rand: () => 1234 });

const ledger = (ids) => ids.map((id) => ({ id, formLevel: 1, dvexp: 0, techSlots: [0, 0, 0, 0, 0, 0] }));
const base = [4, ...Array.from({ length: 135 }, (_, i) => 56 + i)];

for (const [label, ids] of [["135 extra forms", base], ["+ Greymon", [4, 12, ...base.slice(1)]], ["only Agumon", [4]]]) {
  const session = new FightReportSession({
    language: 2, battleId: 5, dropItemId: 0, activePosition: 0, bits: 4321, bag: [],
    members: [{
      position: 0, rosterSlot: 3, nameBytes: name("Agumon"), exp: 25350, level: 30, tp: 10,
      hp: 100, maxHp: 100, mp: 10, maxMp: 10, participated: true,
      forms: { digimonId: 144, equippedForms: [4, 144, 0], formLedger: ledger(ids) },
    }],
  }, resources(), host());
  const trace = [];
  for (let frame = 0; frame < 12000 && !session.finished(); frame++) {
    session.tick(frame % 4 < 2 ? ["circle"] : [], frame + 1);
    if (frame % 2000 === 0) trace.push({ frame, state: session.state(), rows: session.rows().map((r) => r.state) });
  }
  console.log(label, "finished=", session.finished());
  console.log("  ", JSON.stringify(trace));
  const rec = session.record(0);
  console.log("   ledger cells", rec.ledger.length, "exp", rec.exp, "level", rec.level);
}
