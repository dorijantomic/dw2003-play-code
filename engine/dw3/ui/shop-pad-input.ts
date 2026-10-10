// The merchant screen's browser-button adapter.
//
// The held set is already the game's own word: web/input.js maps a physical
// button to its word-bit name once, in engine/systems/input-map.ts, and the
// shop's machines ask for logical 0x0D (confirm) and 0x0E (cancel), which are
// word bits 0x2000 and 0x4000 (shop-root-machine.ts:90/94,
// docs/research/ui/shop-system-decompiled.md:497). So the adapter only has to
// build the word and run the press/repeat latches; it must not move a button.
import { maskFromButtons, type PadButton } from "../../systems/input-map.ts";
import { MenuPadWords } from "./pad-words.ts";

export class ShopPadInput {
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

  held = (): number => this.heldWord;
  pressed = (): number => this.pressedWord;
  repeated = (): number => this.repeatedWord;
  buttonBit = (code: number): number => code;
}
