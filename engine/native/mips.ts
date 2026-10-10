// R3000 integer interpreter core for wstag native ambience code (P0 of
// docs/specs/2026-07-04-wstag-native-interpreter-design.md).
//
// Deliberately minimal: the ~50 integer opcodes the census blocks use, plus the
// COP2 (GTE) register moves and the two GTE commands the resident matrix helpers
// execute (see the COP2 case and gteCommand). No COP0/COP1/COP3, no exceptions,
// no load-delay slot (compiler-scheduled code never depends on it) — any other
// instruction raises NativeTrap so the runtime can disable just the offending
// object (fail-soft guardrail from the spec).
//
// Calling convention mirrors the game's tick loop: call(addr, [a0..a3])
// links $ra to an exit sentinel and runs until the callee returns.

import type { NativeMemory } from "./memory.ts";
import { Gte } from "./gte.ts";

/** pc value that means "returned to the host". */
const EXIT_SENTINEL = 0x00cafe00;

/** Default per-call instruction budget (fail-soft against runaway loops). */
export const DEFAULT_BUDGET = 1_000_000;

export class NativeTrap extends Error {
  readonly pc: number;
  readonly instr: number;

  constructor(message: string, pc: number, instr: number) {
    super(`${message} @pc=0x${(pc >>> 0).toString(16)} instr=0x${(instr >>> 0).toString(16)}`);
    this.name = "NativeTrap";
    this.pc = pc;
    this.instr = instr;
  }
}

/**
 * A JS function hooked on a pc. Runs instead of native code at that address;
 * a numeric return value lands in $v0, then control returns to $ra (as if the
 * function body were `jr $ra`).
 */
export type StubFn = (cpu: R3000) => number | void;

/**
 * Call-edge observer for the behavior lab: `callerPc` is the jal/jalr
 * instruction, `target` the resolved callee, `returnPc` the linked $ra.
 */
export type CallHook = (callerPc: number, target: number, returnPc: number) => void;

export class R3000 {
  /** GPRs as signed 32-bit; index 0 is hardwired to 0. */
  private readonly r = new Int32Array(32);
  private hi = 0;
  private lo = 0;
  private readonly stubs = new Map<number, StubFn>();
  /**
   * COP2 (GTE) register files and commands. The full model lives in
   * engine/native/gte.ts; the arithmetic it runs is engine/dw3/gte-math.ts. See
   * that module for the register map and the exact command set the fight
   * overlays execute (RTPS, MVMVA, GPF, NCLIP, AVSZ3/4, NCS).
   */
  readonly gte = new Gte();

  /** $gp for gp-relative EXE code; the game's boot value, settable by the runtime. */
  gp = 0;
  /**
   * Optional execution guard (production boots): when set, executing an
   * address with no stub for which this returns false raises NativeTrap —
   * catches calls into EXE/fieldstg code that is not loaded (all zeros),
   * which would otherwise nop-slide. Dump boots leave this unset.
   */
  execGuard: ((pc: number) => boolean) | null = null;
  /** When set, records the last N executed pcs (debugging fail-soft traps). */
  traceRing: Int32Array | null = null;
  private tracePos = 0;
  /** How many pcs have been recorded through `traceRing` (may exceed its length). */
  traceWritten(): number {
    return this.tracePos;
  }
  /** Optional call-edge observer; null disables the cost (parity path). */
  onCall: CallHook | null = null;
  /** Optional observer of each `jr $ra`, reported at the executing pc. */
  onReturn: ((pc: number) => void) | null = null;
  /** Scratch stack top used by call(); overwritten stack is never compared in parity. */
  sp = 0x801ffcf0;

  readonly mem: NativeMemory;

  constructor(mem: NativeMemory) {
    this.mem = mem;
  }

  reg(i: number): number {
    return this.r[i] as number;
  }
  setReg(i: number, v: number): void {
    if (i !== 0) this.r[i] = v | 0;
  }

  /** Addresses intercepted by a host stub, for the coverage report's status. */
  stubAddresses(): number[] {
    return [...this.stubs.keys()];
  }

  setStub(addr: number, fn: StubFn): void {
    this.stubs.set(addr >>> 0, fn);
  }

  /**
   * Drop a host stub so the shipped image's own body runs at that address.
   * Used by oracles that must compare a port against the real routine while a
   * runtime host hook of the same address is installed.
   */
  clearStub(addr: number): void {
    this.stubs.delete(addr >>> 0);
  }

  /**
   * Oracle/test access to the COP2 register file, so a harness can seed the
   * rotation matrix, translation vector and view registers the way the game's
   * own ctc2/mtc2 sequence would, and read an accumulator back.
   */
  readGteData(reg: number): number {
    return this.gte.readData(reg);
  }
  writeGteData(reg: number, v: number): void {
    this.gte.writeData(reg, v);
  }
  readGteCtrl(reg: number): number {
    return this.gte.readCtrl(reg);
  }
  writeGteCtrl(reg: number, v: number): void {
    this.gte.writeCtrl(reg, v);
  }

  /**
   * Call a native function: a0..a3 from args, $ra = exit sentinel.
   * Returns $v0 (signed). Registers are reset per call (except gp/sp defaults).
   */
  call(addr: number, args: number[], budget: number = DEFAULT_BUDGET): number {
    this.r.fill(0);
    for (let i = 0; i < args.length && i < 4; i++) this.r[4 + i] = (args[i] as number) | 0;
    this.r[28] = this.gp | 0;
    this.r[29] = this.sp | 0;
    this.r[31] = EXIT_SENTINEL;
    this.run(addr, budget);
    return this.r[2] as number;
  }

  private run(entry: number, budget: number): void {
    const r = this.r;
    const mem = this.mem;
    let pc = entry >>> 0;
    let nextPc = (pc + 4) >>> 0;

    for (let n = 0; n < budget; n++) {
      if (pc === EXIT_SENTINEL) return;
      mem.currentPc = pc >>> 0;

      const stub = this.stubs.get(pc);
      if (stub !== undefined) {
        const v = stub(this);
        if (typeof v === "number") r[2] = v | 0;
        pc = (r[31] as number) >>> 0; // jr $ra
        nextPc = (pc + 4) >>> 0;
        continue;
      }

      if (this.execGuard !== null && !this.execGuard(pc)) {
        throw new NativeTrap(
          `exec outside loaded code (missing stub? ra=0x${((r[31] as number) >>> 0).toString(16)})`,
          pc,
          0,
        );
      }

      if (this.traceRing !== null) {
        this.traceRing[this.tracePos++ % this.traceRing.length] = pc | 0;
      }

      const w = mem.read32(pc) >>> 0;
      const instrPc = pc;
      pc = nextPc;
      nextPc = (nextPc + 4) >>> 0;

      const op = w >>> 26;
      const rs = (w >>> 21) & 31;
      const rt = (w >>> 16) & 31;
      const rd = (w >>> 11) & 31;
      const sa = (w >>> 6) & 31;
      const imm = w & 0xffff;
      const simm = (imm << 16) >> 16;

      switch (op) {
        case 0x00: {
          // SPECIAL
          switch (w & 0x3f) {
            case 0x00: if (rd) r[rd] = (r[rt] as number) << sa; break; // sll
            case 0x02: if (rd) r[rd] = ((r[rt] as number) >>> sa) | 0; break; // srl
            case 0x03: if (rd) r[rd] = (r[rt] as number) >> sa; break; // sra
            case 0x04: if (rd) r[rd] = (r[rt] as number) << ((r[rs] as number) & 31); break; // sllv
            case 0x06: if (rd) r[rd] = ((r[rt] as number) >>> ((r[rs] as number) & 31)) | 0; break; // srlv
            case 0x07: if (rd) r[rd] = (r[rt] as number) >> ((r[rs] as number) & 31); break; // srav
            case 0x08:
              if (rs === 31 && this.onReturn !== null) this.onReturn(instrPc);
              nextPc = (r[rs] as number) >>> 0; // jr (takes effect after delay slot)
              break;
            case 0x09: { // jalr
              const ret = (instrPc + 8) | 0;
              const target = (r[rs] as number) >>> 0;
              if (this.onCall !== null) this.onCall(instrPc, target, ret >>> 0);
              nextPc = target;
              if (rd) r[rd] = ret;
              break;
            }
            case 0x0a: if (rd && (r[rt] as number) === 0) r[rd] = r[rs] as number; break; // movz
            case 0x0b: if (rd && (r[rt] as number) !== 0) r[rd] = r[rs] as number; break; // movn
            case 0x0c: throw new NativeTrap("syscall", instrPc, w);
            case 0x0d: throw new NativeTrap("break", instrPc, w);
            case 0x10: if (rd) r[rd] = this.hi; break; // mfhi
            case 0x11: this.hi = r[rs] as number; break; // mthi
            case 0x12: if (rd) r[rd] = this.lo; break; // mflo
            case 0x13: this.lo = r[rs] as number; break; // mtlo
            case 0x18: { // mult
              const p = BigInt(r[rs] as number) * BigInt(r[rt] as number);
              this.lo = Number(BigInt.asIntN(32, p));
              this.hi = Number(BigInt.asIntN(32, p >> 32n));
              break;
            }
            case 0x19: { // multu
              const p = BigInt((r[rs] as number) >>> 0) * BigInt((r[rt] as number) >>> 0);
              this.lo = Number(BigInt.asIntN(32, p));
              this.hi = Number(BigInt.asIntN(32, p >> 32n));
              break;
            }
            case 0x1a: { // div
              const a = r[rs] as number, b = r[rt] as number;
              if (b === 0) { this.lo = a >= 0 ? -1 : 1; this.hi = a; }
              else if (a === -0x80000000 && b === -1) { this.lo = -0x80000000; this.hi = 0; }
              else { this.lo = (a / b) | 0; this.hi = a % b | 0; }
              break;
            }
            case 0x1b: { // divu
              const a = (r[rs] as number) >>> 0, b = (r[rt] as number) >>> 0;
              if (b === 0) { this.lo = -1; this.hi = a | 0; }
              else { this.lo = (a / b) >>> 0 | 0; this.hi = a % b | 0; }
              break;
            }
            case 0x20: // add (no overflow exception modeled)
            case 0x21: if (rd) r[rd] = ((r[rs] as number) + (r[rt] as number)) | 0; break; // addu
            case 0x22: // sub
            case 0x23: if (rd) r[rd] = ((r[rs] as number) - (r[rt] as number)) | 0; break; // subu
            case 0x24: if (rd) r[rd] = (r[rs] as number) & (r[rt] as number); break; // and
            case 0x25: if (rd) r[rd] = (r[rs] as number) | (r[rt] as number); break; // or
            case 0x26: if (rd) r[rd] = (r[rs] as number) ^ (r[rt] as number); break; // xor
            case 0x27: if (rd) r[rd] = ~((r[rs] as number) | (r[rt] as number)); break; // nor
            case 0x2a: if (rd) r[rd] = (r[rs] as number) < (r[rt] as number) ? 1 : 0; break; // slt
            case 0x2b: if (rd) r[rd] = ((r[rs] as number) >>> 0) < ((r[rt] as number) >>> 0) ? 1 : 0; break; // sltu
            default: throw new NativeTrap("unknown SPECIAL", instrPc, w);
          }
          break;
        }
        case 0x01: {
          // REGIMM
          const cond = rt & 1 ? (r[rs] as number) >= 0 : (r[rs] as number) < 0; // bgez : bltz
          if ((rt & 0x1e) === 0x10) r[31] = (instrPc + 8) | 0; // bltzal/bgezal link
          else if ((rt & 0x1e) !== 0x00) throw new NativeTrap("unknown REGIMM", instrPc, w);
          if (cond) nextPc = (instrPc + 4 + (simm << 2)) >>> 0;
          break;
        }
        case 0x02: nextPc = ((instrPc & 0xf0000000) | ((w & 0x03ffffff) << 2)) >>> 0; break; // j
        case 0x03: // jal
          r[31] = (instrPc + 8) | 0;
          nextPc = ((instrPc & 0xf0000000) | ((w & 0x03ffffff) << 2)) >>> 0;
          if (this.onCall !== null) this.onCall(instrPc, nextPc, (r[31] as number) >>> 0);
          break;
        case 0x04: if ((r[rs] as number) === (r[rt] as number)) nextPc = (instrPc + 4 + (simm << 2)) >>> 0; break; // beq
        case 0x05: if ((r[rs] as number) !== (r[rt] as number)) nextPc = (instrPc + 4 + (simm << 2)) >>> 0; break; // bne
        case 0x06: if ((r[rs] as number) <= 0) nextPc = (instrPc + 4 + (simm << 2)) >>> 0; break; // blez
        case 0x07: if ((r[rs] as number) > 0) nextPc = (instrPc + 4 + (simm << 2)) >>> 0; break; // bgtz
        case 0x08: // addi (no overflow exception)
        case 0x09: if (rt) r[rt] = ((r[rs] as number) + simm) | 0; break; // addiu
        case 0x0a: if (rt) r[rt] = (r[rs] as number) < simm ? 1 : 0; break; // slti
        case 0x0b: if (rt) r[rt] = ((r[rs] as number) >>> 0) < (simm >>> 0) ? 1 : 0; break; // sltiu
        case 0x0c: if (rt) r[rt] = (r[rs] as number) & imm; break; // andi
        case 0x0d: if (rt) r[rt] = (r[rs] as number) | imm; break; // ori
        case 0x0e: if (rt) r[rt] = (r[rs] as number) ^ imm; break; // xori
        case 0x0f: if (rt) r[rt] = (imm << 16) | 0; break; // lui
        case 0x20: if (rt) r[rt] = mem.read8s((r[rs] as number) + simm); break; // lb
        case 0x21: if (rt) r[rt] = mem.read16s((r[rs] as number) + simm); break; // lh
        case 0x22: { // lwl (little-endian)
          const addr = (r[rs] as number) + simm;
          const b = addr & 3;
          const word = mem.read32(addr & ~3) >>> 0;
          if (rt) r[rt] = b === 3 ? word | 0 : (((r[rt] as number) & (0xffffffff >>> ((b + 1) * 8))) | (word << ((3 - b) * 8))) | 0;
          break;
        }
        case 0x23: if (rt) r[rt] = mem.read32((r[rs] as number) + simm); break; // lw
        case 0x24: if (rt) r[rt] = mem.read8((r[rs] as number) + simm); break; // lbu
        case 0x25: if (rt) r[rt] = mem.read16((r[rs] as number) + simm); break; // lhu
        case 0x26: { // lwr (little-endian)
          const addr = (r[rs] as number) + simm;
          const b = addr & 3;
          const word = mem.read32(addr & ~3) >>> 0;
          if (rt) r[rt] = b === 0 ? word | 0 : (((r[rt] as number) & ((0xffffffff << ((4 - b) * 8)) | 0)) | (word >>> (b * 8))) | 0;
          break;
        }
        case 0x28: mem.write8((r[rs] as number) + simm, r[rt] as number); break; // sb
        case 0x29: mem.write16((r[rs] as number) + simm, r[rt] as number); break; // sh
        case 0x2a: { // swl (little-endian)
          const addr = (r[rs] as number) + simm;
          const b = addr & 3;
          const aligned = addr & ~3;
          const old = mem.read32(aligned) >>> 0;
          const v = (r[rt] as number) >>> 0;
          mem.write32(aligned, b === 3 ? v : (old & ((0xffffffff << ((b + 1) * 8)) >>> 0)) | (v >>> ((3 - b) * 8)));
          break;
        }
        case 0x2b: mem.write32((r[rs] as number) + simm, r[rt] as number); break; // sw
        // LWC2/SWC2 move words between memory and the GTE's data registers.
        // SWC2 is opcode 0x3A (the original's `swc2 $14` stores SXY2); 0x36 is
        // LDC2, which no routine here executes.
        case 0x32: this.gte.loadData(rt, mem.read32((r[rs] as number) + simm)); break; // lwc2
        case 0x3a: mem.write32((r[rs] as number) + simm, this.gte.storeData(rt)); break; // swc2
        case 0x2e: { // swr (little-endian)
          const addr = (r[rs] as number) + simm;
          const b = addr & 3;
          const aligned = addr & ~3;
          const old = mem.read32(aligned) >>> 0;
          const v = (r[rt] as number) >>> 0;
          mem.write32(aligned, b === 0 ? v : (old & (0xffffffff >>> ((4 - b) * 8))) | (v << (b * 8)));
          break;
        }
        case 0x12: { // COP2 (the GTE)
          // The full register file and command set live in engine/native/gte.ts;
          // the save-screen helpers (RotMatrixYXZ/ApplyMatrixSV) remain its first
          // consumers, and the battle 3-D core's RTPS/MVMVA/GPF/NCLIP/AVSZ run
          // through the same model. Unknown commands stay no-ops (fail-soft).
          if (rs === 4) { this.gte.writeData(rd, r[rt] as number); break; } // mtc2
          if (rs === 6) { this.gte.writeCtrl(rd, r[rt] as number); break; } // ctc2
          if (rs === 0) { if (rt) r[rt] = this.gte.readData(rd); break; } // mfc2
          if (rs === 2) { if (rt) r[rt] = this.gte.readCtrl(rd); break; } // cfc2
          if (rs >= 16) { this.gte.command(w); break; } // GTE command
          break; // BC2 and the reserved forms: no condition model, no branch
        }
        case 0x10: case 0x11: case 0x13: // COP0, COP1, COP3
          throw new NativeTrap("COP instruction (GTE?) not supported", instrPc, w);
        default:
          throw new NativeTrap("unknown opcode", instrPc, w);
      }
      r[0] = 0;
    }
    throw new NativeTrap("budget exhausted", pc, 0);
  }
}
