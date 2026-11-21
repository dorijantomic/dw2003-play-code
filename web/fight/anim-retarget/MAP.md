# web/fight/anim-retarget
Retargets a donor clip's motion onto another model's skeleton: bone roles, K16 in-rest-frame baking, a K23 world-space bake.
web/fight/anim-retarget.ts re-exports bakeRetarget and friends; call bakeRetarget for the automatic choice.

| file | lines | job | main exports |
|---|---|---|---|
| by-role.ts | 320 | K16 bake: conjugate per frame in the target's rest frame, scale root, IK hands/feet | bakeRetargetByRole |
| cast-gate.ts | 325 | picks the bake to use (candidates, best first), applies cast gates, hand points | bakeRetarget, castGate, applyCastBake, handPoint, CAST_GATE |
| k16-rig.ts | 430 | rig maths: K16 vectors/matrices, rest pose, chains, role->bone map, mirror test | rigOf, roleBoneMap, k16Rest, k16ChainLen, k16mul |
| rig-basics.ts | 354 | channel sampling, rest pose, bone map from mesh, plain key-copy bake | sample, restPose, rolesOf, buildBoneMap, bakeRetargetGeometry |
| world.ts | 336 | K23 bake: parts paired by where they sit on the body, rotated in world space | bakeRetargetWorld, k23Cloud, k23NeutralFrame |
| types.ts | 72 | types only: the interfaces this folder's own code builds and fills in | — |

Where to look for:
- retarget a new clip onto a new model -> cast-gate.ts (bakeRetarget, candidate order)
- which bone plays which role, or a model whose roles are wrong -> k16-rig.ts (roleBoneMap, rigOf)
- a bake without IK / a plain key copy -> rig-basics.ts (bakeRetargetGeometry)
- a model that comes out mangled by the world-space route -> world.ts (bakeRetargetWorld, k23Cloud)
- clip sampling / root motion normalising -> rig-basics.ts (sample, normaliseRoots)
