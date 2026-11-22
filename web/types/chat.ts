
/** A chat packet on its way to the wire: the bytes, plus the page count the header carries. */
export interface ChatPacket extends Uint8Array {
  pages?: number;
}

/** What the game hands installChat: the stage to mount the box on and the key / bubble hooks. */
export interface ChatHooks {
  stage: HTMLElement;
  canOpen(): boolean;
  releaseKeys?(): void;
  onSend?(text: string): void;
  bubbleOpen?(): boolean;
  dismiss?(): void;
}
