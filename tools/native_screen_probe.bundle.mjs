// tools/native_screen_probe.ts
import { closeSync, existsSync, openSync, readSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// engine/native/memory.ts
var RAM_SIZE = 2097152;
var RAM_MASK = 2097151;
var NativeMemory = class _NativeMemory {
  bytes;
  view;
  /**
   * PC of the instruction currently executing. The R3000 core updates this per
   * instruction so store hooks can attribute a write to its site. Only the
   * behavior lab reads it; the parity path leaves the hooks null.
   */
  currentPc = 0;
  /** Opt-in store observer; null disables the call and its cost. */
  onWrite = null;
  constructor(bytes) {
    if (bytes !== void 0 && bytes.length !== RAM_SIZE) {
      throw new Error(`NativeMemory expects a ${RAM_SIZE}-byte image, got ${bytes.length}`);
    }
    this.bytes = bytes ?? new Uint8Array(RAM_SIZE);
    this.view = new DataView(this.bytes.buffer, this.bytes.byteOffset, this.bytes.byteLength);
  }
  /** Wrap (not copy) a full 2MB RAM dump. */
  static fromDump(bytes) {
    return new _NativeMemory(bytes);
  }
  /** Copy a blob into the address space at a RAM address. */
  load(blob, addr) {
    const off = addr & RAM_MASK;
    if (off + blob.length > RAM_SIZE) throw new Error(`load overruns RAM: 0x${addr.toString(16)}+${blob.length}`);
    this.bytes.set(blob, off);
  }
  /**
   * Optional hardware-register service (engine/native/device-ports.ts). Null
   * keeps the plain 2MB RAM model; when set, the listed registers answer from
   * the device and everything else falls through to RAM.
   */
  devices = null;
  read8(addr) {
    return this.bytes[addr & RAM_MASK];
  }
  read8s(addr) {
    return this.view.getInt8(addr & RAM_MASK);
  }
  read16(addr) {
    return this.view.getUint16(addr & RAM_MASK, true);
  }
  read16s(addr) {
    return this.view.getInt16(addr & RAM_MASK, true);
  }
  /** Signed 32-bit (matches register width); use >>> 0 for the unsigned view. */
  read32(addr) {
    if (this.devices !== null) {
      const v = this.devices.read(addr >>> 0);
      if (v !== void 0) return v | 0;
    }
    return this.view.getInt32(addr & RAM_MASK, true);
  }
  write8(addr, v) {
    const masked = addr & RAM_MASK;
    this.bytes[masked] = v & 255;
    if (this.onWrite !== null) this.onWrite(this.currentPc, addr >>> 0, 1, v & 255);
  }
  write16(addr, v) {
    const masked = addr & RAM_MASK;
    this.view.setUint16(masked, v & 65535, true);
    if (this.onWrite !== null) this.onWrite(this.currentPc, addr >>> 0, 2, v & 65535);
  }
  write32(addr, v) {
    if (this.devices !== null && this.devices.write(addr >>> 0, v >>> 0)) return;
    const masked = addr & RAM_MASK;
    this.view.setUint32(masked, v >>> 0, true);
    if (this.onWrite !== null) this.onWrite(this.currentPc, addr >>> 0, 4, v >>> 0);
  }
};

// engine/native/screen-heap.ts
var HEAP_BASE = 2148532224;
var HEAP_LIMIT = 2149576692;
var ScreenHeap = class {
  mem;
  base;
  limit;
  next;
  constructor(mem, base = HEAP_BASE, limit = HEAP_LIMIT) {
    this.mem = mem;
    this.base = base >>> 0;
    this.limit = limit >>> 0;
    this.next = this.base;
  }
  /** The low-level allocator stubbed at F0x80017D2C. */
  allocLowLevel(size) {
    const bytes = ((size >>> 0) + 15 & ~15) >>> 0;
    if (this.next + bytes > this.limit) this.next = this.base;
    const p = this.next;
    this.next = p + bytes >>> 0;
    for (let a2 = p; a2 < p + bytes; a2 += 4) this.mem.write32(a2, 0);
    return p | 0;
  }
  /** The port-facing allocation; the arena is already suitably aligned. */
  alloc(size, align) {
    void align;
    return this.allocLowLevel(size);
  }
  free(_ptr) {
  }
};

// engine/native/mips.ts
var EXIT_SENTINEL = 13303296;
var DEFAULT_BUDGET = 1e6;
var NativeTrap = class extends Error {
  pc;
  instr;
  constructor(message, pc, instr) {
    super(`${message} @pc=0x${(pc >>> 0).toString(16)} instr=0x${(instr >>> 0).toString(16)}`);
    this.name = "NativeTrap";
    this.pc = pc;
    this.instr = instr;
  }
};
var R3000 = class {
  /** GPRs as signed 32-bit; index 0 is hardwired to 0. */
  r = new Int32Array(32);
  hi = 0;
  lo = 0;
  stubs = /* @__PURE__ */ new Map();
  /** $gp for gp-relative EXE code; the game's boot value, settable by the runtime. */
  gp = 0;
  /**
   * Optional execution guard (production boots): when set, executing an
   * address with no stub for which this returns false raises NativeTrap —
   * catches calls into EXE/fieldstg code that is not loaded (all zeros),
   * which would otherwise nop-slide. Dump boots leave this unset.
   */
  execGuard = null;
  /** When set, records the last N executed pcs (debugging fail-soft traps). */
  traceRing = null;
  tracePos = 0;
  /** How many pcs have been recorded through `traceRing` (may exceed its length). */
  traceWritten() {
    return this.tracePos;
  }
  /** Optional call-edge observer; null disables the cost (parity path). */
  onCall = null;
  /** Optional observer of each `jr $ra`, reported at the executing pc. */
  onReturn = null;
  /** Scratch stack top used by call(); overwritten stack is never compared in parity. */
  sp = 2149580016;
  mem;
  constructor(mem) {
    this.mem = mem;
  }
  reg(i) {
    return this.r[i];
  }
  setReg(i, v) {
    if (i !== 0) this.r[i] = v | 0;
  }
  /** Addresses intercepted by a host stub, for the coverage report's status. */
  stubAddresses() {
    return [...this.stubs.keys()];
  }
  setStub(addr, fn) {
    this.stubs.set(addr >>> 0, fn);
  }
  /**
   * Drop a host stub so the shipped image's own body runs at that address.
   * Used by oracles that must compare a port against the real routine while a
   * runtime host hook of the same address is installed.
   */
  clearStub(addr) {
    this.stubs.delete(addr >>> 0);
  }
  /**
   * Call a native function: a0..a3 from args, $ra = exit sentinel.
   * Returns $v0 (signed). Registers are reset per call (except gp/sp defaults).
   */
  call(addr, args, budget = DEFAULT_BUDGET) {
    this.r.fill(0);
    for (let i = 0; i < args.length && i < 4; i++) this.r[4 + i] = args[i] | 0;
    this.r[28] = this.gp | 0;
    this.r[29] = this.sp | 0;
    this.r[31] = EXIT_SENTINEL;
    this.run(addr, budget);
    return this.r[2];
  }
  run(entry, budget) {
    const r = this.r;
    const mem = this.mem;
    let pc = entry >>> 0;
    let nextPc = pc + 4 >>> 0;
    for (let n = 0; n < budget; n++) {
      if (pc === EXIT_SENTINEL) return;
      mem.currentPc = pc >>> 0;
      const stub = this.stubs.get(pc);
      if (stub !== void 0) {
        const v = stub(this);
        if (typeof v === "number") r[2] = v | 0;
        pc = r[31] >>> 0;
        nextPc = pc + 4 >>> 0;
        continue;
      }
      if (this.execGuard !== null && !this.execGuard(pc)) {
        throw new NativeTrap(
          `exec outside loaded code (missing stub? ra=0x${(r[31] >>> 0).toString(16)})`,
          pc,
          0
        );
      }
      if (this.traceRing !== null) {
        this.traceRing[this.tracePos++ % this.traceRing.length] = pc | 0;
      }
      const w = mem.read32(pc) >>> 0;
      const instrPc = pc;
      pc = nextPc;
      nextPc = nextPc + 4 >>> 0;
      const op = w >>> 26;
      const rs = w >>> 21 & 31;
      const rt = w >>> 16 & 31;
      const rd = w >>> 11 & 31;
      const sa = w >>> 6 & 31;
      const imm = w & 65535;
      const simm = imm << 16 >> 16;
      switch (op) {
        case 0: {
          switch (w & 63) {
            case 0:
              if (rd) r[rd] = r[rt] << sa;
              break;
            // sll
            case 2:
              if (rd) r[rd] = r[rt] >>> sa | 0;
              break;
            // srl
            case 3:
              if (rd) r[rd] = r[rt] >> sa;
              break;
            // sra
            case 4:
              if (rd) r[rd] = r[rt] << (r[rs] & 31);
              break;
            // sllv
            case 6:
              if (rd) r[rd] = r[rt] >>> (r[rs] & 31) | 0;
              break;
            // srlv
            case 7:
              if (rd) r[rd] = r[rt] >> (r[rs] & 31);
              break;
            // srav
            case 8:
              if (rs === 31 && this.onReturn !== null) this.onReturn(instrPc);
              nextPc = r[rs] >>> 0;
              break;
            case 9: {
              const ret = instrPc + 8 | 0;
              const target = r[rs] >>> 0;
              if (this.onCall !== null) this.onCall(instrPc, target, ret >>> 0);
              nextPc = target;
              if (rd) r[rd] = ret;
              break;
            }
            case 10:
              if (rd && r[rt] === 0) r[rd] = r[rs];
              break;
            // movz
            case 11:
              if (rd && r[rt] !== 0) r[rd] = r[rs];
              break;
            // movn
            case 12:
              throw new NativeTrap("syscall", instrPc, w);
            case 13:
              throw new NativeTrap("break", instrPc, w);
            case 16:
              if (rd) r[rd] = this.hi;
              break;
            // mfhi
            case 17:
              this.hi = r[rs];
              break;
            // mthi
            case 18:
              if (rd) r[rd] = this.lo;
              break;
            // mflo
            case 19:
              this.lo = r[rs];
              break;
            // mtlo
            case 24: {
              const p = BigInt(r[rs]) * BigInt(r[rt]);
              this.lo = Number(BigInt.asIntN(32, p));
              this.hi = Number(BigInt.asIntN(32, p >> 32n));
              break;
            }
            case 25: {
              const p = BigInt(r[rs] >>> 0) * BigInt(r[rt] >>> 0);
              this.lo = Number(BigInt.asIntN(32, p));
              this.hi = Number(BigInt.asIntN(32, p >> 32n));
              break;
            }
            case 26: {
              const a2 = r[rs], b = r[rt];
              if (b === 0) {
                this.lo = a2 >= 0 ? -1 : 1;
                this.hi = a2;
              } else if (a2 === -2147483648 && b === -1) {
                this.lo = -2147483648;
                this.hi = 0;
              } else {
                this.lo = a2 / b | 0;
                this.hi = a2 % b | 0;
              }
              break;
            }
            case 27: {
              const a2 = r[rs] >>> 0, b = r[rt] >>> 0;
              if (b === 0) {
                this.lo = -1;
                this.hi = a2 | 0;
              } else {
                this.lo = a2 / b >>> 0 | 0;
                this.hi = a2 % b | 0;
              }
              break;
            }
            case 32:
            // add (no overflow exception modeled)
            case 33:
              if (rd) r[rd] = r[rs] + r[rt] | 0;
              break;
            // addu
            case 34:
            // sub
            case 35:
              if (rd) r[rd] = r[rs] - r[rt] | 0;
              break;
            // subu
            case 36:
              if (rd) r[rd] = r[rs] & r[rt];
              break;
            // and
            case 37:
              if (rd) r[rd] = r[rs] | r[rt];
              break;
            // or
            case 38:
              if (rd) r[rd] = r[rs] ^ r[rt];
              break;
            // xor
            case 39:
              if (rd) r[rd] = ~(r[rs] | r[rt]);
              break;
            // nor
            case 42:
              if (rd) r[rd] = r[rs] < r[rt] ? 1 : 0;
              break;
            // slt
            case 43:
              if (rd) r[rd] = r[rs] >>> 0 < r[rt] >>> 0 ? 1 : 0;
              break;
            // sltu
            default:
              throw new NativeTrap("unknown SPECIAL", instrPc, w);
          }
          break;
        }
        case 1: {
          const cond = rt & 1 ? r[rs] >= 0 : r[rs] < 0;
          if ((rt & 30) === 16) r[31] = instrPc + 8 | 0;
          else if ((rt & 30) !== 0) throw new NativeTrap("unknown REGIMM", instrPc, w);
          if (cond) nextPc = instrPc + 4 + (simm << 2) >>> 0;
          break;
        }
        case 2:
          nextPc = (instrPc & 4026531840 | (w & 67108863) << 2) >>> 0;
          break;
        // j
        case 3:
          r[31] = instrPc + 8 | 0;
          nextPc = (instrPc & 4026531840 | (w & 67108863) << 2) >>> 0;
          if (this.onCall !== null) this.onCall(instrPc, nextPc, r[31] >>> 0);
          break;
        case 4:
          if (r[rs] === r[rt]) nextPc = instrPc + 4 + (simm << 2) >>> 0;
          break;
        // beq
        case 5:
          if (r[rs] !== r[rt]) nextPc = instrPc + 4 + (simm << 2) >>> 0;
          break;
        // bne
        case 6:
          if (r[rs] <= 0) nextPc = instrPc + 4 + (simm << 2) >>> 0;
          break;
        // blez
        case 7:
          if (r[rs] > 0) nextPc = instrPc + 4 + (simm << 2) >>> 0;
          break;
        // bgtz
        case 8:
        // addi (no overflow exception)
        case 9:
          if (rt) r[rt] = r[rs] + simm | 0;
          break;
        // addiu
        case 10:
          if (rt) r[rt] = r[rs] < simm ? 1 : 0;
          break;
        // slti
        case 11:
          if (rt) r[rt] = r[rs] >>> 0 < simm >>> 0 ? 1 : 0;
          break;
        // sltiu
        case 12:
          if (rt) r[rt] = r[rs] & imm;
          break;
        // andi
        case 13:
          if (rt) r[rt] = r[rs] | imm;
          break;
        // ori
        case 14:
          if (rt) r[rt] = r[rs] ^ imm;
          break;
        // xori
        case 15:
          if (rt) r[rt] = imm << 16 | 0;
          break;
        // lui
        case 32:
          if (rt) r[rt] = mem.read8s(r[rs] + simm);
          break;
        // lb
        case 33:
          if (rt) r[rt] = mem.read16s(r[rs] + simm);
          break;
        // lh
        case 34: {
          const addr = r[rs] + simm;
          const b = addr & 3;
          const word = mem.read32(addr & ~3) >>> 0;
          if (rt) r[rt] = b === 3 ? word | 0 : r[rt] & 4294967295 >>> (b + 1) * 8 | word << (3 - b) * 8 | 0;
          break;
        }
        case 35:
          if (rt) r[rt] = mem.read32(r[rs] + simm);
          break;
        // lw
        case 36:
          if (rt) r[rt] = mem.read8(r[rs] + simm);
          break;
        // lbu
        case 37:
          if (rt) r[rt] = mem.read16(r[rs] + simm);
          break;
        // lhu
        case 38: {
          const addr = r[rs] + simm;
          const b = addr & 3;
          const word = mem.read32(addr & ~3) >>> 0;
          if (rt) r[rt] = b === 0 ? word | 0 : r[rt] & (4294967295 << (4 - b) * 8 | 0) | word >>> b * 8 | 0;
          break;
        }
        case 40:
          mem.write8(r[rs] + simm, r[rt]);
          break;
        // sb
        case 41:
          mem.write16(r[rs] + simm, r[rt]);
          break;
        // sh
        case 42: {
          const addr = r[rs] + simm;
          const b = addr & 3;
          const aligned = addr & ~3;
          const old = mem.read32(aligned) >>> 0;
          const v = r[rt] >>> 0;
          mem.write32(aligned, b === 3 ? v : old & 4294967295 << (b + 1) * 8 >>> 0 | v >>> (3 - b) * 8);
          break;
        }
        case 43:
          mem.write32(r[rs] + simm, r[rt]);
          break;
        // sw
        case 46: {
          const addr = r[rs] + simm;
          const b = addr & 3;
          const aligned = addr & ~3;
          const old = mem.read32(aligned) >>> 0;
          const v = r[rt] >>> 0;
          mem.write32(aligned, b === 0 ? v : old & 4294967295 >>> (4 - b) * 8 | v << b * 8);
          break;
        }
        case 16:
        case 17:
        case 18:
        case 19:
          throw new NativeTrap("COP instruction (GTE?) not supported", instrPc, w);
        default:
          throw new NativeTrap("unknown opcode", instrPc, w);
      }
      r[0] = 0;
    }
    throw new NativeTrap("budget exhausted", pc, 0);
  }
};

// engine/native/stubs.ts
var A = {
  ALLOC: 2147566852,
  // (cb, size, extraSize) — a3 forced to 0
  ALLOC_ID: 2147566556,
  // (cb, size, extraSize, id)
  SET_STATE: 2147566196,
  SET_SUB1: 2147566216,
  SET_SUB2: 2147566232,
  SET_SUB3: 2147566244,
  ADV_STATE: 2147566252,
  ADV_SUB1: 2147566280,
  ADV_SUB2: 2147566304,
  ADV_SUB3: 2147566324,
  DESTROY: 2147566344,
  SET_FLAG: 2147575212,
  // runtime target of [0x80048ac8]
  GET_FLAG: 2147574704,
  // runtime target of [0x80048acc]
  RAND_U16: 2147586876,
  // runtime target of [0x8004dc0c]
  FRAME_DELTA: 2147604228,
  // runtime target of [0x8004df9c]
  GLOBAL_SET_FLAG_PTR: 2147781320,
  GLOBAL_GET_FLAG_PTR: 2147781324,
  GLOBAL_RAND_PTR: 2147802124,
  GLOBAL_FRAME_DELTA_PTR: 2147803036,
  GLOBAL_FRAME_DELTA_VALUE: 2147802664
};
var HEAP_BASE2 = 2148204544;
var DRAW_CTX_METHODS = {
  2147609776: "reset",
  // ctx+0x70 (also jal'd by the fill itself)
  2147609788: "setOrigin",
  // ctx+0x74 (0x140,0x100 = screen center)
  2147609816: "setDepth",
  // ctx+0x78
  2147609836: "m_0x88",
  2147609848: "m_0x80",
  2147609908: "setLayer",
  // ctx+0x7c (0x1002, 2)
  2147609964: "drawSprite",
  // ctx+0x84 (subPtr, spriteId, x, y) — decoded
  2147612112: "setScale",
  // ctx+0x8c (sx, sy, sz) — (-0x1000,...) = x-flip
  2147612140: "m_0x90",
  2147612168: "setPos",
  // ctx+0x94 (x, y)
  2147612188: "m_0x98",
  2147612200: "m_0x9c"
};
function installDrawStubs(cpu, sink) {
  for (const [addr, method] of Object.entries(DRAW_CTX_METHODS)) {
    cpu.setStub(Number(addr), (c) => {
      sink?.({ method, args: [c.reg(4), c.reg(5), c.reg(6), c.reg(7)] });
      return 0;
    });
  }
}
var OBJECT_LIFECYCLE_DEAD = 3;
var CHILD_ARRAY_MAX = 64;
var RAM_LO = 2147549184;
var RAM_HI = 2149580800;
function destroyTrackedObject(mem, world, addr) {
  const target = addr >>> 0;
  const obj = world.objects.find((o) => o.addr >>> 0 === target);
  if (!obj) return false;
  if (!obj.alive) return true;
  obj.alive = false;
  const count = mem.read32(target + 32) | 0;
  const array = mem.read32(target + 36) >>> 0;
  if (count > 0 && count <= CHILD_ARRAY_MAX && array >= RAM_LO && array < RAM_HI) {
    for (let i = 0; i < count; i++) {
      const child = mem.read32(array + i * 4) >>> 0;
      if (child !== 0) destroyTrackedObject(mem, world, child);
    }
  }
  for (const p of world.objects) {
    if (!p.alive) continue;
    const n = mem.read32(p.addr + 32) | 0;
    if (n <= 0 || n > CHILD_ARRAY_MAX) continue;
    const a2 = mem.read32(p.addr + 36) >>> 0;
    if (a2 < RAM_LO || a2 >= RAM_HI) continue;
    for (let i = 0; i < n; i++) {
      if (mem.read32(a2 + i * 4) >>> 0 === target) mem.write32(a2 + i * 4, 0);
    }
  }
  return true;
}
var StubWorld = class {
  objects = [];
  mem;
  heapNext = HEAP_BASE2;
  constructor(mem) {
    this.mem = mem;
  }
  carve(size) {
    const requested = size | 0;
    const actual = requested === 0 ? 256 : requested;
    const addr = this.heapNext >>> 0;
    this.heapNext = (this.heapNext + actual + 7 & ~7) >>> 0;
    for (let i = 0; i < actual; i++) this.mem.write8(addr + i, 0);
    return addr;
  }
  alloc(cb, size, extraSize, id) {
    const obj = this.carve(size);
    const m = this.mem;
    if (extraSize !== 0) {
      m.write32(obj + 36, this.carve(extraSize));
      m.write32(obj + 32, extraSize >> 2);
    }
    m.write32(obj + 40, A.SET_STATE);
    m.write32(obj + 44, A.SET_SUB1);
    m.write32(obj + 48, A.SET_SUB2);
    m.write32(obj + 52, A.SET_SUB3);
    m.write32(obj + 56, A.ADV_STATE);
    m.write32(obj + 60, A.ADV_SUB1);
    m.write32(obj + 64, A.ADV_SUB2);
    m.write32(obj + 68, A.ADV_SUB3);
    m.write32(obj + 72, cb);
    m.write32(obj + 76, A.DESTROY);
    if (id !== 0) m.write32(obj + 0, id);
    this.objects.push({ addr: obj, cb, extra: m.read32(obj + 36), id, alive: true });
    return obj;
  }
};
function installCoreStubs(cpu, host) {
  const mem = cpu.mem;
  const world = new StubWorld(mem);
  mem.write32(A.GLOBAL_SET_FLAG_PTR, A.SET_FLAG);
  mem.write32(A.GLOBAL_GET_FLAG_PTR, A.GET_FLAG);
  mem.write32(A.GLOBAL_RAND_PTR, A.RAND_U16);
  mem.write32(A.GLOBAL_FRAME_DELTA_PTR, A.FRAME_DELTA);
  cpu.setStub(A.ALLOC, (c) => world.alloc(c.reg(4) >>> 0, c.reg(5), c.reg(6), 0));
  cpu.setStub(A.ALLOC_ID, (c) => world.alloc(c.reg(4) >>> 0, c.reg(5), c.reg(6), c.reg(7)));
  cpu.setStub(A.SET_STATE, (c) => {
    const o = c.reg(4);
    mem.write32(o + 12, c.reg(5));
    mem.write32(o + 16, 0);
    mem.write32(o + 20, 0);
    mem.write32(o + 24, 0);
  });
  cpu.setStub(A.SET_SUB1, (c) => {
    const o = c.reg(4);
    mem.write32(o + 16, c.reg(5));
    mem.write32(o + 20, 0);
    mem.write32(o + 24, 0);
  });
  cpu.setStub(A.SET_SUB2, (c) => {
    const o = c.reg(4);
    mem.write32(o + 20, c.reg(5));
    mem.write32(o + 24, 0);
  });
  cpu.setStub(A.SET_SUB3, (c) => mem.write32(c.reg(4) + 24, c.reg(5)));
  const advance = (off) => (c) => {
    const o = c.reg(4);
    const v = mem.read32(o + off) + 1;
    for (let z = off + 4; z <= 24; z += 4) mem.write32(o + z, 0);
    mem.write32(o + off, v);
    return v;
  };
  cpu.setStub(A.ADV_STATE, advance(12));
  cpu.setStub(A.ADV_SUB1, advance(16));
  cpu.setStub(A.ADV_SUB2, advance(20));
  cpu.setStub(A.ADV_SUB3, advance(24));
  cpu.setStub(A.DESTROY, (c) => {
    const addr = c.reg(4) >>> 0;
    const obj = world.objects.find((o) => o.addr === addr);
    if (obj) obj.alive = false;
    else host.log?.(`destroy of unknown object 0x${addr.toString(16)}`);
  });
  cpu.setStub(A.SET_FLAG, (c) => host.setFlag(c.reg(4), c.reg(5)));
  cpu.setStub(A.GET_FLAG, (c) => host.getFlag(c.reg(4)));
  cpu.setStub(A.RAND_U16, () => host.rand16() & 65535);
  cpu.setStub(A.FRAME_DELTA, () => mem.read32(A.GLOBAL_FRAME_DELTA_VALUE));
  return world;
}

// engine/native/vram.ts
var TRANSFER_BYTES = (w, h) => (w >>> 0) * (h >>> 0) * 2;
var VramMap = class {
  loads = [];
  /**
   * Record one LoadImage. `readByte` copies the source bytes out of the
   * emulated memory at upload time, so a later overwrite of the source block
   * cannot rewrite history.
   */
  upload(x, y, w, h, data, bpp, clut, readByte) {
    const bytes = TRANSFER_BYTES(w, h);
    const pixels = new Uint8Array(Math.max(0, Math.min(bytes, 262144)));
    for (let i = 0; i < pixels.length; i++) pixels[i] = readByte(data + i >>> 0) & 255;
    const load = { x, y, w, h, data, bpp, clut, pixels };
    this.loads.push(load);
    return load;
  }
  /** The most recent upload covering VRAM texel (x, y), or null. */
  find(x, y) {
    for (let i = this.loads.length - 1; i >= 0; i--) {
      const l = this.loads[i];
      if (x >= l.x && x < l.x + l.w && y >= l.y && y < l.y + l.h) return l;
    }
    return null;
  }
  clear() {
    this.loads.length = 0;
  }
};

// engine/native/device-ports.ts
var GP0 = 528488464;
var GPUSTAT = 528488468;
var DMA2_MADR = 528486560;
var DMA2_BCR = 528486564;
var DMA2_CHCR = 528486568;
var GPUSTAT_DMA_READY = 67108864;
function installDevicePorts(mem) {
  const scratch = { madr: 0, bcr: 0, chcr: 0 };
  mem.devices = {
    read(addr) {
      switch (addr >>> 0) {
        case GPUSTAT:
          return GPUSTAT_DMA_READY | 469762048;
        case GP0:
          return 0;
        case DMA2_MADR:
          return scratch.madr | 0;
        case DMA2_BCR:
          return scratch.bcr | 0;
        case DMA2_CHCR:
          return scratch.chcr & ~16777216;
        default:
          return void 0;
      }
    },
    write(addr, value) {
      switch (addr >>> 0) {
        case GP0:
        case GPUSTAT:
          return true;
        // GP0/GP1 writes are device state, not RAM
        case DMA2_MADR:
          scratch.madr = value | 0;
          return true;
        case DMA2_BCR:
          scratch.bcr = value | 0;
          return true;
        case DMA2_CHCR:
          scratch.chcr = value | 0;
          return true;
        default:
          return false;
      }
    }
  };
}

// engine/native/runtime.ts
var OVERLAY_BASE = 2148163040;
var FIELDSTG_BASE = 2148019376;
var EFFECT_REGISTRY = 2148119528;
var DESCRIPTOR_BANK = 2148113792;
var CTX_FILL = 2147612232;
var FRAME_DELTA_ALT = 2147604212;
var SET_DE30 = 2147604564;
var GET_DE30 = 2147604548;
var LAYER_LOOKUP = 2147605124;
var START_EVENT = 2148029432;
var GETTER_48 = 2147584084;
var GETTER_4E = 2147584120;
var GETTER_A4 = 2147584384;
var OBJ_LOOKUP = 2147582220;
var SFX_PLAY = 2147614828;
var RESOURCE_GET_BASE = 2147565148;
var RESOLVER = 2147565784;
var GLOBAL_SEEDS = [
  [2147802984, GET_DE30],
  [2147802988, SET_DE30],
  [2147803020, LAYER_LOOKUP],
  [2147803032, FRAME_DELTA_ALT],
  [2147766108, RESOLVER],
  [2147766092, RESOURCE_GET_BASE],
  [2147792828, OBJ_LOOKUP],
  [2147793860, GETTER_48],
  [2147793880, GETTER_A4],
  [2147834952, SFX_PLAY]
];
var ZONEMGR = 2148120260;
var ZONEMGR_SET = 2148083916;
var ZONEMGR_COMMIT = 2148083940;
var SIN_FN = 2147658700;
var COS_FN = 2147658908;
var SIN_TABLE_BASE = 2147836040;
var LOAD_IMAGE = 2147638036;
var GRANT_CARD = 2147577388;
var SND_OBJ_CTOR = 2147614632;
var SND_METHOD_BASE = 265289728;
var POINT_REBIND = 2148046152;
var LAYER_METHOD_SLOTS = [
  [28, 2147581804],
  [48, 2147653968],
  [52, 2147581804],
  [56, 2147566652],
  [60, 2147693780],
  [72, 2147604956],
  [84, 2147604496],
  [272, 2147606704],
  [276, 2147606716],
  [280, 2147606616],
  [284, 2147606628],
  [288, 2147606664],
  [292, 2147606676],
  [296, 2147606728],
  [300, 2147606568],
  [304, 2147606120],
  [308, 2147605920],
  [312, 2147606440],
  [316, 2147606476],
  [320, 2147606524],
  [324, 2147606556],
  [328, 2147607016],
  [332, 2147607104],
  [336, 2147607332],
  [340, 2147607436],
  [344, 2147607664],
  [348, 2147607556],
  [352, 2147607900],
  [356, 2147607796],
  [360, 2147606808],
  [476, 2147566196],
  [480, 2147566216],
  [484, 2147566232],
  [488, 2147566244],
  [492, 2147566252],
  [496, 2147566280],
  [500, 2147566304],
  [504, 2147566324],
  [512, 2147566344],
  [568, 2148032268],
  [572, 2148032312],
  [588, 2148022724],
  [592, 2148023164],
  [596, 2148023164],
  [600, 2148022744],
  [604, 2148022764],
  [608, 2148022784],
  [612, 2148022804],
  [616, 2148022824],
  [620, 2148022844],
  [624, 2148022864],
  [628, 2148022880],
  [632, 2148023164],
  [636, 2148023164],
  [640, 2148023164],
  [644, 2148023164],
  [648, 2148022900],
  [652, 2148022920],
  [656, 2148023164],
  [660, 2148022940],
  [664, 2148022960],
  [668, 2148022980],
  [672, 2148023e3],
  [676, 2148023164],
  [680, 2148023020],
  [684, 2148023040],
  [688, 2148023060],
  [692, 2148023080],
  [696, 2148023100],
  [700, 2148023120],
  [704, 2148023164],
  [708, 2148023140],
  [712, 2148023912],
  [716, 2148024004],
  [720, 2148024108],
  [724, 2148024236],
  [728, 2148024108],
  [732, 2148024548],
  [736, 2148025132],
  [740, 2148025168],
  [744, 2148025416],
  [748, 2148025884],
  [752, 2148025972],
  [756, 2148025132],
  [760, 2148025132],
  [764, 2148025132],
  [768, 2148025132],
  [772, 2148025132],
  [776, 2148025996],
  [780, 2148026128],
  [784, 2148027412],
  [788, 2148027424],
  [792, 2148027424],
  [796, 2148027412],
  [800, 2148027424],
  [804, 2148027424],
  [808, 2148027424],
  [812, 2148027412],
  [816, 2148027424],
  [820, 2148027412],
  [824, 2148027424],
  [828, 2148027412],
  [832, 2148027424],
  [836, 2148027424],
  [840, 2148027424],
  [844, 2148027424],
  [848, 2148027424],
  [852, 2148027412],
  [856, 2148027424],
  [860, 2148027412],
  [864, 2148027424],
  [868, 2148027412],
  [872, 2148027424],
  [876, 2148027412],
  [880, 2148027424],
  [884, 2148027412],
  [888, 2148027412],
  [892, 2148027424],
  [896, 2148027424],
  [900, 2148027412],
  [904, 2148027424],
  [908, 2148027412],
  [912, 2148027412],
  [916, 2148027412],
  [920, 2148027412],
  [924, 2148028496],
  [928, 2148028528],
  [932, 2148028712],
  [936, 2148028812],
  [940, 2148028496],
  [944, 2148028496],
  [948, 2148029124],
  [956, 2148028856],
  [960, 2148028912],
  [964, 2148028936],
  [968, 2148028992],
  [972, 2148029056],
  [976, 2148039292],
  [980, 2148039328],
  [984, 2148039384],
  [988, 2148039400],
  [992, 2148039440],
  [996, 2148041768],
  [1e3, 2148041812],
  [1004, 2148041968],
  [1008, 2148041840],
  [1012, 2148041968],
  [1016, 2148041968],
  [1020, 2148041884],
  [1024, 2148041904],
  [1028, 2148041936],
  [1036, 2148042060],
  [1040, 2148042036],
  [1044, 2148042036],
  [1048, 2148042044],
  [1052, 2148042028],
  [1056, 2148042028],
  [1060, 2148042052],
  [1076, 2148042272],
  [1080, 2148042544],
  [1084, 2148042608]
];
var LAYER_GET_SCROLL = 2147606628;
var LAYER_SET_SCROLL = 2147606664;
var LAYER_OT_BUCKET = 2147606440;
var LAYER_ENQUEUE = 2147607104;
var CACHE_TICK = 2147564764;
var CACHE_TRANSFER = 2147563796;
var CACHE_SLOTS = 2147765052;
var SLOT_COUNT = 64;
var SLOT_STRIDE = 16;
var LBA_LEN_SECTORS = 2147775652;
var ALLOC_FROM_FREE_LIST = 2147581228;
var FREE_PTR = 2147792364;
var RECORD_TABLE = 2147792848;
var FRAME_DELTA_VALUE = 2147802664;
var FRAME_DELTA_ALT_VALUE = 2147802656;
var PROGRESS_ORDINAL = 2147791728;
var PACKET_ARENA = 2148794368;
var VSYNC = 2147674108;
var VBLANK_COUNT = 2147860504;
var GTE_CTRL_SETTERS = [2147660780, 2147660812];
var TITLE_REGION_TABLE = 2148041292;
var TITLE_LOGO_CELL = 2148041268;
var LANGUAGE_INDEX = 2147863720;
var AUDIO_BANK_PENDING = 2147615804;
var BIOS_FOPEN = 2147635372;
var BIOS_FREAD = 2147635388;
var BIOS_FWRITE = 2147635404;
var BIOS_FCLOSE = 2147635420;
var PAD_RECORDS = 2147792920;
var PAD_PORT_STRIDE = 448;
var NativeStageRuntime = class {
  mem;
  cpu;
  world;
  /** Where this overlay image is mapped. Stage overlays use OVERLAY_BASE;
   *  screen overlays load in the resident slot (0x80082cb0). */
  overlayBase;
  drawCalls = [];
  /** Indices in `drawCalls` where a new picture service was constructed. */
  ctxMarkers = [];
  sfx = [];
  /** Textured quads captured from the GPU packet cursor this frame. */
  screenQuads = [];
  /** Single textured sprites (the card faces) captured from the same cursor. */
  cardPrims = [];
  /** VRAM uploads the console's LoadImage would have written. */
  vram = new VramMap();
  /** load_texture(slot, packed-id) requests the stage init makes. */
  resources = [];
  /** start_event(id) calls native code made (bridged to the engine via host). */
  events = [];
  disabled = [];
  /** Trap raised during boot (root ctor/init), if any. */
  bootTrap = null;
  /**
   * Run the original screen object manager's lifecycle rule (F0x80018140): an
   * object whose +0xC reads 3 at the top of its turn is destroyed instead of
   * ticked, and the parent's child-array slot becomes NULL. Default off so the
   * coverage probe and differential gate keep their recorded flat-tick
   * behaviour; the production browser host turns it on.
   */
  objectLifecycle = false;
  deadCbs = /* @__PURE__ */ new Set();
  renderJobs = [];
  overlayEnd;
  fieldstgEnd = FIELDSTG_BASE;
  // exclusive; == base when not loaded
  residentEnd = 0;
  // resident EXE image (screens); 0 when not loaded
  heap = null;
  // screen buffer arena (null for stages)
  bridgeServices = null;
  constructor(overlay, manifest, host, exeTables, fieldstg, overlayBase = OVERLAY_BASE, resident) {
    this.overlayBase = overlayBase >>> 0;
    this.mem = new NativeMemory();
    installDevicePorts(this.mem);
    if (resident) {
      this.mem.load(resident.image, resident.base);
      this.residentEnd = resident.base + resident.image.length >>> 0;
    }
    if (fieldstg) {
      this.mem.load(fieldstg, FIELDSTG_BASE);
      this.fieldstgEnd = FIELDSTG_BASE + fieldstg.length;
    }
    this.mem.load(overlay, this.overlayBase);
    if (exeTables) {
      for (let i = 0; i < exeTables.halfwords.length; i++) {
        this.mem.write16(exeTables.sin_table_base + i * 2, exeTables.halfwords[i]);
      }
    }
    this.overlayEnd = this.overlayBase + manifest.size;
    this.cpu = new R3000(this.mem);
    this.hostRef = host;
    this.world = installCoreStubs(this.cpu, host);
    installDrawStubs(this.cpu, (c) => this.drawCalls.push(c));
    this.installRuntimeStubs(host);
    this.cpu.execGuard = (pc) => pc >= this.overlayBase && pc < this.overlayEnd || pc >= FIELDSTG_BASE && pc < this.fieldstgEnd || this.residentEnd !== 0 && pc >= 2147549184 && pc < this.residentEnd;
    this.manifest = manifest;
  }
  manifest;
  /**
   * TypeScript services the mixed-mode bridge hands to translated ports that
   * allocate (engine/native/bridge.ts). Null on stage runtimes, where the
   * allocator stub is not installed, so service-needing entries are skipped
   * rather than diverging.
   */
  get services() {
    return this.bridgeServices;
  }
  installRuntimeStubs(host) {
    const mem = this.mem;
    const fieldstgLoaded = this.fieldstgEnd !== FIELDSTG_BASE;
    for (const [g, target] of GLOBAL_SEEDS) mem.write32(g, target);
    if (fieldstgLoaded) {
      mem.write32(ZONEMGR + 64, ZONEMGR_SET);
      mem.write32(ZONEMGR + 80, ZONEMGR_COMMIT);
      cpuStub(this.cpu, ZONEMGR_SET, (c) => {
        const slot = c.reg(4), id = c.reg(5);
        this.resources.push({ slot, id: id >>> 0 });
        if (slot >= 0 && slot < 16) mem.write32(ZONEMGR + slot * 4, id);
        return 0;
      });
      cpuStub(this.cpu, ZONEMGR_COMMIT, () => 0);
    }
    cpuStub(this.cpu, CTX_FILL, (c) => {
      const ctx = c.reg(4) >>> 0;
      for (let i = 0; i < 160; i += 4) mem.write32(ctx + i, 0);
      mem.write32(ctx + 56, 4096);
      mem.write32(ctx + 60, 4096);
      mem.write32(ctx + 64, 4096);
      mem.write32(ctx + 36, 1);
      mem.write8(ctx + 40, 128);
      mem.write8(ctx + 41, 128);
      mem.write8(ctx + 42, 128);
      mem.write32(ctx + 112, 2147609776);
      mem.write32(ctx + 116, 2147609788);
      mem.write32(ctx + 120, 2147609816);
      mem.write32(ctx + 124, 2147609908);
      mem.write32(ctx + 128, 2147609848);
      mem.write32(ctx + 132, 2147609964);
      mem.write32(ctx + 136, 2147609836);
      mem.write32(ctx + 140, 2147612112);
      mem.write32(ctx + 144, 2147612140);
      mem.write32(ctx + 148, 2147612168);
      mem.write32(ctx + 152, 2147612188);
      mem.write32(ctx + 156, 2147612200);
      this.ctxMarkers.push(this.drawCalls.length);
    });
    cpuStub(this.cpu, FRAME_DELTA_ALT, () => mem.read32(FRAME_DELTA_ALT_VALUE));
    cpuStub(this.cpu, SET_DE30, (c) => {
      const end = c.reg(4) >>> 0;
      const start = mem.read32(2147802672) >>> 0;
      this.captureScreenQuads(end);
      this.captureCardPrim(start, end);
      mem.write32(2147802672, end);
    });
    cpuStub(this.cpu, GET_DE30, () => mem.read32(2147802672));
    mem.write32(2147802672, PACKET_ARENA);
    const layerObjs = /* @__PURE__ */ new Map();
    let layerScratch = 2149384192;
    let otScratch = 2149056512;
    const layerMethodNames = /* @__PURE__ */ new Map();
    for (const [off, addr] of LAYER_METHOD_SLOTS) {
      if (!layerMethodNames.has(addr)) layerMethodNames.set(addr, `layer+0x${off.toString(16)}`);
    }
    if (fieldstgLoaded) {
      for (const [addr, name] of layerMethodNames) {
        if (addr === LAYER_GET_SCROLL || addr === LAYER_SET_SCROLL || addr === LAYER_OT_BUCKET || addr === LAYER_ENQUEUE) continue;
        if (addr >= 2147566196 && addr <= 2147566344) continue;
        cpuStub(this.cpu, addr, (c) => {
          this.drawCalls.push({ method: name, args: [c.reg(4), c.reg(5), c.reg(6), c.reg(7)] });
          return 0;
        });
      }
    }
    cpuStub(this.cpu, LAYER_GET_SCROLL, (c) => {
      const o = c.reg(4), out = c.reg(5);
      mem.write32(out, mem.read32(o + 112) >> 8);
      mem.write32(out + 4, mem.read32(o + 116) >> 8);
    });
    cpuStub(this.cpu, LAYER_SET_SCROLL, (c) => {
      const o = c.reg(4);
      mem.write32(o + 112, c.reg(5));
      mem.write32(o + 116, c.reg(6));
    });
    cpuStub(this.cpu, LAYER_OT_BUCKET, () => {
      otScratch += 2048;
      if (otScratch >= 2149187584) otScratch = 2149056512;
      return otScratch;
    });
    cpuStub(this.cpu, LAYER_ENQUEUE, (c) => {
      this.renderJobs.push({
        cb: c.reg(5) >>> 0,
        obj: c.reg(6) >>> 0,
        extra: mem.read32((c.reg(29) >>> 0) + 16) >>> 0
      });
      return 0;
    });
    if (fieldstgLoaded) {
      cpuStub(this.cpu, LAYER_LOOKUP, (c) => {
        const id = c.reg(4);
        let obj = layerObjs.get(id);
        if (obj === void 0) {
          obj = layerScratch;
          layerScratch += 1088;
          for (let off = 0; off < 1088; off += 4) mem.write32(obj + off, 0);
          for (const [off, addr] of LAYER_METHOD_SLOTS) mem.write32(obj + off, addr);
          layerObjs.set(id, obj);
        }
        return obj;
      });
    }
    const tab = (idx) => mem.read16s(SIN_TABLE_BASE + idx * 2);
    const quarterSin = (a2) => {
      if (a2 <= 1024) return tab(a2);
      if (a2 <= 2048) return tab(2048 - a2);
      return a2 <= 3072 ? -tab(a2 - 2048) : -tab(4096 - a2);
    };
    cpuStub(this.cpu, SIN_FN, (c) => {
      const a2 = c.reg(4);
      return a2 >= 0 ? quarterSin(a2 & 4095) : -quarterSin(-a2 & 4095);
    });
    cpuStub(this.cpu, COS_FN, (c) => {
      const a2 = Math.abs(c.reg(4)) & 4095;
      if (a2 <= 1024) return tab(1024 - a2);
      if (a2 <= 2048) return -tab(a2 - 1024);
      return a2 <= 3072 ? -tab(3072 - a2) : tab(a2 - 3072);
    });
    if (fieldstgLoaded) {
      for (let i = 0; i < 6; i++) {
        const slot = 28 + i * 4;
        cpuStub(this.cpu, SND_METHOD_BASE + i * 4, (c) => {
          this.drawCalls.push({ method: `snd+0x${slot.toString(16)}`, args: [c.reg(4), c.reg(5), c.reg(6), c.reg(7)] });
          return 0;
        });
      }
      cpuStub(this.cpu, SND_OBJ_CTOR, (c) => {
        const o = c.reg(4) >>> 0;
        for (let i = 0; i < 52; i += 4) mem.write32(o + i, 0);
        for (let i = 0; i < 6; i++) mem.write32(o + 28 + i * 4, SND_METHOD_BASE + i * 4);
        mem.write32(o + 24, 43008);
        return o;
      });
    }
    cpuStub(this.cpu, LOAD_IMAGE, (c) => {
      const rect = c.reg(4) >>> 0;
      this.vram.upload(
        mem.read16(rect) | 0,
        mem.read16(rect + 2) | 0,
        mem.read16(rect + 4) | 0,
        mem.read16(rect + 6) | 0,
        c.reg(5) >>> 0,
        8,
        // card artwork is 8-bit per texel; the palette upload is a second call
        false,
        (addr) => mem.read8(addr)
      );
      return 0;
    });
    if (fieldstgLoaded) {
      cpuStub(this.cpu, POINT_REBIND, (c) => {
        mem.write32(2148120828, c.reg(4));
        mem.write32(2148120824, mem.read32(2148113808));
        return 0;
      });
      cpuStub(this.cpu, START_EVENT, (c) => {
        const id = c.reg(4);
        this.events.push(id);
        host.startEvent?.(id);
        return 0;
      });
    }
    if (this.residentEnd !== 0) {
      for (let port = 0; port < 2; port++) {
        for (let slot = 0; slot < 4; slot++) {
          const rec = RECORD_TABLE + port * PAD_PORT_STRIDE + slot * 112;
          for (let n = 0; n < 16; n++) mem.write8(rec + 164 + n, n);
        }
      }
      this.heap = new ScreenHeap(mem);
      const heap = this.heap;
      const world = this.world;
      const startTransfer = (id, buf) => {
        id &= 65535;
        const sectors = mem.read16(LBA_LEN_SECTORS + id * 2);
        const bytes = Math.min(sectors << 11 >>> 0, 2097152);
        if (buf >>> 0 >= 2147483648 && bytes > 0) {
          if (host.readBank) host.readBank(id, buf >>> 0, bytes);
          else for (let a2 = 0; a2 < bytes; a2 += 4) mem.write32(buf + a2, 0);
        }
      };
      this.bridgeServices = {
        startTransfer,
        alloc: (size, align) => heap.alloc(size, align),
        free: () => {
        },
        carve: (size) => world.carve(size),
        allocObject: (cb, size, extraSize, id) => world.alloc(cb, size, extraSize, id)
      };
      cpuStub(this.cpu, ALLOC_FROM_FREE_LIST, (c) => heap.allocLowLevel(c.reg(4) >>> 0));
      const FREE_STUB = 265355264;
      cpuStub(this.cpu, FREE_STUB, () => 0);
      mem.write32(FREE_PTR, FREE_STUB);
      cpuStub(this.cpu, CACHE_TRANSFER, () => {
        for (let i = 0; i < SLOT_COUNT; i++) {
          const slot = CACHE_SLOTS + i * SLOT_STRIDE;
          if (mem.read32(slot) !== 1) continue;
          const id = mem.read32(slot + 4) & 65535;
          const buf = mem.read32(slot + 12) >>> 0;
          startTransfer(id, buf);
          break;
        }
        return 0;
      });
      let vblank = 0;
      cpuStub(this.cpu, VSYNC, (c) => {
        if (c.reg(4) < 0) {
          vblank = vblank + 1 >>> 0;
          mem.write32(VBLANK_COUNT, vblank);
          return vblank | 0;
        }
        return mem.read32(VBLANK_COUNT) | 0;
      });
      for (const addr of GTE_CTRL_SETTERS) cpuStub(this.cpu, addr, () => 0);
      cpuStub(this.cpu, 0, () => 0);
      cpuStub(this.cpu, AUDIO_BANK_PENDING, () => 0);
      if (mem.read32(TITLE_REGION_TABLE) === 142999553) {
        const lang = mem.read32(LANGUAGE_INDEX) & 7;
        mem.write32(TITLE_LOGO_CELL, mem.read32(TITLE_REGION_TABLE + lang * 8 + 4) >>> 0);
      }
      cpuStub(this.cpu, BIOS_FOPEN, () => -1);
      cpuStub(this.cpu, BIOS_FREAD, () => 0);
      cpuStub(this.cpu, BIOS_FWRITE, () => 0);
      cpuStub(this.cpu, BIOS_FCLOSE, () => 0);
    }
    cpuStub(this.cpu, GETTER_48, (c) => mem.read16(RECORD_TABLE + c.reg(4) * 448 + 72));
    cpuStub(this.cpu, GETTER_4E, (c) => mem.read16(RECORD_TABLE + c.reg(4) * 448 + 78));
    cpuStub(this.cpu, GETTER_A4, (c) => mem.read8(RECORD_TABLE + c.reg(4) * 448 + c.reg(5) + 164));
    cpuStub(this.cpu, OBJ_LOOKUP, () => 0);
    cpuStub(this.cpu, RESOLVER, () => 2149449728);
    if (this.residentEnd === 0) cpuStub(this.cpu, RESOURCE_GET_BASE, () => 0);
    cpuStub(this.cpu, SFX_PLAY, (c) => {
      const id = c.reg(4) >>> 0;
      this.sfx.push(id);
      host.playPackedSound?.(id);
      host.log?.(`sfx 0x${id.toString(16)}`);
      return 0;
    });
  }
  hostRef = null;
  /** Host-supplied held button words, one per controller port (screens). */
  padHeld = [0, 0];
  padPrev = [0, 0];
  /** Per physical bit: tick of the last repeat pulse and its credit ladder
   *  (docs/research/ui/pad-input-service-behaviour-2026-08-21.md: rate 16,
   *  credit +10 saturating at 12, release resets). */
  padLast = [new Int32Array(16), new Int32Array(16)];
  padCredit = [new Int32Array(16), new Int32Array(16)];
  padTick = 0;
  /** Parse the 40 textured quads the screen builder just wrote before SET_DE30.
   *  Bounds come from the decoded builder: stride 0x28, vertices at +8/+0x10/
   *  +0x18/+0x20, uv at +0xC/+0x14/+0x1C/+0x24, CLUT +0xE, texpage +0x16,
   *  command byte +7. The batch is contiguous and exactly 40 quads long; if the
   *  memory before the published cursor does not carry that shape (a different
   *  prim writer moved the cursor), nothing is captured. */
  captureScreenQuads(end) {
    const mem = this.mem;
    const base = end - 40 * 40 >>> 0;
    const looksQuad = (a2) => mem.read8(a2 + 3) === 9 && mem.read8(a2 + 4) === 128 && mem.read8(a2 + 5) === 128 && mem.read8(a2 + 6) === 128 && (mem.read8(a2 + 7) === 44 || mem.read8(a2 + 7) === 46);
    for (let i = 0; i < 40; i++) {
      if (!looksQuad(base + i * 40)) return;
    }
    for (let i = 0; i < 40; i++) {
      const a2 = base + i * 40;
      this.screenQuads.push({
        cmd: mem.read8(a2 + 7),
        x: [mem.read16s(a2 + 8), mem.read16s(a2 + 16), mem.read16s(a2 + 24), mem.read16s(a2 + 32)],
        y: [mem.read16s(a2 + 10), mem.read16s(a2 + 18), mem.read16s(a2 + 26), mem.read16s(a2 + 34)],
        u: [mem.read8(a2 + 12), mem.read8(a2 + 20), mem.read8(a2 + 28), mem.read8(a2 + 36)],
        v: [mem.read8(a2 + 13), mem.read8(a2 + 21), mem.read8(a2 + 29), mem.read8(a2 + 37)],
        texpage: mem.read16(a2 + 22),
        clut: mem.read16(a2 + 14)
      });
    }
  }
  /** Parse the single 0x1C-byte sprite + DR_TPAGE the card class's +0x34 emit
   *  publishes (accepted vram-sample-contract section 2): the range is exactly
   *  0x1C bytes, byte +3 is the tag size, +4..+6 the neutral tint, +7 the sprite
   *  command (0x64/0x66) and +0x18 the DR_TPAGE parameter. Anything else is a
   *  different prim writer and is left alone. */
  captureCardPrim(start, end) {
    const mem = this.mem;
    const len = end - start >>> 0;
    if (len !== 28) return;
    const a2 = start >>> 0;
    if (mem.read8(a2 + 3) !== 4) return;
    if (mem.read8(a2 + 4) !== 128 || mem.read8(a2 + 5) !== 128 || mem.read8(a2 + 6) !== 128) return;
    const cmd = mem.read8(a2 + 7);
    if (cmd !== 100 && cmd !== 102) return;
    const tpageWord = mem.read32(a2 + 24) >>> 0;
    if (tpageWord >>> 24 !== 225) return;
    this.cardPrims.push({
      cmd,
      x: mem.read16s(a2 + 8),
      y: mem.read16s(a2 + 10),
      u: mem.read8(a2 + 12),
      v: mem.read8(a2 + 13),
      clut: mem.read16(a2 + 14),
      tpage: tpageWord & 511
    });
  }
  /**
   * The card grant (fixture seed): call the shipped grant routine F0x80016E2C
   * for one card id, which sets the album's "ever obtained" flag at
   * save + id + 0x4DF and adds to the copies-held byte at +0x3A2. This is the
   * game's own writer (its only store to that flag), so a captured run seeded
   * this way takes the same path a real obtained card does.
   */
  grantCard(id, count = 1) {
    if (this.residentEnd === 0) return false;
    this.cpu.call(GRANT_CARD, [id | 0, count | 0], 1e4);
    return true;
  }
  /** Set the held-button word for a controller port (host input service).
   *  The next tick derives the pressed edge and writes the pad record the
   *  screens read through F0x80018854/F0x80018878/F0x8001889C. */
  setPadHeld(port, buttons) {
    if (port < 0 || port >= this.padHeld.length) return;
    this.padHeld[port] = buttons & 65535;
  }
  /** Derive pressed (held & ~previous) and the 16/6/4 auto-repeat, publish the
   *  record words the screens read. Mirrors the resident poll F0x80018BCC for
   *  the shipped identity button map. */
  applyPad() {
    const mem = this.mem;
    const RATE = 16;
    this.padTick++;
    for (let port = 0; port < this.padHeld.length; port++) {
      const held = this.padHeld[port] & 65535;
      const prev = this.padPrev[port] & 65535;
      let repeat = 0;
      for (let b = 0; b < 16; b++) {
        if (held & 1 << b) {
          const due = this.padTick - this.padLast[port][b] + this.padCredit[port][b];
          if (Math.trunc(due / RATE) !== 0) {
            repeat |= 1 << b;
            this.padLast[port][b] = this.padTick;
            this.padCredit[port][b] = Math.min(this.padCredit[port][b] + 10, 12);
          }
        } else {
          this.padLast[port][b] = this.padTick;
          this.padCredit[port][b] = 0;
        }
      }
      const rec = PAD_RECORDS + port * PAD_PORT_STRIDE;
      mem.write16(rec + 0, held & ~prev);
      mem.write16(rec + 2, repeat);
      mem.write16(rec + 4, prev);
      mem.write16(rec + 6, held);
      this.padPrev[port] = held;
    }
  }
  /** Run the stage's real root constructor (initial allocs + descriptor init). */
  boot(budget = 2e6) {
    this.mem.write32(FRAME_DELTA_VALUE, 1);
    this.mem.write32(FRAME_DELTA_ALT_VALUE, 0);
    this.mem.write32(PROGRESS_ORDINAL, this.hostRef?.ordinal?.() ?? 0);
    if (this.residentEnd === 0) this.mem.write32(DESCRIPTOR_BANK + 0, 0);
    try {
      this.cpu.call(this.overlayBase + this.manifest.root_ctor, [0], budget);
      return true;
    } catch (e) {
      if (e instanceof NativeTrap) {
        this.bootTrap = { cb: this.manifest.root_ctor, pc: e.pc, reason: e.message };
        return false;
      }
      throw e;
    }
  }
  /** One frame: tick every live object's real callback (decoded convention:
   * cb(obj, extraBuf), pause-gate on obj+0x1c when state==1). */
  tick(delta = 1, budgetPerObject = 8e6) {
    const mem = this.mem;
    mem.write32(FRAME_DELTA_VALUE, delta);
    mem.write32(FRAME_DELTA_ALT_VALUE, mem.read32(FRAME_DELTA_ALT_VALUE) + delta >>> 0);
    mem.write32(PROGRESS_ORDINAL, this.hostRef?.ordinal?.() ?? 0);
    mem.write32(2147802672, PACKET_ARENA);
    if (this.residentEnd !== 0) this.applyPad();
    if (this.residentEnd !== 0) {
      try {
        this.cpu.call(CACHE_TICK, [], 5e5);
      } catch (e) {
        if (!(e instanceof NativeTrap)) throw e;
      }
    }
    this.screenQuads.length = 0;
    this.cardPrims.length = 0;
    this.renderJobs.length = 0;
    const objs = this.residentEnd !== 0 ? this.screenTickOrder([...this.world.objects]) : [...this.world.objects];
    for (const o of objs) {
      if (!o.alive || this.deadCbs.has(o.addr)) continue;
      if (this.objectLifecycle && (mem.read32(o.addr + 12) | 0) === OBJECT_LIFECYCLE_DEAD) {
        destroyTrackedObject(mem, this.world, o.addr);
        continue;
      }
      if (mem.read32(o.addr + 12) === 1) {
        const pause = mem.read32(o.addr + 28);
        if (pause !== 0) {
          if (pause > 0) mem.write32(o.addr + 28, pause - 1);
          continue;
        }
      }
      try {
        this.cpu.call(mem.read32(o.addr + 72) >>> 0, [o.addr | 0, mem.read32(o.addr + 36)], budgetPerObject);
      } catch (e) {
        if (!(e instanceof NativeTrap)) throw e;
        this.deadCbs.add(o.addr);
        this.disabled.push({ cb: o.cb, pc: e.pc, reason: e.message });
      }
    }
    for (const job of this.renderJobs) {
      if (job.cb === 0) continue;
      try {
        this.cpu.call(job.cb, [job.obj | 0, job.extra | 0], budgetPerObject);
      } catch (e) {
        if (!(e instanceof NativeTrap)) throw e;
        this.disabled.push({ cb: job.cb, pc: e.pc, reason: `draw: ${e.message}` });
      }
    }
  }
  /**
   * Screen tick order, matching the original schedule. F0x80018140 calls an
   * object's +0x48 handler, then F0x80018230 walks its +0x20 count over the
   * +0x24 array in ascending index order and ticks each child the same way.
   * We reproduce that as a depth-first walk: each not-yet-visited object is
   * visited, then the tracked objects its +0x24 array names, in array order.
   * Roots first in allocation order, then anything the arrays never named, so
   * no live object is dropped. Only pointers that name a tracked object are
   * followed, so a +0x20 word that is not an array count cannot invent order.
   */
  screenTickOrder(objs) {
    const mem = this.mem;
    const byAddr = /* @__PURE__ */ new Map();
    for (const o of objs) byAddr.set(o.addr >>> 0, o);
    const visited = /* @__PURE__ */ new Set();
    const order = [];
    const visit = (o) => {
      const addr = o.addr >>> 0;
      if (visited.has(addr)) return;
      visited.add(addr);
      order.push(o);
      const count = mem.read32(o.addr + 32) | 0;
      if (count <= 0 || count > 64) return;
      const array = mem.read32(o.addr + 36) >>> 0;
      if (array < 2147549184 || array >= 2149580800) return;
      for (let i = 0; i < count; i++) {
        const child = byAddr.get(mem.read32(array + i * 4) >>> 0);
        if (child) visit(child);
      }
    };
    for (const o of objs) visit(o);
    return order;
  }
  get liveObjects() {
    return this.world.objects.filter((o) => o.alive && !this.deadCbs.has(o.addr));
  }
  /**
   * Fire an effect id (the script's SETANIM ≥ 0x320 path). Fieldstg
   * F0x80084dd0 first looks up a live object by id, otherwise constructs one
   * into a free cutscene effect slot, then calls
   * F0x800924c8(obj,id,anim,facing). The
   * registry's +8 function receives only (obj,anim,facing). Either registry
   * function may be null; the id is still consumed when an entry exists.
   */
  fireEffect(id, anim = 0, facing = 0) {
    if (this.fieldstgEnd === FIELDSTG_BASE) return false;
    let entry = 0;
    for (let a2 = EFFECT_REGISTRY; ; a2 += 12) {
      const eid = this.mem.read32(a2) >>> 0;
      if (eid === 0) return false;
      if (eid === id) {
        entry = a2;
        break;
      }
    }
    const ctor = this.mem.read32(entry + 4) >>> 0;
    const draw = this.mem.read32(entry + 8) >>> 0;
    try {
      let nativeObj = this.world.objects.find(
        (o) => o.id === id && o.alive && !this.deadCbs.has(o.addr)
      );
      if (!nativeObj && ctor !== 0) {
        const obj = this.cpu.call(ctor, [id]) >>> 0;
        nativeObj = this.world.objects.find((o) => o.addr === obj && o.alive);
      }
      if (nativeObj && draw !== 0) this.cpu.call(draw, [nativeObj.addr | 0, anim, facing]);
      return true;
    } catch (e) {
      if (!(e instanceof NativeTrap)) throw e;
      this.disabled.push({ cb: ctor, pc: e.pc, reason: `fireEffect(0x${id.toString(16)}): ${e.message}` });
      return false;
    }
  }
};
function cpuStub(cpu, addr, fn) {
  cpu.setStub(addr, fn);
}

// engine/dw3/zero-fill.ts
function zeroFill(mem, dest, length) {
  const len = length | 0;
  if ((len & 3) !== 0) {
    if (len <= 0) return;
    for (let i = 0; i < len; i++) mem.write8(dest + i, 0);
    return;
  }
  const words = len >> 2;
  if (words <= 0) return;
  for (let i = 0; i < words; i++) mem.write32(dest + i * 4, 0);
}

// engine/dw3/byte-ops.ts
function memcpyBytes(mem, dest, src, n) {
  if (dest === 0) return 0;
  const count = n | 0;
  for (let i = 0; i < count; i++) {
    mem.write8(dest + i, mem.read8(src + i) & 255);
  }
  return dest >>> 0;
}
function strlenBytes(mem, ptr) {
  if (ptr === 0) return 0;
  let n = 0;
  while ((mem.read8(ptr + n) & 255) !== 0) n += 1;
  return n;
}
function strcpyBytes(mem, dest, src) {
  if (dest === 0 || src === 0) return 0;
  let i = 0;
  for (; ; ) {
    const b = mem.read8(src + i) & 255;
    mem.write8(dest + i, b);
    i += 1;
    if (b === 0) break;
  }
  return dest >>> 0;
}

// engine/dw3/ui/int-to-decimal.ts
function intToDecimalAscii(mem, dest, value) {
  const v = value | 0;
  if (v <= 0) {
    mem.write8(dest, 48);
    return;
  }
  let stripped = v;
  let digits = 0;
  let place = 10;
  do {
    digits += 1;
    stripped -= stripped % place;
    place = place * 10 | 0;
  } while (stripped !== 0);
  let rest = v;
  do {
    const rem = rest % 10;
    rest = (rest - rem) / 10;
    digits -= 1;
    mem.write8(dest + digits, rem + 48);
  } while (rest !== 0);
}

// engine/dw3/ui/text-decode.ts
var TEXT_FONT = {
  tableA: 12,
  tableB: 16,
  basicLimit: 20,
  extCount: 22
};
var TEXT_TOKEN_END = 1024;
var TEXT_TOKEN_INVALID = 768;
var TEXT_TOKEN_NEWLINE = 513;
var TEXT_TABLE_ENTRY = 4;
var TEXT_TABLE_TERMINATOR = 65535;
var s16 = (v) => v << 16 >> 16;
function tableLookup(mem, table, key2, firstOffset, tag) {
  let entry = table + firstOffset >>> 0;
  if (mem.read16(entry) === TEXT_TABLE_TERMINATOR) return TEXT_TOKEN_INVALID;
  for (; ; ) {
    if ((key2 & 65535) === mem.read16(entry)) {
      return (mem.read8(entry + 2) & 255 | tag) >>> 0;
    }
    const next = entry + TEXT_TABLE_ENTRY >>> 0;
    if (mem.read16(next) === TEXT_TABLE_TERMINATOR) return TEXT_TOKEN_INVALID;
    entry = next;
  }
}
function decodeTextToken(mem, ptr, convert, font) {
  const b0 = mem.read8(ptr) & 255;
  if (b0 === 0) return TEXT_TOKEN_END;
  if ((convert & 255) !== 0) {
    if (b0 < 4) {
      return s16((b0 << 8 | mem.read8(ptr + 1) & 255) & 65535);
    }
    if (b0 === 10) return TEXT_TOKEN_NEWLINE;
    const key2 = (b0 << 8 | mem.read8(ptr + 1) & 255) & 65535;
    if ((key2 + 32177 & 65535) < 326) {
      return tableLookup(mem, mem.read32(font + TEXT_FONT.tableA) >>> 0, key2, 16, 0);
    }
    return tableLookup(mem, mem.read32(font + TEXT_FONT.tableB) >>> 0, key2, 0, 256);
  }
  if (b0 === 1) {
    const b1 = mem.read8(ptr + 1) & 255;
    const limit = mem.read16s(font + TEXT_FONT.extCount);
    if (limit < b1) {
      return (mem.read16(font + TEXT_FONT.extCount) + 1 & 255 | 256) >>> 0;
    }
    return s16((1 << 8 | b1) & 65535);
  }
  if (b0 >= 4) {
    return b0 < mem.read16s(font + TEXT_FONT.basicLimit) ? b0 : TEXT_TOKEN_INVALID;
  }
  return s16((b0 << 8 | mem.read8(ptr + 1) & 255) & 65535);
}

// engine/dw3/ui/text-element-setters.ts
var TEXT_ELEMENT = {
  unk58: 88,
  unk62: 98,
  unkA4: 164,
  unkA6: 166,
  unkA8: 168,
  unkAA: 170,
  unkB0: 176,
  unkB2: 178,
  unkB4: 180,
  unkB6: 182,
  unkBF: 191,
  unkC0: 192,
  unkC1: 193,
  unkC2: 194,
  unkC8: 200
};
function setTextScroll(mem, self, a1) {
  const v = a1 | 0;
  if (v > 0) {
    mem.write16(self + TEXT_ELEMENT.unkA4, 0);
    mem.write16(self + TEXT_ELEMENT.unkA8, 0);
    mem.write16(self + TEXT_ELEMENT.unkAA, v & 65535);
    mem.write16(self + TEXT_ELEMENT.unkA6, 0);
    return;
  }
  const unk62 = mem.read16(self + TEXT_ELEMENT.unk62);
  mem.write16(self + TEXT_ELEMENT.unkA8, 0);
  mem.write16(self + TEXT_ELEMENT.unkAA, 0);
  mem.write16(self + TEXT_ELEMENT.unkA4, unk62 & 65535);
}
function setTextWidgetOrigin(mem, self, x, y) {
  mem.write16(self + TEXT_ELEMENT.unkB0, x & 65535);
  mem.write16(self + TEXT_ELEMENT.unkB2, y & 65535);
}
function set_unk_0xc0_fns_8001a1f4(mem, self, v) {
  mem.write8(self + TEXT_ELEMENT.unkC0, v & 255);
}
function setVectorAndActiveFlag(mem, self, x, y) {
  const x32 = x | 0;
  const y32 = y | 0;
  if (x32 << 16 !== 0 || y32 << 16 !== 0) {
    mem.write8(self + TEXT_ELEMENT.unkC2, 1);
    mem.write16(self + TEXT_ELEMENT.unkB4, x32 & 65535);
    mem.write16(self + TEXT_ELEMENT.unkB6, y32 & 65535);
    return;
  }
  mem.write8(self + TEXT_ELEMENT.unkC2, 0);
  mem.write16(self + TEXT_ELEMENT.unkB4, 0);
  mem.write16(self + TEXT_ELEMENT.unkB6, 0);
}
function setTextElementFlagC1(mem, self, v) {
  const unk62 = mem.read16(self + TEXT_ELEMENT.unk62) << 16 >> 16;
  if (unk62 !== 0) {
    mem.write8(self + TEXT_ELEMENT.unkC1, v & 255);
    return;
  }
  mem.write8(self + TEXT_ELEMENT.unkC1, 0);
}
function set_unk_0xc8_fns_8001a418(mem, self, v) {
  mem.write32(self + TEXT_ELEMENT.unkC8, v | 0);
}
function set_unk_0x58_fns_8001a448(mem, self, v) {
  mem.write32(self + TEXT_ELEMENT.unk58, v | 0);
}
function set_unk_0xbf_fns_8001a450(mem, self, v) {
  mem.write8(self + TEXT_ELEMENT.unkBF, v & 255);
}
var BOOT_GP = 2147863376;
var CURRENT_FETCHER_TABLE = BOOT_GP + 456 >>> 0;
var TEXT_ELEMENT_STATE = 16;
function getUnkC3(mem, self) {
  return mem.read8(self + 195) & 255;
}
function getUnkC1(mem, self) {
  return mem.read8(self + 193) & 255;
}
function isState1(mem, self) {
  return (mem.read32(self + TEXT_ELEMENT_STATE) ^ 1) >>> 0 < 1 ? 1 : 0;
}
function setCurrentFetcherTable(mem, table) {
  mem.write32(CURRENT_FETCHER_TABLE, table | 0);
}

// engine/dw3/ui/fetch-table.ts
function fetchTableEntry(mem, base, index) {
  const count = mem.read32(base) | 0;
  if (index < 0) return 0;
  if (count < index) return 0;
  const offset = mem.read32(base + 4 + index * 4) >>> 0;
  return base + offset >>> 0;
}
var FONT_TABLE_A = 2147803152;
var FONT_TABLE_B = 2147804092;
var FETCHER_TABLE_ENTRY = 2147612484;
var FETCHER_MEASURE_ENTRY = 2147612528;
var FETCHER_CONVERT_ENTRY = 2147613216;
var bswap16 = (v) => (v >>> 8 | (v & 255) << 8) & 65535;
function initFetcherTable(mem, block) {
  zeroFill(mem, block, 12);
  mem.write32(block + 0, FETCHER_TABLE_ENTRY);
  mem.write32(block + 4, FETCHER_MEASURE_ENTRY);
  mem.write32(block + 8, FETCHER_CONVERT_ENTRY);
  setCurrentFetcherTable(mem, block);
}
function convertTextEncoding(mem, dst, src, mode) {
  const len = strlenBytes(mem, src);
  if (mode !== 0) {
    if (mode !== 1) return 1;
    const count = len >> 1;
    if (count <= 0) return 1;
    let idx2 = 0;
    let ai2 = src;
    let ao2 = dst;
    let matches = 0;
    for (; ; ) {
      let matched = 0;
      if (mem.read16(FONT_TABLE_A + 16) !== 65535) {
        const swapped = bswap16(mem.read16(ai2));
        let entry = FONT_TABLE_A + 16;
        for (; ; ) {
          if (mem.read16(entry) === swapped) {
            matches += 1;
            const byte = mem.read8(entry + 2) & 255;
            matched = 1;
            mem.write8(ao2, byte);
            ao2 += 1;
            break;
          }
          entry += 4;
          if (mem.read16(entry) === 65535) break;
        }
      }
      if (matched === 0 && mem.read16(FONT_TABLE_B + 4) !== 65535) {
        const swapped = bswap16(mem.read16(ai2));
        let entryB = FONT_TABLE_B + 4;
        let entryA = FONT_TABLE_A + 4;
        for (; ; ) {
          if (mem.read16(entryB) === swapped) {
            ao2 += 2;
            mem.write8(ao2 - 2, 1);
            const byte = mem.read8(entryA + 2) & 255;
            matches += 2;
            mem.write8(ao2 - 1, byte);
            break;
          }
          entryB += 4;
          entryA += 4;
          if (mem.read16(entryB) === 65535) break;
        }
      }
      idx2 += 1;
      if (!(idx2 < count)) return 0;
      ai2 += 2;
    }
  }
  if (len <= 0) return len;
  let idx = 0;
  let ai = src;
  let ao = dst;
  for (; ; ) {
    const b = mem.read8(ai) & 255;
    if (b >= 4) {
      if (mem.read16(FONT_TABLE_A + 16) !== 65535) {
        let entry = FONT_TABLE_A + 16;
        for (; ; ) {
          if ((mem.read8(entry + 2) & 255) === b) {
            mem.write16(ao, bswap16(mem.read16(entry)));
            ao += 2;
            break;
          }
          if (mem.read16(entry + 4) === 65535) break;
          entry += 4;
        }
      }
    } else {
      if (mem.read16(FONT_TABLE_B + 4) !== 65535) {
        const second = mem.read8(ai + 1) & 255;
        let entry = FONT_TABLE_B + 4;
        for (; ; ) {
          if ((mem.read8(entry + 2) & 255) === second) {
            mem.write16(ao, bswap16(mem.read16(entry)));
            ao += 2;
            break;
          }
          entry += 4;
          if (mem.read16(entry) === 65535) break;
        }
      }
      ai += 2;
      idx += 2;
      if (!(idx < len)) return 0;
      continue;
    }
    ai += 1;
    idx += 1;
    if (!(idx < len)) return 0;
  }
}

// engine/dw3/globals.ts
var LOAD_CELL_B400 = 2147791872;
var LOAD_CELL_B3F8 = 2147791864;
var CURRENT_VIEW_CELL = BOOT_GP + 440 >>> 0;
function loadPtrB400(mem) {
  return mem.read32(LOAD_CELL_B400) | 0;
}
function loadPtrB3F8(mem) {
  return mem.read32(LOAD_CELL_B3F8) | 0;
}
function setCurrentView(mem, value) {
  mem.write32(CURRENT_VIEW_CELL, value | 0);
}

// engine/dw3/psx-env.ts
var DRAW_AREA_WIDTH = 2147835644;
var DRAW_AREA_HEIGHT = 2147835646;
var s162 = (v) => v << 16 >> 16;
function clampDrawCoord(mem, value, limitAddr) {
  const signed = s162(value);
  if (signed < 0) return 0;
  if (s162(mem.read16(limitAddr)) - 1 < signed) {
    return (mem.read16(limitAddr) & 65535) - 1 | 0;
  }
  return value | 0;
}
function setDrawTPage(mem, drawEnv, abr, texPage, code) {
  mem.write8(drawEnv + 3, 1);
  let word = 3774873600;
  if ((texPage | 0) !== 0) word |= 512;
  let flags = (code & 2559) >>> 0;
  if ((abr | 0) !== 0) flags |= 1024;
  mem.write32(drawEnv + 4, (word | flags) >>> 0);
}
var I_MASK_PTR_ADDR = 2147860448;
function setIntrMask(mem, value) {
  const addr = mem.read32(I_MASK_PTR_ADDR) >>> 0;
  const old = mem.read16(addr) & 65535;
  mem.write16(addr, value & 65535);
  return old;
}
var DISPLAY_MODE_WORD = 2147860568;
function displayModeWord(mem) {
  return mem.read32(DISPLAY_MODE_WORD) >>> 0;
}
function setDefDrawEnv(mem, env, x, y, w, h) {
  const mode = displayModeWord(mem);
  mem.write16(env + 0, x & 65535);
  mem.write16(env + 2, y & 65535);
  mem.write16(env + 4, w & 65535);
  mem.write16(env + 12, 0);
  mem.write16(env + 14, 0);
  mem.write16(env + 16, 0);
  mem.write16(env + 18, 0);
  mem.write8(env + 25, 0);
  mem.write8(env + 26, 0);
  mem.write8(env + 27, 0);
  mem.write8(env + 22, 1);
  mem.write16(env + 6, h & 65535);
  mem.write8(env + 23, (mode !== 0 ? h < 289 : h < 257) ? 1 : 0);
  mem.write16(env + 8, x & 65535);
  mem.write16(env + 10, y & 65535);
  mem.write16(env + 20, 10);
  mem.write8(env + 24, 0);
  return env >>> 0;
}
function setDefDispEnv(mem, env, x, y, w, h) {
  mem.write16(env + 0, x & 65535);
  mem.write16(env + 2, y & 65535);
  mem.write16(env + 4, w & 65535);
  mem.write16(env + 8, 0);
  mem.write16(env + 10, 0);
  mem.write16(env + 12, 0);
  mem.write16(env + 14, 0);
  mem.write8(env + 17, 0);
  mem.write8(env + 16, 0);
  mem.write8(env + 19, 0);
  mem.write8(env + 18, 0);
  mem.write16(env + 6, h & 65535);
  return env >>> 0;
}
function drawTexPageCommand(dither, texPage, code) {
  let word = 3774873600;
  if ((texPage | 0) !== 0) word |= 512;
  let flags = (code & 2559) >>> 0;
  if ((dither | 0) !== 0) flags |= 1024;
  return (word | flags) >>> 0;
}
function drawAreaStartCommand(mem, x, y) {
  const cx = clampDrawCoord(mem, x, DRAW_AREA_WIDTH) & 1023;
  const cy = clampDrawCoord(mem, y, DRAW_AREA_HEIGHT) & 1023;
  return (3808428032 | cy << 10 | cx) >>> 0;
}
function drawAreaEndCommand(mem, x, y) {
  const cx = clampDrawCoord(mem, x, DRAW_AREA_WIDTH) & 1023;
  const cy = clampDrawCoord(mem, y, DRAW_AREA_HEIGHT) & 1023;
  return (3825205248 | cy << 10 | cx) >>> 0;
}
function drawOffsetCommand(x, y) {
  return (3841982464 | (y & 2047) << 11 | x & 2047) >>> 0;
}
function texWindowCommand(mem, rect) {
  if (rect >>> 0 === 0) return 0;
  if (mem.read8 === void 0) throw new Error("texWindowCommand needs PsxEnvMemory.read8");
  const u2 = (mem.read8(rect) & 255) >>> 3;
  const offX = (-s162(mem.read16(rect + 4)) & 255) >> 3;
  const v = (mem.read8(rect + 2) & 255) >>> 3;
  const offY = (-s162(mem.read16(rect + 6)) & 255) >> 3;
  return (v << 15 | u2 << 10 | 3791650816 | offY << 5 | offX) >>> 0;
}

// engine/dw3/display-service.ts
var DISPLAY_SERVICE = 2147802640;
var DISPLAY_SERVICE_INIT_FLAG = BOOT_GP + 400 >>> 0;
var DISPLAY_SERVICE_FIELDS = {
  packet: 32,
  packetA: 36,
  packetB: 40,
  packetSize: 44,
  init30: 48,
  packetIndex: 52,
  viewBase: 96,
  viewCount: 30,
  viewHandle: 216,
  releaseMethod: 368
};
function findDisplayViewCell(mem, key2) {
  const want = key2 | 0;
  for (let i = 0; i < DISPLAY_SERVICE_FIELDS.viewCount; i++) {
    const slot = DISPLAY_SERVICE + i * 4;
    const registered = mem.read32(slot + DISPLAY_SERVICE_FIELDS.viewBase) | 0;
    if (want === 0) {
      if (registered === 0) return i;
      continue;
    }
    if (registered !== 0 && (mem.read32(slot + DISPLAY_SERVICE_FIELDS.viewHandle) | 0) === want) return i;
  }
  return -1;
}
var DISPLAY_HEAP_ALLOC = 2147792348 + 24;
var DISP_ENV_A = DISPLAY_SERVICE + 56;
var DISP_ENV_B = DISP_ENV_A + 20;

// engine/dw3/ui/phase-banner.ts
var PHASE_BANNER_ARMED = 756;
var PHASE_BANNER_OPCODE = 1057;
var PHASE_BANNER_PENDING = 758;
var PHASE_BANNER_NEXT = 759;
var INTER_PHASE_TABLE = 2148162908;
function queueInterPhaseBanner(mem, duel) {
  mem.write8(duel + PHASE_BANNER_ARMED, 1);
  const record = mem.read8(duel + PHASE_BANNER_PENDING) * 4 + INTER_PHASE_TABLE >>> 0;
  mem.write8(duel + PHASE_BANNER_OPCODE, mem.read8(record) & 255);
  const next = mem.read8(record + 2) & 255;
  mem.write8(duel + PHASE_BANNER_NEXT, next);
  return next;
}

// engine/dw3/ui/fade-wash.ts
var FADE_WASH = {
  /** The handler's dispatch state (1 = ramping arm). */
  state0: 12,
  setState: 40,
  advance0: 56,
  /** The wash state: 0 idle, 1 ramping, 2 done. */
  state: 80,
  /** Ticks left in the ramp (s32). */
  counter: 84,
  /** The ramp's length in ticks (s32). */
  duration: 88,
  /** The quad's draw-mode low bits (u8, the creator's argument). */
  modeBits: 92,
  /** Non-zero holds the wash at the end instead of returning to idle. */
  hold: 93,
  target: 94,
  previous: 97,
  current: 100,
  setColoursSlot: 104,
  startSlot: 108,
  isIdleSlot: 112,
  stopSlot: 116
};
var FADE_WASH_HANDLER = 2148152764;
var FADE_WASH_SET_COLOURS = 2148152648;
var FADE_WASH_START = 2148152664;
var FADE_WASH_IS_IDLE = 2148152740;
var FADE_WASH_STOP = 2148152752;
var FADE_WASH_SIZE = 120;
function createFadeWash(mem, host, modeBits) {
  const obj = host.allocate(FADE_WASH_HANDLER, FADE_WASH_SIZE, 4) >>> 0;
  mem.write32(obj + FADE_WASH.setColoursSlot, FADE_WASH_SET_COLOURS);
  mem.write32(obj + FADE_WASH.startSlot, FADE_WASH_START);
  mem.write32(obj + FADE_WASH.isIdleSlot, FADE_WASH_IS_IDLE);
  mem.write8(obj + FADE_WASH.modeBits, modeBits & 255);
  mem.write32(obj + FADE_WASH.stopSlot, FADE_WASH_STOP);
  return obj;
}
function fadeWashSetColours(mem, obj, r, g, b) {
  mem.write8(obj + FADE_WASH.current, r & 255);
  mem.write8(obj + FADE_WASH.current + 1, g & 255);
  mem.write8(obj + FADE_WASH.current + 2, b & 255);
}
function fadeWashStart(mem, obj, r, g, b, duration, hold) {
  for (let i = 0; i < 3; i++) {
    mem.write8(obj + FADE_WASH.previous + i, mem.read8(obj + FADE_WASH.current + i));
  }
  mem.write8(obj + FADE_WASH.target, r & 255);
  mem.write8(obj + FADE_WASH.target + 1, g & 255);
  mem.write8(obj + FADE_WASH.target + 2, b & 255);
  mem.write32(obj + FADE_WASH.counter, duration | 0);
  mem.write32(obj + FADE_WASH.duration, duration | 0);
  mem.write32(obj + FADE_WASH.state, 1);
  mem.write8(obj + FADE_WASH.hold, hold & 255);
}

// engine/dw3/ui/duel-queue.ts
var QUEUE_GREY_FLAGS = 1181;
var QUEUE_GREY_BLOCK = 1182;
var QUEUE_GREY_COUNT = 15;
var QUEUE_ANNOUNCE = 774;
var QUEUE_ANNOUNCE_TABLE = 2148162836;
var QUEUE_ANNOUNCE_SLOT = 4;
var QUEUE_ANNOUNCE_FRAMES = 10;
var QUEUE_ANNOUNCE_FRAMES_HOLD = 15;
var QUEUE_ANNOUNCE_HOLD_KIND = 2;
function applyQueuedGreyFlags(mem, duel) {
  const queued = mem.read8(duel + QUEUE_GREY_FLAGS) & 255;
  if (queued === 0) return;
  const value = queued === 2 ? 1 : 0;
  for (let i = 0; i < QUEUE_GREY_COUNT; i++) mem.write8(duel + QUEUE_GREY_BLOCK + i, value);
  mem.write8(duel + QUEUE_GREY_FLAGS, 0);
}
function runQueuedAnnounce(mem, host, duel, ctx) {
  const kind = mem.read8(duel + QUEUE_ANNOUNCE) & 255;
  if (kind === 0) return;
  const record = (kind - 1) * 4 + QUEUE_ANNOUNCE_TABLE >>> 0;
  const mode = mem.read8(record + 3) & 255;
  const obj = createFadeWash(mem, host, mode);
  mem.write32(ctx + QUEUE_ANNOUNCE_SLOT, obj);
  fadeWashSetColours(mem, obj, mem.read8(record) & 255, mem.read8(record + 1) & 255, mem.read8(record + 2) & 255);
  const frames = mode === QUEUE_ANNOUNCE_HOLD_KIND ? QUEUE_ANNOUNCE_FRAMES_HOLD : QUEUE_ANNOUNCE_FRAMES;
  fadeWashStart(mem, obj, 0, 0, 0, frames, 1);
  mem.write8(duel + QUEUE_ANNOUNCE, 0);
}

// engine/dw3/ui/view-openers.ts
var PANEL_RESET = [
  [110, 241],
  [130, 143],
  [158, 189],
  [194, -100],
  [214, 80],
  [100, 0],
  [98, 0],
  [96, 0],
  [108, 0],
  [128, 327],
  [156, 320],
  [184, 0],
  [182, 0],
  [180, 0],
  [192, 0],
  [212, 327],
  [240, 320],
  [242, 38]
];
function resetViewPanels(mem, view) {
  for (const [offset, value] of PANEL_RESET) {
    mem.write16(view + offset, value & 65535);
  }
}

// engine/dw3/ui/text-measure.ts
var ADVANCE_TABLE_CELL = 2147802628;
var MEASURE_LINE = { buffer: 0, length: 6, flag: 10 };
var s163 = (v) => v << 16 >> 16;
var s8 = (v) => v << 24 >> 24;
function measureLine(mem, line, font, fixedWidth) {
  if ((mem.read32(line) | 0) === 0) return 0;
  const fixed = s163(fixedWidth);
  const len = s163(mem.read16(line + MEASURE_LINE.length));
  let cursor = 0;
  let width = 0;
  let maxWidth = 0;
  if (len <= 0) return 0;
  const buf = mem.read32(line) >>> 0;
  const flag = s163(mem.read16(line + MEASURE_LINE.flag));
  const advanceBase = mem.read32(ADVANCE_TABLE_CELL) >>> 0;
  const glyphBase = mem.read32(font + 4) >>> 0;
  const extBase = mem.read32(font + 8) >>> 0;
  const extCount = s163(mem.read16(font + 22));
  for (; ; ) {
    const token = decodeTextToken(mem, buf + cursor >>> 0, flag & 255, font);
    const type = token >>> 8 & 255;
    if (type === 4) {
      return width > maxWidth ? width : maxWidth;
    }
    if (type < 5) {
      if (type === 2) {
        const operand = mem.read8(buf + cursor + 1 >>> 0) & 255;
        if (operand === 1 || operand === 3) {
          if (maxWidth < width) maxWidth = width;
          width = 0;
        } else if (operand === 5) {
          const index = mem.read8(buf + cursor + 2 >>> 0) & 255;
          width += measureLine(mem, line + index * 12 >>> 0, font, fixed);
        }
        cursor += mem.read32(advanceBase + operand * 4 >>> 0) | 0;
      } else if (type === 0) {
        if (fixed !== 0) {
          width += fixed;
        } else {
          const glyph = glyphBase + ((token & 65535) << 16 >> 16) * 11 - 44 >>> 0;
          width += (mem.read8(glyph + 9) & 255) + s8(mem.read8(glyph + 7));
        }
        cursor += flag !== 0 ? 2 : 1;
      } else if (type === 1) {
        const code = token & 255;
        if (!(extCount < code) && !(code <= 0)) {
          if (fixed !== 0) {
            width += fixed;
          } else {
            const glyph = extBase + code * 11 - 11 >>> 0;
            width += (mem.read8(glyph + 9) & 255) + s8(mem.read8(glyph + 7));
          }
        }
        cursor += 2;
      } else {
        if (fixed !== 0) {
          width += fixed;
        } else {
          width += (mem.read8(glyphBase + 9) & 255) + s8(mem.read8(glyphBase + 7));
        }
        cursor += flag !== 0 ? 2 : 1;
      }
    }
    if (!(cursor < len)) return width > maxWidth ? width : maxWidth;
  }
}

// engine/dw3/ui/text-widget-line.ts
var LINE_RECORD_BASE = 92;
var LINE_RECORD_STRIDE = 12;
var LINE_BUFFER = 0;
var LINE_CAPACITY = 4;
var LINE_LENGTH = 6;
var LINE_FLAG = 10;
var WIDGET_FLAG_C1 = 193;
var WIDGET_SCROLL = 170;
var DEFAULT_LINE_STRING = 2147549604;
function widgetSetLineString(mem, host, self, lineRec, cString) {
  if (cString === 0) {
    widgetSetLineString(mem, host, self, lineRec, DEFAULT_LINE_STRING);
  } else {
    const len = strlenBytes(mem, cString);
    mem.write16(lineRec + LINE_LENGTH, len & 65535);
    if ((len & 65535) === 0) {
      mem.write8(self + WIDGET_FLAG_C1, 0);
      return;
    }
    mem.write8(self + WIDGET_FLAG_C1, 1);
    let buffer = mem.read32(lineRec + LINE_BUFFER) >>> 0;
    mem.write16(lineRec + LINE_FLAG, 1);
    if (buffer !== 0) {
      const capacity = mem.read16(lineRec + LINE_CAPACITY) << 16 >> 16;
      const signedLen = mem.read16(lineRec + LINE_LENGTH) << 16 >> 16;
      if (!(signedLen < capacity)) {
        host.free(buffer);
        mem.write32(lineRec + LINE_BUFFER, 0);
        mem.write16(lineRec + LINE_CAPACITY, 0);
        buffer = 0;
      }
    }
    if (buffer === 0) {
      const raw = mem.read16(lineRec + LINE_LENGTH) & 65535;
      const capacity = (raw & 3) !== 0 ? (raw & 65532) + 8 : raw + 4;
      mem.write16(lineRec + LINE_CAPACITY, capacity & 65535);
      buffer = host.alloc(capacity << 16 >> 16, 2) >>> 0;
      mem.write32(lineRec + LINE_BUFFER, buffer);
    }
    zeroFill(mem, buffer, mem.read16(lineRec + LINE_CAPACITY) << 16 >> 16);
    memcpyBytes(mem, buffer, cString, mem.read16(lineRec + LINE_LENGTH) << 16 >> 16);
  }
  if (mem.read16(self + WIDGET_SCROLL) << 16 >> 16 === 0) {
    setTextScroll(mem, self, 0);
  }
}
function setWidgetString(mem, host, self, cString) {
  widgetSetLineString(mem, host, self, self + LINE_RECORD_BASE, cString);
}
var EXT_MESSAGE_LITERAL = 2147549692;
function setWidgetStringIndexed(mem, host, self, cString, index) {
  if (index - 1 >>> 0 < 5) {
    const lineRec = self + LINE_RECORD_BASE + index * LINE_RECORD_STRIDE >>> 0;
    widgetSetLineString(mem, host, self, lineRec, cString);
    return;
  }
  setWidgetString(mem, host, self, EXT_MESSAGE_LITERAL);
}

// engine/dw3/ui/text-widget-resource.ts
var LINE_FLAG_WORD = 102;
function installLine(mem, host, self, line, strPtr) {
  widgetSetLineString(
    mem,
    host,
    self,
    self + line * LINE_RECORD_STRIDE + LINE_RECORD_BASE,
    strPtr
  );
  mem.write16(self + line * LINE_RECORD_STRIDE + LINE_FLAG_WORD, 0);
}
function widgetSetLineFromSource(mem, host, self, source, index, line) {
  const lineIdx = line | 0;
  if ((index | 0) >= 0) {
    const strPtr = host.stringById(source >>> 0, index | 0) >>> 0;
    if (strPtr === 0) return;
    installLine(mem, host, self, lineIdx, strPtr);
    return;
  }
  installLine(mem, host, self, lineIdx, source >>> 0);
}

// engine/dw3/ui/text-window.ts
var TEXT_WINDOW = {
  state: 12,
  state2: 16,
  selected: 20,
  cursor: 24,
  font: 80,
  line0: 92,
  line0Length: 98,
  flag: 102,
  revealEnd: 164,
  revealCursor: 166,
  unkA8: 168,
  lineWidth: 170,
  penX: 184,
  penY: 186,
  unkBF: 191,
  fixedPitch: 194
};
var TEXT_LINE = { buffer: 0, length: 6, cursor: 8, flag: 10 };
var s164 = (v) => v << 16 >> 16;
var s82 = (v) => v << 24 >> 24;
function rescanVisibleWindow(mem, self) {
  if ((mem.read32(self + TEXT_WINDOW.state) | 0) !== 1) return 1;
  const table = mem.read32(ADVANCE_TABLE_CELL) >>> 0;
  const font = mem.read32(self + TEXT_WINDOW.font) >>> 0;
  const buffer = mem.read32(self + TEXT_WINDOW.line0) >>> 0;
  let cursor = s164(mem.read16(self + TEXT_WINDOW.revealCursor));
  let substitutions = 0;
  let pages = 0;
  let running = 1;
  for (; ; ) {
    const token = decodeTextToken(
      mem,
      buffer + cursor >>> 0,
      mem.read8(self + TEXT_WINDOW.flag) & 255,
      font
    );
    const type = token >>> 8 & 255;
    if (type === 1) {
      cursor += 2;
    } else if (type < 2) {
      cursor += s164(mem.read16(self + TEXT_WINDOW.flag)) !== 0 ? 2 : 1;
    } else if (type === 2) {
      const operand = mem.read8(buffer + cursor + 1) & 255;
      if (operand === 2) {
        if ((mem.read8(buffer + cursor + 2) & 255) < 5) running = 0;
        cursor += mem.read32(table + 8) | 0;
      } else if (operand < 3) {
        if (operand === 1) {
          pages += 1;
          if (!(pages < (mem.read8(self + TEXT_WINDOW.unkBF) & 255))) {
            running = 0;
          } else {
            cursor += mem.read32(table + 4) | 0;
          }
        } else {
          cursor += mem.read32(table + operand * 4) | 0;
        }
      } else if (operand === 3) {
        running = 0;
      } else if (operand === 5) {
        const index = mem.read8(buffer + cursor + 2) & 255;
        if (index >= 6) {
          running = 0;
        } else {
          substitutions += s164(mem.read16(self + index * 12 + TEXT_WINDOW.line0Length));
          cursor += mem.read32(table + 20) | 0;
        }
      } else {
        cursor += mem.read32(table + operand * 4) | 0;
      }
    } else if (type === 4) {
      running = 0;
    } else {
      cursor += s164(mem.read16(self + TEXT_WINDOW.flag)) !== 0 ? 2 : 1;
    }
    if (running !== 0) continue;
    mem.write16(self + TEXT_WINDOW.revealEnd, cursor + substitutions & 65535);
    return cursor + substitutions | 0;
  }
}
function textHandlerEntry0(mem, self, line) {
  const buffer = mem.read32(line + TEXT_LINE.buffer) >>> 0;
  const cursor = s164(mem.read16(line + TEXT_LINE.cursor));
  const operand = mem.read8(buffer + cursor + 1) & 255;
  if (operand !== 0 && operand === 7) {
    mem.write16(self + TEXT_WINDOW.revealCursor, cursor + 2 & 65535);
  } else {
    rescanVisibleWindow(mem, self);
  }
  return 0;
}
function textHandlerWait(mem, self, line, tok) {
  const counter = mem.read16(tok + 24) + 1 & 65535;
  mem.write16(tok + 24, counter);
  const signed = s164(counter);
  if (signed === 1) {
    mem.write32(tok + 16, s164(mem.read16(line + TEXT_LINE.cursor)) + 2 | 0);
  } else if (!(signed < (mem.read8(self + TEXT_WINDOW.unkBF) & 255))) {
    mem.write16(self + TEXT_WINDOW.revealCursor, mem.read16(tok + 16));
    const budget = mem.read8(self + TEXT_WINDOW.unkBF) & 255;
    if (!(budget < 2)) {
      mem.write8(self + TEXT_WINDOW.unkBF, budget - 1 & 255);
      rescanVisibleWindow(mem, self);
      mem.write8(self + TEXT_WINDOW.unkBF, mem.read8(self + TEXT_WINDOW.unkBF) + 1 & 255);
    }
    return 32768;
  }
  mem.write16(self + TEXT_WINDOW.penX, 0);
  if ((mem.read8(self + TEXT_WINDOW.fixedPitch) & 255) !== 0) {
    mem.write16(self + TEXT_WINDOW.penY, mem.read16(self + TEXT_WINDOW.penY) + mem.read16(self + 182) & 65535);
  } else {
    const font = mem.read32(self + TEXT_WINDOW.font) >>> 0;
    const delta = s82(mem.read8(font + 1));
    mem.write16(self + TEXT_WINDOW.penY, mem.read16(self + TEXT_WINDOW.penY) + delta & 65535);
  }
  return 32772;
}
function textHandlerSetText(mem, self, line) {
  const buffer = mem.read32(line + TEXT_LINE.buffer) >>> 0;
  const cursor = s164(mem.read16(line + TEXT_LINE.cursor));
  const operand = mem.read8(buffer + cursor + 2) & 255;
  if (operand >= 5) return 32771;
  mem.write32(self + TEXT_WINDOW.state, 2);
  mem.write32(self + TEXT_WINDOW.state2, 1);
  if (operand - 1 >>> 0 < 4) {
    mem.write32(self + TEXT_WINDOW.selected, operand);
  } else {
    mem.write32(self + TEXT_WINDOW.selected, 0);
  }
  mem.write32(self + TEXT_WINDOW.cursor, s164(mem.read16(line + TEXT_LINE.cursor)) + 2 | 0);
  return 0;
}
function textHandlerPageScan(mem, self, line) {
  if (s164(mem.read16(self + TEXT_WINDOW.lineWidth)) === 0) {
    mem.write16(self + TEXT_WINDOW.revealEnd, mem.read16(line + TEXT_LINE.length));
  } else {
    mem.write16(self + TEXT_WINDOW.revealEnd, mem.read16(line + TEXT_LINE.cursor) + 2 & 65535);
  }
  const length = s164(mem.read16(line + TEXT_LINE.length));
  for (; ; ) {
    if (!(s164(mem.read16(line + TEXT_LINE.cursor)) < length)) return 0;
    const buffer = mem.read32(line + TEXT_LINE.buffer) >>> 0;
    const rawCursor = mem.read16(line + TEXT_LINE.cursor);
    const token = decodeTextToken(
      mem,
      buffer + s164(rawCursor) >>> 0,
      mem.read8(line + TEXT_LINE.flag) & 255,
      mem.read32(self + TEXT_WINDOW.font) >>> 0
    );
    const type = token >>> 8 & 255;
    if (type === 2) {
      const operand = mem.read8(buffer + s164(rawCursor) + 1) & 255;
      if (operand === 5 || operand === 8) {
        mem.write16(self + TEXT_WINDOW.revealCursor, rawCursor);
        mem.write16(line + TEXT_LINE.cursor, length + 1 & 65535);
      } else {
        const table = mem.read32(ADVANCE_TABLE_CELL) >>> 0;
        const step = mem.read16(table + operand * 4);
        mem.write16(line + TEXT_LINE.cursor, rawCursor + step & 65535);
      }
    } else if (type < 3) {
      mem.write16(self + TEXT_WINDOW.revealCursor, rawCursor);
      mem.write16(line + TEXT_LINE.cursor, length + 1 & 65535);
    } else if (type === 4) {
      mem.write16(self + TEXT_WINDOW.revealCursor, rawCursor - 1 & 65535);
      return 3;
    } else {
      mem.write16(self + TEXT_WINDOW.revealCursor, rawCursor);
      mem.write16(line + TEXT_LINE.cursor, length + 1 & 65535);
    }
  }
}
function textHandlerNoop() {
  return 32771;
}
function textHandlerSetLine(mem, self, line) {
  const buffer = mem.read32(line + TEXT_LINE.buffer) >>> 0;
  const cursor = s164(mem.read16(line + TEXT_LINE.cursor));
  const operand = mem.read8(buffer + cursor + 2) & 255;
  if (operand >= 255) return 32771;
  mem.write32(self + TEXT_WINDOW.state, 2);
  mem.write32(self + TEXT_WINDOW.state2, 0);
  mem.write32(self + TEXT_WINDOW.selected, operand);
  mem.write8(buffer + cursor + 2, 255);
  mem.write16(self + TEXT_WINDOW.unkA8, 0);
  return 32768;
}
var TEXT_LITERAL_EXT_MESSAGE = 2147549748;
var TEXT_LITERAL_PLAYER_NAME = 2147782024;
var TEXT_TOKEN = { code: 20, type: 22, glyph: 12 };
var advanceCursor = (mem, cursor, line) => {
  mem.write16(cursor, mem.read16(cursor) + (s164(mem.read16(line + TEXT_LINE.flag)) !== 0 ? 2 : 1) & 65535);
};
function stepToken(mem, host, self, line, tok, cursor) {
  const type = s164(mem.read16(tok + TEXT_TOKEN.type));
  const font = mem.read32(self + TEXT_WINDOW.font) >>> 0;
  if (type === 4) {
    mem.write8(self + 195, 1);
    mem.write16(cursor, mem.read16(cursor) + 1 & 65535);
    return 3;
  }
  if (type === 0) {
    const code = s164(mem.read16(tok + TEXT_TOKEN.code));
    mem.write32(tok + TEXT_TOKEN.glyph, mem.read32(font + 4) + code * 11 - 44 >>> 0);
    advanceCursor(mem, cursor, line);
    return 1;
  }
  if (type === 1) {
    const code = mem.read8(tok + TEXT_TOKEN.code) & 255;
    const extCount = s164(mem.read16(font + 22));
    const glyph = !(extCount < code) && !(code <= 0) ? mem.read32(font + 8) + code * 11 - 11 >>> 0 : mem.read32(font + 4) >>> 0;
    mem.write32(tok + TEXT_TOKEN.glyph, glyph);
    mem.write16(cursor, mem.read16(cursor) + 2 & 65535);
    return 1;
  }
  if (type !== 2) {
    mem.write32(tok + TEXT_TOKEN.glyph, mem.read32(font + 4) >>> 0);
    advanceCursor(mem, cursor, line);
    return 1;
  }
  if (s164(mem.read16(line + TEXT_LINE.flag)) !== 0) {
    const code = mem.read8(tok + TEXT_TOKEN.code) & 255;
    if (code === 1) {
      const result2 = textHandlerWait(mem, self, line, tok);
      mem.write16(cursor, mem.read16(cursor) + 1 & 65535);
      return result2 & 4294934527;
    }
    return textHandlerEntry0(mem, self, line) | 0;
  }
  const buffer = mem.read32(line + TEXT_LINE.buffer) >>> 0;
  const operand = mem.read8(buffer + s164(mem.read16(cursor)) + 1) & 255;
  const entry0 = (m, _h, s, l) => textHandlerEntry0(m, s, l);
  const handler = HANDLER_TABLE[operand < HANDLER_TABLE.length ? operand : 0] ?? entry0;
  const result = handler(mem, host, self, line, tok) | 0;
  if ((result & 32768) === 0) return result & 4294934527;
  const table = mem.read32(ADVANCE_TABLE_CELL) >>> 0;
  const step = mem.read16(table + operand * 4);
  mem.write16(cursor, mem.read16(cursor) + step & 65535);
  return result & 4294934527;
}
function textNextGlyph(mem, host, self, line, tok) {
  const buffer = mem.read32(line + TEXT_LINE.buffer) >>> 0;
  const cursor = s164(mem.read16(line + TEXT_LINE.cursor));
  const n = mem.read8(buffer + cursor + 2) & 255;
  const record = self + n * 12 + TEXT_WINDOW.line0 >>> 0;
  if ((mem.read32(record) | 0) === 0) {
    setWidgetStringIndexed(mem, host, self, TEXT_LITERAL_EXT_MESSAGE, n);
    return 32771;
  }
  const recCursor = s164(mem.read16(record + TEXT_LINE.cursor));
  if (!(recCursor < s164(mem.read16(record + TEXT_LINE.length)))) return 32771;
  const token = decodeTextToken(
    mem,
    mem.read32(record) + recCursor >>> 0,
    mem.read8(record + TEXT_LINE.flag) & 255,
    mem.read32(self + TEXT_WINDOW.font) >>> 0
  );
  mem.write16(tok + TEXT_TOKEN.code, token & 65535);
  const type = token >>> 8 & 255;
  mem.write16(tok + TEXT_TOKEN.type, type);
  if (type === 2) return 32768;
  const result = stepToken(mem, host, self, record, tok, record + TEXT_LINE.cursor >>> 0);
  if (s164(mem.read16(self + TEXT_WINDOW.lineWidth)) !== 0) return result;
  return result === 1 ? 2 : result;
}
function textHandlerPlayerName(mem, host, self, line) {
  const cursor = s164(mem.read16(line + TEXT_LINE.cursor));
  const n = mem.read8(mem.read32(line + TEXT_LINE.buffer) + cursor + 2) & 255;
  if (n >= 6) return 32771;
  widgetSetLineFromSource(mem, host, self, TEXT_LITERAL_PLAYER_NAME, -1, n);
  const buffer = mem.read32(line + TEXT_LINE.buffer) >>> 0;
  mem.write8(buffer + cursor + 2, 6);
  return 32771;
}
var HANDLER_TABLE = [
  (m, _h, s, l) => textHandlerEntry0(m, s, l),
  (m, _h, s, l, t) => textHandlerWait(m, s, l, t),
  (m, _h, s, l) => textHandlerSetText(m, s, l),
  (m, _h, s, l) => textHandlerPageScan(m, s, l),
  () => textHandlerNoop(),
  textNextGlyph,
  (m, _h, s, l) => textHandlerSetLine(m, s, l),
  (m, _h, s, l) => textHandlerEntry0(m, s, l),
  textHandlerPlayerName,
  (m, _h, s, l) => textHandlerEntry0(m, s, l)
];

// engine/dw3/resource-service.ts
var RESOURCE_SERVICE_ACTIVE = 2147764996;
var CACHE_SLOTS2 = 2147765052;
var CACHE_SLOT_COUNT = 64;
var CACHE_SLOT_STRIDE = 16;
function isResourceServiceReady(mem) {
  return mem.read32(RESOURCE_SERVICE_ACTIVE) >>> 0 !== 0 ? 1 : 0;
}
function findFreeCacheSlot(mem) {
  for (let i = 0; i < CACHE_SLOT_COUNT; i++) {
    const slot = CACHE_SLOTS2 + i * CACHE_SLOT_STRIDE >>> 0;
    if ((mem.read32(slot + 4) | 0) === 0) return slot;
  }
  return 0;
}
function findCacheSlotById(mem, id) {
  const want = id | 0;
  for (let i = 0; i < CACHE_SLOT_COUNT; i++) {
    const slot = CACHE_SLOTS2 + i * CACHE_SLOT_STRIDE >>> 0;
    if ((mem.read32(slot + 4) | 0) === want) return slot;
  }
  return 0;
}
var FRAME_CLOCK_CELL = 2147802656;
var CACHE_ACTIVE = 2147765048;
var LBA_LEN_SECTORS2 = 2147775652;
var CACHE_ALLOC_TAG = 3;
function cachePoll(mem, id, host) {
  const slot = findCacheSlotById(mem, id);
  if (slot === 0) {
    cacheAcquire(mem, id, host);
    return 1;
  }
  mem.write32(slot + 8, mem.read32(FRAME_CLOCK_CELL) | 0);
  return (mem.read32(slot) & 65535) === 3 ? 0 : 1;
}
function cacheAcquire(mem, id, host) {
  const known = findCacheSlotById(mem, id);
  if (known !== 0) {
    mem.write32(known + 8, mem.read32(FRAME_CLOCK_CELL) | 0);
    return;
  }
  const slot = findFreeCacheSlot(mem);
  mem.write32(slot + 4, id | 0);
  const sectors = mem.read16(LBA_LEN_SECTORS2 + (id & 65535) * 2);
  mem.write32(slot + 12, host.alloc(sectors << 11 >>> 0, CACHE_ALLOC_TAG) | 0);
  mem.write16(slot + 0, 1);
  mem.write32(slot + 8, 0);
  mem.write16(slot + 2, 0);
  mem.write32(CACHE_ACTIVE, 1);
}
function cacheServicePending(mem, host) {
  if ((mem.read32(CACHE_ACTIVE) | 0) === 0) return;
  if (isResourceServiceReady(mem) === 1) return;
  let updated = false;
  let started = false;
  for (let i = 0; i < CACHE_SLOT_COUNT; i++) {
    const slot = CACHE_SLOTS2 + i * CACHE_SLOT_STRIDE >>> 0;
    const id = mem.read32(slot + 4) | 0;
    if (id === 0) continue;
    const state = mem.read32(slot) & 65535;
    if (state === 1) {
      if (started) continue;
      updated = true;
      host.startTransfer(id, mem.read32(slot + 12) >>> 0);
      mem.write16(slot + 0, 2);
      mem.write32(slot + 8, mem.read32(FRAME_CLOCK_CELL) | 0);
      started = true;
    } else if (state === 2) {
      mem.write16(slot + 0, 3);
      mem.write32(slot + 8, mem.read32(FRAME_CLOCK_CELL) | 0);
      updated = true;
    }
  }
  if (!updated) mem.write32(CACHE_ACTIVE, 0);
}
function cacheLoadBlocking(mem, id, host) {
  cacheAcquire(mem, id, host);
  do {
    cacheServicePending(mem, host);
  } while (cachePoll(mem, id, host) !== 0);
}
function resourceGetBase(mem, id, host) {
  const slot = findCacheSlotById(mem, id);
  if (slot !== 0 && (mem.read32(slot) & 65535) === 3) {
    mem.write32(slot + 8, host.clock() | 0);
    return mem.read32(slot + 12) >>> 0;
  }
  while ((host.busyGate() | 0) !== 0) {
  }
  cacheLoadBlocking(mem, id, host);
  const found = findCacheSlotById(mem, id);
  return found === 0 ? 0 : mem.read32(found + 12) >>> 0;
}

// engine/dw3/disc-tables.ts
var LBA_LEN_SECTORS3 = 2147775652;
function getLbaSectorLength(mem, index) {
  const off = Math.imul(index | 0, 2);
  return mem.read16(LBA_LEN_SECTORS3 + off >>> 0) & 65535;
}

// engine/dw3/item-record.ts
function itemRecord(id) {
  return (id | 0) <= 0 ? 0 : 2147751992 + Math.imul(id | 0, 12) >>> 0;
}
function itemIconClip(mem, id) {
  return mem.read8(2147756968 + mem.read8(itemRecord(id) + 9 >>> 0) >>> 0) & 255;
}
function itemClassEquals(mem, id, value) {
  return (mem.read8(itemRecord(id) + 8 >>> 0) & 255) === (value | 0) ? 1 : 0;
}

// engine/dw3/party-context.ts
var PARTY_CONTEXT = 2147781940;
var PARTY_MAP = PARTY_CONTEXT + 112;
var ROSTER_RECORDS = 2147783828;
var ROSTER_STRIDE = 988;
var CUR_STATS = ROSTER_RECORDS + 8;
function partyPositionToRosterSlot(mem, position) {
  if (position >>> 0 >= 3) return -1;
  return mem.read32(PARTY_MAP + position * 4) | 0;
}
function persistentRosterSlot(slot) {
  return CUR_STATS + (slot | 0) * ROSTER_STRIDE >>> 0;
}
var CHARACTER_RECORDS = 2147792848;
var CHARACTER_STRIDE = 448;
function getPadButtons4A(mem, slot) {
  return mem.read16(CHARACTER_RECORDS + (slot | 0) * CHARACTER_STRIDE + 74 >>> 0) & 65535;
}
var CURRENT_SHOP_ID = 2147791876;
function getCurrentShopId(mem) {
  return mem.read32(CURRENT_SHOP_ID) | 0;
}
var SCREEN_TRANSITION_A = PARTY_CONTEXT + 9928;
var SCREEN_TRANSITION_B = PARTY_CONTEXT + 9936;
function requestScreenTransition(mem, a2, b) {
  mem.write32(SCREEN_TRANSITION_A, a2 | 0);
  mem.write32(SCREEN_TRANSITION_B, b | 0);
}
function getFollowerRosterSlot(mem, position) {
  if (position >>> 0 >= 3) return -1;
  const slot = mem.read32(PARTY_MAP + position * 4) | 0;
  const addr = PARTY_CONTEXT + Math.imul(slot, ROSTER_STRIDE) + 1888 >>> 0;
  return (mem.read32(addr) | 0) - 3 | 0;
}

// engine/dw3/display-view.ts
var RECT_COLOUR = { valid: 24, r: 25, g: 26, b: 27 };
function setRectColour(mem, self, r, g, b) {
  mem.write8(self + RECT_COLOUR.r, r & 255);
  mem.write8(self + RECT_COLOUR.b, b & 255);
  mem.write8(self + RECT_COLOUR.g, g & 255);
  mem.write8(self + RECT_COLOUR.valid, ((b | r | g) & 255) !== 0 ? 1 : 0);
}

// engine/dw3/ui/spawn-ui-icon.ts
var UI_ICON_SIZE = 152;
var UI_ICON_EXTRA_SIZE = 4;
var UI_ICON_HANDLER = 2147594404;
var UI_ICON_BASE_TABLE = [
  [40, 2147566196],
  [44, 2147566216],
  [48, 2147566232],
  [52, 2147566244],
  [56, 2147566252],
  [60, 2147566280],
  [64, 2147566304],
  [68, 2147566324],
  [72, UI_ICON_HANDLER],
  [76, 2147566344]
];
var UI_ICON_FIELDS = {
  state: 16,
  secondaryCount: 32,
  secondaryPtr: 36,
  target: 80,
  order: 84,
  x: 88,
  y: 92,
  unk60: 96,
  visible: 100,
  dirty: 104,
  lastFrame: 112,
  restTicks: 116,
  cycleTicks: 120,
  unk7c: 124
};
function spawnUiIcon(mem, host, target, order, x, y) {
  const obj = host.alloc(UI_ICON_SIZE) >>> 0;
  const extra = host.alloc(UI_ICON_EXTRA_SIZE) >>> 0;
  mem.write32(obj + UI_ICON_FIELDS.secondaryPtr, extra);
  mem.write32(obj + UI_ICON_FIELDS.secondaryCount, UI_ICON_EXTRA_SIZE >> 2);
  for (const [off, value] of UI_ICON_BASE_TABLE) mem.write32(obj + off, value >>> 0);
  mem.write32(obj + UI_ICON_FIELDS.visible, 1);
  mem.write32(obj + UI_ICON_FIELDS.restTicks, 32);
  mem.write32(obj + UI_ICON_FIELDS.cycleTicks, 6);
  mem.write32(obj + 128, 2147594316);
  mem.write32(obj + 132, 2147594344);
  mem.write32(obj + 140, 2147594380);
  mem.write32(obj + 144, 2147594388);
  mem.write32(obj + 136, 2147594364);
  mem.write32(obj + UI_ICON_FIELDS.target, target << 16 >> 16);
  mem.write32(obj + UI_ICON_FIELDS.order, order | 0);
  mem.write32(obj + UI_ICON_FIELDS.x, x << 16 >> 16);
  mem.write32(obj + UI_ICON_FIELDS.y, y << 16 >> 16);
  mem.write32(obj + 148, 2147594396);
  return obj;
}
function uiIconSetVisible(mem, self, v) {
  mem.write32(self + UI_ICON_FIELDS.visible, v | 0);
  if ((v | 0) === 0) {
    mem.write32(self + UI_ICON_FIELDS.state, 0);
    mem.write32(self + UI_ICON_FIELDS.lastFrame, 0);
  }
  mem.write32(self + UI_ICON_FIELDS.dirty, 1);
}
function uiIconSetPos(mem, self, x, y) {
  mem.write32(self + UI_ICON_FIELDS.x, x | 0);
  mem.write32(self + UI_ICON_FIELDS.y, y | 0);
  mem.write32(self + UI_ICON_FIELDS.dirty, 1);
}
function uiIconSetUnk60(mem, self, v) {
  mem.write32(self + UI_ICON_FIELDS.unk60, v | 0);
  mem.write32(self + UI_ICON_FIELDS.dirty, 1);
}
function uiIconSetRestTicks(mem, self, v) {
  mem.write32(self + UI_ICON_FIELDS.restTicks, v | 0);
}
function uiIconSetCycleTicks(mem, self, v) {
  mem.write32(self + UI_ICON_FIELDS.cycleTicks, v | 0);
}
function uiIconSetUnk7c(mem, self, v) {
  mem.write32(self + UI_ICON_FIELDS.unk7c, v | 0);
}

// engine/dw3/psx-stdio.ts
var STDOUT_BUFFER = 2148012544;
var STDOUT_COUNT = 2147835980;
var STDOUT_COLUMN = 2147835976;
var CTYPE_TABLE = 2147835417;
var STDOUT_FD = 1;
function isCountable(mem, ch) {
  return (mem.read8(CTYPE_TABLE + (ch & 255)) & 151) !== 0;
}
function emit(mem, ch, host) {
  const count = mem.read32(STDOUT_COUNT) | 0;
  if (count >= 32) {
    host.fwrite(STDOUT_FD, STDOUT_BUFFER, count);
    mem.write32(STDOUT_COUNT, 0);
  }
  mem.write8(STDOUT_BUFFER + (mem.read32(STDOUT_COUNT) >>> 0), ch & 255);
  mem.write32(STDOUT_COUNT, (mem.read32(STDOUT_COUNT) >>> 0) + 1);
}
function putchar(mem, ch, host) {
  const c = ch << 24 >> 24;
  if (c === 9) {
    do {
      putchar(mem, 32, host);
    } while ((mem.read32(STDOUT_COLUMN) & 7) !== 0);
    return;
  }
  if (c === 10) {
    putchar(mem, 13, host);
    mem.write32(STDOUT_COLUMN, 0);
    emit(mem, ch, host);
    return;
  }
  if (isCountable(mem, ch & 255)) {
    mem.write32(STDOUT_COLUMN, (mem.read32(STDOUT_COLUMN) >>> 0) + 1);
  }
  emit(mem, ch, host);
}
function flushStdout(mem, host) {
  const count = mem.read32(STDOUT_COUNT) | 0;
  if (count > 0) {
    host.fwrite(STDOUT_FD, STDOUT_BUFFER, count);
    mem.write32(STDOUT_COUNT, 0);
  }
}

// engine/dw3/ui/shop-list-slots.ts
var SHOP_LIST_SLOT_FIELDS = {
  baseState: 12,
  state1: 16,
  secondary: 36,
  mode: 92,
  stock: 1716,
  cursorLatch: 1720,
  selected: 1724,
  pageSize: 1748
};
function shopListSelectedId(mem, self) {
  const idx = mem.read32(self + SHOP_LIST_SLOT_FIELDS.selected) | 0;
  if ((mem.read32(self + SHOP_LIST_SLOT_FIELDS.mode) | 0) !== 0) {
    return mem.read16(self + Math.imul(idx, 2) + 100) << 16 >> 16;
  }
  const stock = mem.read32(self + SHOP_LIST_SLOT_FIELDS.stock) >>> 0;
  return mem.read16(stock + Math.imul(idx, 2) >>> 0) << 16 >> 16;
}

// engine/dw3/ui/shop-list-create.ts
var SHOP_LIST_SIZE = 1796;
var SHOP_LIST_EXTRA_SIZE = 80;
var SHOP_LIST_TICK = 2148040384;
var SHOP_LIST_BASE_TABLE = [
  [40, 2147566196],
  [44, 2147566216],
  [48, 2147566232],
  [52, 2147566244],
  [56, 2147566252],
  [60, 2147566280],
  [64, 2147566304],
  [68, 2147566324],
  [72, SHOP_LIST_TICK],
  [76, 2147566344]
];
var SHOP_LIST_METHODS = [
  [1768, 2148042692],
  [1772, 2148042732],
  [1776, 2148042800],
  [1780, 2148042516],
  [1784, 2148042352],
  [1788, 2148042872],
  [1792, 2148042980]
];
function shopListCreate(mem, host, parent, shopArg, mode) {
  const obj = host.alloc(SHOP_LIST_SIZE) >>> 0;
  const extra = host.alloc(SHOP_LIST_EXTRA_SIZE) >>> 0;
  mem.write32(obj + 36, extra);
  mem.write32(obj + 32, SHOP_LIST_EXTRA_SIZE >> 2);
  for (const [off, value] of SHOP_LIST_BASE_TABLE) mem.write32(obj + off, value >>> 0);
  for (const [off, value] of SHOP_LIST_METHODS) mem.write32(obj + off, value >>> 0);
  mem.write32(obj + 84, 4096);
  mem.write32(obj + 88, 4);
  mem.write32(obj + 80, parent | 0);
  mem.write32(obj + 92, mode | 0);
  mem.write32(obj + 96, shopArg | 0);
  return obj;
}

// engine/dw3/ui/shop-stock.ts
var SHOP_STOCK_RECORDS = 2148061364;
var SHOP_STOCK_CELL = 2148061612;
function shopLoad(mem, shopId) {
  const id = shopId | 0;
  if (id < 0) return 0;
  const record = SHOP_STOCK_RECORDS + Math.imul(id, 8) >>> 0;
  const stock = mem.read32(record + 4) >>> 0;
  if (stock === 0) return 0;
  mem.write32(SHOP_STOCK_CELL, mem.read32(record) >>> 0);
  return stock;
}

// engine/dw3/ui/window-fold.ts
var FOLD_DURATION = 0;
var FOLD_DELTA = 4;
var FOLD_VALUE = 8;
var FOLD_ACTIVE = 12;
var FOLD_FULL = 4096;
function divLo(a2, b) {
  if (b === 0) return a2 >= 0 ? -1 : 1;
  if (a2 === -2147483648 && b === -1) return -2147483648;
  return a2 / b | 0;
}
function windowFoldStart(mem, obj, direction) {
  const duration = mem.read32(obj + FOLD_DURATION) | 0;
  mem.write32(obj + FOLD_ACTIVE, 1);
  if ((direction | 0) !== 0) {
    mem.write32(obj + FOLD_VALUE, 0);
    mem.write32(obj + FOLD_DELTA, divLo(FOLD_FULL, duration));
  } else {
    mem.write32(obj + FOLD_VALUE, FOLD_FULL);
    mem.write32(obj + FOLD_DELTA, -(divLo(FOLD_FULL, duration) << 1) | 0);
  }
}
function windowFoldTick(mem, obj) {
  if ((mem.read32(obj + FOLD_ACTIVE) | 0) === 0) return 1;
  const delta = mem.read32(obj + FOLD_DELTA) | 0;
  const value = mem.read32(obj + FOLD_VALUE) + delta | 0;
  mem.write32(obj + FOLD_VALUE, value);
  if (delta > 0) {
    if (value < FOLD_FULL + 1) return 0;
    mem.write32(obj + FOLD_VALUE, FOLD_FULL);
    mem.write32(obj + FOLD_ACTIVE, 0);
    return 1;
  }
  if (value >= 0) return 0;
  mem.write32(obj + FOLD_VALUE, 0);
  mem.write32(obj + FOLD_ACTIVE, 0);
  return 1;
}

// engine/dw3/ui/sound-test.ts
var s32 = (v) => v | 0;
function soundTestScrollList(mem, delta, cursorPtr, scrollPtr, count) {
  const candidate = s32(mem.read32(cursorPtr)) + delta;
  if (candidate < 0) return;
  if (!(candidate < count)) return;
  mem.write32(cursorPtr, candidate >>> 0);
  if (!(candidate < s32(mem.read32(scrollPtr)) + 8)) {
    mem.write32(scrollPtr, candidate - 7 >>> 0);
  }
  if (s32(mem.read32(cursorPtr)) < s32(mem.read32(scrollPtr))) {
    mem.write32(scrollPtr, mem.read32(cursorPtr));
  }
}

// engine/dw3/ui/title-tasks.ts
var TITLE_CREATORS = {
  decoLayer: { handler: 2148020712, size: 124, extra: 0 },
  glow: { handler: 2148025252, size: 116, extra: 0 },
  wordmark: { handler: 2148027604, size: 116, extra: 0 },
  logo: { handler: 2148028768, size: 116, extra: 0 },
  menu: { handler: 2148029844, size: 168, extra: 0 },
  background: { handler: 2148033860, size: 152, extra: 0 },
  sequence: { handler: 2148035696, size: 316, extra: 28 }
};
function titleDecoLayerCreate(mem, screen, host) {
  const obj = host.allocTitleTask(
    TITLE_CREATORS.decoLayer.handler,
    TITLE_CREATORS.decoLayer.size,
    TITLE_CREATORS.decoLayer.extra
  ) >>> 0;
  mem.write32(obj + 120, 2148021164);
  mem.write32(obj + 104, 4096);
  mem.write32(obj + 108, 2);
  mem.write32(obj + 80, screen >>> 0);
  return obj;
}
function titleGlowCreate(mem, screen, host) {
  const obj = host.allocTitleTask(
    TITLE_CREATORS.glow.handler,
    TITLE_CREATORS.glow.size,
    TITLE_CREATORS.glow.extra
  ) >>> 0;
  mem.write32(obj + 112, 2148024800);
  mem.write32(obj + 96, 4096);
  mem.write32(obj + 100, 2);
  mem.write32(obj + 80, screen >>> 0);
  return obj;
}
function titleWordmarkCreate(mem, screen, host) {
  const obj = host.allocTitleTask(
    TITLE_CREATORS.wordmark.handler,
    TITLE_CREATORS.wordmark.size,
    TITLE_CREATORS.wordmark.extra
  ) >>> 0;
  mem.write32(obj + 112, 2148027312);
  mem.write32(obj + 96, 4096);
  mem.write32(obj + 100, 2);
  mem.write32(obj + 80, screen >>> 0);
  return obj;
}
function titleLogoCreate(mem, screen, host) {
  const obj = host.allocTitleTask(
    TITLE_CREATORS.logo.handler,
    TITLE_CREATORS.logo.size,
    TITLE_CREATORS.logo.extra
  ) >>> 0;
  mem.write32(obj + 112, 2148028476);
  mem.write32(obj + 96, 4096);
  mem.write32(obj + 100, 2);
  mem.write32(obj + 80, screen >>> 0);
  return obj;
}
function titleMenuCreate(mem, screen, host) {
  const obj = host.allocTitleTask(
    TITLE_CREATORS.menu.handler,
    TITLE_CREATORS.menu.size,
    TITLE_CREATORS.menu.extra
  ) >>> 0;
  mem.write32(obj + 156, 2148031460);
  mem.write32(obj + 160, 2148031516);
  mem.write32(obj + 164, 2148031580);
  mem.write32(obj + 140, 4096);
  mem.write32(obj + 144, 2);
  mem.write16(obj + 80, screen & 65535);
  return obj;
}
function titleBackgroundCreate(mem, screen, host) {
  const obj = host.allocTitleTask(
    TITLE_CREATORS.background.handler,
    TITLE_CREATORS.background.size,
    TITLE_CREATORS.background.extra
  ) >>> 0;
  mem.write32(obj + 148, 2148034472);
  mem.write32(obj + 124, 4096);
  mem.write32(obj + 128, 2);
  mem.write32(obj + 80, screen >>> 0);
  return obj;
}
function titleSequenceCreate(mem, screen, host) {
  const obj = host.allocTitleTask(
    TITLE_CREATORS.sequence.handler,
    TITLE_CREATORS.sequence.size,
    TITLE_CREATORS.sequence.extra
  ) >>> 0;
  mem.write32(obj + 92, 4096);
  mem.write32(obj + 96, 2);
  mem.write32(obj + 80, screen >>> 0);
  return obj;
}
var s165 = (v) => v << 16 >> 16;
function titleMenuOutcome(mem, obj) {
  return s165(mem.read32(obj + 82));
}

// engine/dw3/ui/title-draw.ts
var s166 = (v) => v << 16 >> 16;
var u16 = (v) => v & 65535;
function titleTwinkleStepper(mem, state, table, flag) {
  let p = table + s166(mem.read16s(state)) * 4 >>> 0;
  if (flag === 0) {
    mem.write16(state + 2, u16(mem.read16s(state + 2) - 1));
  }
  if (s166(mem.read16s(state + 2)) <= 0) {
    p = p + 4 >>> 0;
    mem.write16(state, u16(s166(mem.read16s(state)) + 1));
    mem.write16(state + 2, u16(mem.read16s(state + 2) + mem.read16s(p + 2)));
    if ((mem.read16s(p) & 65535) === 255) {
      p = table >>> 0;
      mem.write16(state, 0);
      mem.write16(state + 2, u16(mem.read16s(state + 2) + mem.read16s(p + 2)));
    }
    titleTwinkleStepper(mem, state, table, flag + 1);
  }
  return s166(mem.read16s(p));
}

// engine/dw3/ui/tween-linear.ts
var TWEEN_STEPS = 0;
var TWEEN_VALUE = 8;
var TWEEN_ACCUM = 12;
var TWEEN_TARGET = 16;
var TWEEN_DELTA = 20;
var TWEEN_ACTIVE = 24;
var s322 = (v) => v | 0;
function tweenLinearStart(mem, obj, from, to, steps) {
  if (from === to) return;
  const start = s322(from);
  const target = s322(to);
  const count = s322(steps);
  const delta = count === 0 ? 0 : Math.trunc((target - start << 8) / count);
  mem.write32(obj + TWEEN_STEPS, count >>> 0);
  mem.write32(obj + TWEEN_ACCUM, start << 8 >>> 0);
  mem.write32(obj + TWEEN_VALUE, start >>> 0);
  mem.write32(obj + TWEEN_TARGET, target >>> 0);
  mem.write32(obj + TWEEN_ACTIVE, 1);
  mem.write32(obj + TWEEN_DELTA, delta >>> 0);
}
function tweenLinearTick(mem, obj) {
  if (s322(mem.read32(obj + TWEEN_ACTIVE)) === 0) return 1;
  const accum = s322(mem.read32(obj + TWEEN_ACCUM)) + s322(mem.read32(obj + TWEEN_DELTA)) | 0;
  mem.write32(obj + TWEEN_ACCUM, accum >>> 0);
  const value = accum >> 8;
  mem.write32(obj + TWEEN_VALUE, value >>> 0);
  const delta = s322(mem.read32(obj + TWEEN_DELTA));
  const target = s322(mem.read32(obj + TWEEN_TARGET));
  if (delta > 0) {
    if (target < value) {
      mem.write32(obj + TWEEN_VALUE, target >>> 0);
      mem.write32(obj + TWEEN_ACTIVE, 0);
      return 1;
    }
    return 0;
  }
  if (value < target) {
    mem.write32(obj + TWEEN_VALUE, target >>> 0);
    mem.write32(obj + TWEEN_ACTIVE, 0);
    return 1;
  }
  return 0;
}

// engine/dw3/ui/country-palette.ts
function paletteElementSetFrame(mem, element, frame) {
  mem.write16(element + 84, frame & 65535);
}
var COUNTRY_PALETTE_ELEMENT_SIZE = 96;
var COUNTRY_PALETTE_ELEMENT_HANDLER = 2148021372;
var COUNTRY_PALETTE_ELEMENT_FRAME_FN = 2148021364;
var COUNTRY_PALETTE_ELEMENT_FRAME_SLOT = 92;
function createPaletteElement(mem, host) {
  const element = host.allocate(
    COUNTRY_PALETTE_ELEMENT_HANDLER,
    COUNTRY_PALETTE_ELEMENT_SIZE,
    0
  ) >>> 0;
  mem.write32(element + COUNTRY_PALETTE_ELEMENT_FRAME_SLOT, COUNTRY_PALETTE_ELEMENT_FRAME_FN);
  return element;
}

// engine/dw3/ui/lab-root.ts
var LAB_ROOT_HANDLER = 2148068620;
var LAB_ROOT_SIZE = 124;
var LAB_ROOT_EXTRA = 12;
var LAB_ROOT_CLOSE = 2148069024;
var LAB_ROOT_REOPEN = 2148069116;
var LAB_ROOT_PREDICATE = 2148069208;
var LAB_ROOT_COUNT_PACK = 2148068432;
var LAB_ROOT_FADE_PANEL = 2148069260;
var LAB_ROOT = {
  phase: 12,
  substate: 16,
  setState: 40,
  advance: 56,
  target: 80,
  ambient: 84,
  ambientToggle: 88,
  result: 92,
  partyCount: 96,
  slotClose: 104,
  slotReopen: 108,
  slotPredicate: 112,
  slotCountPack: 116,
  slotFade: 120
};
var s323 = (v) => v | 0;
function labRootConstruct(mem, host) {
  const obj = host.allocLabRoot(LAB_ROOT_HANDLER, LAB_ROOT_SIZE, LAB_ROOT_EXTRA) >>> 0;
  mem.write32(obj + LAB_ROOT.slotClose, LAB_ROOT_CLOSE);
  mem.write32(obj + LAB_ROOT.slotReopen, LAB_ROOT_REOPEN);
  mem.write32(obj + LAB_ROOT.slotPredicate, LAB_ROOT_PREDICATE);
  mem.write32(obj + LAB_ROOT.slotCountPack, LAB_ROOT_COUNT_PACK);
  mem.write32(obj + LAB_ROOT.slotFade, LAB_ROOT_FADE_PANEL);
  mem.write32(obj + LAB_ROOT.target, 4096);
  return obj;
}
function labRootCountAndPackParty(mem, self) {
  mem.write32(self + LAB_ROOT.partyCount, 0);
  const party = 2147781940 + 112;
  for (let i = 0; i < 3; i++) {
    if (s323(mem.read32(party + i * 4)) >= 0) {
      mem.write32(self + LAB_ROOT.partyCount, mem.read32(self + LAB_ROOT.partyCount) + 1 >>> 0);
    }
  }
  for (let i = 0; i < 3; i++) {
    if (s323(mem.read32(party + i * 4)) >= 0) continue;
    for (let j = i; j < 3; j++) {
      const value = s323(mem.read32(party + j * 4));
      if (value >= 0) {
        mem.write32(party + i * 4, value >>> 0);
        mem.write32(party + j * 4, 4294967295);
        break;
      }
    }
  }
}

// engine/dw3/ui/create-text-element.ts
var TEXT_ELEMENT_SIZE = 372;
var FONT_TABLE_CELL = 2147802624;
var TEXT_ELEMENT_HANDLER = 2147593236;
var BASE_TABLE = [
  [40, 2147566196],
  [44, 2147566216],
  [48, 2147566232],
  [52, 2147566244],
  [56, 2147566252],
  [60, 2147566280],
  [64, 2147566304],
  [68, 2147566324],
  [72, TEXT_ELEMENT_HANDLER],
  [76, 2147566344]
];
var METHOD_TABLE = [
  [272, 2147587268],
  // setWidgetString
  [276, 2147587304],
  [280, 2147587504],
  // widgetSetLineNumber
  [284, 2147587724],
  [288, 2147587812],
  [292, 2147588004],
  // drawTextElement
  [296, 2147590064],
  [300, 2147590528],
  [304, 2147590584],
  // setTextScroll
  [308, 2147590632],
  // setTextWidgetOrigin
  [312, 2147590644],
  [316, 2147590652],
  [320, 2147590660],
  // setVectorAndActiveFlag
  [324, 2147590716],
  // setTextElementFlagC1
  [328, 2147590748],
  // measureTextWidth
  [332, 2147590828],
  [336, 2147591192],
  [340, 2147591200],
  [344, 2147591228],
  [348, 2147591240],
  // set_unk_0x58
  [352, 2147591248],
  // set_unk_0xbf
  [356, 2147591256],
  [360, 2147591264],
  [364, 2147591276],
  [368, 2147591288]
];
function createTextElement(mem, host, target, fontKind, x, y) {
  const obj = host.alloc(TEXT_ELEMENT_SIZE, 2) >>> 0;
  for (const [off, value] of BASE_TABLE) mem.write32(obj + off, value >>> 0);
  for (const [off, value] of METHOD_TABLE) mem.write32(obj + off, value >>> 0);
  const kind = (fontKind - 1 & 65535) >>> 0 < 3 ? fontKind | 0 : 1;
  mem.write32(obj + 84, target << 16 >> 16);
  const fontPtr = (mem.read32(FONT_TABLE_CELL) >>> 0) + Math.imul(kind, 24);
  mem.write16(obj + 172, 320);
  mem.write16(obj + 176, x & 65535);
  mem.write16(obj + 178, y & 65535);
  mem.write16(obj + 174, 0);
  mem.write32(obj + 80, fontPtr >>> 0);
  mem.write8(obj + 191, 1);
  mem.write32(obj + 216, 4096);
  mem.write32(obj + 212, 4096);
  mem.write32(obj + 208, 4096);
  mem.write8(obj + 190, mem.read8(fontPtr >>> 0) & 255);
  return obj;
}

// engine/dw3/ui/native/fight-report-row.ts
var REPORT_ROW_HANDLER = 2148026596;
var REPORT_ROW_SIZE = 372;
var REPORT_ROW_EXTRA = 48;
var REPORT_ROW_METHOD_08 = 2148026888;
var REPORT_ROW_METHOD_14 = 2148026900;
var REPORT_ROW_METHOD_20 = 2148026912;
var REPORT_ROW_METHOD_2C = 2148026924;
var REPORT_ROW_METHOD_E0 = 2148027104;
function reportRowCreate(mem, host, screen, index, score) {
  const obj = host.alloc(REPORT_ROW_SIZE) >>> 0;
  const extra = host.alloc(REPORT_ROW_EXTRA) >>> 0;
  mem.write32(obj + 36, extra);
  mem.write32(obj + 32, REPORT_ROW_EXTRA >> 2);
  for (const entry of BASE_TABLE) {
    const off = entry[0];
    mem.write32(obj + off, (off === 72 ? REPORT_ROW_HANDLER : entry[1]) >>> 0);
  }
  mem.write32(obj + 352, REPORT_ROW_METHOD_08);
  mem.write32(obj + 356, REPORT_ROW_METHOD_14);
  mem.write32(obj + 360, REPORT_ROW_METHOD_20);
  mem.write32(obj + 364, REPORT_ROW_METHOD_2C);
  mem.write32(obj + 368, REPORT_ROW_METHOD_E0);
  mem.write32(obj + 84, 4096);
  mem.write32(obj + 88, 6);
  mem.write32(obj + 80, screen | 0);
  mem.write16(obj + 308, 65535);
  mem.write32(obj + 92, index | 0);
  mem.write32(obj + 96, score | 0);
  return obj;
}
var REPORT_ROW_FIELDS = {
  state: 16,
  target: 80,
  scale: 84,
  index: 92,
  score: 96,
  computed: 100,
  flag68: 104,
  method160: 352
};
function reportRowMethod08(mem, row) {
  mem.write32(row + REPORT_ROW_FIELDS.state, 1);
  return 1;
}

// engine/dw3/ui/native/map-server.ts
var MAP_SERVER_STAGE_CELL = 2147781992;
var MAP_SERVER_LOW = 624;
var MAP_SERVER_HIGH = 727;
function mapServerFromStage(mem) {
  const stage = mem.read32(MAP_SERVER_STAGE_CELL) | 0;
  if (stage < MAP_SERVER_HIGH) return stage < MAP_SERVER_LOW ? 0 : 1;
  return -1;
}

// engine/dw3/ui/memcard-block-grid.ts
var MEMCARD_GRID_HANDLER = 2148025304;
var MEMCARD_GRID_SIZE = 244;
var MEMCARD_GRID_EXTRA = 4;
var MEMCARD_GRID_RESET = 2148025128;
var MEMCARD_GRID_STEP = 2148024588;
var MEMCARD_GRID_SETDIR = 2148024724;
var MEMCARD_GRID_AWAIT = 2148024828;
var MEMCARD_GRID_APPLY = 2148024992;
var MEMCARD_GRID_CANCEL = 2148025060;
var MEMCARD_GRID = {
  state: 12,
  substate: 16,
  methodReset: 220,
  methodStep: 224,
  methodSetDir: 228,
  methodAwait: 232,
  methodApply: 236,
  methodCancel: 240,
  advance: 56,
  parent: 80,
  target: 84,
  bucket: 88,
  scrollY: 128,
  scrollX: 156,
  cursorX: 184,
  result: 204,
  stamp: 208,
  clutFrame: 212,
  clutDir: 216
};
function memcardBlockGridCreate(mem, parent, host) {
  const grid = host.allocGrid(MEMCARD_GRID_HANDLER, MEMCARD_GRID_SIZE, MEMCARD_GRID_EXTRA) >>> 0;
  mem.write32(grid + MEMCARD_GRID.methodReset, MEMCARD_GRID_RESET);
  mem.write32(grid + MEMCARD_GRID.methodStep, MEMCARD_GRID_STEP);
  mem.write32(grid + MEMCARD_GRID.methodSetDir, MEMCARD_GRID_SETDIR);
  mem.write32(grid + MEMCARD_GRID.methodAwait, MEMCARD_GRID_AWAIT);
  mem.write32(grid + MEMCARD_GRID.methodApply, MEMCARD_GRID_APPLY);
  mem.write32(grid + MEMCARD_GRID.methodCancel, MEMCARD_GRID_CANCEL);
  mem.write32(grid + MEMCARD_GRID.target, 4096);
  mem.write32(grid + MEMCARD_GRID.bucket, 2);
  mem.write32(grid + MEMCARD_GRID.parent, parent >>> 0);
  return grid;
}

// engine/dw3/ui/card-battle-context.ts
var CARD_BATTLE_VIEW_SIZE = 3912;
var CARD_BATTLE_VIEW_SLOT = 56;
var CARD_BATTLE_VIEW_HANDLER = 2148121512;
var CARD_BATTLE_PARENT = 80;
var CARD_BATTLE_STORES = [
  { at: 3744, fn: 2148125408 },
  { at: 3748, fn: 2148122176 },
  { at: 3752, fn: 2148122232 },
  { at: 3756, fn: 2148122284 },
  { at: 3760, fn: 2148122460 },
  { at: 3768, fn: 2148125772 },
  { at: 3764, fn: 2148126116 },
  { at: 3812, fn: 2148122708 },
  { at: 3816, fn: 2148122844 },
  { at: 3824, fn: 2148122988 },
  { at: 3820, fn: 2148122916 },
  { at: 3828, fn: 2148122996 },
  { at: 3832, fn: 2148123084 },
  { at: 3836, fn: 2148123156 },
  { at: 3840, fn: 2148123228 },
  { at: 3800, fn: 2148108388 },
  { at: 3804, fn: 2148122572 },
  { at: 3808, fn: 2148122640 },
  { at: 3848, fn: 2148125088 },
  { at: 3852, fn: 2148125244 },
  { at: 3856, fn: 2148125312 },
  { at: 3884, fn: 2148124244 },
  { at: 3888, fn: 2148124392 },
  { at: 3892, fn: 2148124528 },
  { at: 3896, fn: 2148124664 },
  { at: 3880, fn: 2148124120 },
  { at: 3860, fn: 2148123920 },
  { at: 3864, fn: 2148126204 },
  { at: 3868, fn: 2148126248 },
  { at: 3872, fn: 2148124932 },
  { at: 3876, fn: 2148124984 },
  { at: 3844, fn: 2148126356 },
  { at: CARD_BATTLE_PARENT, parent: true },
  { at: 3780, fn: 2148123472 },
  { at: 3784, fn: 2148123344 },
  { at: 3772, fn: 2148123704 },
  { at: 3792, fn: 2148123812 },
  { at: 3796, fn: 2148123864 },
  { at: 3776, fn: 2148123584 },
  { at: 3788, fn: 2148123236 },
  { at: 3900, fn: 2148126652 },
  { at: 3904, fn: 2148126560 },
  { at: 3908, fn: 2148127068 }
];
function createCardBattleContext(mem, parent, host) {
  const view = host.allocateView(
    CARD_BATTLE_VIEW_HANDLER,
    CARD_BATTLE_VIEW_SIZE,
    CARD_BATTLE_VIEW_SLOT
  ) >>> 0;
  for (const store of CARD_BATTLE_STORES) {
    mem.write32(view + store.at, store.parent ? parent >>> 0 : store.fn);
  }
  return view;
}

// engine/dw3/ui/native/album-grid-object.ts
var GRID_HANDLER = 2148022344;
var GRID_SIZE = 140;
function albumGridCreate(mem, host, arg0) {
  const obj = host.alloc(GRID_SIZE) >>> 0;
  for (const entry of BASE_TABLE) {
    const off = entry[0];
    mem.write32(obj + off, (off === 72 ? GRID_HANDLER : entry[1]) >>> 0);
  }
  mem.write32(obj + 132, 2148020500);
  mem.write32(obj + 136, 2148020556);
  mem.write32(obj + 84, 4096);
  mem.write32(obj + 88, 6);
  mem.write32(obj + 80, arg0 | 0);
  return obj;
}

// engine/dw3/ui/shop-actor.ts
var SHOP_ACTOR_BUY_HANDLER = 2148030608;
var SHOP_ACTOR_SELL_HANDLER = 2148037364;
var SHOP_ACTOR_BUY_FORWARDER = 2148030772;
var SHOP_ACTOR_SELL_FORWARDER = 2148037532;
var SHOP_ACTOR_BUY_SIZE = 200;
var SHOP_ACTOR_SELL_SIZE = 204;
var SHOP_ACTOR_BUY_EXTRA = 36;
var SHOP_ACTOR_SELL_EXTRA = 56;
function shopActorBaseTable(handler) {
  return [
    [40, 2147566196],
    [44, 2147566216],
    [48, 2147566232],
    [52, 2147566244],
    [56, 2147566252],
    [60, 2147566280],
    [64, 2147566304],
    [68, 2147566324],
    [72, handler],
    [76, 2147566344]
  ];
}
function shopActorCreate(mem, host, handler, size, extraSize, forwarder, arg) {
  const obj = host.alloc(size) >>> 0;
  const extra = host.alloc(extraSize) >>> 0;
  mem.write32(obj + 36, extra);
  mem.write32(obj + 32, extraSize >> 2);
  for (const [off, value] of shopActorBaseTable(handler)) mem.write32(obj + off, value >>> 0);
  mem.write32(obj + 80, forwarder);
  mem.write32(obj + 88, 4096);
  mem.write32(obj + 92, 4);
  mem.write32(obj + 84, arg | 0);
  return obj;
}
function shopActorBuy(mem, host, arg) {
  return shopActorCreate(
    mem,
    host,
    SHOP_ACTOR_BUY_HANDLER,
    SHOP_ACTOR_BUY_SIZE,
    SHOP_ACTOR_BUY_EXTRA,
    SHOP_ACTOR_BUY_FORWARDER,
    arg
  );
}
function shopActorSell(mem, host, arg) {
  return shopActorCreate(
    mem,
    host,
    SHOP_ACTOR_SELL_HANDLER,
    SHOP_ACTOR_SELL_SIZE,
    SHOP_ACTOR_SELL_EXTRA,
    SHOP_ACTOR_SELL_FORWARDER,
    arg
  );
}

// engine/dw3/ui/native/select-action.ts
var SELECT_ACTION_LIFECYCLE = 2148050204;
var SELECT_FIELDS = {
  state: 12,
  mode: 16,
  flag18: 24,
  parent: 80,
  layer: 88,
  bucket: 92,
  foldA: 108,
  foldB: 124,
  foldC: 140,
  foldD: 156,
  foldE: 172,
  foldF: 188,
  foldG: 204,
  foldH: 220,
  foldI: 236,
  slotFrame: 252,
  pickFrame: 264,
  clut: 268,
  frameTimer: 244,
  clutTimer: 248,
  destroy: 56
};
var SELECT_METHOD_SHOW = 2148042460;
var SELECT_METHOD_HIDE = 2148042520;
function selectActionConstruct(mem, host, parent) {
  const obj = host.alloc(SELECT_ACTION_LIFECYCLE, 284, 76) >>> 0;
  mem.write32(obj + 276, SELECT_METHOD_SHOW);
  mem.write32(obj + 280, SELECT_METHOD_HIDE);
  mem.write32(obj + SELECT_FIELDS.layer, 4096);
  mem.write32(obj + SELECT_FIELDS.bucket, 2);
  mem.write32(obj + SELECT_FIELDS.parent, parent >>> 0);
  return obj;
}

// engine/dw3/ui/memcard-save-card.ts
var MEMCARD_CARD_HANDLER = 2148021956;
var MEMCARD_CARD_SIZE = 144;
var MEMCARD_CARD_EXTRA = 76;
var MEMCARD_CARD_FILL = 2148020588;
var MEMCARD_CARD_DRAW_A = 2148020408;
var MEMCARD_CARD_DRAW_B = 2148020448;
var MEMCARD_CARD = {
  state: 12,
  substate: 16,
  step: 20,
  widgetCount: 32,
  widgetArray: 36,
  method2c: 44,
  advance: 56,
  parent: 80,
  target: 84,
  bucket: 88,
  visible: 92,
  fillFlag: 96,
  stamp: 100,
  anim0: 104,
  fold: 116,
  foldAux: 120,
  foldValue: 124,
  subA: 132,
  subB: 136,
  fill: 140,
  scaleB: 144,
  scaleC: 148
};
function memcardSaveCardCreate(mem, parent, host) {
  const card = host.allocCard(MEMCARD_CARD_HANDLER, MEMCARD_CARD_SIZE, MEMCARD_CARD_EXTRA) >>> 0;
  mem.write32(card + MEMCARD_CARD.subA, MEMCARD_CARD_DRAW_A);
  mem.write32(card + MEMCARD_CARD.subB, MEMCARD_CARD_DRAW_B);
  mem.write32(card + MEMCARD_CARD.fill, MEMCARD_CARD_FILL);
  mem.write32(card + MEMCARD_CARD.target, 4096);
  mem.write32(card + MEMCARD_CARD.parent, parent >>> 0);
  mem.write32(card + MEMCARD_CARD.bucket, 1);
  return card;
}

// engine/dw3/ui/memcard-message-window.ts
var MEMCARD_WINDOW_HANDLER = 2148037940;
var MEMCARD_WINDOW_SIZE = 10332;
var MEMCARD_WINDOW_EXTRA = 40;
var MEMCARD_WINDOW_REFRESH = 2148027504;
var MEMCARD_WINDOW_DISMISS = 2148027560;
var MEMCARD_WINDOW = {
  state: 12,
  substep: 16,
  methodRefresh: 10324,
  methodDismiss: 10328,
  advance: 56,
  parent: 80,
  target: 84,
  boxX: 88,
  boxY: 92,
  foldX: 10256,
  tween: 10276,
  foldY: 10284,
  blinkOn: 10304,
  blinkStamp: 10308,
  blinkFrame: 10312,
  drain: 10316
};
function memcardMessageWindowCreate(mem, parent, host) {
  const win = host.allocMessageWindow(MEMCARD_WINDOW_HANDLER, MEMCARD_WINDOW_SIZE, MEMCARD_WINDOW_EXTRA) >>> 0;
  mem.write32(win + MEMCARD_WINDOW.methodRefresh, MEMCARD_WINDOW_REFRESH);
  mem.write32(win + MEMCARD_WINDOW.methodDismiss, MEMCARD_WINDOW_DISMISS);
  mem.write32(win + MEMCARD_WINDOW.parent, parent >>> 0);
  mem.write32(win + MEMCARD_WINDOW.target, 4096);
  return win;
}

// engine/dw3/ui/band-highlight.ts
var BAND_HANDLER = 2148052840;
var BAND_SIZE = 584;
var BAND_EXTRA = 172;
var BAND_METHODS = [
  [564, 2148053660],
  [568, 2148053796],
  [572, 2148053824],
  [576, 2148053880],
  [580, 2148054064]
];
function bandCreate(mem, host, mode, itemId) {
  const obj = host.alloc(BAND_SIZE) >>> 0;
  const extra = host.alloc(BAND_EXTRA) >>> 0;
  mem.write32(obj + 36, extra);
  mem.write32(obj + 32, BAND_EXTRA >> 2);
  for (const [off, value] of BAND_BASE_TABLE) mem.write32(obj + off, value >>> 0);
  for (const [off, value] of BAND_METHODS) mem.write32(obj + off, value >>> 0);
  mem.write32(obj + 80, 4096);
  mem.write32(obj + 84, 6);
  mem.write32(obj + 88, mode | 0);
  mem.write32(obj + 484, itemId | 0);
  mem.write32(obj + 488, 1);
  mem.write32(obj + 496, 1);
  return obj;
}
var BAND_BASE_TABLE = [
  [40, 2147566196],
  [44, 2147566216],
  [48, 2147566232],
  [52, 2147566244],
  [56, 2147566252],
  [60, 2147566280],
  [64, 2147566304],
  [68, 2147566324],
  [72, BAND_HANDLER],
  [76, 2147566344]
];

// engine/dw3/ui/shop-root.ts
var SHOP_ROOT_HANDLER = 2148057008;
var SHOP_ROOT_SIZE = 172;
var SHOP_ROOT_EXTRA = 36;
var SHOP_ROOT_BIT_REFRESH = 2148057284;
function shopRootBaseTable() {
  return [
    [40, 2147566196],
    [44, 2147566216],
    [48, 2147566232],
    [52, 2147566244],
    [56, 2147566252],
    [60, 2147566280],
    [64, 2147566304],
    [68, 2147566324],
    [72, SHOP_ROOT_HANDLER],
    [76, 2147566344]
  ];
}
function shopRootCreate(mem, host) {
  const obj = host.alloc(SHOP_ROOT_SIZE) >>> 0;
  const extra = host.alloc(SHOP_ROOT_EXTRA) >>> 0;
  mem.write32(obj + 36, extra);
  mem.write32(obj + 32, SHOP_ROOT_EXTRA >> 2);
  for (const [off, value] of shopRootBaseTable()) mem.write32(obj + off, value >>> 0);
  mem.write32(obj + 168, SHOP_ROOT_BIT_REFRESH);
  mem.write32(obj + 80, 4096);
  mem.write32(obj + 96, getCurrentShopId(mem) | 0);
  return obj;
}

// engine/dw3/ui/wizard-anim.ts
var WIZARD_TABLE_DWELL_HANDLER = 2148021744;
var WIZARD_TABLE_DWELL_SIZE = 104;
var WIZARD_TABLE_DWELL_EXTRA = 0;
var WIZARD_FRAME_STEP_HANDLER = 2148021224;
var WIZARD_FRAME_STEP_SIZE = 104;
var WIZARD_FRAME_STEP_EXTRA = 0;
function wizardTableDwellCreate(mem, host) {
  return host.allocAnim(WIZARD_TABLE_DWELL_HANDLER, WIZARD_TABLE_DWELL_SIZE, WIZARD_TABLE_DWELL_EXTRA) >>> 0;
}
function wizardFrameStepCreate(mem, host) {
  return host.allocAnim(WIZARD_FRAME_STEP_HANDLER, WIZARD_FRAME_STEP_SIZE, WIZARD_FRAME_STEP_EXTRA) >>> 0;
}
var WIZARD_INTRO_HANDLER = 2148020548;
var WIZARD_INTRO_SIZE = 132;
var WIZARD_INTRO_EXTRA = 0;
var WIZARD_INTRO_SETUP = 2148021008;
var WIZARD_INTRO_LAYER = 2148021144;
var WIZARD_INTRO = {
  state: 12,
  advance: 56,
  originX: 80,
  originY: 84,
  enabled: 88,
  layerTarget: 92,
  layerBucket: 96,
  stamp0: 100,
  stamp1: 104,
  elem0X: 108,
  elem0Y: 112,
  elem1X: 116,
  elem1Y: 120,
  setupSlot: 124,
  layerSlot: 128
};
function wizardIntroCreate(mem, host) {
  const obj = host.allocAnim(WIZARD_INTRO_HANDLER, WIZARD_INTRO_SIZE, WIZARD_INTRO_EXTRA) >>> 0;
  mem.write32(obj + WIZARD_INTRO.setupSlot, WIZARD_INTRO_SETUP);
  mem.write32(obj + WIZARD_INTRO.layerSlot, WIZARD_INTRO_LAYER);
  return obj;
}
function wizardIntroSetLayer(mem, obj, a1, a2) {
  mem.write32(obj + WIZARD_INTRO.layerTarget, a1 >>> 0);
  mem.write32(obj + WIZARD_INTRO.layerBucket, a2 >>> 0);
}
var WIZARD_CHROME_HANDLER = 2148022132;
var WIZARD_CHROME_SIZE = 92;
var WIZARD_CHROME_EXTRA = 8;
var WIZARD_CHROME = {
  state: 12,
  substate: 16,
  stamp: 20,
  screen: 80,
  pose: 84,
  widgetA: 0,
  widgetB: 4,
  penX: 184,
  penY: 186
};
function wizardChromeCreate(mem, screen, host) {
  const obj = host.allocChrome(WIZARD_CHROME_HANDLER, WIZARD_CHROME_SIZE, WIZARD_CHROME_EXTRA) >>> 0;
  mem.write32(obj + WIZARD_CHROME.screen, screen >>> 0);
  return obj;
}

// engine/dw3/ui/native/fight-command-menu.ts
var COMMAND_PAD_READ_A = 2147792848 + 1012;
var COMMAND_PAD_READ_B = 2147792848 + 1020;
function commandMenuActorConstruct(mem, arg0, arg1, host) {
  const obj = host.allocateActor();
  mem.write32(obj + 84, arg1);
  mem.write32(arg1, 4294967295);
  mem.write32(obj + 80, arg0);
  return obj;
}
function commandMenuCreate(mem, config, host) {
  const menu = host.allocateMenu();
  for (let i = 0; i < 8; i++) {
    mem.write32(menu + 88 + i * 4, mem.read32(config + i * 4) | 0);
  }
  return menu;
}

// engine/dw3/ui/gym-hud.ts
var GYM_HUD_FIELDS = { target: 80, pod: 104 };
var GYM_HUD_SINGLES = [
  [0, 1, 51, 19],
  [4, 3, 51, 34],
  [8, 3, 80, 34],
  [12, 3, 51, 44],
  [16, 3, 93, 44],
  [20, 3, 128, 44],
  [24, 3, 51, 53],
  [28, 3, 93, 53],
  [32, 3, 128, 53],
  [36, 3, 95, 44],
  [40, 3, 95, 53]
];
var s167 = (v) => v << 16 >> 16;
function gymHudConstruct(mem, screen, hud, host) {
  const target = s167(mem.read16(screen + GYM_HUD_FIELDS.target));
  for (const [off, kind, x, y] of GYM_HUD_SINGLES) {
    mem.write32(hud + off, host.createTextElement(target, kind, x, y) >>> 0);
  }
  for (let i = 0; i < 6; i++) {
    mem.write32(hud + 44 + 4 * i, host.createTextElement(target, 1, 51, 79 + 14 * i) >>> 0);
  }
  for (let j = 0; j < 7; j++) {
    mem.write32(hud + 68 + 4 * j, host.createTextElement(target, 1, 93, 79 + 14 * j) >>> 0);
  }
  mem.write32(hud + 96, host.createTextElement(target, 1, 16, 187) >>> 0);
  mem.write32(hud + 100, host.createTextElement(target, 1, 44, 187) >>> 0);
  mem.write32(hud + 104, host.createTextElement(target, 1, 161, 23) >>> 0);
  mem.write32(hud + 108, host.createTextElement(target, 1, 174, 73) >>> 0);
}

// engine/dw3/ui/native/wfight-panel.ts
var WFIGHT_PANEL_ROW_HANDLER = 2148175156;
function wfightPanelCreate(mem, arg0, arg1, host) {
  const obj = host.createPanel(WFIGHT_PANEL_ROW_HANDLER, 256, 112, 65535);
  mem.write32(obj + 248, arg0);
  mem.write32(obj + 252, arg1);
  return obj;
}

// engine/dw3/ui/native/pause-items.ts
var PAUSE_ITEMS_ROOT_HANDLER = 2148080920;
var PAUSE_ITEMS_ROOT_SIZE = 1116;
var PAUSE_ITEMS_ROOT_EXTRA = 212;
var PAUSE_ITEMS_SEED = [4096, 6];
function pauseItemsRootFactory(mem, arg0, host) {
  const obj = host.allocateRoot();
  mem.write32(obj + 84, PAUSE_ITEMS_SEED[0]);
  mem.write32(obj + 88, PAUSE_ITEMS_SEED[1]);
  mem.write32(obj + 80, arg0);
  return obj;
}
var PAUSE_ITEMS_FRAME_CELL = 2147802640 + 392;

// engine/dw3/ui/native/folder-screen.ts
var FOLDER_SCREEN_HANDLER = 2148048536;
var FOLDER_SCREEN_SIZE = 288;
var FOLDER_SCREEN_EXTRA = 108;
function folderScreenCreate(mem, host) {
  const obj = host.alloc(FOLDER_SCREEN_SIZE) >>> 0;
  const extra = host.alloc(FOLDER_SCREEN_EXTRA) >>> 0;
  mem.write32(obj + 36, extra);
  mem.write32(obj + 32, FOLDER_SCREEN_EXTRA >> 2);
  for (const entry of BASE_TABLE) {
    const off = entry[0];
    mem.write32(obj + off, (off === 72 ? FOLDER_SCREEN_HANDLER : entry[1]) >>> 0);
  }
  mem.write32(obj + 284, 2148045388);
  mem.write32(obj + 80, 4096);
  mem.write32(obj + 84, 7);
  return obj;
}

// engine/dw3/ui/wizard-root.ts
var WIZARD_ROOT_HANDLER = 2148041016;
var WIZARD_ROOT_SIZE = 108;
var WIZARD_ROOT_EXTRA = 40;
var WIZARD_ROOT_TARGET = 4097;
var WIZARD_ROOT_LAYER = 5;
var WIZARD_ROOT = {
  state: 12,
  substate: 16,
  method: 40,
  target: 80,
  layer: 84,
  fold: 92
};
function wizardRootCreate(mem, host) {
  const obj = host.allocWizardRoot(WIZARD_ROOT_HANDLER, WIZARD_ROOT_SIZE, WIZARD_ROOT_EXTRA) >>> 0;
  mem.write32(obj + WIZARD_ROOT.target, WIZARD_ROOT_TARGET);
  mem.write32(obj + WIZARD_ROOT.layer, WIZARD_ROOT_LAYER);
  return obj;
}

// engine/dw3/ui/native/album-lifecycle.ts
var ALBUM_SCREEN_HANDLER = 2148029760;
var ALBUM_SCREEN_SIZE = 216;
var ALBUM_SCREEN_EXTRA = 76;
function albumScreenCreate(mem, host) {
  const obj = host.alloc(ALBUM_SCREEN_SIZE) >>> 0;
  const extra = host.alloc(ALBUM_SCREEN_EXTRA) >>> 0;
  mem.write32(obj + 36, extra);
  mem.write32(obj + 32, ALBUM_SCREEN_EXTRA >> 2);
  for (const entry of BASE_TABLE) {
    const off = entry[0];
    mem.write32(obj + off, (off === 72 ? ALBUM_SCREEN_HANDLER : entry[1]) >>> 0);
  }
  mem.write32(obj + 80, 4096);
  mem.write32(obj + 84, 7);
  return obj;
}

// engine/dw3/ui/native/name-screen.ts
var NAME_SCREEN_HANDLER = 2148033628;
var NAME_SCREEN_SIZE = 108;
var NAME_SCREEN_EXTRA = 16;
function nameScreenCreate(mem, host) {
  const obj = host.alloc(NAME_SCREEN_SIZE) >>> 0;
  const extra = host.alloc(NAME_SCREEN_EXTRA) >>> 0;
  mem.write32(obj + 36, extra);
  mem.write32(obj + 32, NAME_SCREEN_EXTRA >> 2);
  for (const entry of BASE_TABLE) {
    const off = entry[0];
    mem.write32(obj + off, (off === 72 ? NAME_SCREEN_HANDLER : entry[1]) >>> 0);
  }
  mem.write32(obj + 104, 2148033900);
  mem.write32(obj + 80, 4096);
  return obj;
}

// engine/dw3/ui/native/name-sequence.ts
var PARTNER_SELECT_HANDLER = 2148031972;
var PARTNER_SELECT_SIZE = 224;
var PARTNER_SELECT_EXTRA = 40;
function partnerSelectCreate(mem, arg0, host) {
  const obj = host.allocatePartnerSelect();
  mem.write32(obj + 80, arg0);
  mem.write32(obj + 84, 4096);
  return obj;
}

// engine/dw3/ui/native/wfight-menu.ts
var WFIGHT_MENU_HANDLER = 2148163276;
var WFIGHT_MENU_SIZE = 84;
function wfightMenuFactory(host) {
  return host.allocateActor();
}

// engine/dw3/ui/task-registration.ts
var STAGE_SELECT_MENU_TASK = { handler: 2148027804, size: 0, widget: 0 };
var SHOCK_TEST_TASK = { handler: 2148026132, size: 92, widget: 16 };
var SOUND_TEST_TASK = { handler: 2148027180, size: 116, widget: 44 };
function stageSelectMenuCreate(host) {
  return host.allocTask(
    STAGE_SELECT_MENU_TASK.handler,
    STAGE_SELECT_MENU_TASK.size,
    STAGE_SELECT_MENU_TASK.widget
  ) >>> 0;
}
function shockTestCreate(host) {
  return host.allocTask(
    SHOCK_TEST_TASK.handler,
    SHOCK_TEST_TASK.size,
    SHOCK_TEST_TASK.widget
  ) >>> 0;
}
function soundTestCreate(host) {
  return host.allocTask(
    SOUND_TEST_TASK.handler,
    SOUND_TEST_TASK.size,
    SOUND_TEST_TASK.widget
  ) >>> 0;
}

// engine/dw3/ui/native/cnty-creators.ts
var CNTY_ROOT_TICK = 2148023576;
var CNTY_FADE_TICK = 2148020612;
var CNTY_LEFT_BREATHE_TICK = 2148021980;
var CNTY_RIGHT_BREATHE_TICK = 2148022592;
var CNTY_BOTTOM_BREATHE_TICK = 2148023232;
function countrySelectRootCreate(host) {
  return host.alloc(CNTY_ROOT_TICK, 84, 20);
}
function countrySelectFadeCreate(host) {
  return host.alloc(CNTY_FADE_TICK, 84, 0);
}
function countrySelectLeftCreate(host) {
  return host.alloc(CNTY_LEFT_BREATHE_TICK, 88, 0);
}
function countrySelectRightCreate(host) {
  return host.alloc(CNTY_RIGHT_BREATHE_TICK, 88, 0);
}
function countrySelectBottomCreate(host) {
  return host.alloc(CNTY_BOTTOM_BREATHE_TICK, 88, 0);
}

// engine/native/bridge.ts
var STDIO_NOOP_HOST = { fwrite: () => {
} };
var num = (v) => typeof v === "number" ? v | 0 : 0;
var a = (cpu, n) => cpu.reg(4 + n) | 0;
var u = (cpu, n) => cpu.reg(4 + n) >>> 0;
var u64 = (v) => v >>> 0;
function factoryHost(services, handler) {
  let first = true;
  return {
    alloc(size, align) {
      void align;
      if (first) {
        first = false;
        return services.allocObject(handler, size, 0, 0);
      }
      return services.carve(size);
    }
  };
}
function gymHudHost(mem, services) {
  const unused = (name) => () => {
    throw new Error(`gymHudHost.${name} reached; bridge the fill that calls it first`);
  };
  return {
    // A fresh factory per widget: the factory's first alloc is the object
    // (allocObject registers it for the tick walk), a second is its carve.
    createTextElement: (target, kind, x, y) => createTextElement(mem, factoryHost(services, TEXT_ELEMENT_HANDLER), target, kind, x, y) >>> 0,
    resolveText: unused("resolveText"),
    rosterSlot: unused("rosterSlot"),
    rosterHandle: unused("rosterHandle"),
    copyProjection: unused("copyProjection"),
    widgetSetLine0: unused("widgetSetLine0"),
    widgetSetLineNumber: unused("widgetSetLineNumber"),
    widgetSetC0: unused("widgetSetC0"),
    widgetSetFlagC1: unused("widgetSetFlagC1"),
    widgetMeasure: unused("widgetMeasure")
  };
}
function commandMenuHost(services) {
  const unused = (name) => () => {
    throw new Error(`commandMenuHost.${name} reached; bridge the function that calls it first`);
  };
  return {
    allocateActor: () => services.allocObject(2148089412, 88, 28, 0),
    allocateMenu: () => services.allocObject(2148118348, 168, 0, 0),
    createTextElement: unused("createTextElement"),
    resourceBase: unused("resourceBase"),
    packResolve: unused("packResolve"),
    padReadA: unused("padReadA"),
    padReadB: unused("padReadB"),
    playSound: unused("playSound"),
    frameDelta: unused("frameDelta"),
    initDrawContext: unused("initDrawContext"),
    setLayer: unused("setLayer"),
    setOrigin: unused("setOrigin"),
    setPaletteRow: unused("setPaletteRow"),
    drawSprite: unused("drawSprite"),
    callMethod: unused("callMethod")
  };
}
function wfightMenuHost(services) {
  const unused = (name) => () => {
    throw new Error(`wfightMenuHost.${name} reached; bridge wfightMenuTick that calls it first`);
  };
  return {
    allocateActor: () => services.allocObject(WFIGHT_MENU_HANDLER, WFIGHT_MENU_SIZE, 0, 0),
    resourceLoaded: unused("resourceLoaded"),
    loadResource: unused("loadResource"),
    releaseResource: unused("releaseResource"),
    resourceBase: unused("resourceBase"),
    packResolve: unused("packResolve"),
    initMenuContext: unused("initMenuContext"),
    contextMethod: unused("contextMethod"),
    callMethod: unused("callMethod")
  };
}
function nameSequenceHost(services) {
  const unused = (name) => () => {
    throw new Error(`nameSequenceHost.${name} reached; bridge the name sequence that calls it first`);
  };
  return {
    allocatePartnerSelect: () => services.allocObject(PARTNER_SELECT_HANDLER, PARTNER_SELECT_SIZE, PARTNER_SELECT_EXTRA, 0),
    cardIndexOf: unused("cardIndexOf"),
    cardRecord: unused("cardRecord"),
    makeCharacterModel: unused("makeCharacterModel"),
    requestBanks: unused("requestBanks"),
    banksReady: unused("banksReady"),
    idleShimmer: unused("idleShimmer"),
    releaseService: unused("releaseService"),
    callMethod: unused("callMethod")
  };
}
function wizardAnimHost(services) {
  const unused = (name) => () => {
    throw new Error(`wizardAnimHost.${name} reached; bridge the wizard tick that calls it first`);
  };
  return {
    allocAnim: (handler, size, extra) => services.allocObject(handler, size, extra, 0),
    advance: unused("advance"),
    initDrawContext: unused("initDrawContext"),
    setOrigin: unused("setOrigin"),
    setLayer: unused("setLayer"),
    drawSprite: unused("drawSprite"),
    packResolve: unused("packResolve"),
    frameTick: unused("frameTick")
  };
}
function wizardChromeHost(services) {
  const unused = (name) => () => {
    throw new Error(`wizardChromeHost.${name} reached; bridge the chrome tick that calls it first`);
  };
  return {
    allocChrome: (handler, size, extra) => services.allocObject(handler, size, extra, 0),
    advance: unused("advance"),
    setState0: unused("setState0"),
    setSubstate: unused("setSubstate"),
    resourceGetBase: unused("resourceGetBase"),
    createWidget: unused("createWidget"),
    widgetSetPageLines: unused("widgetSetPageLines"),
    widgetSetResourceLine: unused("widgetSetResourceLine"),
    widgetSetColourRow: unused("widgetSetColourRow"),
    widgetSetTypewriter: unused("widgetSetTypewriter"),
    widgetSetCallback: unused("widgetSetCallback"),
    widgetSetTypewriterSpeed: unused("widgetSetTypewriterSpeed"),
    widgetSetPos: unused("widgetSetPos"),
    widgetBusy: unused("widgetBusy"),
    widgetState: unused("widgetState"),
    widgetFlag: unused("widgetFlag"),
    widgetReveal: unused("widgetReveal"),
    padPressed: unused("padPressed"),
    padShift: unused("padShift"),
    frameTick: unused("frameTick"),
    initDrawContext: unused("initDrawContext"),
    setOrigin: unused("setOrigin"),
    setLayer: unused("setLayer"),
    setClutRow: unused("setClutRow"),
    drawSprite: unused("drawSprite"),
    packResolve: unused("packResolve")
  };
}
function wfightHost(services) {
  const unused = (name) => () => {
    throw new Error(`wfightHost.${name} reached; bridge wfightPanelTick that calls it first`);
  };
  return {
    createPanel: (handler, size, extra, tag) => services.allocObject(handler, size, extra, tag | 0),
    openService: unused("openService"),
    serviceCategory: unused("serviceCategory"),
    setEntryCategory: unused("setEntryCategory"),
    resolveList: unused("resolveList"),
    createWidget: unused("createWidget"),
    padButtons3F4: unused("padButtons3F4"),
    padButtons3FC: unused("padButtons3FC"),
    padButtons3F8: unused("padButtons3F8"),
    frameCounter: unused("frameCounter"),
    callMethod: unused("callMethod")
  };
}
function pauseItemsHost(services) {
  const unused = (name) => () => {
    throw new Error(`pauseItemsHost.${name} reached; bridge the items root tick that calls it first`);
  };
  return {
    allocateRoot: () => services.allocObject(PAUSE_ITEMS_ROOT_HANDLER, PAUSE_ITEMS_ROOT_SIZE, PAUSE_ITEMS_ROOT_EXTRA, 0),
    cardIndexOf: unused("cardIndexOf"),
    createTextElement: unused("createTextElement"),
    createFrameElement: unused("createFrameElement"),
    callMethod: unused("callMethod"),
    itemsTick: unused("itemsTick"),
    itemsDraw: unused("itemsDraw")
  };
}
var textResourceHost = (m, s) => ({
  alloc: (size, align) => s.alloc(size, align),
  free: (ptr) => s.free(ptr),
  stringById: (base, index) => fetchTableEntry(m, base, index)
});
var BRIDGE_ENTRIES = [
  // ── resident EXE helpers: memory-only leaves, executed on every screen ──
  { address: 2147581104, module: "exe/fns", name: "zeroFill", run: (c, m) => num(zeroFill(m, u(c, 0), a(c, 1))) },
  { address: 2147635532, module: "exe/fns", name: "memcpyBytes", run: (c, m) => num(memcpyBytes(m, u(c, 0), u(c, 1), a(c, 2))), regs: (c) => {
    const dest = u(c, 0), src = u(c, 1), n = a(c, 2);
    if (dest === 0) return;
    c.setReg(1, dest);
    if (n > 0) {
      c.setReg(4, dest + n >>> 0);
      c.setReg(5, src + n >>> 0);
      c.setReg(6, 0);
    }
  } },
  { address: 2147635804, module: "exe/fns", name: "strlenBytes", run: (c, m) => num(strlenBytes(m, u(c, 0))) },
  { address: 2147635596, module: "exe/fns", name: "strcpyBytes", run: (c, m) => num(strcpyBytes(m, u(c, 0), u(c, 1))) },
  // resident global leaves and the view-slot search
  { address: 2147576664, module: "exe/fns", name: "loadPtrB400", run: (c, m) => num(loadPtrB400(m)) },
  { address: 2147576680, module: "exe/fns", name: "loadPtrB3F8", run: (c, m) => num(loadPtrB3F8(m)) },
  { address: 2147608544, module: "exe/fns", name: "setCurrentView", run: (c, m) => {
    setCurrentView(m, u(c, 0));
    return c.reg(2);
  } },
  {
    address: 2147605200,
    module: "exe/fns",
    name: "findDisplayViewCell",
    run: (c, m) => num(findDisplayViewCell(m, a(c, 0))),
    regs: (c, m) => {
      const r = findDisplayViewCell(m, a(c, 0)) | 0;
      c.setReg(5, r === -1 ? 30 : r);
    }
  },
  { address: 2147587336, module: "exe/fns", name: "intToDecimalAscii", run: (c, m) => num(intToDecimalAscii(m, u(c, 0), a(c, 1))) },
  { address: 2147603044, module: "exe/fns", name: "decodeTextToken", run: (c, m) => num(decodeTextToken(m, u(c, 0), a(c, 1), a(c, 2))) },
  { address: 2147612484, module: "exe/fns", name: "fetchTableEntry", run: (c, m) => num(fetchTableEntry(m, u(c, 0), a(c, 1))) },
  // the fetcher service builder and its code converter. F0x8001FCC0 sets no
  // v0 (the original leaves it), so the entry preserves it.
  { address: 2147613888, module: "exe/fns", name: "initFetcherTable", run: (c, m) => {
    initFetcherTable(m, u(c, 0));
    return c.reg(2);
  } },
  { address: 2147613216, module: "exe/fns", name: "convertTextEncoding", run: (c, m) => num(convertTextEncoding(m, u(c, 0), u(c, 1), a(c, 2))) },
  // the text measure service: the loop and its wrapper. F0x8001A25C returns
  // the measure value in v0, except on the enable==0 path where it leaves v0
  // untouched (the entry preserves it).
  {
    address: 2147612528,
    module: "exe/fns",
    name: "measureLine",
    run: (c, m) => num(measureLine(m, u(c, 0), u(c, 1), a(c, 2))),
    regs: (c) => {
      c.setReg(6, u(c, 1));
    }
  },
  { address: 2147563688, module: "exe/fns", name: "isResourceServiceReady", run: (c, m) => num(isResourceServiceReady(m)) },
  { address: 2147564084, module: "exe/fns", name: "findFreeCacheSlot", run: (c, m) => num(findFreeCacheSlot(m)) },
  {
    address: 2147565148,
    module: "exe/fns",
    name: "resourceGetBase",
    requiresServices: true,
    // Both execution modes share the runtime's synchronous disc adapter.
    // The readiness cell is a FUNCTION POINTER, not the busy word.
    run: (c, m, services) => num(resourceGetBase(m, a(c, 0), {
      alloc: (size, tag) => services.alloc(size, tag),
      startTransfer: (id, buffer) => {
        if (!services.startTransfer) throw new Error("resourceGetBase needs the bank-transfer service");
        services.startTransfer(id, buffer);
      },
      clock: () => m.read32(2147802656) | 0,
      busyGate: () => isResourceServiceReady(m)
    }))
  },
  // exe/f5-f7 share f5's v1 residue: its first shift is in the guard delay
  // slot; positive ids then complete id*12. Consumers preserve that v1.
  {
    address: 2147562844,
    module: "exe/fns",
    name: "itemRecord",
    run: (c) => num(itemRecord(a(c, 0))),
    regs: (c) => c.setReg(3, Math.imul(a(c, 0), a(c, 0) <= 0 ? 2 : 12))
  },
  {
    address: 2147562884,
    module: "exe/fns",
    name: "itemIconClip",
    run: (c, m) => itemIconClip(m, a(c, 0)),
    regs: (c) => c.setReg(3, Math.imul(a(c, 0), a(c, 0) <= 0 ? 2 : 12))
  },
  {
    address: 2147562936,
    module: "exe/fns",
    name: "itemClassEquals",
    run: (c, m) => itemClassEquals(m, a(c, 0), a(c, 1)),
    regs: (c) => c.setReg(3, Math.imul(a(c, 0), a(c, 0) <= 0 ? 2 : 12))
  },
  { address: 2147566080, module: "exe/fns", name: "getLbaSectorLength", run: (c, m) => num(getLbaSectorLength(m, a(c, 0))) },
  { address: 2147584156, module: "exe/fns", name: "getPadButtons4A", run: (c, m) => num(getPadButtons4A(m, a(c, 0))) },
  { address: 2147577236, module: "exe/fns", name: "partyPositionToRosterSlot", run: (c, m) => num(partyPositionToRosterSlot(m, a(c, 0))) },
  { address: 2147577816, module: "exe/fns", name: "getFollowerRosterSlot", run: (c, m) => num(getFollowerRosterSlot(m, a(c, 0))) },
  { address: 2147576696, module: "exe/fns", name: "getCurrentShopId", run: (c, m) => num(getCurrentShopId(m)) },
  { address: 2147576712, module: "exe/fns", name: "requestScreenTransition", run: (c, m) => num(requestScreenTransition(m, a(c, 0), a(c, 1))) },
  { address: 2147651932, module: "exe/fns", name: "setDrawTPage", run: (c, m) => num(setDrawTPage(m, u(c, 0), a(c, 1), a(c, 2), a(c, 3))) },
  { address: 2147642140, module: "exe/fns", name: "drawTexPageCommand", run: (c) => num(drawTexPageCommand(a(c, 0), a(c, 1), a(c, 2))) },
  { address: 2147642172, module: "exe/fns", name: "drawAreaStartCommand", run: (c, m) => num(drawAreaStartCommand(m, a(c, 0), a(c, 1))) },
  { address: 2147642324, module: "exe/fns", name: "drawAreaEndCommand", run: (c, m) => num(drawAreaEndCommand(m, a(c, 0), a(c, 1))) },
  { address: 2147642476, module: "exe/fns", name: "drawOffsetCommand", run: (c) => num(drawOffsetCommand(a(c, 0), a(c, 1))) },
  { address: 2147642504, module: "exe/fns", name: "texWindowCommand", run: (c, m) => num(texWindowCommand(m, u(c, 0))) },
  { address: 2147675032, module: "exe/fns", name: "setIntrMask", run: (c, m) => num(setIntrMask(m, a(c, 0))) },
  // ── the Psy-Q stdout byte/flush pair (oracle tests/psx-stdio-oracle.test.js) ──
  // The native callers are the printf core 0x8002843C and its wrapper, which
  // stay MIPS; the pair's own fwrite boundary is the runtime's return-zero
  // BIOS stub (runtime.ts BIOS_FWRITE), so the port's host is a no-op with
  // identical observables and never re-enters the interpreter.
  { address: 2147650348, module: "exe/fns", name: "putchar", run: (c, m) => {
    const ch = a(c, 0);
    putchar(m, ch, STDIO_NOOP_HOST);
    return ch << 24 >> 24 === 9 ? 0 : m.read32(STDOUT_COUNT) | 0;
  } },
  { address: 2147650600, module: "exe/fns", name: "flushStdout", run: (c, m) => {
    if ((m.read32(STDOUT_COUNT) | 0) > 0) {
      flushStdout(m, STDIO_NOOP_HOST);
      return 0;
    }
    return c.reg(2);
  } },
  // FINAL DECISION (turn 352): printfFormat 0x8002843c stays NATIVE in mixed
  // mode. The single-entry experiment failed the differential gate
  // (memHash native=44cd208f vs bridge=7d8f9a3 on pro/cardgame,
  // logs/turn352-gate-formatter.log); the revert restores the baseline
  // (logs/turn352-gate-restored.log, turn352-gate-final.log). Cause not
  // isolated (see BRIDGE_BLOCKERS); the port remains oracle-proven and the
  // native body keeps executing in mixed mode. Do not re-install without a
  // passing gate run.
  { address: 2147606568, module: "exe/fns", name: "setRectColour", run: (c, m) => num(setRectColour(m, u(c, 0), a(c, 1), a(c, 2), a(c, 3))) },
  // text-element setters (the resident widget field writers)
  { address: 2147590584, module: "exe/fns", name: "setTextScroll", run: (c, m) => num(setTextScroll(m, u(c, 0), a(c, 1))) },
  { address: 2147590632, module: "exe/fns", name: "setTextWidgetOrigin", run: (c, m) => num(setTextWidgetOrigin(m, u(c, 0), a(c, 1), a(c, 2))) },
  { address: 2147590644, module: "exe/fns", name: "set_unk_0xc0_fns_8001a1f4", run: (c, m) => num(set_unk_0xc0_fns_8001a1f4(m, u(c, 0), a(c, 1))) },
  { address: 2147590660, module: "exe/fns", name: "setVectorAndActiveFlag", run: (c, m) => num(setVectorAndActiveFlag(m, u(c, 0), a(c, 1), a(c, 2))) },
  { address: 2147590716, module: "exe/fns", name: "setTextElementFlagC1", run: (c, m) => num(setTextElementFlagC1(m, u(c, 0), a(c, 1))) },
  { address: 2147591192, module: "exe/fns", name: "set_unk_0xc8_fns_8001a418", run: (c, m) => num(set_unk_0xc8_fns_8001a418(m, u(c, 0), a(c, 1))) },
  { address: 2147591240, module: "exe/fns", name: "set_unk_0x58_fns_8001a448", run: (c, m) => num(set_unk_0x58_fns_8001a448(m, u(c, 0), a(c, 1))) },
  { address: 2147591248, module: "exe/fns", name: "set_unk_0xbf_fns_8001a450", run: (c, m) => num(set_unk_0xbf_fns_8001a450(m, u(c, 0), a(c, 1))) },
  // text-element getters/state leaf (read-only) and the fetcher-table store.
  // F0x8001F738 touches no register, so the entry must preserve v0; callers
  // read it (the initFetcherTable caller's delay slot stores it at a0+8).
  { address: 2147591264, module: "exe/fns", name: "getUnkC3", run: (c, m) => num(getUnkC3(m, u(c, 0))) },
  { address: 2147591276, module: "exe/fns", name: "getUnkC1", run: (c, m) => num(getUnkC1(m, u(c, 0))) },
  { address: 2147591288, module: "exe/fns", name: "isState1", run: (c, m) => num(isState1(m, u(c, 0))) },
  // the text widget's visible-window rescan and the first control handlers.
  // rescanVisibleWindow (0x80019fb0) stays native: see BRIDGE_BLOCKERS.
  { address: 2147591912, module: "exe/fns", name: "textHandlerEntry0", run: (c, m) => num(textHandlerEntry0(m, u(c, 0), u(c, 1))) },
  { address: 2147591996, module: "exe/fns", name: "textHandlerWait", run: (c, m) => num(textHandlerWait(m, u(c, 0), u(c, 1), u(c, 2))) },
  { address: 2147592236, module: "exe/fns", name: "textHandlerSetText", run: (c, m) => num(textHandlerSetText(m, u(c, 0), u(c, 1))) },
  { address: 2147592372, module: "exe/fns", name: "textHandlerPageScan", run: (c, m) => num(textHandlerPageScan(m, u(c, 0), u(c, 1))) },
  { address: 2147592712, module: "exe/fns", name: "textHandlerNoop", run: () => 32771 },
  { address: 2147593008, module: "exe/fns", name: "textHandlerSetLine", run: (c, m) => num(textHandlerSetLine(m, u(c, 0), u(c, 1))) },
  { address: 2147612472, module: "exe/fns", name: "setCurrentFetcherTable", run: (c, m) => {
    setCurrentFetcherTable(m, u(c, 0));
    return c.reg(2);
  } },
  // ui-icon setters (the cursor/marker widgets)
  { address: 2147594316, module: "exe/fns", name: "uiIconSetVisible", run: (c, m) => num(uiIconSetVisible(m, u(c, 0), a(c, 1))) },
  { address: 2147594344, module: "exe/fns", name: "uiIconSetPos", run: (c, m) => num(uiIconSetPos(m, u(c, 0), a(c, 1), a(c, 2))) },
  { address: 2147594364, module: "exe/fns", name: "uiIconSetUnk60", run: (c, m) => num(uiIconSetUnk60(m, u(c, 0), a(c, 1))) },
  { address: 2147594380, module: "exe/fns", name: "uiIconSetRestTicks", run: (c, m) => num(uiIconSetRestTicks(m, u(c, 0), a(c, 1))) },
  { address: 2147594388, module: "exe/fns", name: "uiIconSetCycleTicks", run: (c, m) => num(uiIconSetCycleTicks(m, u(c, 0), a(c, 1))) },
  { address: 2147594396, module: "exe/fns", name: "uiIconSetUnk7c", run: (c, m) => num(uiIconSetUnk7c(m, u(c, 0), a(c, 1))) },
  // ── overlay leaves on the item-shop path ──
  // shopListMoveCursor (0x80088714) stays native: see BRIDGE_BLOCKERS.
  { address: 2148042800, module: "pro/stitshop", name: "shopListSelectedId", run: (c, m) => num(shopListSelectedId(m, u(c, 0))) },
  { address: 2148058248, module: "pro/stitshop", name: "shopLoad", run: (c, m) => num(shopLoad(m, a(c, 0))) },
  // ── overlay leaves exercised by the interaction phase (sound test) ──
  { address: 2148025404, module: "pro/soundtst", name: "soundTestScrollList", run: (c, m) => num(soundTestScrollList(m, a(c, 1), u(c, 2), u(c, 3), m.read32((c.reg(29) >>> 0) + 16) | 0)) },
  // ── resident roster accessor ──
  { address: 2147580748, module: "exe/fns", name: "persistentRosterSlot", run: (c) => num(persistentRosterSlot(a(c, 0))) },
  // ── the shared window-fold family, every executed module instance ──
  { address: 2148057820, module: "pro/stitshop", name: "windowFoldStart_stitshop", run: (c, m) => num(windowFoldStart(m, u(c, 0), a(c, 1))) },
  { address: 2148057968, module: "pro/stitshop", name: "windowFoldTick_stitshop", run: (c, m) => num(windowFoldTick(m, u(c, 0))) },
  { address: 2148030624, module: "pro/stcrdabm", name: "windowFoldStart_stcrdabm", run: (c, m) => num(windowFoldStart(m, u(c, 0), a(c, 1))) },
  { address: 2148030772, module: "pro/stcrdabm", name: "windowFoldTick_stcrdabm", run: (c, m) => num(windowFoldTick(m, u(c, 0))) },
  { address: 2148049624, module: "pro/stcrddek", name: "windowFoldStart_stcrddek_secondary", run: (c, m) => num(windowFoldStart(m, u(c, 0), a(c, 1))) },
  { address: 2148049772, module: "pro/stcrddek", name: "windowFoldTick_stcrddek_secondary", run: (c, m) => num(windowFoldTick(m, u(c, 0))) },
  { address: 2148044724, module: "pro/stcrdshp", name: "windowFoldStart_stcrdshp", run: (c, m) => num(windowFoldStart(m, u(c, 0), a(c, 1))) },
  { address: 2148044872, module: "pro/stcrdshp", name: "windowFoldTick_stcrdshp", run: (c, m) => num(windowFoldTick(m, u(c, 0))) },
  { address: 2148034352, module: "pro/stdgname", name: "windowFoldStart_stdgname_secondary", run: (c, m) => num(windowFoldStart(m, u(c, 0), a(c, 1))) },
  { address: 2148034500, module: "pro/stdgname", name: "windowFoldTick_stdgname_secondary", run: (c, m) => num(windowFoldTick(m, u(c, 0))) },
  { address: 2148031632, module: "pro/stfgtrep", name: "windowFoldStart_stfgtrep", run: (c, m) => num(windowFoldStart(m, u(c, 0), a(c, 1))) },
  { address: 2148031780, module: "pro/stfgtrep", name: "windowFoldTick_stfgtrep", run: (c, m) => num(windowFoldTick(m, u(c, 0))) },
  { address: 2148069932, module: "pro/stgdglab", name: "windowFoldStart_stgdglab", run: (c, m) => num(windowFoldStart(m, u(c, 0), a(c, 1))) },
  { address: 2148070080, module: "pro/stgdglab", name: "windowFoldTick_stgdglab", run: (c, m) => num(windowFoldTick(m, u(c, 0))) },
  { address: 2148055292, module: "pro/stgtrain", name: "windowFoldStart_stgtrain", run: (c, m) => num(windowFoldStart(m, u(c, 0), a(c, 1))) },
  { address: 2148055440, module: "pro/stgtrain", name: "windowFoldTick_stgtrain", run: (c, m) => num(windowFoldTick(m, u(c, 0))) },
  { address: 2148113756, module: "pro/ststatus", name: "windowFoldStart_ststatus", run: (c, m) => num(windowFoldStart(m, u(c, 0), a(c, 1))) },
  { address: 2148113904, module: "pro/ststatus", name: "windowFoldTick_ststatus", run: (c, m) => num(windowFoldTick(m, u(c, 0))) },
  // ── the duel's inter-phase banner queue (pro/cardgame) ──
  // the duel's inter-phase banner queue: pure field writes (the two widget
  // slots belong to showPhaseBanner/tickPhaseBanner, which stay native)
  { address: 2148145912, module: "pro/cardgame", name: "queueInterPhaseBanner", run: (c, m) => num(queueInterPhaseBanner(m, u(c, 0))) },
  // the tick's two queue services: the flag fan is pure memory; the announce
  // spawns the fade-wash task through the same factory the native path uses,
  // with the fade-wash slots called as ports (exactly what the original does
  // through the object's own slots)
  { address: 2148132396, module: "pro/cardgame", name: "applyQueuedGreyFlags", run: (c, m) => {
    applyQueuedGreyFlags(m, u(c, 0));
    return c.reg(2);
  } },
  { address: 2148132192, module: "pro/cardgame", name: "runQueuedAnnounce", requiresServices: true, run: (c, m, services) => {
    runQueuedAnnounce(m, {
      // the same call the native ALLOC stub makes: world.alloc(cb, size, extra, 0)
      allocate: (handler, size, extra) => services.allocObject(handler, size, extra, 0)
    }, u(c, 0), u(c, 1));
    return c.reg(2);
  } },
  // ── the duel's centre-plate queue (pro/cardgame) ──
  // resetViewPanels (F0x8009C264) is pure view stores, so the bridge can run
  // it in place of the MIPS body; the two slot openers (openBannerSlot
  // 0x8009BEAC, openPromptSlot 0x8009C054) fire the resident packed-sound stub
  // and stay native.
  { address: 2148123236, module: "pro/cardgame", name: "resetViewPanels", run: (c, m) => {
    resetViewPanels(m, u(c, 0));
    return c.reg(2);
  } },
  // ── album leaves (card album/folder) ──
  { address: 2148026888, module: "pro/stfgtrep", name: "reportRowMethod08", run: (c, m) => num(reportRowMethod08(m, u(c, 0))) },
  // ── title leaves (logo/wordmark/menu twinkle and exit) ──
  { address: 2148031580, module: "pro/stdwtitl", name: "titleMenuOutcome", run: (c, m) => num(titleMenuOutcome(m, u(c, 0))) },
  { address: 2148032604, module: "pro/stdwtitl", name: "titleTwinkleStepper", run: (c, m) => num(titleTwinkleStepper(m, u(c, 0), u(c, 1), a(c, 2))) },
  // ── country-select decor/palette leaves ──
  { address: 2148021364, module: "pro/cnty_sel", name: "paletteElementSetFrame", run: (c, m) => num(paletteElementSetFrame(m, a(c, 0), a(c, 1))) },
  // ── memory-card / lab / wizard leaves ──
  { address: 2148040668, module: "pro/stgmcard", name: "tweenLinearStart_stgmcard", run: (c, m) => num(tweenLinearStart(m, u(c, 0), a(c, 1), a(c, 2), a(c, 3))) },
  { address: 2148040732, module: "pro/stgmcard", name: "tweenLinearTick_stgmcard", run: (c, m) => num(tweenLinearTick(m, u(c, 0))) },
  { address: 2148068432, module: "pro/stgdglab", name: "labRootCountAndPackParty", run: (c, m) => num(labRootCountAndPackParty(m, u(c, 0))) },
  { address: 2148021144, module: "pro/stplnmet", name: "wizardIntroSetLayer", run: (c, m) => num(wizardIntroSetLayer(m, u(c, 0), a(c, 1), a(c, 2))) },
  { address: 2148116080, module: "pro/ststatus", name: "mapServerFromStage", run: (c, m) => num(mapServerFromStage(m)) },
  {
    address: 2148026864,
    module: "pro/stgmcard",
    name: "memcardBlockGridCreate",
    requiresServices: true,
    run: (c, m, s) => num(memcardBlockGridCreate(m, u(c, 0), {
      allocGrid: (handler, size, extra) => s.allocObject(handler, size, extra, 0),
      tweenStart: (obj, from, to, steps) => tweenLinearStart(m, u64(obj), from, to, steps)
    }))
  },
  {
    address: 2148127504,
    module: "pro/cardgame",
    name: "createCardBattleContext",
    requiresServices: true,
    run: (c, m, s) => num(createCardBattleContext(m, u(c, 0), {
      allocateView: (handler, size, slot) => s.allocObject(handler, size, slot, 0)
    }))
  },
  // ── factory constructors whose host already names the factory args ──
  {
    address: 2148022904,
    module: "pro/stcrdabm",
    name: "albumGridCreate",
    requiresServices: true,
    run: (c, m, s) => num(albumGridCreate(m, factoryHost(s, GRID_HANDLER), a(c, 0))),
    regs: (c) => {
      c.setReg(4, 2148022344);
      c.setReg(5, 140);
      c.setReg(6, 0);
      c.setReg(3, 6);
    }
  },
  {
    address: 2148030828,
    module: "pro/stitshop",
    name: "shopActorBuy",
    requiresServices: true,
    run: (c, m, s) => num(shopActorBuy(m, factoryHost(s, SHOP_ACTOR_BUY_HANDLER), a(c, 0)))
  },
  {
    address: 2148037588,
    module: "pro/stitshop",
    name: "shopActorSell",
    requiresServices: true,
    run: (c, m, s) => num(shopActorSell(m, factoryHost(s, SHOP_ACTOR_SELL_HANDLER), a(c, 0)))
  },
  {
    address: 2148050448,
    module: "pro/stgdglab",
    name: "selectActionConstruct",
    requiresServices: true,
    run: (c, m, s) => num(selectActionConstruct(m, { alloc: (h, size, extra) => s.allocObject(h, size, extra, 0) }, a(c, 0))),
    regs: (c) => {
      c.setReg(4, 2148050204);
      c.setReg(5, 284);
      c.setReg(6, 76);
      c.setReg(3, 2);
    }
  },
  {
    address: 2148023148,
    module: "pro/stgmcard",
    name: "memcardSaveCardCreate",
    requiresServices: true,
    run: (c, m, s) => num(memcardSaveCardCreate(m, a(c, 0), { allocCard: (h, size, extra) => s.allocObject(h, size, extra, 0) }))
  },
  {
    address: 2148038552,
    module: "pro/stgmcard",
    name: "memcardMessageWindowCreate",
    requiresServices: true,
    run: (c, m, s) => num(memcardMessageWindowCreate(m, a(c, 0), { allocMessageWindow: (h, size, extra) => s.allocObject(h, size, extra, 0) })),
    regs: (c) => {
      c.setReg(4, 2148037940);
      c.setReg(5, 10332);
      c.setReg(6, 40);
      c.setReg(3, 4096);
    }
  },
  {
    address: 2148069328,
    module: "pro/stgdglab",
    name: "labRootConstruct",
    requiresServices: true,
    run: (c, m, s) => num(labRootConstruct(m, { allocLabRoot: (h, size, extra) => s.allocObject(h, size, extra, 0) }))
  },
  {
    address: 2148029084,
    module: "pro/stdwtitl",
    name: "titleLogoCreate",
    requiresServices: true,
    run: (c, m, s) => num(titleLogoCreate(m, a(c, 0), { allocTitleTask: (h, size, extra) => s.allocObject(h, size, extra, 0) }))
  },
  {
    address: 2148034528,
    module: "pro/stdwtitl",
    name: "titleBackgroundCreate",
    requiresServices: true,
    run: (c, m, s) => num(titleBackgroundCreate(m, a(c, 0), { allocTitleTask: (h, size, extra) => s.allocObject(h, size, extra, 0) }))
  },
  {
    address: 2148021220,
    module: "pro/stdwtitl",
    name: "titleDecoLayerCreate",
    requiresServices: true,
    run: (c, m, s) => num(titleDecoLayerCreate(m, a(c, 0), { allocTitleTask: (h, size, extra) => s.allocObject(h, size, extra, 0) }))
  },
  {
    address: 2148025576,
    module: "pro/stdwtitl",
    name: "titleGlowCreate",
    requiresServices: true,
    run: (c, m, s) => num(titleGlowCreate(m, a(c, 0), { allocTitleTask: (h, size, extra) => s.allocObject(h, size, extra, 0) }))
  },
  {
    address: 2148027888,
    module: "pro/stdwtitl",
    name: "titleWordmarkCreate",
    requiresServices: true,
    run: (c, m, s) => num(titleWordmarkCreate(m, a(c, 0), { allocTitleTask: (h, size, extra) => s.allocObject(h, size, extra, 0) }))
  },
  {
    address: 2148031592,
    module: "pro/stdwtitl",
    name: "titleMenuCreate",
    requiresServices: true,
    run: (c, m, s) => num(titleMenuCreate(m, a(c, 0), { allocTitleTask: (h, size, extra) => s.allocObject(h, size, extra, 0) }))
  },
  {
    address: 2148036016,
    module: "pro/stdwtitl",
    name: "titleSequenceCreate",
    requiresServices: true,
    run: (c, m, s) => num(titleSequenceCreate(m, a(c, 0), { allocTitleTask: (h, size, extra) => s.allocObject(h, size, extra, 0) }))
  },
  {
    address: 2148023020,
    module: "pro/stgtrain",
    name: "gymHudConstruct",
    requiresServices: true,
    run: (c, m, s) => num(gymHudConstruct(m, u(c, 0), u(c, 1), gymHudHost(m, s)))
  },
  {
    address: 2148118728,
    module: "pro/fightstg",
    name: "commandMenuCreate",
    requiresServices: true,
    run: (c, m, s) => num(commandMenuCreate(m, u(c, 0), commandMenuHost(s)))
  },
  {
    address: 2148089756,
    module: "pro/fightstg",
    name: "commandMenuActorConstruct",
    requiresServices: true,
    run: (c, m, s) => num(commandMenuActorConstruct(m, u(c, 0), u(c, 1), commandMenuHost(s)))
  },
  {
    address: 2148176668,
    module: "pro/wfightts",
    name: "wfightPanelCreate",
    requiresServices: true,
    run: (c, m, s) => num(wfightPanelCreate(m, u(c, 0), a(c, 1), wfightHost(s))),
    regs: (c, m) => {
      c.setReg(4, 2148175156);
      c.setReg(5, 256);
      c.setReg(6, 112);
      c.setReg(7, 65535);
      void m;
    }
  },
  {
    address: 2148081228,
    module: "pro/ststatus",
    name: "pauseItemsRootFactory",
    requiresServices: true,
    run: (c, m, s) => num(pauseItemsRootFactory(m, u(c, 0), pauseItemsHost(s))),
    regs: (c, m) => {
      c.setReg(4, 2148080920);
      c.setReg(5, 1116);
      c.setReg(6, 212);
      c.setReg(3, 6);
      void m;
    }
  },
  {
    address: 2147564028,
    module: "exe/fns",
    name: "findCacheSlotById",
    run: (c, m) => num(findCacheSlotById(m, a(c, 0))),
    regs: (c, m) => {
      const id = a(c, 0);
      let v1 = 2147765052;
      let a1 = 0;
      for (let i = 0; i < 64; i++) {
        a1 = i + 1;
        if ((m.read32(v1 + 4) | 0) === id) {
          c.setReg(3, v1 >>> 0);
          c.setReg(5, a1);
          return;
        }
        v1 = v1 + 16 >>> 0;
      }
      c.setReg(3, v1 >>> 0);
      c.setReg(5, a1);
    }
  },
  // ── Psy-Q display env leaves: pure struct writes, fifth argument on the stack ──
  {
    address: 2147651692,
    module: "exe/fns",
    name: "setDefDispEnv",
    run: (c, m) => num(setDefDispEnv(m, u(c, 0), a(c, 1), a(c, 2), a(c, 3), m.read32(c.reg(29) + 16 >>> 0) | 0))
  },
  {
    address: 2147651500,
    module: "exe/fns",
    name: "setDefDrawEnv",
    run: (c, m) => num(setDefDrawEnv(m, u(c, 0), a(c, 1), a(c, 2), a(c, 3), m.read32(c.reg(29) + 16 >>> 0) | 0))
  },
  {
    address: 2147677568,
    module: "exe/fns",
    name: "displayModeWord",
    run: (c, m) => num(displayModeWord(m))
  },
  // ── remaining screen/task creators from the factory inventory ──
  {
    address: 2148030060,
    module: "pro/stcrdabm",
    name: "albumScreenCreate",
    requiresServices: true,
    run: (c, m, s) => {
      const fh = factoryHost(s, ALBUM_SCREEN_HANDLER);
      return num(albumScreenCreate(m, { alloc: (size) => fh.alloc(size) }));
    }
  },
  {
    address: 2148033968,
    module: "pro/stdgname",
    name: "nameScreenCreate",
    requiresServices: true,
    run: (c, m, s) => {
      const fh = factoryHost(s, NAME_SCREEN_HANDLER);
      return num(nameScreenCreate(m, { alloc: (size) => fh.alloc(size) }));
    }
  },
  {
    address: 2148032836,
    module: "pro/stdgname",
    name: "partnerSelectCreate",
    requiresServices: true,
    run: (c, m, s) => num(partnerSelectCreate(m, u(c, 0), nameSequenceHost(s))),
    regs: (c) => {
      c.setReg(4, PARTNER_SELECT_HANDLER);
      c.setReg(5, PARTNER_SELECT_SIZE);
      c.setReg(6, PARTNER_SELECT_EXTRA);
      c.setReg(3, 4096);
    }
  },
  {
    address: 2148164628,
    module: "pro/wfightmn",
    name: "wfightMenuFactory",
    requiresServices: true,
    run: (c, m, s) => num(wfightMenuFactory(wfightMenuHost(s))),
    regs: (c) => {
      c.setReg(4, WFIGHT_MENU_HANDLER);
      c.setReg(5, WFIGHT_MENU_SIZE);
      c.setReg(6, 0);
    }
  },
  {
    address: 2148021652,
    module: "pro/cnty_sel",
    name: "createPaletteElement",
    requiresServices: true,
    run: (c, m, s) => num(createPaletteElement(m, { allocate: (h, size, slot) => s.allocObject(h, size, slot, 0) })),
    regs: (c) => {
      c.setReg(4, COUNTRY_PALETTE_ELEMENT_HANDLER);
      c.setReg(5, COUNTRY_PALETTE_ELEMENT_SIZE);
      c.setReg(6, 0);
    }
  },
  {
    address: 2148032164,
    module: "pro/stagslct",
    name: "stageSelectMenuCreate",
    requiresServices: true,
    run: (c, m, s) => num(stageSelectMenuCreate({ allocTask: (h, size, widget) => s.allocObject(h, size, widget, 0) })),
    regs: (c) => {
      c.setReg(4, STAGE_SELECT_MENU_TASK.handler);
      c.setReg(5, STAGE_SELECT_MENU_TASK.size);
      c.setReg(6, STAGE_SELECT_MENU_TASK.widget);
    }
  },
  {
    address: 2148026780,
    module: "pro/shocktst",
    name: "shockTestCreate",
    requiresServices: true,
    run: (c, m, s) => num(shockTestCreate({ allocTask: (h, size, widget) => s.allocObject(h, size, widget, 0) })),
    regs: (c) => {
      c.setReg(4, SHOCK_TEST_TASK.handler);
      c.setReg(5, SHOCK_TEST_TASK.size);
      c.setReg(6, SHOCK_TEST_TASK.widget);
    }
  },
  {
    address: 2148027720,
    module: "pro/soundtst",
    name: "soundTestCreate",
    requiresServices: true,
    run: (c, m, s) => num(soundTestCreate({ allocTask: (h, size, widget) => s.allocObject(h, size, widget, 0) })),
    regs: (c) => {
      c.setReg(4, SOUND_TEST_TASK.handler);
      c.setReg(5, SOUND_TEST_TASK.size);
      c.setReg(6, SOUND_TEST_TASK.widget);
    }
  },
  // ── wizard (pro/stplnmet): the five object creators ──
  // Each body is F0x80014504(handler, size, extra) plus inline field writes;
  // the residue is the factory call's registers and the last immediate.
  {
    address: 2148021156,
    module: "pro/stplnmet",
    name: "wizardIntroCreate",
    requiresServices: true,
    run: (c, m, s) => {
      const host = wizardAnimHost(s);
      return num(wizardIntroCreate(m, host));
    },
    regs: (c) => {
      c.setReg(4, WIZARD_INTRO_HANDLER);
      c.setReg(5, WIZARD_INTRO_SIZE);
      c.setReg(6, 0);
      c.setReg(3, 2148021144);
    }
  },
  {
    address: 2148022088,
    module: "pro/stplnmet",
    name: "wizardTableDwellCreate",
    requiresServices: true,
    run: (c, m, s) => num(wizardTableDwellCreate(m, wizardAnimHost(s))),
    regs: (c) => {
      c.setReg(4, WIZARD_TABLE_DWELL_HANDLER);
      c.setReg(5, WIZARD_TABLE_DWELL_SIZE);
      c.setReg(6, 0);
    }
  },
  {
    address: 2148021700,
    module: "pro/stplnmet",
    name: "wizardFrameStepCreate",
    requiresServices: true,
    run: (c, m, s) => num(wizardFrameStepCreate(m, wizardAnimHost(s))),
    regs: (c) => {
      c.setReg(4, WIZARD_FRAME_STEP_HANDLER);
      c.setReg(5, WIZARD_FRAME_STEP_SIZE);
      c.setReg(6, 0);
    }
  },
  {
    address: 2148023608,
    module: "pro/stplnmet",
    name: "wizardChromeCreate",
    requiresServices: true,
    run: (c, m, s) => num(wizardChromeCreate(m, u(c, 0), wizardChromeHost(s))),
    regs: (c) => {
      c.setReg(4, WIZARD_CHROME_HANDLER);
      c.setReg(5, WIZARD_CHROME_SIZE);
      c.setReg(6, WIZARD_CHROME_EXTRA);
    }
  },
  {
    address: 2148041380,
    module: "pro/stplnmet",
    name: "wizardRootCreate",
    requiresServices: true,
    run: (c, m, s) => num(wizardRootCreate(m, { allocWizardRoot: (h, size, extra) => s.allocObject(h, size, extra, 0) })),
    regs: (c) => {
      c.setReg(4, 2148041016);
      c.setReg(5, WIZARD_ROOT_SIZE);
      c.setReg(6, WIZARD_ROOT_EXTRA);
      c.setReg(3, 5);
    }
  },
  // ── country select: five argument-less factory thunks (pro/cnty_sel) ──
  // Each body is F0x80014504(cb, size, extra) and returns the object; the
  // residue is the factory call's registers (the callback, size and extra).
  {
    address: 2148025236,
    module: "pro/cnty_sel",
    name: "countrySelectRootCreate",
    requiresServices: true,
    run: (c, m, s) => num(countrySelectRootCreate({ alloc: (cb, size, extra) => s.allocObject(cb, size, extra, 0) })),
    regs: (c) => {
      c.setReg(4, CNTY_ROOT_TICK);
      c.setReg(5, 84);
      c.setReg(6, 20);
    }
  },
  {
    address: 2148020952,
    module: "pro/cnty_sel",
    name: "countrySelectFadeCreate",
    requiresServices: true,
    run: (c, m, s) => num(countrySelectFadeCreate({ alloc: (cb, size, extra) => s.allocObject(cb, size, extra, 0) })),
    regs: (c) => {
      c.setReg(4, CNTY_FADE_TICK);
      c.setReg(5, 84);
      c.setReg(6, 0);
    }
  },
  {
    address: 2148022276,
    module: "pro/cnty_sel",
    name: "countrySelectLeftCreate",
    requiresServices: true,
    run: (c, m, s) => num(countrySelectLeftCreate({ alloc: (cb, size, extra) => s.allocObject(cb, size, extra, 0) })),
    regs: (c) => {
      c.setReg(4, CNTY_LEFT_BREATHE_TICK);
      c.setReg(5, 88);
      c.setReg(6, 0);
    }
  },
  {
    address: 2148022888,
    module: "pro/cnty_sel",
    name: "countrySelectRightCreate",
    requiresServices: true,
    run: (c, m, s) => num(countrySelectRightCreate({ alloc: (cb, size, extra) => s.allocObject(cb, size, extra, 0) })),
    regs: (c) => {
      c.setReg(4, CNTY_RIGHT_BREATHE_TICK);
      c.setReg(5, 88);
      c.setReg(6, 0);
    }
  },
  {
    address: 2148023532,
    module: "pro/cnty_sel",
    name: "countrySelectBottomCreate",
    requiresServices: true,
    run: (c, m, s) => num(countrySelectBottomCreate({ alloc: (cb, size, extra) => s.allocObject(cb, size, extra, 0) })),
    regs: (c) => {
      c.setReg(4, CNTY_BOTTOM_BREATHE_TICK);
      c.setReg(5, 88);
      c.setReg(6, 0);
    }
  },
  {
    address: 2148049080,
    module: "pro/stcrddek",
    name: "folderScreenCreate",
    requiresServices: true,
    run: (c, m, s) => {
      const fh = factoryHost(s, FOLDER_SCREEN_HANDLER);
      return num(folderScreenCreate(m, { alloc: (size) => fh.alloc(size) }));
    },
    regs: (c, m) => {
      c.setReg(4, 2148048536);
      c.setReg(5, 288);
      c.setReg(6, 108);
      c.setReg(3, 7);
      void m;
    }
  },
  // ── allocating constructors on the screen paths (need the heap service) ──
  {
    address: 2147593784,
    module: "exe/fns",
    name: "createTextElement",
    requiresServices: true,
    run: (c, m, s) => num(createTextElement(m, factoryHost(s, TEXT_ELEMENT_HANDLER), u(c, 0), a(c, 1), a(c, 2), a(c, 3)))
  },
  {
    address: 2147586928,
    module: "exe/fns",
    name: "widgetSetLineString",
    requiresServices: true,
    run: (c, m, s) => {
      widgetSetLineString(m, s, u(c, 0), u(c, 1), a(c, 2));
      const len = m.read16(u(c, 1) + 6) | 0;
      return len === 0 ? 1 : m.read16(u(c, 0) + 170) << 16 >> 16;
    },
    regs: (c, m) => {
      const self = u(c, 0), line = u(c, 1), cstr = u(c, 2);
      const len = m.read16(line + 6) | 0;
      if (len === 0) return;
      c.setReg(4, self);
      c.setReg(6, 0);
      c.setReg(3, m.read32(line + 0) >>> 0);
      if (m.read16(self + 170) === 0) c.setReg(5, 0);
      else c.setReg(5, cstr + len >>> 0);
    }
  },
  // the token stepper and the two handlers that complete its table
  {
    address: 2147591308,
    module: "exe/fns",
    name: "stepToken",
    requiresServices: true,
    run: (c, m, s) => num(stepToken(m, textResourceHost(m, s), u(c, 0), u(c, 1), u(c, 2), u(c, 3)))
  },
  {
    address: 2147592720,
    module: "exe/fns",
    name: "textNextGlyph",
    requiresServices: true,
    run: (c, m, s) => num(textNextGlyph(m, textResourceHost(m, s), u(c, 0), u(c, 1), u(c, 2)))
  },
  {
    address: 2147593124,
    module: "exe/fns",
    name: "textHandlerPlayerName",
    requiresServices: true,
    run: (c, m, s) => num(textHandlerPlayerName(m, textResourceHost(m, s), u(c, 0), u(c, 1)))
  },
  {
    address: 2147587724,
    module: "exe/fns",
    name: "setWidgetStringIndexed",
    requiresServices: true,
    run: (c, m, s) => {
      const self = u(c, 0);
      const index = a(c, 2);
      setWidgetStringIndexed(m, s, self, u(c, 1), index);
      const line = (index - 1 >>> 0 < 5 ? self + 92 + index * 12 : self + 92) >>> 0;
      const len = m.read16(line + 6) | 0;
      return len === 0 ? 1 : m.read16(self + 170) << 16 >> 16;
    }
  },
  {
    address: 2148027116,
    module: "pro/stfgtrep",
    name: "reportRowCreate",
    requiresServices: true,
    run: (c, m, s) => num(reportRowCreate(m, factoryHost(s, REPORT_ROW_HANDLER), u(c, 0), a(c, 1), a(c, 2)))
  },
  {
    address: 2147595108,
    module: "exe/fns",
    name: "spawnUiIcon",
    requiresServices: true,
    run: (c, m, s) => num(spawnUiIcon(m, factoryHost(s, UI_ICON_HANDLER), u(c, 0), a(c, 1), a(c, 2), a(c, 3))),
    regs: (c) => {
      c.setReg(4, 2147594404);
      c.setReg(5, 152);
      c.setReg(6, 4);
      c.setReg(3, 2147594396);
    }
  },
  {
    address: 2148043176,
    module: "pro/stitshop",
    name: "shopListCreate",
    requiresServices: true,
    run: (c, m, s) => num(shopListCreate(m, factoryHost(s, SHOP_LIST_TICK), u(c, 0), a(c, 1), a(c, 2))),
    regs: (c) => {
      c.setReg(4, 2148040384);
      c.setReg(5, 1796);
      c.setReg(6, 80);
      c.setReg(3, 4);
    }
  },
  {
    address: 2148057368,
    module: "pro/stitshop",
    name: "shopRootCreate",
    requiresServices: true,
    run: (c, m, s) => num(shopRootCreate(m, factoryHost(s, SHOP_ROOT_HANDLER)))
  },
  {
    address: 2148054148,
    module: "pro/stitshop",
    name: "bandCreate",
    requiresServices: true,
    run: (c, m, s) => num(bandCreate(m, factoryHost(s, BAND_HANDLER), a(c, 0), a(c, 1))),
    regs: (c) => {
      c.setReg(4, 2148052840);
      c.setReg(5, 584);
      c.setReg(6, 172);
      c.setReg(3, 1);
    }
  }
];
var key = (module, address) => `${module}:0x${(address >>> 0).toString(16)}`;
var byModule = /* @__PURE__ */ new Map();
for (const entry of BRIDGE_ENTRIES) {
  const list = byModule.get(entry.module) ?? [];
  list.push(entry);
  byModule.set(entry.module, list);
}
var invocations = /* @__PURE__ */ new Map();
var bridgeProbe = null;
function setBridgeProbe(fn) {
  bridgeProbe = fn;
}
function bridgeInvocations() {
  return invocations;
}
function bridgeEntriesFor(modules) {
  const want = /* @__PURE__ */ new Set(["exe/fns", ...modules]);
  return BRIDGE_ENTRIES.filter((e) => want.has(e.module));
}
function isBridged(module, address) {
  const list = byModule.get(module);
  return list !== void 0 && list.some((e) => e.address === address >>> 0);
}
function installTranslationBridge(cpu, mem, modules, only, services) {
  let installed = 0;
  for (const entry of bridgeEntriesFor(modules)) {
    if (only !== void 0 && only !== null && !only.has(entry.address)) continue;
    if (entry.requiresServices === true && (services === void 0 || services === null)) continue;
    const entryKey = key(entry.module, entry.address);
    cpu.setStub(entry.address, (c) => {
      invocations.set(entryKey, (invocations.get(entryKey) ?? 0) + 1);
      const ret = entry.run(c, mem, services ?? null);
      entry.regs?.(c, mem);
      bridgeProbe?.(entry, c, ret);
      return ret;
    });
    installed += 1;
  }
  return installed;
}
function bridgeAddresses(modules) {
  return bridgeEntriesFor(modules).map((e) => e.address);
}

// tools/native_screen_probe.ts
var TRANSLATED_FUNCTIONS = JSON.parse(
  readFileSync(new URL("../data/translated_functions.json", import.meta.url), "utf8")
);
var TRANSLATED_BY_ADDRESS = /* @__PURE__ */ new Map();
for (const e of TRANSLATED_FUNCTIONS) {
  const a2 = parseInt(e.address, 16) >>> 0;
  const list = TRANSLATED_BY_ADDRESS.get(a2);
  if (list === void 0) TRANSLATED_BY_ADDRESS.set(a2, [e]);
  else list.push(e);
}
function isTranslated(module, address) {
  const list = TRANSLATED_BY_ADDRESS.get(address >>> 0);
  if (list === void 0) return false;
  return list.some((e) => e.module === void 0 || e.module === module);
}
var ROOT = fileURLToPath(new URL("..", import.meta.url));
var INVENTORY = join(ROOT, "recovered/ddw3/function-inventory.json");
var SEMANTICS = join(ROOT, "recovered/ddw3/semantics.json");
var ASM = join(homedir(), "ddw3/asm/dw2003/pro");
var SPECS_PATH = join(ROOT, "data/native_screen_roots.json");
var DEFAULT_REPORT_BASE = join(
  ROOT,
  ".dw3-research/bulk-port-plan-2026-09-14/screen-coverage-2026-09-14"
);
function num2(v) {
  if (v === void 0) return void 0;
  return v.startsWith("0x") ? Number(BigInt(v)) >>> 0 : Number(v) >>> 0;
}
var FNV_OFFSET = 2166136261;
var fnvByte = (h, b) => Math.imul(h ^ b & 255, 16777619) >>> 0;
var fnvWord = (h, w) => fnvByte(fnvByte(fnvByte(fnvByte(h, w), w >>> 8), w >>> 16), w >>> 24);
function u32(v) {
  if (typeof v === "number") return v >>> 0;
  if (typeof v === "string") return (v.startsWith("0x") ? Number.parseInt(v, 16) : Number(v)) >>> 0;
  throw new Error(`not an address: ${String(v)}`);
}
var inventory = existsSync(INVENTORY) ? JSON.parse(readFileSync(INVENTORY, "utf8")) : { modules: [] };
var semantics = existsSync(SEMANTICS) ? JSON.parse(readFileSync(SEMANTICS, "utf8")) : { functions: {}, families: {} };
function indexModule(modId) {
  const mod = inventory.modules.find((m) => m.id === modId);
  if (!mod) return [];
  const starts = /* @__PURE__ */ new Map();
  const put = (addr, name, end, overwrite) => {
    const rec = starts.get(addr);
    if (!rec) {
      starts.set(addr, { name, end });
      return;
    }
    const should = overwrite === true || typeof overwrite === "function" && overwrite(rec.name);
    if (should) rec.name = name;
    if (end > rec.end) rec.end = end;
  };
  for (const f of mod.functions ?? []) {
    const addr = u32(f.address ?? 0);
    if (addr) put(addr, String(f.semantic_name ?? f.original_name ?? f.id ?? `0x${addr.toString(16)}`), u32(f.provisional_end_address ?? 0), false);
  }
  for (const f of mod.pointer_candidates ?? []) {
    const addr = u32(f.address ?? f.target_address ?? 0);
    if (addr) put(addr, String(f.original_name ?? f.id ?? `0x${addr.toString(16)}`), 0, false);
  }
  for (const [key2, fn] of Object.entries(semantics.functions ?? {})) {
    const [m, a2] = key2.split(":");
    if (m !== modId || !a2) continue;
    const addr = u32(a2.replace(/^F0x/, "0x"));
    if (addr) put(addr, fn.name ?? `0x${addr.toString(16)}`, 0, true);
  }
  for (const family of Object.values(semantics.families ?? {})) {
    for (const [key2, name] of Object.entries(family.members ?? {})) {
      const [m, a2] = key2.split(":");
      if (m !== modId || !a2) continue;
      const addr = u32(a2.replace(/^F0x/, "0x"));
      if (addr) put(addr, name, 0, (old) => /(^|:)F0x[0-9a-f]+$/.test(old) || /:C0x[0-9a-f]+$/.test(old) || /^0x/.test(old));
    }
  }
  if (modId === "exe/fns") {
    const extentsPath = join(ROOT, "docs/generated/function-extents.json");
    const extents = existsSync(extentsPath) ? JSON.parse(readFileSync(extentsPath, "utf8")) : { sources: {} };
    for (const [source, record] of Object.entries(extents.sources)) {
      if (!/\/asm\/dw2003\/exe\/f[0-9]\.s$/.test(source)) continue;
      for (const f of record.functions) put(u32(f.address), f.name, 0, false);
    }
  }
  const sorted = [...starts.entries()].map(([address, v]) => ({ address, ...v })).sort((a2, b) => a2.address - b.address);
  const out = [];
  for (let i = 0; i < sorted.length; i++) {
    const cur = sorted[i];
    const next = sorted[i + 1];
    let end = cur.end > cur.address ? cur.end + 4 : next ? next.address : cur.address + 4;
    if (next && end > next.address) end = next.address;
    out.push({ address: cur.address, end, name: cur.name, module: modId });
  }
  return out;
}
function fnAt(index, addr) {
  let lo = 0;
  let hi = index.length - 1;
  let found;
  while (lo <= hi) {
    const mid = lo + hi >> 1;
    if (index[mid].address <= addr) {
      found = index[mid];
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found && addr < found.end ? found : void 0;
}
var byStart = /* @__PURE__ */ new Map();
for (const m of inventory.modules) {
  for (const f of m.functions ?? []) {
    byStart.set(u32(f.address), `${m.id}:${f.semantic_name ?? f.original_name ?? f.id}`);
  }
}
var WORD_RE = /\.[Ll]0x([0-9a-f]{8}): (?:\.word 0x([0-9a-f]+)|.*?# \.word 0x([0-9a-f]+))/g;
function loadImage(path, base) {
  const text = readFileSync(path, "utf8");
  const words = /* @__PURE__ */ new Map();
  let absolute = true;
  for (const m of text.matchAll(WORD_RE)) {
    const key2 = Number.parseInt(m[1], 16);
    if (key2 < 16777216) absolute = false;
    words.set(key2, Number.parseInt(m[2] ?? m[3], 16) >>> 0);
  }
  if (words.size === 0) throw new Error(`no .word annotations in ${path}`);
  if (absolute) {
    const shifted = /* @__PURE__ */ new Map();
    for (const [key2, word] of words) shifted.set(key2 - base, word);
    words.clear();
    for (const [key2, word] of shifted) words.set(key2, word);
  }
  let size = 0;
  for (const off of words.keys()) size = Math.max(size, off + 4);
  const img = new Uint8Array(size);
  const view = new DataView(img.buffer);
  for (const [off, word] of words) view.setUint32(off, word, true);
  return img;
}
function openDisc(path) {
  if (!existsSync(path)) return null;
  return openSync(path, "r");
}
function readSectors(fd, lba, bytes) {
  const out = Buffer.alloc(bytes);
  const sec = Buffer.alloc(2352);
  let done = 0;
  for (let s = 0; done < bytes; s++) {
    readSync(fd, sec, 0, 2352, (lba + s) * 2352);
    const n = Math.min(2048, bytes - done);
    sec.copy(out, done, 24, 24 + n);
    done += n;
  }
  return out;
}
function loadOverlayFromDisc(fd, exe, index) {
  const data = exe.image;
  const lbaOff = 2147766124 - exe.base + index * 4;
  const lenOff = 2147775652 - exe.base + index * 2;
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const lba = dv.getUint32(lbaOff, true) >>> 0;
  const sectors = dv.getUint16(lenOff, true);
  if (lba === 0 || sectors === 0) throw new Error(`overlay index ${index} has no disc extent`);
  return new Uint8Array(readSectors(fd, lba, sectors << 11));
}
function loadExe(fd) {
  const head = readSectors(fd, 24, 2048);
  if (head.toString("latin1", 0, 8) !== "PS-X EXE") throw new Error("disc LBA 24 is not a PS-X EXE");
  const tAddr = head.readUInt32LE(24);
  const tSize = head.readUInt32LE(28);
  const exe = readSectors(fd, 24, 2048 + tSize);
  return { image: new Uint8Array(exe.subarray(2048, 2048 + tSize)), base: tAddr };
}
function loadSpecs(path = SPECS_PATH) {
  const raw = JSON.parse(readFileSync(path, "utf8"));
  if (!Array.isArray(raw)) throw new Error(`${path} is not a spec array`);
  return raw.map((r) => ({
    module: String(r.module),
    ctor: u32(r.ctor),
    tick: u32(r.tick),
    discIndex: r.disc_index === void 0 ? void 0 : u32(r.disc_index),
    actor: r.actor === void 0 ? void 0 : String(r.actor),
    parentSize: r.parentSize === void 0 ? void 0 : u32(r.parentSize),
    ctorArg: r.ctorArg === void 0 ? void 0 : u32(r.ctorArg)
  }));
}
var PAD_UP = 16;
var PAD_RIGHT = 32;
var PAD_DOWN = 64;
var PAD_LEFT = 128;
var PAD_CIRCLE = 8192;
var PAD_CROSS = 16384;
var INTERACT_TAP_FRAMES = 16;
var INTERACT_HOLD_FRAMES = 2;
var INTERACT_SCHEDULE = [
  PAD_DOWN,
  PAD_DOWN,
  PAD_RIGHT,
  PAD_CROSS,
  PAD_CIRCLE,
  PAD_UP,
  PAD_LEFT,
  PAD_CROSS
];
var INTERACT_FRAMES = INTERACT_SCHEDULE.length * INTERACT_TAP_FRAMES;
function interactionPad(frame) {
  const tap = Math.floor(frame / INTERACT_TAP_FRAMES);
  if (tap >= INTERACT_SCHEDULE.length) return 0;
  return frame % INTERACT_TAP_FRAMES < INTERACT_HOLD_FRAMES ? INTERACT_SCHEDULE[tap] : 0;
}
function runScreen(spec, opts = {}) {
  const idleFrames = opts.frames ?? 60;
  const interact = opts.interact === true;
  const bridge = opts.bridge === true;
  const interactionFrames = interact ? INTERACT_FRAMES : 0;
  const frames = idleFrames + interactionFrames;
  const moduleId = spec.module;
  const mod = inventory.modules.find((m) => m.id === moduleId);
  if (!mod) throw new Error(`module ${moduleId} not in inventory`);
  const base = u32(mod.load_base);
  const localIndex = indexModule(moduleId);
  const discPath = opts.discPath ?? process.env.DW3_DISC ?? join(process.env.DDW3_DIR ?? join(homedir(), "ddw3"), "build/iso/dw2003.bin");
  const discFd = opts.noExe ? null : openDisc(discPath);
  const exe = discFd !== null ? loadExe(discFd) : null;
  let image;
  if (discFd !== null && exe && spec.discIndex !== void 0) {
    image = loadOverlayFromDisc(discFd, exe, spec.discIndex);
  } else {
    const asmName = mod.source.split("/").pop();
    image = loadImage(join(ASM, asmName), base);
  }
  const overlayEnd = base + image.length >>> 0;
  const residentIndex = exe ? indexModule("exe/fns") : [];
  const residentBase = exe ? exe.base : 0;
  const residentEnd = exe ? exe.base + exe.image.length >>> 0 : 0;
  const resolveWithOffset = (addr) => {
    const a2 = addr >>> 0;
    const idx = a2 >= base && a2 < overlayEnd ? localIndex : exe && a2 >= residentBase && a2 < residentEnd ? residentIndex : null;
    if (idx) {
      const f = fnAt(idx, a2);
      if (f) return `${f.module}:${f.name}${a2 !== f.address ? `+0x${(a2 - f.address).toString(16)}` : ""}`;
      return `0x${a2.toString(16)}`;
    }
    return byStart.get(a2) ?? `0x${a2.toString(16)}`;
  };
  const host = { setFlag() {
  }, getFlag: () => 0, rand16: () => 1911, log() {
  } };
  const manifest = { size: image.length, event_table: 0, init_fn: 0, root_ctor: spec.ctor - base >>> 0, allocs: [], effect_ids: [] };
  const rt = new NativeStageRuntime(image, manifest, host, void 0, void 0, base, exe ?? void 0);
  if (exe) rt.cpu.gp = 2147863376;
  if (process.env.DW3_DUMP_ALLOC && rt.services !== null) {
    const svc = rt.services;
    const realAlloc = svc.alloc.bind(svc);
    const realCarve = svc.carve.bind(svc);
    const realObject = svc.allocObject.bind(svc);
    svc.alloc = (size, align) => {
      const p = realAlloc(size, align);
      console.log(`ALLOC ${size} -> 0x${(p >>> 0).toString(16)}`);
      return p;
    };
    svc.carve = (size) => {
      const p = realCarve(size);
      console.log(`CARVE ${size} -> 0x${(p >>> 0).toString(16)}`);
      return p;
    };
    svc.allocObject = (cb, size, extra, id) => {
      const p = realObject(cb, size, extra, id);
      console.log(`OBJECT cb=0x${(cb >>> 0).toString(16)} size=${size} extra=${extra} -> 0x${(p >>> 0).toString(16)}`);
      return p;
    };
    rt.cpu.setStub(2147581228, (c) => {
      const p = svc.alloc(c.reg(4) >>> 0);
      const caller = rt.mem.read32((c.reg(29) >>> 0) + 28) >>> 0;
      console.log(`LOW caller=0x${caller.toString(16)} ${c.reg(4) >>> 0} -> 0x${(p >>> 0).toString(16)}`);
      return p;
    });
  }
  rt.cpu.setStub(0, () => 0);
  const packIndexByDir = /* @__PURE__ */ new Map();
  const packSlotByDir = /* @__PURE__ */ new Map();
  const packIndexByHandle = /* @__PURE__ */ new Map();
  const dirByKey = /* @__PURE__ */ new Map();
  rt.cpu.setStub(2147565784, (c) => {
    const handle = c.reg(4) >>> 0;
    const idx = handle >>> 16 & 65535;
    const sub = handle & 65535;
    packIndexByHandle.set(handle, idx);
    const key2 = (idx << 16 | sub) >>> 0;
    let dir = dirByKey.get(key2);
    if (dir === void 0) {
      dir = 265289728 + dirByKey.size * 16 >>> 0;
      dirByKey.set(key2, dir);
      packIndexByDir.set(dir, idx);
      packSlotByDir.set(dir, sub);
    }
    return dir;
  });
  const ring = new Int32Array(opts.ringSize ?? 8e6);
  rt.cpu.traceRing = ring;
  const cpuState = rt.cpu;
  cpuState.tracePos = 0;
  const executed = /* @__PURE__ */ new Map();
  const residentExecuted = /* @__PURE__ */ new Map();
  const unmapped = /* @__PURE__ */ new Map();
  let ringOverflow = false;
  const bump = (map, key2, make, frame) => {
    const rec = map.get(key2);
    if (rec) {
      rec.hits++;
      if (frame < 0) rec.firstFrame = -1;
    } else {
      const fresh = make();
      fresh.hits = 1;
      fresh.firstFrame = frame;
      map.set(key2, fresh);
    }
  };
  const drain = (frame) => {
    const pos = cpuState.tracePos;
    const n = Math.min(pos, ring.length);
    if (pos > ring.length) ringOverflow = true;
    for (let i = 0; i < n; i++) {
      const pc = ring[i] >>> 0;
      if (pc >= base && pc < overlayEnd) {
        const f = fnAt(localIndex, pc);
        if (f) bump(executed, f.address, () => ({ fn: f, hits: 0, firstFrame: frame }), frame);
        else bump(unmapped, pc, () => ({ hits: 0, firstFrame: frame }), frame);
      } else if (residentBase !== 0 && pc >= residentBase && pc < residentEnd) {
        const f = fnAt(residentIndex, pc);
        if (f) bump(residentExecuted, f.address, () => ({ fn: f, hits: 0, firstFrame: frame }), frame);
      }
    }
    cpuState.tracePos = 0;
  };
  if (opts.debugCache && exe) {
    const stubs = rt.cpu.stubs;
    const orig = stubs.get(2147563796);
    let calls = 0;
    rt.cpu.setStub(2147563796, (c) => {
      calls++;
      if (calls <= 5) {
        const slots = [];
        for (let i = 0; i < 64; i++) {
          const s = 2147765052 + i * 16;
          const st = rt.mem.read16(s);
          if (st !== 0) slots.push(`slot${i} st=${st} id=${rt.mem.read32(s + 4)} buf=0x${(rt.mem.read32(s + 12) >>> 0).toString(16)}`);
        }
        console.log(
          `transfer call ${calls}: a0=0x${u32(c.reg(4)).toString(16)} a3=0x${u32(c.reg(7)).toString(16)} flag=${rt.mem.read32(2147765048)} slots=[${slots.join(", ")}]`
        );
      }
      return orig(c);
    });
  }
  let bankReads = 0;
  let bankBytes = 0;
  const bankIds = /* @__PURE__ */ new Set();
  if (exe && discFd !== null) {
    host.readBank = (id, dest, bytes) => {
      bankIds.add(id >>> 0);
      const lba = rt.mem.read32(2147766124 + id * 4) >>> 0;
      if (lba === 0) return;
      bankReads++;
      bankBytes += bytes;
      const data = readSectors(discFd, lba, bytes);
      for (let i = 0; i < bytes; i++) rt.mem.write8(dest + i, data[i]);
    };
  }
  const externalCalls = /* @__PURE__ */ new Map();
  const callJournal = [];
  rt.cpu.onCall = (callerPc, target) => {
    const t = target >>> 0;
    if (t >= base && t < overlayEnd) return;
    const rec = externalCalls.get(t) ?? { from: /* @__PURE__ */ new Set(), count: 0 };
    rec.from.add(callerPc >>> 0);
    rec.count++;
    externalCalls.set(t, rec);
    callJournal.push({ from: callerPc >>> 0, to: t });
    if (callJournal.length > 64) callJournal.shift();
    const watch = num2(process.argv[process.argv.indexOf("--watch") + 1]);
    if (process.argv.includes("--watch") && callerPc >>> 0 === watch) {
      console.log(
        `[watch] caller=0x${u32(callerPc).toString(16)} target=0x${t.toString(16)} v0=0x${u32(rt.cpu.reg(2)).toString(16)} mem@0x80055c48=0x${u32(rt.mem.read32(2147834952)).toString(16)} code@0x80099d80=0x${u32(rt.mem.read32(2148113792)).toString(16)} code@0x80099d7c=0x${u32(rt.mem.read32(2148113788)).toString(16)}`
      );
    }
  };
  const dbg = !!process.env.DW3_DEBUG;
  const rd80 = () => `0x80099d80=0x${u32(rt.mem.read32(2148113792)).toString(16)} 0x80099d7c=0x${u32(rt.mem.read32(2148113788)).toString(16)}`;
  if (dbg) {
    console.log(`dbg preboot ${rd80()}`);
    const w32 = rt.mem.write32.bind(rt.mem);
    const w16 = rt.mem.write16.bind(rt.mem);
    const w8 = rt.mem.write8.bind(rt.mem);
    rt.mem.write32 = (a2, v) => {
      if (a2 >>> 0 === 2148113792) {
        const tp = cpuState.tracePos;
        const last = [];
        for (let i = 6; i >= 1; i--) last.push(`0x${u32(ring[(tp - i + ring.length) % ring.length]).toString(16)}`);
        console.log(`dbg WRITE32 0x80099d80 = 0x${(v >>> 0).toString(16)} recent=[${last.join(" ")}]`);
      }
      w32(a2, v);
    };
    rt.mem.write16 = (a2, v) => {
      if (a2 >>> 0 === 2148113792) console.log(`dbg WRITE16 0x80099d80 = 0x${(v >>> 0).toString(16)}`);
      w16(a2, v);
    };
    rt.mem.write8 = (a2, v) => {
      if (a2 >>> 0 >= 2148113792 && a2 >>> 0 <= 2148113795) console.log(`dbg WRITE8 0x${(a2 >>> 0).toString(16)} = 0x${(v >>> 0).toString(16)}`);
      w8(a2, v);
    };
  }
  let hostStubs = /* @__PURE__ */ new Set();
  const invBefore = bridge ? new Map(bridgeInvocations()) : null;
  let currentFrame = -1;
  if (bridge) {
    const onlyEnv = process.env.DW3_BRIDGE_ONLY;
    const only = onlyEnv ? new Set(onlyEnv.split(",").map((s) => Number.parseInt(s.trim(), 16) >>> 0)) : null;
    installTranslationBridge(rt.cpu, rt.mem, [spec.module], only, rt.services);
    if (process.env.DW3_DUMP_BRIDGE) {
      setBridgeProbe((entry, c, ret) => {
        console.log(
          `BRIDGE f${currentFrame} ${entry.module}:${entry.name} ra=0x${(c.reg(31) >>> 0).toString(16)} a0=0x${(c.reg(4) >>> 0).toString(16)} a1=0x${(c.reg(5) >>> 0).toString(16)} a2=0x${(c.reg(6) >>> 0).toString(16)} a3=0x${(c.reg(7) >>> 0).toString(16)} ret=0x${(ret >>> 0).toString(16)} v1=0x${(c.reg(3) >>> 0).toString(16)}`
        );
      });
    }
  }
  if (process.env.DW3_DUMP_WRITES) {
    const [lo, hi] = process.env.DW3_DUMP_WRITES.split(":").map((s) => Number.parseInt(s, 16) >>> 0);
    const m = rt.mem;
    for (const method of ["write8", "write16", "write32"]) {
      const orig = m[method].bind(rt.mem);
      m[method] = (addr, v) => {
        if (addr >>> 0 >= lo && addr >>> 0 < hi) {
          console.log(`W ${method} 0x${(addr >>> 0).toString(16)} ${v} ra=0x${(rt.cpu.reg(31) >>> 0).toString(16)} sp=0x${(rt.cpu.reg(29) >>> 0).toString(16)}`);
        }
        orig(addr, v);
      };
    }
  }
  const booted = rt.boot();
  if (dbg) console.log(`dbg postboot ${rd80()}`);
  let bootTrap = null;
  if (!booted) bootTrap = rt.bootTrap?.reason ?? "unknown";
  drain(-1);
  const ringDump = [];
  const traps = [];
  const trapSnapshots = /* @__PURE__ */ new Map();
  let drawIntents = 0;
  let drawHash = FNV_OFFSET;
  let quadHash = FNV_OFFSET;
  const drawMethods = {};
  const drawIds = /* @__PURE__ */ new Set();
  const drawDirs = {};
  const drawDirsAll = /* @__PURE__ */ new Set();
  const drawSample = [];
  if (booted) {
    const dead = rt;
    const rawCall = rt.cpu.call.bind(rt.cpu);
    rt.cpu.call = (addr, callArgs, budget) => {
      try {
        return rawCall(addr, callArgs, budget);
      } catch (e) {
        if (e instanceof NativeTrap) {
          const key2 = `pc=0x${u32(e.pc).toString(16)} ${e.message}`;
          if (!trapSnapshots.has(key2)) {
            const w = cpuState.tracePos;
            const start = (w - 48 + ring.length) % ring.length;
            const pcs = [];
            for (let i = 0; i < 48; i++) pcs.push(`0x${u32(ring[(start + i) % ring.length]).toString(16)}`);
            const calls = callJournal.slice(-14).map((c) => `${resolveWithOffset(c.from)} -> ${resolveWithOffset(c.to)}`);
            const lines = [
              `trap pc=0x${u32(e.pc).toString(16)} ra=0x${u32(rt.cpu.reg(31)).toString(16)}`,
              `  ring: ${pcs.join(" -> ")}`,
              `  last calls: ${calls.join(" | ")}`,
              `  mem: 0x80055c48=0x${(rt.mem.read32(2147834952) >>> 0).toString(16)} 0x8009b5d8=0x${(rt.mem.read32(2148120024) >>> 0).toString(16)} 0x800a31b8(word@0x8009af68+0x250?)=0x0 ra@sp? n/a`
            ];
            trapSnapshots.set(key2, lines);
            if (ringDump.length === 0) ringDump.push(...lines);
          }
        }
        throw e;
      }
    };
    hostStubs = new Set(rt.cpu.stubAddresses());
    if (bridge) for (const addr of bridgeAddresses([spec.module])) hostStubs.delete(addr);
    for (let f = 0; f < frames; f++) {
      currentFrame = f;
      if (interact && f >= idleFrames) rt.setPadHeld(0, interactionPad(f - idleFrames));
      const before = rt.disabled.length;
      if (dbg && f < 6) console.log(`dbg frame${f} pre ${rd80()}`);
      rt.drawCalls.length = 0;
      rt.ctxMarkers.length = 0;
      rt.tick(1);
      drawIntents += rt.drawCalls.length;
      for (const c of rt.drawCalls) {
        if (process.env.DW3_DUMP_DRAW) console.log(`DRAW f${f} ${c.method}(${c.args.join(",")})`);
        for (let i = 0; i < c.method.length; i++) drawHash = fnvByte(drawHash, c.method.charCodeAt(i));
        for (const arg of c.args) drawHash = fnvWord(drawHash, arg >>> 0);
        drawMethods[c.method] = (drawMethods[c.method] ?? 0) + 1;
        if (c.method === "drawSprite") {
          drawIds.add(c.args[1] >>> 0);
          drawDirs[String(c.args[1] >>> 0)] = c.args[0] >>> 0;
          drawDirsAll.add(c.args[0] >>> 0);
        }
        if (drawSample.length < 120) drawSample.push({ method: c.method, args: [...c.args] });
      }
      for (const q of rt.screenQuads) {
        quadHash = fnvWord(quadHash, q.cmd);
        quadHash = fnvWord(quadHash, (q.x[0] & 65535) << 16 | q.y[0] & 65535);
        quadHash = fnvWord(quadHash, (q.u[0] & 255) << 24 | (q.v[0] & 255) << 16 | q.texpage & 65535);
        quadHash = fnvWord(quadHash, (q.clut & 65535) << 16 | q.x[1] & 65535);
      }
      drain(f);
      for (const d of rt.disabled.slice(before)) {
        traps.push({ count: 1, pc: u32(d.pc), cb: u32(d.cb), reason: d.reason });
        if (u32(d.pc) !== 0) rt.cpu.setStub(u32(d.pc), () => 0);
      }
      if (rt.disabled.length > before) {
        rt.disabled.length = 0;
        dead.deadCbs.clear();
      }
    }
  }
  const mergedTraps = /* @__PURE__ */ new Map();
  for (const t of traps) {
    const key2 = `pc=0x${t.pc.toString(16)} cb=0x${t.cb.toString(16)} ${t.reason}`;
    const rec = mergedTraps.get(key2);
    if (rec) rec.count++;
    else mergedTraps.set(key2, { ...t });
  }
  const boundary = [...externalCalls.entries()].map(([address, rec]) => {
    let kind = "external-stub";
    if (address === 0) kind = "null";
    else if (exe && address >= residentBase && address < residentEnd) kind = "resident";
    else if (address >= 265289728 && address < 266338304) kind = "synthetic-stub";
    return {
      address,
      count: rec.count,
      kind,
      name: resolveWithOffset(address),
      callers: [...rec.from].map(resolveWithOffset).sort(),
      status: isTranslated("exe/fns", address) ? "translated" : hostStubs.has(address) ? "host-served" : "native"
    };
  }).sort((a2, b) => a2.address - b.address);
  const toExecuted = (map) => [...map.values()].map((r) => ({
    address: r.fn.address,
    module: r.fn.module,
    name: r.fn.name,
    hits: r.hits,
    firstFrame: r.firstFrame,
    status: bridge && isBridged(r.fn.module, u32(r.fn.address)) ? "replaced" : isTranslated(r.fn.module, u32(r.fn.address)) ? "translated" : hostStubs.has(u32(r.fn.address)) ? "host-served" : "native"
  })).sort((a2, b) => a2.address - b.address);
  const toUnmapped = (map) => [...map.entries()].map(([address, r]) => ({ address, hits: r.hits, firstFrame: r.firstFrame, status: "inline" })).sort((a2, b) => a2.address - b.address);
  if (discFd !== null) closeSync(discFd);
  const STACK_TOP = 2149580016;
  const STACK_SCRATCH_FLOOR = 2149515264;
  const RAM_BASE = 2147483648;
  let memHash = FNV_OFFSET;
  let memHashFull = FNV_OFFSET;
  {
    const bytes = rt.mem.bytes;
    for (let i = 0; i < bytes.length; i += 4) {
      const word = (bytes[i] | bytes[i + 1] << 8 | bytes[i + 2] << 16 | bytes[i + 3] << 24) >>> 0;
      memHashFull = fnvWord(memHashFull, word);
      const addr = RAM_BASE + i >>> 0;
      if (addr >= STACK_SCRATCH_FLOOR && addr < STACK_TOP) continue;
      memHash = fnvWord(memHash, word);
    }
  }
  const bridged = [];
  if (bridge && invBefore) {
    for (const [k, count] of bridgeInvocations()) {
      const delta = count - (invBefore.get(k) ?? 0);
      if (delta <= 0) continue;
      const [mod2, addrHex] = k.split(":");
      const addr = Number.parseInt(addrHex, 16) >>> 0;
      bridged.push({ module: mod2, address: addr, name: resolveWithOffset(addr), invocations: delta });
    }
    bridged.sort((x, y) => x.address - y.address);
    for (const b of bridged) {
      const isResident = b.module === "exe/fns";
      const fn = fnAt(isResident ? residentIndex : localIndex, b.address);
      if (fn === void 0) continue;
      const map = isResident ? residentExecuted : executed;
      if (!map.has(b.address)) map.set(b.address, { fn, hits: 0, firstFrame: -1 });
    }
  }
  return {
    module: moduleId,
    actor: spec.actor ?? null,
    base,
    ctor: spec.ctor,
    tick: spec.tick,
    imageBytes: image.length,
    booted,
    bootTrap,
    frames: booted ? frames : 0,
    interactionFrames: booted ? interactionFrames : 0,
    bridged,
    memHash: memHash.toString(16),
    memHashFull: memHashFull.toString(16),
    drawHash: drawHash.toString(16),
    quadHash: quadHash.toString(16),
    mem: opts.keepMemory === true ? rt.mem : void 0,
    objects: rt.world.objects.length,
    bankReads,
    bankBytes,
    bankIds: [...bankIds].sort((a2, b) => a2 - b),
    drawIntents,
    drawMethods,
    drawIds: [...drawIds].sort((a2, b) => a2 - b),
    drawDirs,
    drawDirsAll: [...drawDirsAll].sort((a2, b) => a2 - b),
    packDirIndex: Object.fromEntries([...packIndexByDir.entries()].map(([dir, idx]) => [String(dir), idx])),
    packDirSlot: Object.fromEntries([...packSlotByDir.entries()].map(([dir, sub]) => [String(dir), sub])),
    drawSample,
    executed: toExecuted(executed),
    residentExecuted: toExecuted(residentExecuted),
    unmapped: toUnmapped(unmapped),
    boundary,
    traps: [...mergedTraps.values()].sort((a2, b) => b.count - a2.count),
    ringOverflow,
    ringDump,
    trapTrace: Object.fromEntries(trapSnapshots),
    imageSha256: createHash("sha256").update(image).digest("hex").slice(0, 16)
  };
}
function printRun(run) {
  console.log(`module=${run.module} base=0x${run.base.toString(16)} image=0x${run.imageBytes.toString(16)} bytes`);
  console.log(`ctor=0x${run.ctor.toString(16)} tick=0x${run.tick.toString(16)} booted=${run.booted}`);
  if (!run.booted) console.log(`boot trap: ${run.bootTrap}`);
  console.log(`objects allocated=${run.objects} bank reads=${run.bankReads} (${run.bankBytes} bytes)`);
  console.log(`
## executed overlay functions (${run.executed.length})`);
  for (const f of run.executed) console.log(`  x${f.hits.toString().padStart(6)}  ${f.name}  (${f.module}:0x${f.address.toString(16)})`);
  console.log(`
## executed resident EXE functions (${run.residentExecuted.length})`);
  for (const f of run.residentExecuted) console.log(`  x${f.hits.toString().padStart(6)}  exe/fns:${f.name}  (0x${f.address.toString(16)})`);
  if (run.unmapped.length) {
    console.log(`
## executed PCs with no indexed function (${run.unmapped.length})`);
    for (const p of run.unmapped.slice(0, 40)) console.log(`  0x${p.address.toString(16)} x${p.hits}`);
  }
  console.log(`
## trapped callbacks (${run.traps.length})`);
  for (const t of run.traps) console.log(`  x${t.count}  pc=0x${t.pc.toString(16)} cb=0x${t.cb.toString(16)} ${t.reason}`);
  console.log(`
## external call targets (${run.boundary.length})`);
  for (const b of run.boundary) {
    console.log(
      `  0x${b.address.toString(16).padStart(8, "0")} x${b.count.toString().padStart(4)}  [${b.kind}] ${b.name}   <- ${b.callers.slice(0, 3).join(", ")}`
    );
  }
  console.log(`
## draw intents recorded (${run.drawIntents})`);
  console.log(`  methods: ${JSON.stringify(run.drawMethods)}`);
  console.log(`  drawSprite ids: [${run.drawIds.join(",")}]`);
  for (const id of run.drawIds) {
    const dir = run.drawDirs[String(id)];
    console.log(`    id ${id} dir=0x${dir.toString(16)}`);
  }
  for (const d of run.drawSample.slice(0, 40)) console.log(`  ${d.method}(${d.args.map((a2) => a2.toString()).join(", ")})`);
  if (run.ringDump.length) console.log(run.ringDump.join("\n"));
  for (const [key2, lines] of Object.entries(run.trapTrace)) {
    if (lines === run.ringDump) continue;
    console.log(`
## trap trace ${key2}
${lines.join("\n")}`);
  }
  console.log(`image sha256 ${run.imageSha256}`);
  console.log(`memHash=${run.memHash} drawHash=${run.drawHash} quadHash=${run.quadHash}`);
  if (run.bridged.length) {
    console.log(`
## mixed-mode bridge (${run.bridged.length} entries, ${run.bridged.reduce((n, b) => n + b.invocations, 0)} invocations)`);
    for (const b of run.bridged) console.log(`  x${b.invocations.toString().padStart(7)}  ${b.module}:${b.name}  (0x${b.address.toString(16)})`);
  }
}
function summarize(runs) {
  const overlay = /* @__PURE__ */ new Set();
  const resident = /* @__PURE__ */ new Set();
  const boundary = /* @__PURE__ */ new Set();
  const fnStatus = /* @__PURE__ */ new Map();
  let unmapped = 0;
  let traps = 0;
  let bridgeInvocations2 = 0;
  for (const r of runs) {
    for (const f of r.executed) {
      overlay.add(`${f.module}:${f.address}`);
      fnStatus.set(`overlay:${f.address}`, f.status);
    }
    for (const f of r.residentExecuted) {
      resident.add(`exe/fns:${f.address}`);
      fnStatus.set(`resident:${f.address}`, f.status);
    }
    for (const b of r.boundary) boundary.add(b.address);
    unmapped += r.unmapped.length;
    traps += r.traps.reduce((n, t) => n + t.count, 0);
    bridgeInvocations2 += r.bridged.reduce((n, b) => n + b.invocations, 0);
  }
  const statuses = [...fnStatus.values()];
  const hostBoundaries = /* @__PURE__ */ new Set();
  const nativeBoundaries = /* @__PURE__ */ new Set();
  for (const r of runs) {
    for (const b of r.boundary) (b.status === "host-served" ? hostBoundaries : nativeBoundaries).add(b.address);
  }
  return {
    roots_total: runs.length,
    roots_booted: runs.filter((r) => r.booted).length,
    overlay_functions_executed: overlay.size,
    resident_functions_executed: resident.size,
    boundary_targets: boundary.size,
    unmapped_pcs: unmapped,
    traps,
    host_served_boundaries: hostBoundaries.size,
    native_boundaries: nativeBoundaries.size,
    translation_queue: statuses.filter((s) => s === "native").length,
    translated_functions: statuses.filter((s) => s === "translated").length,
    replaced_functions: statuses.filter((s) => s === "replaced").length,
    translated_not_replaced: statuses.filter((s) => s === "translated").length,
    bridge_invocations: bridgeInvocations2
  };
}
function markdown(runs, command, frames, interactionFrames = 0) {
  const s = summarize(runs);
  const lines = [];
  lines.push("---");
  lines.push(
    "reach: Selecting the Phase 0 translation/host-service queue for the native screen port \u2014 which original functions actually execute per screen root and every external boundary target it calls."
  );
  lines.push("status: generated");
  lines.push("---");
  lines.push("");
  lines.push("# Native screen coverage \u2014 executed functions and boundary targets");
  lines.push("");
  lines.push(`> Generated by \`${command}\`.`);
  lines.push("> Do not edit by hand; fix the probe (tools/native_screen_probe.ts).");
  lines.push("");
  lines.push(
    `Each root boots its real constructor from the decomp image under engine/native, with the resident EXE image loaded from the disc, then ticks ${frames} idle frames` + (interactionFrames > 0 ? `, then ${interactionFrames} frames of scripted pad taps (Down, Down, Right, Cross, Circle, Up, Left, Cross; 2-frame hold, 14-frame release). ` : ". ") + "`hits` counts executed instructions attributed to the containing function (pointer candidates and curated semantic names are folded into the function partition). Boundary rows are calls that leave the overlay image; `resident` rows run original EXE code under the interpreter, the other kinds need a host service or a stub."
  );
  lines.push("");
  lines.push("Each executed function carries a `status`: `host-served` when a runtime/interpreter stub answers it (engine/native host services, listed in `resident-screen-services.md`), `replaced` when the mixed-mode bridge ran its engine/dw3 port instead of the shipped MIPS body (`--bridge`), `translated` when the port exists with an oracle test but the bridge is not installed (or not bridgeable yet), `native` when the original MIPS runs in engine/native from the shipped image. The `native` set is the Phase 4 translation queue; a pc outside every partition range would be a function-extent gap (see below), not an `inline` status.");
  lines.push(
    interactionFrames > 0 ? "Method and limits: the interaction phase drives the host pad service (engine/native/runtime.ts) on one deterministic schedule; it samples normal play, not an enumeration. The boot-plus-idle pass is a floor and every later authentic interaction can extend the queue, so a re-run must never shrink the accounted set." : "Method and limits: the host pad service exists (engine/native/runtime.ts) but is not driven in this idle run, so each root is boot plus idle ticks (no button press); run with `--interact` for the pad interaction phase, and note that any later authentic interaction can only add functions."
  );
  lines.push("A function counts as executed when any executed pc falls in its partition range, so `hits` is instruction count, not call count.");
  lines.push("A nonempty `unmapped` list means a real function-extent gap: an executed pc outside every partition range (the inventory's `provisional_end_address` is inclusive and the probe converts it to an exclusive bound, so the last instruction of each routine is attributed; audit 2026-09-15). The list should therefore be empty, and any row is either a routine the index missed or an m2c-truncated tail, for the next decode pass.");
  lines.push("The report is a floor, not a ceiling: an interaction phase can only add functions to the queue.");
  lines.push("Boundary names are recovered-inventory semantic names, not ledger names; two are known to conflict with the ledger (0x80013914, 0x8001b04c). The claim-level contract of every resident screen service is in .dw3-research/bulk-port-plan-2026-09-14/resident-screen-services.md.");
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(`- roots: ${s.roots_total} (booted ${s.roots_booted})`);
  lines.push(`- distinct overlay functions executed: ${s.overlay_functions_executed}`);
  lines.push(`- distinct resident EXE functions executed: ${s.resident_functions_executed}`);
  lines.push(`- distinct external boundary targets: ${s.boundary_targets}`);
  lines.push(`- executed PCs with no indexed function: ${s.unmapped_pcs}`);
  lines.push(`- external boundary targets host-served: ${s.host_served_boundaries}`);
  lines.push(`- external boundary targets native: ${s.native_boundaries}`);
  lines.push(`- executed functions translated to engine/dw3 with an oracle test: ${s.translated_functions}`);
  lines.push(`- executed functions replaced by the TS bridge (this run): ${s.replaced_functions} (${s.bridge_invocations} invocations)`);
  lines.push(`- translated but not bridgeable yet (falls back to native): ${s.translated_not_replaced}`);
  lines.push(`- executed functions native (Phase 4 translation queue): ${s.translation_queue}`);
  if (interactionFrames > 0) lines.push(`- interaction frames per root: ${interactionFrames}`);
  lines.push(`- trapped callbacks (all frames, merged sites): ${s.traps}`);
  lines.push("");
  lines.push("## Per root");
  lines.push("");
  lines.push("| module | actor | boot | objects | bank reads | draw intents | overlay fns | resident fns | boundary | unmapped | traps |");
  lines.push("|---|---|:--:|--:|--:|--:|--:|--:|--:|--:|--:|");
  for (const r of runs) {
    lines.push(
      `| \`${r.module}\` | ${r.actor ?? ""} | ${r.booted ? "yes" : "no"} | ${r.objects} | ${r.bankReads} | ${r.drawIntents} | ${r.executed.length} | ${r.residentExecuted.length} | ${r.boundary.length} | ${r.unmapped.length} | ${r.traps.reduce((n, t) => n + t.count, 0)} |`
    );
  }
  lines.push("");
  for (const r of runs) {
    if (r.booted) continue;
    lines.push(`- \`${r.module}\` did not boot: ${r.bootTrap}`);
  }
  lines.push("");
  const overlay = /* @__PURE__ */ new Map();
  for (const r of runs) {
    for (const f of r.executed) {
      const key2 = `${f.module}:${f.address}`;
      const rec = overlay.get(key2) ?? { module: f.module, name: f.name, address: f.address, roots: /* @__PURE__ */ new Set(), hits: 0, status: f.status };
      rec.roots.add(r.module);
      rec.hits += f.hits;
      overlay.set(key2, rec);
    }
  }
  lines.push("## Union of executed overlay functions (translation queue)");
  lines.push("");
  lines.push("| module | function | address | status | roots | hits |");
  lines.push("|---|---|---|:--:|--:|--:|");
  const overlayRows = [...overlay.values()].sort((a2, b) => a2.module === b.module ? a2.address - b.address : a2.module < b.module ? -1 : 1);
  for (const f of overlayRows) {
    lines.push(`| \`${f.module}\` | \`${f.name}\` | 0x${f.address.toString(16)} | ${f.status} | ${f.roots.size} | ${f.hits} |`);
  }
  lines.push("");
  const resident = /* @__PURE__ */ new Map();
  for (const r of runs) {
    for (const f of r.residentExecuted) {
      const rec = resident.get(f.address) ?? { name: f.name, roots: /* @__PURE__ */ new Set(), hits: 0, status: f.status };
      rec.roots.add(r.module);
      rec.hits += f.hits;
      resident.set(f.address, rec);
    }
  }
  lines.push("## Executed resident EXE functions");
  lines.push("");
  lines.push("| function | address | status | roots | hits |");
  lines.push("|---|---|:--:|--:|--:|");
  for (const [address, f] of [...resident.entries()].sort((a2, b) => a2[0] - b[0])) {
    lines.push(`| \`exe/fns:${f.name}\` | 0x${address.toString(16)} | ${f.status} | ${f.roots.size} | ${f.hits} |`);
  }
  lines.push("");
  const boundary = /* @__PURE__ */ new Map();
  for (const r of runs) {
    for (const b of r.boundary) {
      const rec = boundary.get(b.address) ?? { kind: b.kind, name: b.name, roots: /* @__PURE__ */ new Set(), count: 0, callers: /* @__PURE__ */ new Set() };
      rec.roots.add(r.module);
      rec.count += b.count;
      for (const c of b.callers) rec.callers.add(c);
      boundary.set(b.address, rec);
    }
  }
  lines.push("## External boundary targets");
  lines.push("");
  lines.push("| target | kind | name | roots | calls | callers |");
  lines.push("|---|---|---|--:|--:|---|");
  for (const [address, b] of [...boundary.entries()].sort((a2, b2) => a2[0] - b2[0])) {
    lines.push(
      `| 0x${address.toString(16)} | ${b.kind} | \`${b.name}\` | ${b.roots.size} | ${b.count} | ${[...b.callers].slice(0, 3).join(", ")} |`
    );
  }
  lines.push("");
  const unmapped = runs.filter((r) => r.unmapped.length);
  if (unmapped.length) {
    lines.push("## Executed PCs in a function-extent gap (empty = no unindexed executed routine)");
    lines.push("");
    lines.push("Every pc here executes but falls outside every partition range, so it is either a routine the index missed or an m2c-truncated tail. It is NOT a call target by construction: the inventory's provisional end is inclusive and the probe converts it, so the last instruction of each routine is already attributed.");
    lines.push("");
    for (const r of unmapped) {
      lines.push(`- \`${r.module}\` (${r.unmapped.length}): ${r.unmapped.slice(0, 12).map((p) => `0x${p.address.toString(16)}`).join(", ")}`);
    }
    lines.push("");
  }
  lines.push("## Trapped callbacks");
  lines.push("");
  if (!s.traps) {
    lines.push("None.");
  } else {
    for (const r of runs) {
      for (const t of r.traps) {
        lines.push(`- \`${r.module}\` x${t.count} pc=0x${t.pc.toString(16)} cb=0x${t.cb.toString(16)} ${t.reason}`);
      }
    }
  }
  lines.push("");
  return lines.join("\n") + "\n";
}
function isMain() {
  const entry = process.argv[1];
  return entry !== void 0 && resolve(entry) === fileURLToPath(import.meta.url);
}
if (isMain()) {
  const args = process.argv.slice(2);
  const flag = (name) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : void 0;
  };
  const bankPlanPath = flag("--bank-plan");
  if (bankPlanPath) {
    const frames = num2(flag("--frames")) ?? 20;
    const specs = loadSpecs(flag("--specs") ?? SPECS_PATH);
    const banks = {};
    const packs = {};
    for (const spec of specs) {
      const run = runScreen(spec, { frames, noExe: args.includes("--no-exe") });
      banks[spec.module] = run.bankIds;
      const usedDirs = new Set(run.drawDirsAll.length ? run.drawDirsAll : Object.values(run.drawDirs));
      const packKeys = /* @__PURE__ */ new Set();
      for (const d of usedDirs) {
        const idx = run.packDirIndex[String(d)];
        if (idx === void 0) continue;
        const sub = run.packDirSlot[String(d)] ?? 0;
        packKeys.add(`${idx}:${sub}`);
      }
      packs[spec.module] = [...packKeys].sort((a2, b) => {
        const [ai, as] = a2.split(":").map(Number);
        const [bi, bs] = b.split(":").map(Number);
        return ai === bi ? as - bs : ai - bi;
      });
      console.log(`${spec.module}: banks=[${run.bankIds.join(",")}] packs=[${packs[spec.module].join(",")}]`);
    }
    writeFileSync(bankPlanPath, JSON.stringify({ banks, packs }, null, 1) + "\n");
    console.log(`wrote ${bankPlanPath}`);
  } else if (args.includes("--all")) {
    const frames = num2(flag("--frames")) ?? 20;
    const interact = args.includes("--interact");
    const bridge = args.includes("--bridge");
    const reportBase = flag("--report") ?? DEFAULT_REPORT_BASE;
    const specs = loadSpecs(flag("--specs") ?? SPECS_PATH);
    const runs = [];
    for (const spec of specs) {
      const t0 = Date.now();
      const run = runScreen(spec, { frames, interact, bridge, noExe: args.includes("--no-exe"), ringSize: num2(flag("--ring-size")) });
      runs.push(run);
      console.log(
        `${run.module}: boot=${run.booted ? "yes" : "no"} objects=${run.objects} overlayFns=${run.executed.length} residentFns=${run.residentExecuted.length} boundary=${run.boundary.length} traps=${run.traps.reduce((n, t) => n + t.count, 0)} (${Date.now() - t0}ms)`
      );
    }
    const summary = summarize(runs);
    const command = `node tools/native_screen_probe.ts --all --frames ${frames}${interact ? " --interact" : ""}${bridge ? " --bridge" : ""}`;
    const json = {
      generated_by: "tools/native_screen_probe.ts",
      command,
      frames,
      interaction_frames: interact ? INTERACT_FRAMES : 0,
      generated_at: (/* @__PURE__ */ new Date()).toISOString(),
      summary,
      roots: runs
    };
    writeFileSync(`${reportBase}.json`, JSON.stringify(json, null, 1) + "\n");
    writeFileSync(`${reportBase}.md`, markdown(runs, command, frames, interact ? INTERACT_FRAMES : 0));
    console.log(`
${JSON.stringify(summary)}`);
    console.log(`wrote ${reportBase}.json`);
    console.log(`wrote ${reportBase}.md`);
  } else {
    const moduleId = flag("--module") ?? "pro/stitshop";
    const ctorFlag = num2(flag("--ctor"));
    const tickFlag = num2(flag("--tick"));
    let spec = loadSpecs().find((s) => s.module === moduleId);
    if (!spec) {
      if (ctorFlag === void 0 || tickFlag === void 0) {
        console.error(`no known ctor spec for ${moduleId}; pass --ctor and --tick`);
        process.exit(2);
      }
      spec = { module: moduleId, ctor: ctorFlag, tick: tickFlag };
    }
    if (ctorFlag !== void 0) spec.ctor = ctorFlag;
    if (tickFlag !== void 0) spec.tick = tickFlag;
    const frames = num2(flag("--frames")) ?? 60;
    const run = runScreen(spec, {
      frames,
      interact: args.includes("--interact"),
      bridge: args.includes("--bridge"),
      noExe: args.includes("--no-exe"),
      debugCache: args.includes("--debug-cache"),
      ringSize: num2(flag("--ring-size"))
    });
    printRun(run);
  }
}
export {
  INTERACT_FRAMES,
  INTERACT_SCHEDULE,
  indexModule,
  interactionPad,
  loadSpecs,
  markdown,
  runScreen,
  summarize
};
