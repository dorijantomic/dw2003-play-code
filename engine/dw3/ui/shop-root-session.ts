// Frame owner for the translated merchant root. Browser input, audio and
// painting enter through explicit host services; task methods stay in engine.
import { NativeMemory } from "../../native/memory.ts";
import { CURRENT_SHOP_ID } from "../party-context.ts";
import { installShopCatalog, type ShopCatalogData } from "./shop-catalog.ts";
import { installShopFont } from "./shop-font.ts";
import { shopRootHandler } from "./shop-root-handler.ts";
import { shopRootMachine } from "./shop-root-machine.ts";
import { shopRootDraw } from "./shop-root-draw.ts";
import { shopRootCreate, shopRootLabels, SHOP_ROOT_EXTRA, SHOP_ROOT_HANDLER, SHOP_ROOT_SIZE } from "./shop-root.ts";
import { constructShopTask } from "./shop-task-allocation.ts";
import { ShopTextBanks } from "./shop-text-banks.ts";
import { ShopWidgetServices } from "./shop-widget-services.ts";
import { ShopPadInput } from "./shop-pad-input.ts";
import type { PadButton } from "../../systems/input-map.ts";
import { seedShopSaveState, readShopSaveState, type ShopSaveSeed, type ShopSaveResult } from "./shop-save-state.ts";
import { TranslatedTaskTree, type TranslatedTaskClass } from "./translated-task-tree.ts";
import { windowFoldStart, windowFoldTick } from "./window-fold.ts";
import { ShopDrawIntents } from "./shop-draw-intents.ts";
import { ShopTradeComposition } from "./shop-trade-composition.ts";
import { createShopFade, registerShopFade, startShopFade } from "./shop-fade-task.ts";

export interface ShopRootResources {
  catalog: ShopCatalogData;
  itemRecords: Uint8Array;
  descriptors: readonly Uint8Array[];
  font: Uint8Array;
  banks: ReadonlyMap<number, Uint8Array>;
}

export interface ShopRootSessionHost {
  playSound(id: number): void;
  closeSave(save: number, result: number): void;
  childClasses?: ReadonlyMap<number, TranslatedTaskClass>;
}

export class ShopRootSession {
  readonly mem = new NativeMemory();
  readonly banks: ShopTextBanks;
  readonly widgets: ShopWidgetServices;
  readonly tree: TranslatedTaskTree;
  readonly trade: ShopTradeComposition;
  readonly root: number;
  readonly pad = new ShopPadInput();
  readonly draw = new ShopDrawIntents(this.mem);
  private resourceRequested = false;
  private frame = 0;

  constructor(shopId: number, language: number, save: ShopSaveSeed,
              resources: ShopRootResources, host: ShopRootSessionHost) {
    if (!Number.isInteger(shopId) || shopId < 0 || shopId >= 30) {
      throw new Error("Invalid merchant starting state");
    }
    installShopCatalog(this.mem, resources.catalog, resources.itemRecords, resources.descriptors);
    installShopFont(this.mem, resources.font);
    this.banks = new ShopTextBanks(this.mem, language, resources.banks);
    this.widgets = new ShopWidgetServices(this.mem, this.banks);
    this.mem.write32(CURRENT_SHOP_ID, shopId);
    this.mem.write32(0x8005cca8, language);
    seedShopSaveState(this.mem, save);
    const classes = new Map(host.childClasses ?? []);
    classes.set(SHOP_ROOT_HANDLER, {
      name: "merchant root", childSlots: [0x1c, 0x20], terminalTick: true,
      tick: (root, context) => shopRootHandler(this.mem, root, context, {
        loadRequest: (id) => {
          if (id !== 1) throw new Error(`Unknown merchant resource ${id}`);
          this.resourceRequested = true;
        },
        loadBusy: (id) => {
          if (id !== 1 || !this.resourceRequested) throw new Error("Merchant resource was not requested");
          return 0; // All data was loaded and validated before the root was made.
        },
        buildLabels: (owner, labels) => shopRootLabels(this.mem, {
          createTextElement: this.widgets.createTextElement,
          spawnUiIcon: this.widgets.spawnUiIcon,
          uiIconSetVisible: this.widgets.cursorShow,
        }, owner, labels),
        advance0: (owner) => this.tree.callMethod(owner, 0x38),
        menuTick: (owner, labels) => shopRootMachine(this.mem, owner, labels, {
          foldStart: (window, opening) => {
            windowFoldStart(this.mem, window, opening);
            host.playSound(opening ? 0x40019 : 0x4001a);
          },
          foldTick: (window) => windowFoldTick(this.mem, window),
          bankGet: (id) => this.banks.source(id),
          textSet: this.widgets.textSet,
          textNumber: this.widgets.textNumber,
          textMeasure: this.widgets.textMeasure,
          textShow: this.widgets.textShow,
          cursorShow: this.widgets.cursorShow,
          cursorPlace: this.widgets.cursorPlace,
          padPressed: this.pad.pressed,
          padKey: this.pad.buttonBit,
          playSound: host.playSound,
          transition: (object, state) => this.tree.callMethod(object, 0x2c, [state]),
          createBuy: (owner) => this.trade.createBuy(owner),
          createSell: (owner) => this.trade.createSell(owner),
          createFade: () => createShopFade(this.mem, this.tree),
          fadeStart: (fade, direction, frames) =>
            startShopFade(this.mem, this.tree, fade, direction, frames),
        }),
        draw: (owner) => shopRootDraw(this.mem, owner, this.draw),
        closeSave: host.closeSave,
      }),
    });
    this.tree = new TranslatedTaskTree(this.mem, classes,
      (task) => this.widgets.retireTask(task));
    this.trade = new ShopTradeComposition({ mem: this.mem, tree: this.tree,
      widgets: this.widgets, banks: this.banks, pad: this.pad, draw: this.draw,
      playSound: host.playSound });
    this.trade.register(classes);
    registerShopFade(this.mem, this.tree, classes);
    this.root = constructShopTask(this.tree, SHOP_ROOT_HANDLER, SHOP_ROOT_SIZE, SHOP_ROOT_EXTRA,
      (allocation) => shopRootCreate(this.mem, allocation));
  }

  tick(buttons: Iterable<PadButton> = [], displayTick?: number): void {
    this.frame = displayTick ?? this.frame + 1;
    this.draw.beginFrame(this.frame);
    this.pad.update(buttons, this.frame);
    this.tree.tick(this.root);
    this.widgets.tickCursors(this.frame);
  }

  result(): ShopSaveResult { return readShopSaveState(this.mem, this.trade.swaps); }
  finished(): boolean { return !this.tree.tasks.has(this.root); }
  fadeLevel(): number {
    if (this.finished()) return 255;
    const context = this.mem.read32(this.root + 0x24) >>> 0;
    const fade = this.mem.read32(context + 0x20) >>> 0;
    return fade ? Math.max(0, Math.min(255, (this.mem.read32(fade + 0x5c) | 0) >> 8)) : 0;
  }
}
