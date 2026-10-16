# Which Digimon a player can get, and how their techniques animate

Checked 2026-10-14. Everything for the disc's own 55 species is disc data, so no outside "which evolution makes
sense" list is used there. The 135 species the disc only ever used as enemies (Kunemon, Tapirmon, Betamon ...
Galacticmon) are made obtainable on top of that, with lineage from the Digimon canon (Digimon World 2 / anime).

## The disc's 55 species

| Species rows | Digimon | How the player gets them |
|---|---|---|
| 1-8 | the eight rookies | Partner NPCs hand out one per roster slot (`bank70_partner_grants.json`) |
| 9-52 | the 44 forms Dinohumon ... Diaboromon | Each of the eight lines learns all 44 by the disc's unlock rule (`engine/dw3/evo-trees.ts`, `pro/stfgtrep` 0x369C-0x390C) |
| 53-55 | Agunimon, BladeGarurumon, AncientGreymon | Only as DNA (Jogress) results in battle, models 468-470, as in the original |

## The 135 enemy-only species (ids 56..190)

Built by `tools/build_extra_species.py` from `enemies.json` plus our own lineage file
(`data/authored/web/assets/data/extra_species_canon.json`: fixed ids, append only, and each species' canonical
pre-evolutions). Output (not committed, like all disc-derived data): `extra_species.json`, `extra_profiles.bin`.
The build_all stage is `extra_species`.

- **Form shape**: the same as the disc's 44 forms. Tier A-E from the enemy's stat total (and never below the forms
  it comes from) sets the stat-bonus total, resist cap and DV cap; the bonus is split by the enemy's own stat
  shares; resistances are the enemy's, scaled to the cap; family is the enemy's `digimon_type` (the same 1-11 the
  base forms use).
- **Techniques**: the enemy's own attack is the basic, its special (if any) the signature, the rest come from the
  disc's generic technique pool by element and tier. Every one is a technique the disc animates.
- **How the player gets one**: each of the eight lines gets 135 more unlock records after its 44. A form needs its
  canonical pre-evolution at a form level plus one stat gate from the enemy's strongest stat; roots (Kunemon,
  Tapirmon, Betamon ...) need only line level. A line that suits the family (insects: Veemon and Monmon lines;
  aquatic: Kumamon and Veemon; ...) meets the base gate, the others need more of everything. One form is learned
  per fight, as in the original, after the disc's 44.
- **Where they show up**: the game's own screens, unchanged. `web/extra-roster.js` registers the profile records
  with the menu engine's species getter (`engine/dw3/ui/native/pause-status.ts`) and adds the rows to
  `digimon.json` / `evolutions.json` as they are fetched. The names are already in the disc's name bank 0x4E (it
  names every enemy), so the Digivolve list, the Digimon Lab, the victory screen, the Tag list and the card all
  name them. Extra species have no DNA partner.
- **More than 44 forms**: the card's roster record, and every native screen, hold 44 ledger cells. The cells show
  the current and equipped forms always, then one page of the rest (base forms first, then the extras in species
  order). In the Digimon Lab press `[` and `]` to flip the page. Nothing is cut: the walker keeps the whole ledger,
  and a memory-card save keeps the forms that did not fit in its companion snapshot.
- **Not separate species**: the numbered copies of an enemy (Numemon2 ... Numemon6, Kuwagamon2 ...) are the same
  Digimon at other strengths, so they are not extra forms.

## Technique animation

An enemy model only carries the clips its enemy used (idle, hits, the basic attack, sometimes one spell). The
player species carry all 18. A technique an extra species owns with a clip its model lacks would have stood still
with no effect, so `web/fight/clip-fallback.js` builds the missing clip:

- support (10), field (15), debuff (16), spell (9) and multi-shot (13) come from a donor player species' clip of
  the same number (Greymon's pack), with the timeline tables the model lacks replaced by its own attack tables and
  the projectile sprite replaced by its own or one by element;
- combos (6, 8) and the signature strike (11) are the model's own basic attack plus the technique's own effect
  where the hit spark lands.

Models that have the clip are never touched. `tools/fight_fallback_census.mjs` plays all 1,493 clips this builds
through the real action VM (finishes, real tables, registered effects): 0 problems.

Known and expected: `tools/fight_anim_census.baseline.json` lists 47 clips the animation census flags on the disc's
own models. 20 are clip 12 on the DNA-capable species: that is the Jogress director script (presentation command
0x3A), not a body animation, so its `emptyTables[56]` is not a missing move.

## Tests and checks

- `tests/digimon-obtainability.test.js`: all 55 reachable; every enemy-only species reachable from all eight lines
  by the real unlock rule; every owned technique resolves to a clip (or the donor's), effect and backdrop.
- `tests/fight-fallback-census.test.js`, `tests/extra-save-roundtrip.test.js` (48 forms through a card save and load).
- Browser: `tools/verify_extra_roster.mjs` (the Digivolve list), `tools/verify_extra_learn.mjs` (win a fight, learn
  Kunemon, saved), `tools/verify_extra_tech_anim.mjs` (spell, combo and support on an enemy-only model).

## New partners: DemiDevimon, Kunemon, Hagurumon

Three partners beyond the disc's eight, each with its whole line already in the game as 3D models
(`data/authored/web/assets/data/new_starters.json`, built by `tools/build_extra_species.py` into `extra_species.json`'s
`starters`):

| Partner | Id | Roster slot | Own line (line level 5 / 20 / 40) | Gear from |
|---|---|---|---|---|
| DemiDevimon | 191 | 8 | Devimon, Myotismon, VenomMyotismon | Renamon's line |
| Kunemon | 192 | 9 | Kuwagamon, Okuwamon, HerculesKabuterimon | Veemon's line |
| Hagurumon | 193 | 10 | Guardromon, Andromon, HiAndromon | Monmon's line |

Base numbers follow the disc's starter budget (stat total 200, resistances 680, status resistances 150). After its own
line, each gets a donor line's gates for the disc's 44 forms (the donor's own forms ten levels later), then the
enemy-only species by family. A line never learns its own species as a form.

How you get them: once you have a party they are owned and wait in the Digimon Lab (Switch Digimon), like any partner
you have obtained. Their bits sit above the disc's eight (`rosterOwned` bits 8..10), so story checks never see them.

Engine: roster slots 8..15 (`engine/dw3/roster.ts`), their records at `0x801F8000` (`engine/dw3/roster-records.ts`);
every record address goes through `rosterRecordAddress`. A card save keeps the disc's eight records; the new partners'
blocks come back from the companion snapshot (`engine/persistence/memcard-state.ts`).

(Slot 9 was Betamon until 2026-10-16; a four-legged walk was too hard to draw, so Kunemon took the slot, id and form id.)

Field sprites come straight from each battle model: `tools/partner-from-model.sh` (frame counts and timing are
Patamon's; the output is disc-derived, so `web/extra_partners/*.png` stays uncommitted and the committed
`web/extra_partners.json` keeps the blank placeholders). DemiDevimon: `m217pdev x191demi 10 20 44`. Hagurumon:
`IDLE_BEATS=1 ... m122hagu x193hagu 10 61 30`. Kunemon walks by rolling like his attack:
`ZOOM=0.8 WALK_SPIN=720 IDLE_BEATS=1 IDLE_BOB=0 ... m032kune x192kune 10 61 30`.

Pictures: the engine numbers a new partner's lab/status/fight-report picture 0x400 + (slot-8)*0x10 + frame;
`web/partner-pictures.js` paints it from the partner's own field sprite (idle, facing down-left, three frames
fitted into the 32x32 cell). With no sprite imported the cell stays blank.

Battle camera: an enemy-only model on our side (any extra species, a new partner, their forms) has a 0x48
staging record with no near-side shots, so no camera record was ever cut and the arena did not draw.
`nearCameraFor` (web/battle3d.js) lends it the twelve near shots of the partner with the closest stand-off.

Browser checks: `tools/verify_new_partners.mjs`
(lab switch, a fight, card save and load, pause STATUS), `tools/verify_partner_sprite.mjs [outdir] [charId]`.
