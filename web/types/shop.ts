export interface ShopScreen {
  /** per-window fold-anim start times: window key -> the shop clock it started at */
  _anim?: Record<string, number>;
  /** the fold progress of one window right now */
  _animP?: (key: string) => number;
  _animStart?: (...keys: string[]) => void;
  _commit?: (state: any) => void;
  _counts?: (state: any, id: number) => { equip: number; bag: number; };
  /** the shelf: SELL lists the category's sellable items, BUY lists the merchant's stock */
  _currentList?: (state: any) => { id: number; qty: number | null; }[];
  _equipCards?: (state: any) => any[];
  _equipOn?: (state: any, mi: number) => boolean;
  _feedback?: (msg: string) => void;
  _maxQty?: (state: any, item: any) => number;
  _open: boolean;
  _selected?: (state: any) => { id: number; qty: number | null; } | null;
  /** what one of an item costs: its price when buying, its sell value when selling */
  _unitPrice?: (item: any) => number;
  bsIdx: number;
  catIdx: number;
  close?: () => void;
  confirmIdx: number;
  cursor: number;
  draw?: (ctx: CanvasRenderingContext2D, viewW: number, viewH: number, state: any) => void;
  equipIdx: number;
  equipWhoIdx: number;
  fadeLeaving: boolean;
  fadeT0: number;
  feedbackMsg: string | null;
  /** the feedback message queue's next line */
  feedbackNext: string | null;
  handleKey?: (rawKey: string, state: any) => void;
  /** "desc" | "effects" */
  infoView: string;
  isOpen?: () => boolean;
  leaveFoldT0?: number;
  /** 0 = buy, 1 = sell */
  mode: number;
  /** the merchant's name, shown in the window's title row */
  name: string;
  onClose: (() => void) | null;
  open?: (stock: number[], onClose?: (() => void) | null, opts?: ShopOpenOpts) => void;
  page: number;
  qty: number;
  screen: string;
  /** the merchant's stock, as item ids */
  stock: number[];
  /** the shop's own clock, in 60Hz frames, driving the fold animations */
  time: number;
  update?: (dt: number) => void;
}

/** What shop.open() is told about the merchant (web/shop.ts, web/shop-translated.ts). */
export interface ShopOpenOpts {
  /** the merchant's name, shown in the window's title row */
  name?: string;
  /** the live game state the shop reads its bag, wallet and party from */
  state?: any;
  /** which shop this is: the stage's item_shop row, or the decoded shop id (0-29) */
  shopId?: number;
}
