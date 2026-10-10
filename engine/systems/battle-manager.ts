// engine/systems/battle-manager.ts
// Generic turn loop: order actors by speed, run each actor's start-of-turn tick, dispatch
// its action through the injected resolver, and report battle outcome. DW3-free — all
// formula/element knowledge lives in the resolvers passed in (engine/dw3/battle-combat.ts).

export interface TurnActor {
  hp: number;
  spd: number;
  [k: string]: unknown;
}

export interface TurnStartResult { skipped: boolean; prefix: string; }
export interface AttackResult { hit: boolean; dmg: number; heal: number; }

export interface BattleDeps<A extends TurnActor, S> {
  resolveAttack: (attacker: A, defender: A, skill: S | null, rng?: () => number) => AttackResult;
  processTurnStart: (c: A, name: string) => TurnStartResult;
  rng?: () => number;
}

export interface TurnAction<A extends TurnActor, S> {
  actor: A;
  target: A;
  skill: S | null;
  name?: string;
}

export interface TurnEvent {
  type: string;
  [k: string]: unknown;
}

export interface BattleManager<A extends TurnActor, S> {
  runTurn(actions: TurnAction<A, S>[]): { events: TurnEvent[] };
  outcome(party: A[], enemies: A[]): "won" | "lost" | "ongoing";
}

export function createBattleManager<A extends TurnActor, S>(
  deps: BattleDeps<A, S>,
): BattleManager<A, S> {
  const rng = deps.rng;

  function runTurn(actions: TurnAction<A, S>[]): { events: TurnEvent[] } {
    const events: TurnEvent[] = [];
    // Faithful order: fastest acts first (SPD descending). Stable for equal speeds.
    const ordered = actions
      .map((a, i) => ({ a, i }))
      .sort((x, y) => (y.a.actor.spd - x.a.actor.spd) || (x.i - y.i))
      .map(o => o.a);

    for (const act of ordered) {
      if (act.actor.hp <= 0) continue;
      const start = deps.processTurnStart(act.actor, act.name ?? "Actor");
      if (start.prefix) events.push({ type: "turnStart", text: start.prefix });
      if (start.skipped) continue;
      if (act.target.hp <= 0) continue;
      const res = rng
        ? deps.resolveAttack(act.actor, act.target, act.skill, rng)
        : deps.resolveAttack(act.actor, act.target, act.skill);
      if (!res.hit) { events.push({ type: "miss", actor: act.name }); continue; }
      act.target.hp = Math.max(0, act.target.hp - res.dmg);
      events.push({ type: "hit", actor: act.name, dmg: res.dmg, heal: res.heal });
    }
    return { events };
  }

  function outcome(party: A[], enemies: A[]): "won" | "lost" | "ongoing" {
    if (enemies.every(e => e.hp <= 0)) return "won";
    if (party.every(p => p.hp <= 0)) return "lost";
    return "ongoing";
  }

  return { runTurn, outcome };
}
