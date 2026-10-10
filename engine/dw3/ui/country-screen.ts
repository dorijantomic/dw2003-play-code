// The complete language-screen task tree, composed from the existing ports.
// No executable image, interpreter, dispatch fallback, or register emulation.
import { NativeMemory } from "../../native/memory.ts";
import { TranslatedTaskTree } from "./translated-task-tree.ts";
import type { TranslatedTaskClass } from "./translated-task-tree.ts";
import { stepOneShotAnimation } from "./animation-script.ts";
import { frameDelta } from "../../systems/frame-clock.ts";
import {
  COUNTRY_PALETTE_ELEMENT_HANDLER, createPaletteElement,
  paletteCycleTick, paletteElementSetFrame,
} from "./country-palette.ts";
import {
  countrySelectRootCreate, countrySelectFadeCreate, countrySelectLeftCreate,
  countrySelectRightCreate, countrySelectBottomCreate,
  CNTY_ROOT_TICK, CNTY_FADE_TICK, CNTY_LEFT_BREATHE_TICK,
  CNTY_RIGHT_BREATHE_TICK, CNTY_BOTTOM_BREATHE_TICK,
} from "./native/cnty-creators.ts";
import { countrySelectTick, COUNTRY_SELECT_GLOBAL } from "./native/country-select-tick.ts";
import { countrySelectFadeTick } from "./native/cnty-fade.ts";
import { decorLeftBreatheTick, decorRightBreatheTick, decorBottomBreatheTick } from "./native/cnty-decor.ts";
import { countrySelectDrawLeft, countrySelectDrawRight, countrySelectDrawBottom } from "./native/cnty-draw.ts";
import type { CntDrawHost } from "./native/cnty-draw.ts";

export const COUNTRY_SCREEN_DATA_BASE = 0x800843c0;
export const COUNTRY_SCREEN_DATA_SIZE = 0x6b;

export interface CountryScreenHost extends CntDrawHost {
  setFrame(frame: number): void;
  emitFadePrim(alpha: number): void;
  playSound(id: number): void;
  requestTransition?(id: number, arg: number): void;
}

export class CountryScreen {
  readonly memory = new NativeMemory();
  readonly tree: TranslatedTaskTree;
  readonly root: number;
  private pressed = 0;
  private repeated = 0;
  transition: { id: number; arg: number } | null = null;

  constructor(data: Uint8Array, draw: CountryScreenHost, initialLanguage = 0) {
    if (data.length !== COUNTRY_SCREEN_DATA_SIZE) throw new Error("Language screen needs its 107-byte data tables");
    const mem = this.memory;
    mem.load(data, COUNTRY_SCREEN_DATA_BASE);
    mem.write32(COUNTRY_SELECT_GLOBAL, initialLanguage);
    const classes = new Map<number, TranslatedTaskClass>();
    this.tree = new TranslatedTaskTree(mem, classes);
    const callMethod = this.tree.callMethod;
    const allocate = this.tree.allocate;
    const creators = { alloc: allocate };
    const base = {
      baseMethod28: (obj: number, state: number) => callMethod(obj, 0x28, [state]),
      baseMethod2C: (obj: number, state: number) => callMethod(obj, 0x2c, [state]),
      baseMethod38: (obj: number) => callMethod(obj, 0x38),
    };
    classes.set(CNTY_ROOT_TICK, { name: "language screen", tick: (obj, children) => {
      countrySelectTick(mem, obj, children, {
        createA: () => countrySelectFadeCreate(creators),
        createB: () => countrySelectLeftCreate(creators),
        createC: () => countrySelectRightCreate(creators),
        createD: () => countrySelectBottomCreate(creators),
        createMenu: () => createPaletteElement(mem, { allocate }),
        padReadA: () => this.pressed, padReadB: () => this.repeated,
        padButton: (_port, code) => code,
        playSound: (id) => draw.playSound(id),
        invoke: (id, arg) => {
          this.transition = { id, arg };
          draw.requestTransition?.(id, arg);
        },
        callMethod,
      });
    } });
    classes.set(CNTY_FADE_TICK, { name: "language backdrop/fade", tick: (obj) => {
      countrySelectFadeTick(mem, obj, { ...draw, ...base });
    } });
    const decorations = [
      [CNTY_LEFT_BREATHE_TICK, "left", decorLeftBreatheTick, countrySelectDrawLeft],
      [CNTY_RIGHT_BREATHE_TICK, "right", decorRightBreatheTick, countrySelectDrawRight],
      [CNTY_BOTTOM_BREATHE_TICK, "bottom", decorBottomBreatheTick, countrySelectDrawBottom],
    ] as const;
    for (const [id, name, tick, render] of decorations) {
      classes.set(id, { name: `language ${name} panel`, tick: (obj) => {
        tick(mem, obj, { ...base, draw: (target) => render(mem, target, draw) });
      } });
    }
    classes.set(COUNTRY_PALETTE_ELEMENT_HANDLER, {
      name: "language highlight",
      methods: new Map([[0x5c, (obj, args) => paletteElementSetFrame(mem, obj, args[0]!)]]),
      tick: (obj) => {
        // paletteSpriteDraw's existing port omits the local context constructor;
        // each original draw begins with a fresh context, like the panel draws.
        draw.initDrawContext();
        paletteCycleTick(mem, obj, {
          ...draw, advance0: base.baseMethod38, setState0: base.baseMethod28,
          stepPaletteScript: (cursor, table, nesting) =>
            stepOneShotAnimation(mem, cursor, table, nesting, frameDelta),
        });
      },
    });
    this.root = countrySelectRootCreate(creators);
  }

  tick(pressed = 0, repeated = 0): void {
    this.pressed = pressed & 0xffff;
    this.repeated = repeated & 0xffff;
    this.tree.tick(this.root);
  }

  get row(): number { return this.memory.read16s(this.root + 0x50); }
  get language(): number { return this.memory.read8(COUNTRY_SELECT_GLOBAL); }
  get complete(): boolean { return this.transition !== null; }
  dispose(): void { this.tree.dispose(this.root); }
  /** Display and fade rectangles from the screen's own data block. */
  rectangle(index: 0 | 1 | 2): { x: number; y: number; width: number; height: number } {
    const at = COUNTRY_SCREEN_DATA_BASE + index * 8;
    return { x: this.memory.read16s(at), y: this.memory.read16s(at + 2),
      width: this.memory.read16s(at + 4), height: this.memory.read16s(at + 6) };
  }
}
