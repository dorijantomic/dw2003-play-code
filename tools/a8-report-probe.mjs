// A8 probe: what does the translated fight report's own replay learn from a given ledger?
// Mirrors tests/fight-report-session.test.js, but with the user's ledger shape (the lead owns
// every enemy-only species as a form, current form Raijinmon, level 30).
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
const name = (text) => [...text].map((c) => (c >= "a" ? 40 + c.charCodeAt(0) - 97 : 14 + c.charCodeAt(0) - 65));
const host = () => ({ playSound() {}, rand: () => 1234 });
// The browser registers the enemy-only profiles at boot (web/extra-roster.js); without
// them every id 56+ has no game value and the ledger seeding drops those entries.
registerExtraProfiles(new Uint8Array(readFileSync(join(D, "extra_profiles.bin"))));

const ledger = (withGreymon) => {
  const ids = [4, ...Array.from({ length: 135 }, (_, i) => 56 + i)];
  if (withGreymon) ids.splice(1, 0, 12);
  return ids.map((id) => ({ id, formLevel: 1, dvexp: 0, techSlots: [0, 0, 0, 0, 0, 0] }));
};

function run(label, withGreymon) {
  const member = {
    position: 0, rosterSlot: 3, nameBytes: name("Agumon"), exp: 25350, level: 30, tp: 10,
    hp: 100, maxHp: 100, mp: 10, maxMp: 10, participated: true,
    forms: { digimonId: 144, equippedForms: [4, 144, 0], formLedger: ledger(withGreymon) },
  };
  const s = new FightReportSession({
    language: 2, battleId: 5, dropItemId: 0, activePosition: 0, bits: 4321, bag: [],
    members: [member],
  }, resources(), host());
  for (let frame = 0; frame < 4000 && !s.finished(); frame++) s.tick(frame % 4 < 2 ? ["circle"] : [], frame + 1, 1);
  const rec = s.record(0);
  console.log(`${label}: finished=${s.finished()} ledger cells=${rec.ledger.length} forms=${rec.ledger.map((e) => e.form).join(",")}`);
}

run("ledger without Greymon", false);
run("ledger with Greymon   ", true);
