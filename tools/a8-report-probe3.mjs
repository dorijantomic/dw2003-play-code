// A8 probe 3: which ledger shapes make the translated fight report re-learn an OWNED form?
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { FightReportSession } from "../engine/dw3/ui/fight-report-session.ts";
import { registerExtraProfiles, walkerIdOf } from "../engine/dw3/ui/native/pause-status.ts";
import { setLedgerPage } from "../engine/dw3/ui/roster-form-state.ts";

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

const EXTRAS = Array.from({ length: 135 }, (_, i) => 56 + i);
const ledger = (ids) => ids.map((id) => ({ id, formLevel: 1, dvexp: 0, techSlots: [0, 0, 0, 0, 0, 0] }));

function probe(label, ids, page = 0) {
  setLedgerPage(page);
  const session = new FightReportSession({
    language: 2, battleId: 5, dropItemId: 0, activePosition: 0, bits: 4321, bag: [],
    members: [{
      position: 0, rosterSlot: 3, nameBytes: name("Agumon"), exp: 25350, level: 30, tp: 10,
      hp: 100, maxHp: 100, mp: 10, maxMp: 10, participated: true,
      forms: { digimonId: 144, equippedForms: [4, 144, 0], formLedger: ledger(ids) },
    }],
  }, resources(), host());
  const ownedBefore = new Set(ids);
  let frame = 0;
  for (; frame < 8000 && !session.finished(); frame++) session.tick(frame % 4 < 2 ? ["circle"] : [], frame + 1);
  const rec = session.record(0);
  const learned = rec.ledger.map((e) => walkerIdOf(session.mem, e.form)).filter((id) => id > 0 && !ownedBefore.has(id));
  const shown = rec.ledger.map((e) => walkerIdOf(session.mem, e.form)).filter((id) => id > 0);
  console.log(`${label} page=${page}: finished=${session.finished()} cells=${rec.ledger.length} learned=${JSON.stringify(learned)} shown=${shown.slice(0, 8).join(",")}...`);
}

probe("A only Agumon", [4]);
probe("B Agumon+144", [4, 144]);
probe("C all extras", [4, ...EXTRAS]);
probe("D all extras + Greymon", [4, 12, ...EXTRAS]);
probe("D all extras + Greymon, page 1", [4, 12, ...EXTRAS], 1);
probe("D all extras + Greymon, page 3", [4, 12, ...EXTRAS], 3);
probe("E all extras + Greymon + base forms", [4, 9, 10, 11, 12, 13, ...EXTRAS]);
