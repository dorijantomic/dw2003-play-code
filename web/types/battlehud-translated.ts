
/** The disc's memory as these HUD screens poke it: one address at a time, read and written. */
export interface RecordMemory {
  read8(addr: number): number;
  read16(addr: number): number;
  read32(addr: number): number;
  write8(addr: number, value: number): void;
  write16(addr: number, value: number): void;
  write32(addr: number, value: number): void;
}

/** Which side's markers a party-pip run draws, and which slot on each side is the active one. */
export interface BattleHudPipsOptions {
  mode?: number;
  activePlayerIndex?: number;
  activeEnemyIndex?: number;
}
