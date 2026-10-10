import type { BankScheme, EvalContext, VarValue } from "../types.ts";
import { FlagManager } from "./flag-manager.ts";
import { VariableManager } from "./variable-manager.ts";
import { Inventory } from "./inventory.ts";
import { Party } from "./party.ts";

export interface SaveBlob { version: number; flags: Record<number, string>; vars: Record<string, VarValue>; inventory: [number, number][]; party: { members: number[]; lead?: number }; }

export class GameState {
  readonly flags: FlagManager; readonly vars = new VariableManager();
  readonly inventory = new Inventory(); readonly party = new Party();
  constructor(scheme: BankScheme) { this.flags = new FlagManager(scheme, () => this.evalContext()); }
  evalContext(): EvalContext { return { flags: this.flags, vars: this.vars, party: this.party, inventory: this.inventory }; }
  toSave(): SaveBlob { return { version: 1, flags: this.flags.toJSON(), vars: this.vars.toJSON(), inventory: this.inventory.toJSON(), party: this.party.toJSON() }; }
  fromSave(b: SaveBlob): void { this.flags.load(b.flags); this.vars.load(b.vars); this.inventory.load(b.inventory); this.party.load(b.party); }
}
