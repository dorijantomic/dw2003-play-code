// Types for web/mpsocial.ts (the social dock: ALL / CHAT / EVENTS / PLAYERS, inspect, trade, duel, co-op, go).

/** One row of the PLAYERS tab: a peer of the room, or me ("self"). */
export interface MpRosterRow {
  id: number;
  name: string;
  map: string | null;
  card: any;                  // the card as the other game sent it (their name, party, quests)
  self?: boolean;
  away?: boolean;
}

/** The elements of the dock, made once in installSocial. */
export interface MpSocialEls {
  log: HTMLElement;
  players: HTMLElement;
  tabs: Record<string, HTMLElement>;
  unread: HTMLElement;
  toggle: HTMLElement;
  inspect: HTMLElement;
  trade: HTMLElement;
  duel: HTMLElement;
  coop: HTMLElement;
  go: HTMLElement;
}

/** A thing I can give away: an item in my bag, with the amount I hold. */
export interface MpTradeItem {
  id: number;
  qty: number;
  name: string;
}

/** A trade in flight: "out" (I asked), "in" (they asked me), "open" (both said yes, offers on screen). */
export interface MpTrade {
  st: string;
  id: number;
  mine: { items: Record<string, number>; bits: number };   // my offer, keyed by item id
  theirs: { items: MpTradeItem[]; bits: number };          // the list the other player offered
  myOk: boolean;
  theirOk: boolean;
  bag: MpTradeItem[];
}
