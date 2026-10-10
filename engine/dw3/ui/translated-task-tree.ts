// Composition of the existing task-state translations. Addresses here identify
// data records and explicitly registered classes; they are never executed.
// Base state semantics: UI-TASKOBJ-STATEMACHINE-001.
// Traversal: resident F0x80018140/F0x80018230 (parent then live child slots).
import type { NativeMemory } from "../../native/memory.ts";
import {
  setState0, setState1, setState2, setState3,
  advance0, advance1, advance2, advance3,
} from "./task-object.ts";
import type { TaskState } from "./task-object.ts";

export interface TranslatedTaskClass {
  name: string;
  tick(object: number, children: number): void;
  methods?: ReadonlyMap<number, (object: number, args: number[]) => void>;
  /** Offsets of task children in the extra block; other words may be widgets. */
  childSlots?: readonly number[];
  /** Run the class's explicit state-3 close callback once before removal. */
  terminalTick?: boolean;
  /**
   * When a parent is destroyed, close this child the resident way first:
   * F0x80014308 hands each child slot to F0x800182C8, which sets state 3
   * (+0x28) and runs F0x80018140 on it, so the child's own tick sees state 3
   * once before it is destroyed. Opt-in per class.
   */
  closeTick?: boolean;
}

export interface TranslatedTask {
  address: number;
  classId: number;
  size: number;
  children: number;
}

export class TranslatedTaskTree {
  readonly tasks = new Map<number, TranslatedTask>();
  private readonly freeBlocks: Array<{ address: number; size: number; extra: number; children: number }> = [];
  readonly mem: NativeMemory;
  readonly classes: ReadonlyMap<number, TranslatedTaskClass>;
  readonly onDestroy: ((task: TranslatedTask) => void) | undefined;
  private next = 0x80100000;
  constructor(
    mem: NativeMemory,
    classes: ReadonlyMap<number, TranslatedTaskClass>,
    onDestroy?: (task: TranslatedTask) => void,
  ) { this.mem = mem; this.classes = classes; this.onDestroy = onDestroy; }

  allocate = (classId: number, size: number, extra: number): number => {
    if (!this.classes.has(classId >>> 0)) throw new Error(`Untranslated task class ${classId.toString(16)}`);
    if (size < 0x50 || extra < 0 || extra % 4) throw new Error("Invalid task allocation");
    const reused = this.freeBlocks.findIndex((block) => block.size === size && block.extra === extra);
    let address: number;
    let children: number;
    if (reused >= 0) {
      const block = this.freeBlocks.splice(reused, 1)[0]!;
      address = block.address;
      children = block.children;
      this.mem.bytes.fill(0, address & 0x1fffff,
        ((extra ? children + extra : address + size) & 0x1fffff));
    } else {
      address = this.next;
      children = extra ? (address + size + 7) & ~7 : 0;
      this.next = ((extra ? children + extra : address + size) + 7 & ~7) >>> 0;
      if (this.next > 0x801e0000) throw new Error("Translated task storage exhausted");
    }
    this.mem.write32(address + 0x20, extra / 4);
    this.mem.write32(address + 0x24, children);
    this.mem.write32(address + 0x48, classId);
    this.tasks.set(address, { address, classId: classId >>> 0, size, children: children >>> 0 });
    return address;
  };

  /** Call only a known receiver's translated method, never an instruction pointer. */
  callMethod = (object: number, slot: number, args: number[] = []): void => {
    object >>>= 0;
    const task = this.tasks.get(object);
    if (!task) throw new Error(`Unknown translated task ${object.toString(16)}`);
    const klass = this.classes.get(task.classId)!;
    const method = klass.methods?.get(slot);
    if (method) { method(object, args); return; }
    const state = this.state(object);
    switch (slot) {
      case 0x28: setState0(state, args[0]!); break;
      case 0x2c: setState1(state, args[0]!); break;
      case 0x30: setState2(state, args[0]!); break;
      case 0x34: setState3(state, args[0]!); break;
      case 0x38: advance0(state); break;
      case 0x3c: advance1(state); break;
      case 0x40: advance2(state); break;
      case 0x44: advance3(state); break;
      default: throw new Error(`${klass.name}: untranslated method ${slot.toString(16)}`);
    }
    [state.state0, state.state1, state.state2, state.state3]
      .forEach((value, i) => this.mem.write32(object + 0xc + i * 4, value));
  };

  state(object: number): TaskState {
    return {
      state0: this.mem.read32(object + 0xc), state1: this.mem.read32(object + 0x10),
      state2: this.mem.read32(object + 0x14), state3: this.mem.read32(object + 0x18),
    };
  }

  tick(root: number): void {
    const visited = new Set<number>();
    const visit = (address: number): boolean => {
      address >>>= 0;
      if (visited.has(address)) throw new Error("Translated task appears twice in one tree");
      visited.add(address);
      const task = this.tasks.get(address);
      if (!task) throw new Error(`Missing child task ${address.toString(16)}`);
      const state = this.mem.read32(address + 0xc);
      if (state === 3) {
        if (this.classes.get(task.classId)!.terminalTick) {
          this.classes.get(task.classId)!.tick(address, task.children);
        }
        this.destroy(address);
        return false;
      }
      if (state === 1) {
        const pause = this.mem.read32(address + 0x1c);
        if (pause !== 0) {
          if (pause > 0) this.mem.write32(address + 0x1c, pause - 1);
          return true;
        }
      }
      this.classes.get(task.classId)!.tick(address, task.children);
      this.children(task, (child, slot) => {
        // The store below is F0x80018230's own writeback, not a port convenience:
        // the walk steps each live child and puts the stepper's RETURN VALUE back
        // in the slot (exe/fns.s:8929-8931), and F0x80018140 returns 0 exactly
        // when it read state0 == 3 at the top of the turn and ran the teardown
        // (exe/fns.s:8883, 8900-8905). So the slot is emptied on the frame the
        // child dies and a read through it answers 0 on every later frame.
        // F0x80014308, the +0x4C teardown, does NOT clear the slots itself
        // (exe/fns.s:4835-4845): it closes each child through F0x800182C8 and
        // frees the children block. A reading that stops there concludes the slot
        // keeps naming the dying object; the walk's writeback is what ends it, in
        // the same frame. The dead bytes stay readable after that, because
        // F0x80017B70's free clears the block tag alone and F0x80017F54 zero-fills
        // the block only when the allocator hands it out again — which is what
        // destroy()/allocate() below do. Both sides proven against the shipped
        // routines by tests/lane-b/task-slot-lifetime.test.js.
        if (!visit(child)) this.mem.write32(slot, 0);
      });
      return true;
    };
    if (this.tasks.has(root >>> 0)) visit(root);
  }

  dispose(root: number): void {
    if (this.tasks.has(root >>> 0)) this.destroy(root >>> 0);
  }

  private children(task: TranslatedTask, fn: (child: number, slot: number) => void): void {
    const count = this.mem.read32(task.address + 0x20);
    const declared = this.classes.get(task.classId)!.childSlots;
    const offsets = declared ?? Array.from({ length: count }, (_, i) => i * 4);
    for (const offset of offsets) {
      if (offset < 0 || offset % 4 !== 0 || offset >= count * 4) {
        throw new Error(`Invalid child slot ${offset.toString(16)} for ${this.classes.get(task.classId)!.name}` +
          ` at ${task.address.toString(16)} (count ${count})`);
      }
      const slot = task.children + offset;
      const child = this.mem.read32(slot) >>> 0;
      if (child) fn(child, slot);
    }
  }

  private destroy(address: number): void {
    const task = this.tasks.get(address)!;
    this.children(task, (child, slot) => {
      const childTask = this.tasks.get(child >>> 0);
      const klass = childTask ? this.classes.get(childTask.classId) : undefined;
      if (childTask && klass?.closeTick) {
        this.callMethod(child, 0x28, [3]);
        klass.tick(child >>> 0, childTask.children);
      }
      this.destroy(child);
      this.mem.write32(slot, 0);
    });
    this.onDestroy?.(task);
    this.tasks.delete(address);
    this.freeBlocks.push({ address: task.address, size: task.size,
      extra: this.mem.read32(task.address + 0x20) * 4, children: task.children });
  }
}
