
/** A chat packet on its way to the wire: the bytes, plus the page count the header carries. */
export interface ChatPacket extends Uint8Array {
  pages?: number;
}
