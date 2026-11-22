/** A timer handle: a number in the browser, an object when node's types are in play. */
export type MpTimer = number | ReturnType<typeof setTimeout>;

/** What the social dock hears: "status", "roster", "chat", "feed", "trade", ... */
export type MpListener = (type: string, data?: any) => void;

export interface MultiplayerUi {
  addrs: HTMLElement;
  badge: HTMLDivElement;
  code: HTMLElement;
  fillName?: () => void;
  msg: HTMLElement;
  off: HTMLElement;
  on: HTMLElement;
  panel: HTMLDivElement;
  roster: HTMLElement;
  tell: HTMLElement;
}

/** One Digimon of a player card (what mpCard in web/game/mp-chat.ts sends). */
export interface MpPeerCardMon {
  n: string;
  f: string;
  id: number;
  lv: number;
  xp: number;
  hp: number;
  mhp: number;
  mp: number;
  mmp: number;
  st: Record<string, number>;
}

/** A player's card: their party, chapter, BIT and quests. */
export interface MpPeerCard {
  v: number;
  chapter: number;
  bits: number;
  quests: number;
  party: MpPeerCardMon[];
  champ?: boolean;
}

/** One other player of the room. */
export interface MpPeer {
  name: string;
  map: string | null;
  x: number | null;
  y: number | null;
  tx: number;
  ty: number;
  dir: string;
  mv: number;
  animTime: number;
  seen: number;
  emote: string;
  emoteIx: number | null;
  emoteUntil: number;
  say: string;
  sayUntil: number;
  card: MpPeerCard | null;
  hidden: boolean;
  away: boolean;
  moving?: boolean;
}

/** One network address the host shows to friends. */
export interface MpAddress {
  ip: string;
  kind: string;
}

/** Where the link goes (and where a reconnect goes back to). */
export interface MpWant {
  base: string | null;
  create?: boolean;
  room?: string;
  key?: string | null;
}

/** Where a player stands, as the relay is told. */
export interface MpSpot {
  map: string | null;
  x: number;
  y: number;
  dir: string;
  mv: number;
}

/** My own standing and speech. */
export interface MpMe extends MpSpot {
  say: string;
  sayUntil: number;
  emote: string;
  emoteIx: number | null;
  emoteUntil: number;
}

/** The one state object of web/multiplayer.ts. */
export interface MpState {
  ws: WebSocket | null;
  status: string;
  room: string | null;
  id: number | null;
  name: string;
  hostId: number | null;
  /** the host's own addresses, to show to friends */
  addresses: MpAddress[];
  hosting: boolean;
  host: string;
  peers: Map<number, MpPeer>;
  me: MpMe;
  sent: MpSpot & { at: number; };
  retry: number;
  retryTimer: MpTimer;
  want: MpWant | null;
  beat: MpTimer;
  hadWelcome: boolean;
  lost: boolean;
  autoTry: boolean;
  autoTried: boolean;
  defaultName: (() => string) | null;
  ui: MultiplayerUi | null;
  lastTick: number;
  /** the host's battle settings (what the relay last told me) */
  rules: Record<string, boolean> | null;
  /** what I last sent as host */
  rulesSent: string;
  rulesAt: number;
}

/** The marks the chat dock keeps on a line it printed (a queued or dropped line). */
export interface MpChatMark {
  queued?: boolean;
  dropped?: boolean;
}

/** A player standing in this stage, as the game draws it. */
export interface MpGhost {
  id: number;
  name: string;
  x: number;
  y: number;
  dir: string;
  moving: boolean | undefined;
  animTime: number;
  emote: string;
  emoteIx: number | null;
  say: string;
}
