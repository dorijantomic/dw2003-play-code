/** A timer handle: a number in the browser, an object when node's types are in play. */
export type MpTimer = number | ReturnType<typeof setTimeout>;

/** What the social dock hears: "status", "roster", "chat", "feed", "trade", ... */
export type MpListener = (type: string, data?: any) => void;

export interface MultiplayerUi {
  addrs: Element;
  badge: HTMLDivElement;
  code: Element;
  fillName?: () => void;
  msg: Element;
  off: Element;
  on: Element;
  panel: HTMLDivElement;
  roster: Element;
  tell: Element;
}
