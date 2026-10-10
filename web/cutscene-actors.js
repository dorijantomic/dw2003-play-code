// The record a cutscene-spawned (ephemeral) actor is pushed into the scene with.
//
// `actorId` is the field-entity constructor's `kind` for a spawned NPC (spawn
// record +0x8), so it is carried as `npc_id`: per-actor systems gate on it, and
// the drop shadow's six-id denylist can only fire if it is present.
// `x`/`y` park the actor off-map until the script positions it.
export function ephemeralActorRecord(actorId, spriteId) {
  return {
    id: "eph_" + actorId,
    npc_id: actorId,
    sprite: spriteId,
    x: -100,
    y: -100,
    dir: "down",
    _ephemeral: true,
  };
}
