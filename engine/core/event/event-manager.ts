import type { EvalContext, EventRow, Instruction } from "../types.ts";
import type { ConditionEngine } from "../condition/condition-engine.ts";
import type { RunHandle, ScriptVM } from "../script/vm.ts";

export interface RaiseEvent { type: string; params?: Record<string, number | string>; }
/** `skipArrivalChain` drops the rows the stage's ENTRY gate object owns
 *  (`EventRow.arrivalChain` with no `arrivalBand`, i.e. the reset band). The original
 *  asks that chain once per field load, so a raise that stands in for "later in the
 *  same visit" must not re-run it. A place's SECOND gate object (band `phase1`) keeps
 *  its rows: the original re-tests it on every frame while its phase word reads 1, so
 *  the disc still starts its scene later in the same visit. */
export interface RaiseOptions { skipArrivalChain?: boolean; }
interface Deps {
  conditions: ConditionEngine; ctx: () => EvalContext;
  programOf: (scriptId: string) => Instruction[];
  onceFlag: { get: (id: string) => boolean; set: (id: string) => void };
  vm: ScriptVM;
}
export class EventManager {
  private rows: EventRow[] = [];
  private d: Deps;
  constructor(d: Deps) {
    this.d = d;
  }
  addTable(rows: EventRow[]): void { this.rows.push(...rows); }
  clearTable(): void { this.rows = []; }
  raise(ev: RaiseEvent, opts: RaiseOptions = {}): RunHandle | null {
    const cands = this.rows
      .filter(r => r.on === ev.type)
      .filter(r => !(opts.skipArrivalChain && r.arrivalChain && !r.arrivalBand))
      .filter(r => !r.match || Object.entries(r.match).every(([k, v]) => ev.params?.[k] === v))
      .filter(r => !(r.once && this.d.onceFlag.get(r.id)))
      .filter(r => !r.if || this.d.conditions.eval(r.if, this.d.ctx()))
      .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
    const row = cands[0];
    if (!row) return null;
    if (row.once) this.d.onceFlag.set(row.id);
    return this.d.vm.start(this.d.programOf(row.do));
  }
}
