# Aspect system: plan and reasoning

Status: **plan, nothing built in the game yet.** Written 2026-10-19 from the game data in `web/assets/data` and the engine in
`engine/dw3` and `web/battle.js`. Numbers marked *(estimate)* come from a model, not from play; *(open)* means it still has to be
measured or decided.

Companion tools (local pages, served from `web/`):
`extra-forms.html` (every extra form, its unlock rule and strength), `aspect-planner.html` (element routes and the exploit audit).

## 1. What we are doing and why

The five new partners are switched off (`NEW_PARTNERS_ENABLED = false` in `web/extra-roster.js`), because each needed its own
sprite and gym art. What stays is the part that already works: **135 enemy-only Digimon that each of the eight starters can learn
as a form**, after the disc's own 44.

Today every starter learns all 135 through one fixed rule (a stat gate scaled by tier, easier if the family "suits" that starter).
The aim is for a player to *shape* which forms they reach: a Dark-leaning Agumon should reach the dark forms earlier and the others
later, without it ever being a way to get strong too early.

The central design choice: **use the game's own mechanism for this, the element-bonus gate**, not new machinery. The disc already
does it for its off-path forms (SkullGreymon needs Dark 130-300, depending on the line; Angewomon needs a water-type bonus; MetalMamemon a
machine bonus). Our 135 forms are the only ones that ignore it.

## 2. What the data says

### 2.1 How a form is unlocked (verified in `engine/dw3/evo-trees.ts`, `web/battle.js`)

- Each starter has a tree of records: `{to, req0/req0Level, req1/req1Level, kind, threshold}`.
- A record passes when **both prerequisite forms are in the ledger at the required form level** and **one gate** is met. The gate
  `kind` is a core stat (1-5: STR, DEF, SPT, WIS, SPD), the line level (7), or one of seven element bonuses (8-14).
- **One form is learned per battle**, and it is the **first passing record in table order**. So the order of records is a design
  tool: put weaker forms first and the player always gets them first.
- A form can appear in **several records** (any one passing is enough). That gives us OR routes for free.
- What an element gate counts depends on which reader runs: see 2.1b (the trained bonus only, or base tolerance plus trained).
- **Gear never touches a gate.** I found no place where equipment writes the stored stats or element bonus; gear is folded in only when a
  battle is calculated. So wearing a Dark Ring cannot open a Dark route.

### 2.1b What an element gate compares (found while building the routes)

The game has **two** readers of the unlock rule, and they count an element differently:
- the **native results screen** (`engine/dw3/ui/native/fight-report-rewards.ts`, `reportUnlockForm`, the disc's routine ported) reads the roster record's element halfword, which is the seated form's
  **base tolerance plus every trained point** (`web/party.js` `partyRosterView`: `elements: elementValues(prof, stats.elemBonuses)`);
- the **browser path** (`web/battle.js` `nextUnlockedEvolution` into `engine/dw3/evo-trees.ts`) counts the **trained points only** for an element (`base = 0`).

So an element gate such as "Dark 140" could mean "base + trained" on one path and "trained" on the other, and the disc's own thresholds (80-360) look tuned to the total.
**Measured in the live game** (`tools/verify_aspect_route.mjs`, section 7): a gate met only by adding the line's base tolerance does **not** unlock; the trained points alone decide. So the aspect routes' gates are
**trained points only** (110 / 150 / 200 / 290 / 350 by tier, a quarter more on a line that does not suit the family). `ELEMENT_GATE_ADDS_BASE` in the build script keeps the other reading available if the two readers are ever
reconciled; doing that is separate work, and it would also change the disc's own element gates (SkullGreymon and the like).

### 2.2 What feeds the element bonus

| Source | Amount | Limit | Evidence |
|---|---|---|---|
| Level-ups (below Lv 41) | 0 to 2 per element per level, depending on the starter's `resistance_growth` | time; about 20-58 per element by Lv 40, **small** | `rollLevelUpGains`, `elem_table` |
| Element chips (Fire, Water, Ice, Wind, Thunder, Metal, Devil) | `rand % 10 + 1`, about 5.5 | money: 1,800-2,800 gold each, **about 330-510 gold per point**; cap 999 | `item_effects.json`, `items.ts` |
| Gym element drills | 1-50 per rep, about 3-5 per training point on the best drills | training points (TP): **5 per level**, cap 99 held; shared with the core-stat drills | `progression.json` gym tables |
| Gear | none for gates | n/a | 2.1 |

Where the chips come from:
- **Shop**: only shop 19, in **Amaterasu City - Junk Shop (`s251`)** and `s932`. Amaterasu City is the *late* twin of Asuka City (every Asuka map has an Amaterasu twin: `s245` Smith's Shop / `s246` Wedge's Shop, `s250` / `s251` Junk Shop), reached at story ordinal 0x25, after the North Sector. **Chips cannot be bought during the main story**, only after it.
- **Enemy drops**: some enemies drop chips (92 drop sources in the item index; drop rates are 0, 2, 16, 32, 64, 128, 192 or 256, probably out of 256).
- **Story gifts**: a few NPCs give chips (e.g. a hand-out at `s880`).

### 2.3 The gym is locked behind story items (important)

Element drills do **not** exist in the default gym menu (rank menu 0 has only the five core drills). They appear only with:
- **SilverID** (story, `s420`, the Seiryu leader, chapter 5): the five basic elements (Fire to Thunder); some gyms add Dark or Machine.
- **GoldID** (`s401` / `s973`): more drills at some gyms.
- **PlatinumID** (`s326` / `s970`): the full set, including the stronger drill variants.

**Silver comes early**: the Seiryu leader is story ordinal 5, straight after the Central Sector, and the East Sector's enemies are Lv 2-9, so Silver arrives at about **Lv 8-12**.
Before that (Lv 1-10) a player gets element points only from level-ups and drops. After it the gym is the main source for the whole main story, because chips are post-game (2.2).
Gold (`s401` / `s973`) and Platinum (`s326` / `s970`) are NPC or cutscene rewards; their timing is *(open)*, so the stronger drill variants are treated as a worst case.

### 2.3b The story timeline, measured (from `ddw3-walker`: `stage_encounters.json` joined to `field_encounters.json` and `battle_rewards`)

Enemy level and pay per battle for the maps the story walks through (the early-story versions; each map also has a late twin about 10-25 levels higher). Pay is about **10 bits per enemy level**.

| Part of the story | Maps | Enemy level | Bits / battle |
|---|---|---|---|
| Opening, Central Sector | Central Park, Shell Beach, Plug Cape | 1-7 | 10-70 |
| East Sector (Seiryu leader, chapter 5) | Wire Forest, Protocol, Kicking Forest, Tyranno Valley, Divermon's Lake | 2-9 | 25-90 |
| South Sector | Bulk Swamp, Bios Swamp, Phoenix Bay | 8-12 | 80-120 |
| South Sector, later | Ether Jungle, South Cape, Jungle Grave, Suzaku UG Lake | 14-20 | 185-490 |
| Suzaku (chapter 6) | Jungle Shrine, Catacomb | 31 | 330-660 |
| West Sector (Byakko, chapter 7) | Badlands, Noise Desert, Dum Dum Factory, Duct Rooms | 20-25 | 200-250 |
| North Sector (Genbu) | Boot Mountain to Dark Dungeon | 41-49 | 400-650 |
| Undersea, Seabed, Circuit Board | Magasta, Seabed, Circuit Board | 27-47 | 240-460 |
| Post-game | Spy Satellite, late twins | 43-56 | 450-530 |

So a player is about **Lv 8-12 at Silver, about Lv 20 around Suzaku, about Lv 20-25 through the West Sector and about Lv 40-48 by the North Sector**.

### 2.4 Pace and money (estimates, from `battle_rewards` joined with `field_encounters`)

EXP to a level is `growth_xp × (n³ + 5n − 6) / 10 + a tier constant`, and **`growth_xp` belongs to the starter** (the form you digivolve into does not
change it). Pace (battles to reach each level, estimate):

| Line | growth_xp | Lv 20 | Lv 28 | Lv 40 | Lv 50 | TP per 100 battles near Lv 30 |
|---|---|---|---|---|---|---|
| Monmon | 6 | 61 | 124 | 267 | 408 | 51 |
| Guilmon, Renamon | 7 | 70 | 144 | 308 | 473 | 44 |
| Kotemon, Veemon | 8 | 78 | 163 | 349 | 537 | 38 |
| Agumon, Patamon | 9 | 87 | 182 | 391 | 602 | 34 |
| Kumamon | 10 | 96 | 202 | 432 | 667 | 31 |

Money (reference pace `growth_xp` 8): median battle pays about 155 bits at Lv 10, 240 at Lv 14, 320 at Lv 28, 480 at Lv 40, 960 at Lv 50 *(estimate)*.
Cumulative income is about 5k bits by Lv 14, 15k by Lv 20, 37k by Lv 28, 118k by Lv 40, 217k by Lv 50. If **all** of that went into the cheapest chip
(about 330 gold per point), it would buy only about 15 / 46 / 113 / 362 / 663 points. Chips are therefore a real but limited source, and every
gold spent on them is not spent on gear.

### 2.5 Form levels are a time gate, but a cheap one

A form's level rises only when that form is seated in a battle: DVEXP per battle is capped at **10** (solo; shared parties get less), and form level
`n` needs `10 × (n − 1)` DVEXP. So level 40 on a parent form is about **40 solo battles**, and each step in a chain needs its own parent. Nothing buys it: the DVPlug
item only fills the blast gauge. This is why lineage (prerequisite) gates add *depth* to a route, but one step is a modest delay on its own; the chain is what
matters (depth 3-4 is 120-200 battles, three times that with a party of three).

### 2.6 Strength of the forms (so the gates are paying for the right thing)

Stat totals (STR+DEF+SPT+WIS+SPD) of the form rows: disc forms median 150, top 260 (Beelzemon). Our tiers: 1 = about 100, 2 = about 150, 3 = about 200, 4 = about 225, 5 = about 250.
So the extra forms are no stronger than the disc's own late forms: a tier 5 is a Beelzemon/Diaboromon-class form. The risk is *when* they arrive, not how strong they are.

Item modifiers worth knowing: EXP Adapter (+20% EXP) and BIT Adapter (+20% bits) are drop-only; TrainingBook / PowerBrace add 3 / 6 points to a gym rep's success chance
(they do not stack); gear can change battle strength but not gates.

### 2.6b Gear raises fighting strength, just not the unlock gates

Gear does add STR, DEF, SPT, WIS and SPD (`gearStatContributions` in `engine/dw3/equipment.ts`): a weapon leads with STR, armor and shields with DEF, an accessory with its coded stat.
It is applied when a battle is calculated, so it counts for strength but not for a gate (2.1). Best-in-slot gear that any shop sells (my reading of the stat bytes; special items outside families 2-24 may be undercounted):

| Slot | Best item | Adds | Price |
|---|---|---|---|
| Weapon | PositronCannon | STR +260 | 28,000 |
| Body | CrimsonMail | DEF +48 | 25,000 |
| Shield | Apocalypse | DEF +40 | 11,000 |
| Head | MugenHelmet | DEF +39 | 11,000 |
| Accessory | PowerRing | STR +20 | 3,000 |

That is about **+407 across the stats** for a full set (the **late** Amaterasu-side shops; the **early story shops** top out at about **+276**: LightningBow +184 STR for 8,500, KulonArmor +30, KulonShield +25, KungFuCap +27), and the weapon alone is about +260 STR, roughly as much as a whole Lv 28 Digimon's own STR from levelling (about 230-330 depending on the line).
Limits: each item has a `wear_mask` over the eight lines (PositronCannon fits one line, Monmon), so a given starter can wear only some of it, and the top stock (25-30k gold) is in the hub shops `s246`/`s931`,
which are the **post-story Amaterasu twins**, so the +407 set is a post-game purchase. Within the story the best buys are the early shops: the Asuka Junk Shop (`s250`) sells a RavenBow (+146 STR) for 4,500, about what a player has earned by Lv 14, so a +146 weapon can arrive very early on lines that can wear it.
This is the biggest "too strong too early" lever outside the unlock system, so the plan checks **total fighting strength** (form stats + level + gear) against enemy stats at the intended level, not only the gates (section 4).

### 2.7 Each starter already leans somewhere

Passive element growth differs per starter, but only slightly: by Lv 40 a starter's best element has about 58 points and its worst 20. It is a tie-breaker, not a route. Starter
stat growth differs more (e.g. Kumamon grows the most total stats, Patamon the least).

## 3. The design

### 3.1 Three routes per form

Every form gets up to three records on each starter's tree, any one of which unlocks it:
1. **Stat route** (what exists today): a stat gate scaled by tier, easier on a starter that suits the family.
2. **Element route** (new): the form's *signature element* (read from its strongest resistance, tie-broken by its family) must reach a gate.
3. **Lineage route** (new for tiers 3+): a prerequisite chain of forms at form level, the same shape as the disc's.

Reason: the player's *build* decides the route, so two players reach the same form differently. The routes are not additive, so more routes cannot make a form easier than its easiest route.

### 3.2 Aspects (the "pack" idea)

An **Aspect** is a starting nudge to one element plus a small bias in how that starter's routes are ordered. Rules:
- The nudge is a **seed** written once into the stored element bonus: **at most about 40 points** (that is about two or three levels of gym on the best drill; it opens tier 1-2 forms early, never tier 4-5).
- **Aspect is chosen once per partner** (open question: at the start, or later in the Digimon Lab), so it is a commitment and cannot be flipped to dodge a gate.
- The default aspect reproduces today's behaviour exactly, so nothing changes until a player opts in.
- Aspects are **generated from the data**, not hand-listed: each form already has a signature element and family, so a "Dark" aspect simply means the forms whose signature is Dark.

### 3.3 Gate heights are phase-aware

The earliest legal route to a form depends on what the player can reach, so the gates follow the story rather than a flat level:

| Phase | What is available | Forms that may sit here |
|---|---|---|
| Lv 1-10 (before Silver, `s420`) | level-ups and drops only | tier 1 only, and only on a low gate |
| Silver (about Lv 8-12) | gym element drills (Fire to Thunder; some gyms Dark or Machine) | tier 1-3 |
| Gold / Platinum (the late-state maps `s401`, `s326`, `s970`/`s973`: after the main story) | more drills and the stronger variants | post-story only; the main story never has them |
| After the story (Amaterasu shops) | element chips, +407 gear | everything; this is where chips and gear matter |

Starting values (from the planner, `aspect-planner.html`; still to be tuned). **The element route is a shortcut for a specialist; everyone can still use the stat route**, so the element gate is set against a
**focused build** (every training point on the one element, the normal drills, Silver at Lv 10). Setting it against an ordinary 40% split instead lets a focused player arrive 6-27 levels early, which is the exploit.
With the gate set against a focused build, a focused player arrives on time and an ordinary split build arrives later (or uses the stat route):

| Tier | Intended level | Element gate | Focused build arrives | Ordinary 40% build holds at the intended level |
|---|---|---|---|---|
| 1 | 16 | about 110 | Lv 17 | about 50 |
| 2 | 22 | about 150 | Lv 22 | about 70 |
| 3 | 30 | about 200 | Lv 31 | about 100 |
| 4 | 42 | about 290, plus a lineage prerequisite | Lv 42 | about 150 |
| 5 | 52 | about 350, plus a deep lineage chain | Lv 52 | about 170 |

(Planner defaults: Silver at Lv 10, 5 training points per level, normal-drill rate about 1-1.6 points per point, the line's own passive growth added. Gates stay below 999.)

The reasoning: the gate is **what a player who commits fully holds at the intended level**. A specialist is rewarded by getting the forms on schedule; a player who spreads their training takes the stat route
or arrives later. Nobody arrives early on the normal drills. The Platinum drill variants (the planner shows them arriving 6-37 levels early) come from the late-state maps, so they are a **post-story** matter, as are chips and the +407 gear.

**Power check (planner).** Player stored stats (level-ups) + the tier's median form bonus + the gear **that line can wear and afford** (the main-story shops opened by that level, `wear_mask` per line, 60% of all bits spent on gear),
against the median enemy stat total in the maps of that level (from `stage_encounters`). At the intended levels the ratio is 97-104% for tier 1, 84-96% for tiers 2-3 and 73-84% for tiers 4-5: **no cell is above the 125% limit**
and the later tiers sit below the enemies. (An earlier, flat +276 gear assumption made tier 1 look 125-131% strong; the per-line gear model removed that: most early weapons fit only one or two lines.)
The stricter test is the **power at the earliest arrival**, the first level at which any build learns a form of the tier (table in the planner): see section 7 for the numbers.

### 3.4 Ordering and pace

- **Order the table by tier**, weaker first, because only one form is learned per battle and the first match wins. A player is then never handed a tier 4 while a tier 1 is waiting.
- **Pace**: tying gates to a level lets Monmon get there in about 60% of Kumamon's battles. I recommend setting each line's *intended level by battles*, not by level (the planner has this switch),
  or equivalently giving slow lines a slightly lower gate. This is a decision for you (see section 5).
- **Level-gated TP**: because TP come from levels, a fast leveler banks TP faster. Pace adjustment above already compensates.

## 4. What could go wrong, and the answer to each

| Risk | Why it is real | Answer |
|---|---|---|
| Chips buy the gate | Chips are money-only; a rich player could convert gold to points | Early gates cost about a third of the income at the intended level; tier 4-5 add a lineage chain money cannot buy; the planner flags any route cheaper than a set number of battles' income |
| The gym makes it trivial | Best drills give 3-5 points per TP | The drills are locked behind Silver/Gold/Platinum (story); TP are limited (5 per level) and shared with the core stats; the best-case model assumes the best drills and is therefore a worst case |
| The 999 cap | Past about Lv 48 an all-in gym build would pass any gate under 999 | Keep gates for tier 4-5 below about 400 and rely on the lineage chain, as in 3.3 |
| Packs stack with everything | Seed + chips + gym can overlap | Seed is capped at about 40 and chosen once |
| Slow vs fast lines | TP come from levels, so the pace differs by 65% | Intended level by battles, section 3.4 |
| Gear opening gates | It could look like a loophole | It cannot: gear never writes a gate (2.1) |
| Gear making a new form too strong too early | A +260 STR weapon is the size of a whole level range of growth; a strong new form plus top gear could outclass the enemies | Add a **power check** to the planner: form stats + level stats + best wearable gear for the line, against enemy stats at the intended level, and flag forms that arrive with a large margin. If a tier is too strong, move its intended level later rather than weaken the form. EXP/BIT Adapters (+20%) are drop-only and small |
| Form-level shortcut | If form levels were cheap, lineage gates would be empty | They cost about 1 solo battle per level; a chain of 3-4 costs 120-200 battles. It is a modest brake, so it is combined with the other gates rather than relied on alone |

## 5. Decisions needed from you

1. **When is the Aspect picked?** Once at the start (strongest commitment), later in the Digimon Lab (easiest to try), or per partner when they are received.
2. **Pace**: should intended level follow *battles* (slow lines get lower gates) or *level* (same on every line)? I lean towards battles.
3. **Scope**: the Aspect affects only the 135 extra forms and leaves the disc's 44 alone. Is that right?
4. **How many Aspects?** I suggest Balanced (today's behaviour), Fire, Water, Ice, Wind, Thunder, Machine, Dark: seven plus the default, one per element, because the elements are the data the gates already use.
5. **UI**: the Digimon Lab is a native screen; a selector there is real work. The cheaper alternative is to make the Aspect a **key item** the player picks up (one per element), using the item system that already exists.

## 6. What has been built (2026-10-19), all behind a switch

| Piece | Where | State |
|---|---|---|
| Element routes + tier-first ordering | `tools/build_extra_species.py` (`ASPECT_ROUTES=1`; `EXTRA_SPECIES_OUT` for a scratch build) | built, **off by default**; the default build is unchanged (tested) |
| Chosen-once, capped (40) starting element bonus | `applyAspect` in `web/extra-roster.js` (`__extraRoster.setAspect(el)` in the console) | built and tested; **no selector screen yet** (decision 1 and 5) |
| Partner switch | `NEW_PARTNERS_ENABLED = false` | built |
| Pages | `web/extra-forms.html`, `web/aspect-planner.html` | built |
| Playtest sandbox | `web/playtest.html` (+ `web/playtest-maps.json`); `?aspect=1` on the game URL loads `extra_species_aspect.json` | built: any party, levels, stats, element points, forms, per-form techniques, gear, items, map; 12 scenarios; backs up and restores your save |
| Tests | `tests/aspect-routes.test.js` (5), `tests/aspect-seed.test.js` (4) | pass; the rest of the suite is unchanged (the same 63 tests fail with and without these changes: they are pre-existing) |
| Real-game check | `tools/verify_aspect_route.mjs` | passes: see section 7 |
| Modelled playthrough | `tools/simulate_aspect_unlocks.mjs` | see section 7 |

To turn the routes on for a build: `ASPECT_ROUTES=1` when `tools/build_extra_species.py` runs (the `extra_species` stage of `build_all.py`), or flip the default in the script. Nothing ships until that is done.

## 7. Verification, and what the numbers say

**In the real game (`tools/verify_aspect_route.mjs`).** A Kotemon with weak stats (so no stat gate can pass) and one form left to learn wins a fight. Gate 110 on Tyrannomon (fire): 0 trained points does not learn it,
109 does not, **110 does**, and 110 minus the line's own base tolerance (85) does not. So the element route works end to end in the browser, the gate is exact, and **the live game counts the trained points only** (2.1b), which is
why the gates carry no base tolerance.

**Modelled playthrough (`tools/simulate_aspect_unlocks.mjs`).** The game's own unlock rule (`firstUnlockedTreeRecord`) run over 80 simulated players (8 lines x 10 builds: no training, balanced stats, STR specialist, one specialist per element),
with the level-up growth, EXP and training-point rules from the data. Current tree against the aspect tree:

| Tier | Earliest any build learns it, current | ...aspect | Median arrival, current | ...aspect | Intended level |
|---|---|---|---|---|---|
| 1 | Lv 4 | Lv 4 | Lv 6 | Lv 6 | roots: line level 4-14 (existing) |
| 2 | Lv 7 | Lv 7 | Lv 24 | Lv 21 | 22 |
| 3 | Lv 15 | Lv 15 | Lv 42 | Lv 36 | 30 |
| 4 | Lv 32 | Lv 32 | Lv 68 | Lv 68 | 42 |
| 5 | Lv 35 | Lv 35 | Lv 74 | Lv 74 | 52 |

- **The aspect routes add no new early exploit**: the earliest arrival of every tier is identical to today's. It comes from the existing STR stat route (a STR specialist learns Nanimon at Lv 15, BKWarGrowlmon at Lv 32, Puppetmon at Lv 35).
- They pull the **median** arrival of tiers 2-3 earlier (3 and 6 levels); tiers 4-5 are held by the disc's own forms (a tier 4-5 form needs a parent such as Devimon, Myotismon or Imperialdramon, which the disc itself opens only through element training).
- **Orientation is real but modest**: an element specialist learns 1-13 forms through the element route (machine 13, dark 9, thunder 6, water 5, fire 2, ice 2, wind 1) and about 1-8 more forms by Lv 50 than a player with no training.
- **No form is dead**: every form is reached by some build except Galacticmon (needs Piedmon and Diaboromon, the disc's top form), which is the same in both trees.

**Power at the earliest arrival (planner).** Stored stats + the tier's form bonus + the gear that line can wear and afford, against the median enemy in the maps of that level:
tier 1 at Lv 4 is 118-122%, tier 2 at Lv 7 is 116-121%, tier 3 at Lv 15 is 112-120%, tier 4 at Lv 32 is 83-93%, tier 5 at Lv 35 is 82-92%. **No cell is above the 125% limit**; the early tiers arrive about 20% ahead of the median enemy
for a build that specialises hard, the late tiers arrive behind it.

### Against the original game's own allowance (the yardstick)

The disc's own 44 forms, grouped by the same stat-total classes as the extra tiers, put through the same simulation (earliest level any line and build learns one of the class):

| Power class | Disc forms: earliest / median | Extra forms: earliest / median | Reading |
|---|---|---|---|
| 1 (about 100) | Lv 5 / 5 | Lv 4 / 6 | same |
| 2 (about 150) | Lv 9 / 20 | Lv 7 / 24 | same |
| 3 (about 200) | Lv 39 / 42 | Lv 15 / 42 | same median; the earliest outlier is 24 levels sooner |
| 4 (about 225) | Lv 46 / 69 | Lv 32 / 68 | same median; earliest 14 levels sooner |
| 5 (about 250) | Lv 88 / 88 (one of three learned) | Lv 35 / 74 | the disc barely allows it; the extras are reachable, a specialist at Lv 35 |

So the extras follow the original's allowance for the weakest two classes and for the typical player in every class. The outliers are a hard STR grinder getting a tier 3-5 form 14-24 levels before the disc's equivalent would come; that comes from the
existing stat gates (a form's gate is 55% of the enemy's own top stat, so weak-stat enemies have low gates). It is a reward for grinding, in the spirit of the original. If you ever want it closer, raise the lowest stat gates of tiers 3-5
(`gateValue` in `build_extra_species.py`); that is a one-line floor, and it would also make the element routes the natural way in for non-specialists.

### Does steamrolling early pay off, or cost later? (from the data, not a play-test)

- **Nothing scales against the player.** Enemy stats are fixed per map (`stat_scale` 16 is a multiplier of 1) and EXP and bits per fight are fixed per battle id, so being strong does not make later fights harder or pay less. Easy early maps just pay little (about 10 bits and 5 EXP per enemy level), so grinding there is slow, but allowed.
- **A hard specialist's lead is large early and then settles.** Against the median enemy (stat sum): a player with no training sits at 98% to Lv 15, then falls to 82% at Lv 20, 76% at Lv 30 and 70% at Lv 40; a specialist (all training points into stats plus the earliest extra form) is at 132% at Lv 5, 115-124% at Lv 10-15, then 96%, 91%, 84%, 86% at Lv 20-50.
  The specialist's lead over an untrained player is +33% of an enemy's power at Lv 5, +17-24% at Lv 10-15, and a steady **about +15%** from Lv 20 onward.
- **So the payoff is early speed, not a lasting edge.** The form bonus is fixed (+100 to +250) while enemies keep growing (about 2,570 at Lv 50), so it dilutes; the lasting part (+15%) is simply what the gym training buys, which any player can also do.
- **The game expects growth in every channel.** An untrained player falls to 70-76% of enemy power by Lv 30-40; staying level needs gym training, gear (+276 in the main-story shops) and forms together. Nothing found punishes an early spike later; the later areas are just as hard for everyone.
- Form levels do slow with level (DVEXP per battle is `base x 10 / min(level, 50)`), which gently rewards using forms early.

### The verdict, and its limits

What I can state as verified: the element route works in the live game and is exact; it creates no earlier arrival than the system already allows; every form stays reachable; nothing in the existing test suite changed
(the same 63 tests fail with and without the work); the early-arrival power is within the limit I set (125% of the median enemy).

What I cannot state as verified, and will not claim: that the system is *fun* or that its numbers are the *right* ones. The simulation is a model of one kind of player (it assumes a training-point rate, a seating rule for form levels
and median EXP and bits per battle); the enemy comparison is a stat sum that ignores HP, techniques and the real damage formula; the 125% limit and the intended levels are my choices. Two things deserve a human play-test: a STR-heavy
Guilmon or Monmon learning tier 3-5 forms at Lv 15-35, and an element specialist's pace through the West Sector (Lv 20-25).

### Not verified

- The player's actual level at each point of the story (inferred from enemy levels; boss levels are not in the walkable-pool table).
- The gym "variant" drills (ultra/super) and their exact rank requirements; the planner treats them as an upper bound.
- Bits per battle: the third reward column is read as bits; party-size splits and the EXP/BIT adapters are ignored.
- Whether drop rates of 128-256 are out of 256.
- (Closed) The two readers of the unlock rule count element values differently in the source (2.1b), but the **live game** was measured on the original's own gate too: `TARGET=disc tools/verify_aspect_route.mjs` on SkullGreymon (Dark 140, Kotemon's base 95)
  gives 139 trained points: no, 140: yes, 45 (140 minus the base): no. So the live game counts trained points only for the original forms as well as the extra ones; the native screen's base-plus-trained reading is not what decides a grant.
