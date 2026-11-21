import type { ShopOpenOpts } from "./shop.js";

export interface ShopTranslatedScreen {
  /** vendor object: the ui.MenuDisplayClock the shop ticks on */
  _clock: any;
  _error: any;
  _onClose: (() => void) | null;
  _open: boolean;
  /** vendor object: the native screen renderer the picture calls come from */
  _renderer: any;
  _request: number;
  /** vendor object: the engine's ShopRootSession */
  _session: any;
  _state: any;
  close?: () => boolean;
  diagnostics?: any;
  draw?: (ctx: CanvasRenderingContext2D, viewW: number, viewH?: number, state?: any) => void;
  handleKey?: (_button: string, state: any) => void;
  isOpen?: () => boolean;
  open?: (stock: number[], onClose?: (() => void) | null, opts?: ShopOpenOpts) => void;
  update?: (dt: number) => void;
}

/** What createShopTranslated() is told when it is built. */
export interface ShopTranslatedOptions {
  /** the resident digimon table (species stats) the save seed is built against */
  digimonDB?: () => any;
}
