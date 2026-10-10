// Services shared by the translated screens that compose their own task trees
// (the naming screen, the registration wizard): the pad service's three words
// and the text-widget / cursor method slots.
import type { NativeMemory } from "../../native/memory.ts";
import { maskFromButtons, type PadButton } from "../../systems/input-map.ts";
import { MenuPadWords } from "./pad-words.ts";
import { setTextWidgetOrigin, setVectorAndActiveFlag, set_unk_0x58_fns_8001a448 } from "./text-element-setters.ts";
import { setWidgetString } from "./text-widget-line.ts";
import {
  uiIconSetCycleTicks, uiIconSetPos, uiIconSetRestTicks, uiIconSetUnk60, uiIconSetUnk7c, uiIconSetVisible,
} from "./spawn-ui-icon.ts";
import type { ShopWidgetServices } from "./shop-widget-services.ts";

/**
 * The pad service's pressed, held and auto-repeat words. The logical button codes
 * the screens pass are read as the physical bit index (the reference pad map).
 */
export class ScreenPad {
  private readonly words = new MenuPadWords();
  private heldWord = 0;
  private pressedWord = 0;
  private repeatedWord = 0;
  update(buttons: Iterable<PadButton>, displayTick?: number): void {
    this.heldWord = maskFromButtons(buttons);
    const next = this.words.update(this.heldWord, displayTick);
    this.pressedWord = next.pressed;
    this.repeatedWord = next.repeated;
  }
  pressed = (): number => this.pressedWord;
  held = (): number => this.heldWord;
  repeated = (): number => this.repeatedWord;
}

/**
 * One text-widget or cursor method by slot: the installed method the original
 * would have called through the object's own table. Every slot maps to a
 * registered port; an unknown slot throws rather than being guessed.
 */
export function dispatchWidgetMethod(
  mem: NativeMemory, widgets: ShopWidgetServices, target: number, slot: number, args: number[],
): void {
  target >>>= 0;
  if (widgets.isIcon(target)) {
    switch (slot) {
      case 0x80: uiIconSetVisible(mem, target, args[0]!); return;
      case 0x84: uiIconSetPos(mem, target, args[0]!, args[1]!); return;
      case 0x88: uiIconSetUnk60(mem, target, args[0]!); return;
      case 0x8c: uiIconSetRestTicks(mem, target, args[0]!); return;
      case 0x90: uiIconSetCycleTicks(mem, target, args[0]!); return;
      case 0x94: uiIconSetUnk7c(mem, target, args[0]!); return;
      default: throw new Error(`Cursor: untranslated method ${slot.toString(16)}`);
    }
  }
  switch (slot) {
    case 0x110:
      setWidgetString(mem, { alloc: widgets.arena.alloc, free: widgets.arena.free }, target, args[0]!);
      return;
    case 0x114: widgets.textSet(target, args[0]!, args[1]!); return;
    case 0x118: widgets.textNumber(target, args[0]!, args[1]!); return;
    case 0x134: setTextWidgetOrigin(mem, target, args[0]!, args[1]!); return;
    case 0x138: widgets.textColour(target, args[0]!); return;
    case 0x140: setVectorAndActiveFlag(mem, target, args[0]!, args[1]!); return;
    case 0x144: widgets.textShow(target, args[0]!); return;
    case 0x148: widgets.textMeasure(target, args[0]!); return;
    case 0x15c: set_unk_0x58_fns_8001a448(mem, target, args[0]!); return;
    case 0x160: widgets.textFlagBF(target, args[0]!); return;
    default: throw new Error(`Text widget: untranslated method ${slot.toString(16)}`);
  }
}
