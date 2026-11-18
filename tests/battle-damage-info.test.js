// Look-only damage flags (crit, eff): filling the optional `info` of resolveDamage must change no damage value and no RNG draw, for fixed seeds.
// The flags feed the battle overlay's damage pop (web/ui-c/hit.css); the rules never read them.
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveDamage } from "../engine/dw3/battle-formulas.ts";

const stream = (seed) => { let x = seed >>> 0, n = 0; const f = () => { n++; x = (Math.imul(x, 1103515245) + 12345) >>> 0; return (x >>> 8) & 0xffff; }; f.count = () => n; return f; };
const atk = { spd: 120, crit: 20, weaponFamilies: [0, 0, 0], affinity: 0 };
const mk = (res, family = 0) => ({ spd: 100, family, armor: 0, resistances: res });
const skills = [
    { element: "normal", magical: false, damage_scalar: 0, effect: "none" },
    { element: "fire", magical: false, damage_scalar: 60, effect: "none" },
    { element: "ice", magical: true, damage_scalar: 80, effect: "none" },
    { element: "fire", magical: false, damage_scalar: 60, target_family: 3, effect: "none" },
];

test("resolveDamage: with and without the info object, same damage and same RNG draws for 400 seeds", () => {
    let crits = 0;
    for (let seed = 1; seed <= 400; seed++) for (const sk of skills) for (const res of [{ fire: 50, ice: 400 }, { fire: 100, ice: 100 }, { fire: 300, ice: 30 }]) {
        const a = stream(seed), b = stream(seed), info = { crit: false, eff: 1 };
        const plain = resolveDamage(500, atk, mk(res, 3), sk, a, null);
        const flagged = resolveDamage(500, atk, mk(res, 3), sk, b, null, info);
        assert.equal(flagged, plain, `damage seed ${seed}`);
        assert.equal(b.count(), a.count(), `rng draws seed ${seed}`);
        assert.equal(typeof info.crit, "boolean");
        assert.ok(Number.isFinite(info.eff) && info.eff > 0);
        if (info.crit) crits++;
    }
    assert.ok(crits > 0, "at least one crit in the seeds");
});

test("resolveDamage flags: weak element reads above 1.5, resistant below 0.75, family boost is 1.5", () => {
    const seed = stream(7);
    const weak = { crit: false, eff: 1 }, hard = { crit: false, eff: 1 }, fam = { crit: false, eff: 1 }, none = { crit: false, eff: 1 };
    resolveDamage(500, atk, mk({ fire: 30 }), skills[1], seed, null, weak);
    resolveDamage(500, atk, mk({ fire: 4000 }), skills[1], seed, null, hard);
    resolveDamage(500, atk, mk({ fire: 100 }, 3), { ...skills[3], element: "normal", damage_scalar: 0 }, seed, null, fam);
    resolveDamage(500, atk, mk({}), skills[0], seed, null, none);
    assert.ok(weak.eff >= 1.5, "weak " + weak.eff);
    assert.ok(hard.eff <= 1.01, "resist " + hard.eff);
    assert.equal(fam.eff, 1.5);
    assert.equal(none.eff, 1);
});
