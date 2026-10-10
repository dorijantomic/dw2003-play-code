import type { BankScheme, EvalContext, FlagId, FlagReader, VirtualBankHandler } from "../types.ts";

export class FlagManager implements FlagReader {
  private banks = new Map<number, Uint8Array>();
  private virtual = new Map<number, VirtualBankHandler>();
  private cbs: ((id: FlagId, value: boolean) => void)[] = [];
  private scheme: BankScheme;
  private ctx: () => EvalContext;
  constructor(scheme: BankScheme, ctx: () => EvalContext) {
    this.scheme = scheme;
    this.ctx = ctx;
    for (const [bank, cap] of scheme.storedBanks) this.banks.set(bank, new Uint8Array(Math.ceil(cap / 8)));
  }
  registerVirtualBank(bank: number, handler: VirtualBankHandler): void { this.virtual.set(bank, handler); }
  get(id: FlagId, expected = 1): boolean {
    const { bank, bit } = this.scheme.decompose(id);
    const v = this.virtual.get(bank);
    if (v) return v(bit, expected, this.ctx());
    const arr = this.banks.get(bank);
    if (!arr) return expected === 0; // unknown stored bank reads as clear
    const set = (arr[bit >> 3]! & (1 << (bit & 7))) !== 0;
    return expected === 0 ? !set : set;
  }
  set(id: FlagId, value: boolean): void {
    const { bank, bit } = this.scheme.decompose(id);
    if (this.virtual.has(bank)) throw new Error(`cannot set virtual flag bank 0x${bank.toString(16)} (id 0x${id.toString(16)})`);
    const arr = this.banks.get(bank);
    if (!arr) throw new Error(`unknown stored flag bank 0x${bank.toString(16)} (id 0x${id.toString(16)})`);
    const mask = 1 << (bit & 7);
    const i = bit >> 3;
    if (value) arr[i]! |= mask; else arr[i]! &= ~mask;
    for (const cb of this.cbs) cb(id, value);
  }
  onChange(cb: (id: FlagId, value: boolean) => void): void { this.cbs.push(cb); }
  /** Zero every stored bank — a new-game reset. Virtual banks hold no state. Does not fire onChange. */
  clear(): void { for (const arr of this.banks.values()) arr.fill(0); }
  toJSON(): Record<number, string> {
    const out: Record<number, string> = {};
    for (const [b, arr] of this.banks) {
      out[b] = btoa(String.fromCharCode(...arr));
    }
    return out;
  }
  load(obj: Record<number, string>): void {
    for (const [b, s] of Object.entries(obj)) {
      const arr = this.banks.get(Number(b));
      if (arr) {
        const bytes = Uint8Array.from(atob(s), c => c.charCodeAt(0));
        arr.set(bytes.subarray(0, arr.length));
      }
    }
  }
}
