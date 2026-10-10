import type { Condition, EvalContext, LeafEvaluator } from "../types.ts";
export class ConditionEngine {
  private leaves = new Map<string, LeafEvaluator>();
  registerLeaf(kind: string, ev: LeafEvaluator): void { this.leaves.set(kind, ev); }
  eval(c: Condition, ctx: EvalContext): boolean {
    switch (c.kind) {
      case "all": return c.children.every(x => this.eval(x, ctx));
      case "any": return c.children.some(x => this.eval(x, ctx));
      case "not": return !this.eval(c.child, ctx);
      case "none": return !c.children.some(x => this.eval(x, ctx));
      case "leaf": {
        const f = this.leaves.get(c.leaf);
        if (!f) throw new Error(`unknown condition leaf: ${c.leaf}`);
        return f(c.args, ctx);
      }
    }
  }
}
