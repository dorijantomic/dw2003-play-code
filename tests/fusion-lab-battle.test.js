// Fusion Lab battle data (tools/fusion_battle.py): variant models take their species' stats, a species with no
// enemies.json row is scaled to the median total of its stage, and every Random result can become a boss.
// Reads the private game data through python; skipped when it is not on this machine. No disc numbers in this file.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const run = spawnSync("python3", [join(here, "fusion_lab_battle_check.py")], { encoding: "utf8", timeout: 300000 });
let data = null;
try { data = JSON.parse(run.stdout); } catch { /* reported below */ }
const skip = !data || data.skip;

test("variant models: <species><number> takes the species' stats", { skip }, () => {
  assert.equal(data.variants.MetalGreymon2, "MetalGreymon");
  assert.equal(data.digit_variants_ok, true, "trailing-number variants resolve to the name without the number");
  assert.equal(data.variants.BKWarGreymon, "BKWayGreymon", "same canonical name in anatomy.json");
  assert.equal(data.variants.ImperialdramonFM, "Imperialdramon-F");
  assert.equal(data.three_tailed_has_row, false, "a custom model with no species stays without a stats source");
  const g = data.growlmon_metalgreymon2;
  assert.equal(g.boss_ready, true, JSON.stringify(g.blockers));
  assert.ok(g.sources.some((t) => t.includes("MetalGreymon2: stats from MetalGreymon (same Digimon, other model)")), g.sources.join(" | "));
});

test("no enemies.json row: total = median total of the same stage; enemy rows unchanged", { skip }, () => {
  assert.equal(data.enemy_rows_untouched, true);
  for (const [name, f] of Object.entries(data.forms)) {
    assert.ok(Math.abs(f.total - f.median) <= 3, `${name} total ${f.total} vs stage median ${f.median}`);
    assert.ok(f.str > 100, `${name} str is enemy scale`);
  }
  assert.equal(data.forms.Growlmon.stage, "champion");
  assert.equal(data.forms.WarGreymon.stage, "mega");
  assert.ok(data.medians.champion < data.medians.ultimate && data.medians.ultimate < data.medians.mega);
});

test("Random result is always boss-ready (30 seeds)", { skip }, () => {
  assert.equal(data.random.length, 30);
  for (const r of data.random) {
    assert.equal(r.error, undefined, `seed ${r.seed}: ${r.error}`);
    assert.equal(r.ready, true, `seed ${r.seed}: ${JSON.stringify(r.blockers)}`);
  }
});
