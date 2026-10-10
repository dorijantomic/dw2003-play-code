export type FlagId = number;
export type VarValue = number | string | boolean;

export interface BankScheme {
  decompose(id: FlagId): { bank: number; bit: number };
  storedBanks: ReadonlyMap<number, number>; // bank -> bit-capacity
}

export type VirtualBankHandler = (bit: number, expected: number, ctx: EvalContext) => boolean;

export interface EvalContext {
  flags: FlagReader;
  vars: VariableReader;
  party: PartyReader;
  inventory: InventoryReader;
}

export interface FlagReader { get(id: FlagId, expected?: number): boolean; }
export interface VariableReader { get(name: string): VarValue | undefined; }
export interface PartyReader { contains(id: number): boolean; size(): number; }
export interface InventoryReader { has(id: number, count?: number): boolean; }

// Conditions (AST)
export type Condition =
  | { kind: "all"; children: Condition[] }
  | { kind: "any"; children: Condition[] }
  | { kind: "not"; child: Condition }
  | { kind: "none"; children: Condition[] }
  | { kind: "leaf"; leaf: string; args: readonly (number | string | boolean)[] };

export type LeafEvaluator = (args: readonly (number | string | boolean)[], ctx: EvalContext) => boolean;

// Scripts
export type TaggedArg =
  | { t: "INT"; v: number } | { t: "STR"; v: string }
  | { t: "FLAGID"; v: number } | { t: "VARREF"; v: string }
  | { t: "LABEL"; v: string } | { t: "CONDREF"; v: Condition };
export interface Instruction { op: string; args: TaggedArg[]; }
export interface ScriptProgram { id: string; program: Instruction[]; }

// Events
export interface EventRow {
  id: string; on: string; if?: Condition; do: string; once?: boolean; priority?: number;
  // generic param-match: the row fires only if every key here equals the raised event's
  // params[key] (e.g. { npc: 57 } for an OnTalk row bound to a specific actor).
  match?: Record<string, number | string>;
  // This row IS the stage's entry-object arrival dispatcher (the ported chain in
  // engine/systems/scene-arrival.ts, emitted from web/assets/data/scene/arrival_candidates.json).
  // The original's entry object asks its chain ONCE per field load: the dispatcher advances its
  // own phase counter at the end of every pass (exe/fns.s:8955-8963, F0x800142ac) and its gate
  // returns while the phase reads 1..3, and nothing in any of the 76 arrival overlays can set
  // that phase back to 0 or to >= 4. So a raise that SKIPS these rows is the faithful "ask again
  // later in the same visit" — which is what a stage-entry re-raise after a scene completion or
  // a fight must do. See web/engine-bridge.js `rechain`.
  arrivalChain?: boolean;
  // Which phase band the owning gate object tests its chain on (engine/systems/
  // scene-arrival.ts). Absent = the stage's ENTRY object, the reset band, which is
  // asked once per field load. `phase1` names a place's SECOND gate object
  // (s795/s800, pro/wstag795.s:0x5b4-0x5d0): the original keeps re-testing it every
  // frame while its phase word reads 1, so a later raise in the same visit must
  // still offer its rows.
  arrivalBand?: string;
}

export interface EngineErrorInfo { code: string; message: string; detail?: unknown; }
