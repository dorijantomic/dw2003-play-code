import type { VarValue, VariableReader } from "../types.ts";

export class VariableManager implements VariableReader {
  private vars = new Map<string, VarValue>();
  private cbs: ((n: string, o: VarValue | undefined, v: VarValue) => void)[] = [];
  get(name: string): VarValue | undefined { return this.vars.get(name); }
  set(name: string, v: VarValue): void {
    const old = this.vars.get(name); this.vars.set(name, v);
    for (const cb of this.cbs) cb(name, old, v);
  }
  onChange(cb: (n: string, o: VarValue | undefined, v: VarValue) => void): void { this.cbs.push(cb); }
  static nextOrdinal(current: number, stageOrdinals: number[], allOrdinals: number[]): number | null {
    const candidates = stageOrdinals.filter(o => o > current).sort((a, b) => a - b);
    const target = candidates[0];
    if (target === undefined) return null;
    // commit only if no other ladder ordinal lies strictly between current and target
    const between = allOrdinals.some(o => o > current && o < target);
    return between ? null : target;
  }
  toJSON(): Record<string, VarValue> { return Object.fromEntries(this.vars); }
  load(obj: Record<string, VarValue>): void { this.vars = new Map(Object.entries(obj)); }
}
