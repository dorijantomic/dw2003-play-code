// Flat PS1 address space for the wstag native-code interpreter (P0 of
// docs/specs/2026-07-04-wstag-native-interpreter-design.md).
//
// One 2MB buffer models main RAM; addresses are masked with 0x1fffff so
// KUSEG/KSEG0/KSEG1 mirrors (0x00.., 0x80.., 0xa0..) all resolve like the
// console. Two boot modes:
//   - fromDump(bytes): wrap a full PCSX-Redux RAM dump (parity tests — the
//     overlay, descriptor bank, heap objects and even EXE helper code are
//     already in place);
//   - new NativeMemory() + load(overlayBytes, 0x800a5de0): production path,
//     where the engine synthesizes the rest (P1+).

export const RAM_SIZE = 0x200000;
export const RAM_MASK = 0x1fffff;

/** Optional write observer. `pc` is the instruction that executed the store. */
export type MemoryWriteHook = (
  pc: number, address: number, size: number, value: number,
) => void;

export class NativeMemory {
  readonly bytes: Uint8Array;
  readonly view: DataView;
  /**
   * PC of the instruction currently executing. The R3000 core updates this per
   * instruction so store hooks can attribute a write to its site. Only the
   * behavior lab reads it; the parity path leaves the hooks null.
   */
  currentPc = 0;
  /** Opt-in store observer; null disables the call and its cost. */
  onWrite: MemoryWriteHook | null = null;

  constructor(bytes?: Uint8Array) {
    if (bytes !== undefined && bytes.length !== RAM_SIZE) {
      throw new Error(`NativeMemory expects a ${RAM_SIZE}-byte image, got ${bytes.length}`);
    }
    this.bytes = bytes ?? new Uint8Array(RAM_SIZE);
    this.view = new DataView(this.bytes.buffer, this.bytes.byteOffset, this.bytes.byteLength);
  }

  /** Wrap (not copy) a full 2MB RAM dump. */
  static fromDump(bytes: Uint8Array): NativeMemory {
    return new NativeMemory(bytes);
  }

  /** Copy a blob into the address space at a RAM address. */
  load(blob: Uint8Array, addr: number): void {
    const off = addr & RAM_MASK;
    if (off + blob.length > RAM_SIZE) throw new Error(`load overruns RAM: 0x${addr.toString(16)}+${blob.length}`);
    this.bytes.set(blob, off);
  }

  /**
   * Optional hardware-register service (engine/native/device-ports.ts). Null
   * keeps the plain 2MB RAM model; when set, the listed registers answer from
   * the device and everything else falls through to RAM.
   */
  devices: { read(addr: number): number | undefined; write(addr: number, value: number): boolean } | null = null;

  read8(addr: number): number {
    return this.bytes[addr & RAM_MASK] as number;
  }
  /** Bulk copy `len` bytes out of RAM into `dest` (wrapping at RAM_SIZE, like
   *  the 2MB mirror does). The block form of read8 for VRAM uploads and other
   *  large transfers, where a per-byte call is the frame's whole cost. */
  readInto(addr: number, dest: Uint8Array, len = dest.length): void {
    const start = addr & RAM_MASK;
    const end = start + len;
    if (end <= RAM_SIZE) {
      dest.set(this.bytes.subarray(start, end), 0);
      return;
    }
    const first = RAM_SIZE - start;
    dest.set(this.bytes.subarray(start), 0);
    dest.set(this.bytes.subarray(0, end - RAM_SIZE), first);
  }
  read8s(addr: number): number {
    return this.view.getInt8(addr & RAM_MASK);
  }
  read16(addr: number): number {
    return this.view.getUint16(addr & RAM_MASK, true);
  }
  read16s(addr: number): number {
    return this.view.getInt16(addr & RAM_MASK, true);
  }
  /** Signed 32-bit (matches register width); use >>> 0 for the unsigned view. */
  read32(addr: number): number {
    if (this.devices !== null) {
      const v = this.devices.read(addr >>> 0);
      if (v !== undefined) return v | 0;
    }
    return this.view.getInt32(addr & RAM_MASK, true);
  }

  write8(addr: number, v: number): void {
    const masked = addr & RAM_MASK;
    this.bytes[masked] = v & 0xff;
    if (this.onWrite !== null) this.onWrite(this.currentPc, addr >>> 0, 1, v & 0xff);
  }
  write16(addr: number, v: number): void {
    const masked = addr & RAM_MASK;
    this.view.setUint16(masked, v & 0xffff, true);
    if (this.onWrite !== null) this.onWrite(this.currentPc, addr >>> 0, 2, v & 0xffff);
  }
  write32(addr: number, v: number): void {
    if (this.devices !== null && this.devices.write(addr >>> 0, v >>> 0)) return;
    const masked = addr & RAM_MASK;
    this.view.setUint32(masked, v >>> 0, true);
    if (this.onWrite !== null) this.onWrite(this.currentPc, addr >>> 0, 4, v >>> 0);
  }
}
