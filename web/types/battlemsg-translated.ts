
/** Where one message bank ships, and the load in flight once someone asked for it. */
export interface BattleMsgBankFile {
  file: string;
  what: string;
  promise?: Promise<Readonly<Record<number, string>>> | null;
}
