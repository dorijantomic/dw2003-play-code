# web/fight/digimon-anatomy
Static per-model data: anatomy/body plan, arm-end class, emitter sites, and per-technique shot plans.
The lookups live in web/fight/digimon-anatomy.ts (anatomy, bodyPlan, sizeClass, firingSide, emitters, shotsFor, armEquip) which imports these tables.

| file | lines | job | main exports |
|---|---|---|---|
| anatomy-data.ts | 300 | generated model table: name, body family, size, arms, head, per-technique firing limb | ANATOMY, FOLDERS, TECH_MODE_PRIOR, BODY_FAMILY, MODES |
| arm-data.ts | 261 | per-model arm-end class read off the rest-pose mesh at the wrist | ARM_EQUIP, ARM_ATTACH, ARM_EQUIP_CLASSES |
| emitter-data.ts | 507 | per-model emitter sites and per-technique shot plans (counts, modes) | EMITTERS, SHOTS, EMITTER_PARTS, EMITTER_KINDS, SHOT_MODES |

Where to look for:
- which limb/emitter a technique fires from -> anatomy-data.ts (tech, TECH_MODE_PRIOR) then emitter-data.ts (SHOTS)
- what a model holds in its hand (weapon vs bare) -> arm-data.ts (ARM_EQUIP)
- how many shots a technique launches, and from where -> emitter-data.ts (SHOTS, EMITTERS)
- model name / body plan / size ranking -> anatomy-data.ts (ANATOMY, BODY_FAMILY, SIZE_ORDER)
- lookup helpers rather than raw tables -> ../digimon-anatomy.ts
