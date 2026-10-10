import type { Instruction, TaggedArg } from "../types.ts";

export type CommandResult = { yield: boolean };
export type HostCommand = (args: TaggedArg[], vm: ScriptVM) => CommandResult;
export interface RunHandle { done: boolean; }

interface Frame extends RunHandle { prog: Instruction[]; pc: number; done: boolean; blocked: boolean; errors: string[]; }

export class ScriptVM {
  private cmds = new Map<string, HostCommand>();

  registerCommand(name: string, fn: HostCommand): void {
    this.cmds.set(name, fn);
  }

  start(program: Instruction[]): RunHandle {
    const f: Frame = { prog: program, pc: 0, done: false, blocked: false, errors: [] };
    return f;
  }

  resume(h: RunHandle): void {
    (h as Frame).blocked = false;
  }

  tick(h: RunHandle): void {
    const f = h as Frame;
    if (f.done || f.blocked) return;
    while (f.pc < f.prog.length) {
      const ins = f.prog[f.pc]!;
      const cmd = this.cmds.get(ins.op);
      if (!cmd) { f.errors.push(`unknown op ${ins.op}`); f.done = true; return; }
      f.pc++;
      const r = cmd(ins.args, this);
      if (r.yield) { f.blocked = true; return; }
    }
    f.done = true;
  }
}
