// Compose the translated BUY actor, stock list and info band under one task tree.
// The two actor classes share stock, detail panel, text and input services.
import type { NativeMemory } from "../../native/memory.ts";
import {
  partyPositionToRosterSlot, persistentRosterSlot, ROSTER_RECORDS, ROSTER_STRIDE,
  ROSTER_EQUIP_OFFSETS,
} from "../party-context.ts";
import { itemClassEquals, itemRecord } from "../item-record.ts";
import { gearAccessibleForLine, shopEquipSlot, shopEquipSwap, EQUIP_SLOTS, type EquipmentSlots } from "../equipment.ts";
import { bandCreate, bandHighlight, bandHighlightForward, bandLeaveReady, bandToggleExtra, bandRedrawMember, BAND_EXTRA, BAND_HANDLER, BAND_SIZE } from "./band-highlight.ts";
import { bandFillDescription, bandFillNamePrice, bandFillEffectsCards } from "./band-fill.ts";
import { effectsCardFill } from "./effects-card-fill.ts";
import { bandTick } from "./band-tick.ts";
import { itemListDraw } from "./item-list-draw.ts";
import { shopActorBuy, shopActorBuyTick, shopActorSell, shopActorSellTick, SHOP_ACTOR_BUY_EXTRA, SHOP_ACTOR_BUY_HANDLER, SHOP_ACTOR_BUY_SIZE, SHOP_ACTOR_SELL_EXTRA, SHOP_ACTOR_SELL_HANDLER, SHOP_ACTOR_SELL_SIZE } from "./shop-actor.ts";
import { shopActorBuyBuild, shopActorSellBuild } from "./shop-actor-build.ts";
import { shopActorBuyDraw, shopActorSellDraw } from "./shop-actor-draw.ts";
import { shopBuyMachine } from "./shop-buy-machine.ts";
import { shopSellMachine } from "./shop-sell-machine.ts";
import { shopSellBuild } from "./shop-sell-build.ts";
import { enumerateShopInventory } from "./shop-inventory.ts";
import { shopBuyConfirmLine, shopBuyQuantityLine } from "./shop-buy-lines.ts";
import { shopListBuild } from "./shop-list-build.ts";
import { shopListCreate, SHOP_LIST_EXTRA_SIZE, SHOP_LIST_SIZE, SHOP_LIST_TICK } from "./shop-list-create.ts";
import { shopListTick } from "./shop-list-machine.ts";
import { shopListActivate, shopListMoveCursor, shopListReset, shopListSelectedId, shopListSetCursorVisible } from "./shop-list-slots.ts";
import { shopReadout } from "./shop-readout.ts";
import { shopEffectsCardDraw } from "./shop-effects-draw.ts";
import { shopWindowBuyTick } from "./shop-window-buy.ts";
import { shopWindowSellTick } from "./shop-window-sell.ts";
import { shopLoad } from "./shop-stock.ts";
import { constructShopTask } from "./shop-task-allocation.ts";
import type { ShopDrawIntents } from "./shop-draw-intents.ts";
import type { ShopPadInput } from "./shop-pad-input.ts";
import type { ShopTextBanks } from "./shop-text-banks.ts";
import type { ShopWidgetServices } from "./shop-widget-services.ts";
import type { TranslatedTaskClass, TranslatedTaskTree } from "./translated-task-tree.ts";
import { windowFoldStart, windowFoldTick } from "./window-fold.ts";
import { shopRootBitRefresh } from "./shop-root.ts";
import { shopBlockEquip, shopBlockUnequip, type ShopEquipSwap } from "./shop-save-state.ts";

export interface ShopTradeCompositionServices {
  mem: NativeMemory;
  tree: TranslatedTaskTree;
  widgets: ShopWidgetServices;
  banks: ShopTextBanks;
  pad: ShopPadInput;
  draw: ShopDrawIntents;
  playSound(id: number): void;
}

export class ShopTradeComposition {
  readonly services: ShopTradeCompositionServices;
  /**
   * Every HAND SWAP the screen committed, in the order it made them: what
   * `previewEquip` handed to F0x8008C800 with the transfer flag set. The merchant
   * owns the block's two count arrays while it is open, so this log is how the
   * walker learns which piece came off which hand and which went on — the original
   * writes the worn byte once per piece, and only the swap knows that.
   */
  readonly swaps: ShopEquipSwap[] = [];
  constructor(services: ShopTradeCompositionServices) { this.services = services; }

  register(classes: Map<number, TranslatedTaskClass>): void {
    const { mem, tree, widgets, banks, pad, draw, playSound } = this.services;
    const foldStart = (window: number, opening: number): void => {
      windowFoldStart(mem, window, opening);
      playSound(opening ? 0x40019 : 0x4001a);
    };
    const foldTick = (window: number): number => windowFoldTick(mem, window);
    const bankGet = (id: number): number => banks.source(id);
    const resolveText = (offset: number): number => bankGet((mem.read32(0x8005cca8) | 0) + offset);
    const rosterSlot = (position: number): number => partyPositionToRosterSlot(mem, position);
    const rosterHandle = (slot: number): number => persistentRosterSlot(slot);
    const memberHas = (slot: number, id: number): number => {
      if (slot < 0 || slot > 8) return 0;
      const starter = (mem.read32(ROSTER_RECORDS + slot * ROSTER_STRIDE) | 0) - 3;
      return Number(gearAccessibleForLine(id, starter));
    };
    const canEquip = memberHas;
    const equipmentOf = (slot: number): EquipmentSlots => {
      if (slot < 0 || slot > 8) throw new Error("Invalid merchant roster slot");
      const base = ROSTER_RECORDS + slot * ROSTER_STRIDE;
      const out: EquipmentSlots = {};
      for (const name of EQUIP_SLOTS) {
        const id = mem.read16(base + ROSTER_EQUIP_OFFSETS[name]);
        if (id) out[name] = id;
      }
      return out;
    };
    const selectSlot = (slot: number, id: number): number =>
      EQUIP_SLOTS.indexOf(shopEquipSlot(equipmentOf(slot), id)!);
    // The routine's first argument is the party RECORD it was handed, and this
    // port's is the roster slot that record came from, so the party POSITION the
    // walker's wearer record is indexed by is recovered through the same map the
    // seed used (party-context `partyPositionToRosterSlot`). Three reads, and the
    // inverse of the map the block copy came from.
    const partyPositionOfRosterSlot = (slot: number): number => {
      for (let position = 0; position < 3; position++) if (rosterSlot(position) === slot) return position;
      return -1;
    };
    const previewEquip = (slot: number, index: number, id: number, commit: number): void => {
      if (index < 0) return;
      const previous = equipmentOf(slot);
      const result = shopEquipSwap(previous, id);
      if (!result || EQUIP_SLOTS.indexOf(result.slot) !== index) {
        throw new Error("Merchant equip slot differs from selected slot");
      }
      const base = ROSTER_RECORDS + slot * ROSTER_STRIDE;
      for (const name of EQUIP_SLOTS) {
        mem.write16(base + ROSTER_EQUIP_OFFSETS[name], result.equipment[name] ?? 0);
      }
      // The transfer flag arms F0x8008C800's count stores: every piece that comes
      // off a hand moves `worn -= 1; held += 1`, and the piece that goes on moves
      // `worn += 1; held -= 1`. The band's own "Equip n" figure reads the WORN
      // byte of this same block, so writing only the carried half left the figure
      // reading the number the merchant opened with.
      if (!commit) return;
      for (const displaced of result.displaced) shopBlockUnequip(mem, displaced);
      shopBlockEquip(mem, id);
      const party = partyPositionOfRosterSlot(slot);
      if (party < 0) return;
      this.swaps.push({
        party, itemId: id,
        equipment: { ...result.equipment },
        displaced: [...result.displaced],
      });
    };
    const effectsScratch = widgets.arena.alloc(20);
    const effectsHost = {
      rosterSlot, rosterHandle, selectSlot, previewEquip, resolveText,
      itemRecord, widgetSetLine0: widgets.textSet,
      widgetSetLineNumber: widgets.textNumber, widgetMeasure: widgets.textMeasure,
      widgetSetC0: widgets.textColour, widgetSetFlagC1: widgets.textShow,
    };
    const fillHost = {
      resolveText, itemRecord, rosterSlot, rosterHandle, canEquip,
      call89274: (band: number, block: number, index: number) =>
        effectsCardFill(mem, band, block, index, effectsHost, effectsScratch),
      widgetSetLine0: widgets.textSet,
      widgetSetLineNumber: widgets.textNumber,
      widgetSetC0: widgets.textColour,
      widgetSetFlagC1: widgets.textShow,
      widgetMeasure: widgets.textMeasure,
    };
    const fillName = (band: number, block: number, flag: number): void =>
      bandFillNamePrice(mem, band, block, flag, fillHost);
    const fillDescription = (band: number, block: number, flag: number): void =>
      bandFillDescription(mem, band, block, flag, fillHost);
    const fillEffects = (band: number, block: number, flag: number): void =>
      bandFillEffectsCards(mem, band, block, flag, fillHost);
    const bandHighlightHost = {
      call89e2c: fillName, call8a0d0: fillDescription, call8a1fc: fillEffects,
    };
    const lineHost = { bankGet, itemRecord, textSet: widgets.textSet,
      textNumber: widgets.textNumber, textShow: widgets.textShow,
      textMeasure: widgets.textMeasure };
    const listStateHost = { setState: (object: number, state: number): void =>
      tree.callMethod(object, 0x28, [state]) };
    const rebuildSellList = (list: number): void => shopSellBuild(mem, {
      enumerateInventory: (category, destination) => enumerateShopInventory(mem, category, destination),
      itemRecord,
    }, list);
    const listPad = {
      pressed: (_port: number) => pad.pressed(),
      held: (_port: number) => pad.held(),
      repeat: (_port: number) => pad.repeated(),
      buttonBit: (_port: number, code: number) => pad.buttonBit(code),
    };
    classes.set(SHOP_ACTOR_BUY_HANDLER, {
      name: "BUY actor", childSlots: [0, 4],
      tick: (actor, context) => shopActorBuyTick(mem, {
        advanceState: (self) => tree.callMethod(self, 0x38),
        call8360c: (self, block) => shopActorBuyBuild(mem, self, block, {
          createTextElement: widgets.createTextElement,
          spawnUiIcon: widgets.spawnUiIcon,
          cursorActivate: (cursor) => widgets.cursorShow(cursor, 0),
        }),
        call83eb0: (self, block) => shopBuyMachine(mem, self, block, {
          createList: (parent, id) => constructShopTask(tree, SHOP_LIST_TICK, SHOP_LIST_SIZE,
            SHOP_LIST_EXTRA_SIZE, (allocation) => shopListCreate(mem, allocation, parent, id, 0)),
          createBand: (mode, id) => constructShopTask(tree, BAND_HANDLER, BAND_SIZE,
            BAND_EXTRA, (allocation) => bandCreate(mem, allocation, mode, id)),
          refreshQuantityPlate: (self, block, flag) => shopBuyQuantityLine(mem, lineHost, self, block, flag),
          refreshBand: (self, block, flag) => shopBuyConfirmLine(mem, lineHost, self, block, flag),
          selfTransition: (object, state) => tree.callMethod(object, 0x2c, [state]),
          selfBaseAdvance: (object) => tree.callMethod(object, 0x3c),
          bandReset: (band) => tree.callMethod(band, 0x3c),
          listHide: (list) => shopListActivate(mem, listStateHost, list),
          listTeardown: (list) => shopListReset(mem, listStateHost, list),
          listItemId: (list) => shopListSelectedId(mem, list),
          listCursor: (list, visible) => shopListMoveCursor(mem, list, visible),
          listCards: (list, on) => shopListSetCursorVisible(mem, list, on),
          bandQuantity: (band, id, qty) => bandHighlight(mem, bandHighlightHost, band, id, qty),
          bandFold: (band) => bandLeaveReady(mem, band),
          bandReverse: (band) => bandToggleExtra(mem, {
            itemHasSlot: (id, slot) => itemClassEquals(mem, id, slot), playSound,
          }, band),
          bandHighlight: (band, index) => bandRedrawMember(mem, {
            refillItem: fillName,
            refillMember: (panel, children, member) =>
              effectsCardFill(mem, panel, children, member, effectsHost, effectsScratch),
          }, band, index),
          rootCommit: (root) => shopRootBitRefresh(mem, {
            widgetSetLineNumber: widgets.textNumber, measureTextWidth: widgets.textMeasure,
          }, root),
          messageSet: widgets.textSet,
          messageShow: widgets.textShow,
          plateMode: widgets.cursorShow,
          platePos: widgets.cursorPlace,
          foldStart, foldTick,
          memberHas,
          memberEntry: selectSlot,
          memberMove: previewEquip,
          partySlot: rosterSlot, itemRecord,
          itemHasSlot: (id, klass) => itemClassEquals(mem, id, klass),
          bankGet,
          padPressed: (_port) => pad.pressed(),
          padRepeat: (_port) => pad.repeated(),
          padKey: (_port, code) => pad.buttonBit(code),
          playSound,
        }),
        call83970: (self) => shopActorBuyDraw(mem, self, draw),
      }, actor, context),
    });
    classes.set(SHOP_ACTOR_SELL_HANDLER, {
      name: "SELL actor", childSlots: [0, 4],
      tick: (actor, context) => shopActorSellTick(mem, {
        advanceState: (self) => tree.callMethod(self, 0x38),
        call859c0: (self, block) => shopActorSellBuild(mem, self, block, {
          createTextElement: widgets.createTextElement,
          spawnUiIcon: widgets.spawnUiIcon,
          cursorActivate: (cursor) => widgets.cursorShow(cursor, 0),
        }),
        call85f48: (self, block) => shopSellMachine(mem, self, block, {
          foldStart, foldTick, bankGet,
          textSet: widgets.textSet, textNumber: widgets.textNumber,
          textFormat: widgets.textFormat, textMeasure: widgets.textMeasure,
          textShow: widgets.textShow, cursorPlace: widgets.cursorPlace,
          cursorShow: widgets.cursorShow,
          padPressed: pad.pressed, padRepeat: pad.repeated, padKey: pad.buttonBit,
          playSound,
          transition: (object, state) => tree.callMethod(object, 0x2c, [state]),
          createList: (parent, category, mode) => constructShopTask(tree, SHOP_LIST_TICK,
            SHOP_LIST_SIZE, SHOP_LIST_EXTRA_SIZE,
            (allocation) => shopListCreate(mem, allocation, parent, category, mode)),
          createBand: (mode, id) => constructShopTask(tree, BAND_HANDLER, BAND_SIZE,
            BAND_EXTRA, (allocation) => bandCreate(mem, allocation, mode, id)),
          listSelected: (list) => shopListSelectedId(mem, list),
          listCursor: (list, shown) => shopListMoveCursor(mem, list, shown),
          listStop: (list) => shopListReset(mem, listStateHost, list),
          listHide: (list) => shopListActivate(mem, listStateHost, list),
          listRebuild: rebuildSellList,
          bandQuantity: (band, id, qty) => bandHighlight(mem, bandHighlightHost, band, id, qty),
          bandLeave: (band) => bandLeaveReady(mem, band),
          itemRecord,
          rootRefresh: (root) => shopRootBitRefresh(mem, {
            widgetSetLineNumber: widgets.textNumber, measureTextWidth: widgets.textMeasure,
          }, root),
        }),
        call85b18: (self) => shopActorSellDraw(mem, self, draw),
      }, actor, context),
    });
    classes.set(SHOP_LIST_TICK, {
      name: "shop list", childSlots: [],
      tick: (list, context) => shopListTick(mem, list, context, {
        setState: (object, state) => tree.callMethod(object, 0x28, [state]),
        advanceState: (object) => tree.callMethod(object, 0x38),
        foldStart, foldTick,
        sellBuild: rebuildSellList,
        loadStock: (id) => shopLoad(mem, id),
        readout: (object, block, visible) => shopReadout(mem, object, block, visible, {
          alloc: widgets.arena.alloc, free: widgets.arena.free,
          stringById: widgets.stringById,
          resourceSource: bankGet,
          measureTextWidth: widgets.textMeasure,
          scratch: widgets.scratch,
        }),
        buildList: (object, block) => shopListBuild(mem, object, block, {
          createTextElement: widgets.createTextElement,
          spawnUiIcon: widgets.spawnUiIcon,
          cursorActivate: (cursor) => widgets.cursorShow(cursor, 0),
        }),
        drawList: (object) => itemListDraw(mem, object, draw),
        highlight: (parent, id, qty) => bandHighlightForward(mem, bandHighlightHost, parent, id, qty),
        playCursorSfx: () => playSound(0x8004513e),
        pad: listPad,
      }),
    });
    classes.set(BAND_HANDLER, {
      name: "shop detail band", childSlots: [],
      tick: (band, context) => bandTick(mem, band, context, {
        baseMethod38: (object) => tree.callMethod(object, 0x38),
        rosterSlot,
        createTextElement: widgets.createTextElement,
        setWidgetFlagBF: widgets.textFlagBF,
        itemUsableClass: (id, klass) => itemClassEquals(mem, id, klass),
        call8a758: (object, block) => shopWindowBuyTick(mem, object, block, {
          call89e2c: fillName, call8a0d0: fillDescription, call8a1fc: fillEffects,
          textSource: () => resolveText(0x71),
          widgetSetLine0: widgets.textSet,
          widgetSetFlagC1: widgets.textShow,
        }),
        call8a450: (object) => shopEffectsCardDraw(mem, object, {
          ...draw, rosterSlot, canEquip,
        }),
        call8adec: (object, block) => shopWindowSellTick(mem, object, block, {
          call89e2c: fillName, call8a0d0: fillDescription,
        }),
        initDrawContext: draw.initDrawContext,
        setLayer: draw.setLayer,
        setOrigin: draw.setOrigin,
        setScale: draw.setScale,
        setPos: draw.setPos,
        drawSprite: draw.drawSprite,
        packResolve: draw.packResolve,
        iconClip: draw.iconClip,
      }),
    });
  }

  createBuy(root: number): number {
    const { mem, tree } = this.services;
    return constructShopTask(tree, SHOP_ACTOR_BUY_HANDLER, SHOP_ACTOR_BUY_SIZE,
      SHOP_ACTOR_BUY_EXTRA, (allocation) => shopActorBuy(mem, allocation, root));
  }

  createSell(root: number): number {
    const { mem, tree } = this.services;
    return constructShopTask(tree, SHOP_ACTOR_SELL_HANDLER, SHOP_ACTOR_SELL_SIZE,
      SHOP_ACTOR_SELL_EXTRA, (allocation) => shopActorSell(mem, allocation, root));
  }
}
