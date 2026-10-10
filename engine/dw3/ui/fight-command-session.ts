// Frame owner for the translated battle command list (pro/fightstg): the six
// rows Fight / Tech / DV / Tag / Item / Run shown on every player turn.
//
// Step F of docs/plans/2026-09-28-translated-game-completion-plan.md. The
// screen's routines are the registered ports in native/fight-command-menu.ts
// (actor construct/tick, name build, menu create, state machine, row draw, the
// vsync marker blit); this file composes them into one task tree and supplies
// the services they call. No PlayStation instruction is executed.
//
// Services, each an existing translated provider or a documented platform one:
//   object factory F0x80014504        -> TranslatedTaskTree.allocate (zeroing, like F0x80017F54)
//   default commands +0x28/+0x38/+0x3C -> TranslatedTaskTree default slots (F0x80014274/F0x800142AC/F0x800142C8)
//   child close on destroy F0x800182C8 -> TranslatedTaskTree closeTick (state 3 tick, then destroy)
//   text box F0x8001AE38, +0x114, +0x138 -> ShopWidgetServices / dispatchWidgetMethod
//   text box tick F0x8001AC14          -> textRevealTick + drawTextElement (glyphs painted by the browser)
//   pack by number [0x80044F4C]        -> ScreenTextBanks.source (data-only indexed text)
//   pack entry handle [0x80044F5C]     -> identity handle, painted by the screen-pack renderer
//   pad +0x3F4 / +0x3FC                -> ScreenPad pressed / repeat words
//   sound [0x80055C48]                 -> host.playSound
//   frame delta [0x8004DE10+0x18C]     -> the display clock's delta (F0x8001D704 reads 0x8004DE28)
//   picture service F0x8001F648 ctx    -> ShopDrawIntents
//   vsync callback [0x8004DE10]        -> dispatched here once per display tick; only F0x8009ABD8 is known
//   ClearOTag / SetDrawMove            -> translated psyq-video ports
//   BreakDraw / idle poll / ContinueDraw -> platform GPU: always idle; the chain's
//                                          VRAM-to-VRAM moves are recorded as `moves`
//
// Data-only inputs: the two menu configs (0x800A34CC for the commands, 0x800A3634
// for a confused player's joke rows) and the blit rectangle from the overlay's
// data, the command names (text family 0x7F + language), the resident font block,
// and the battle's own state (active party slot and its ailment byte) seeded into
// the workspace at 0x800A4460.
import { NativeMemory } from "../../native/memory.ts";
import { PackedSoundCursor } from "../../systems/packed-sound.ts";
import type { PadButton } from "../../systems/input-map.ts";
import { clearOtag, setDrawMove, CLEAR_OTAG_HEAD } from "../psyq-video.ts";
import { ScreenTextBanks } from "./screen-text-banks.ts";
import { ShopDrawIntents } from "./shop-draw-intents.ts";
import { ShopWidgetServices } from "./shop-widget-services.ts";
import { ScreenPad } from "./screen-services.ts";
import { TranslatedTaskTree, type TranslatedTaskClass } from "./translated-task-tree.ts";
import { textRevealTick } from "./text-window.ts";
import { callTaskOrWidget, loadResidentResources, type CursorGlyphTable } from "./resident-text-host.ts";
import { drawTextElement, type TextDrawerStepperHost } from "./text-drawer.ts";
import { frameDelta } from "../../systems/frame-clock.ts";
import {
  commandMenuActorConstruct, commandMenuActorTick, commandMenuStateMachine, commandMenuVsyncBlit,
  jokeMenuActorConstruct, jokeMenuActorTick,
  COMMAND_ACTOR_EXTRA, COMMAND_ACTOR_HANDLER, COMMAND_ACTOR_SIZE, COMMAND_BLIT_RECT,
  COMMAND_CONFIG, COMMAND_FLAGS_BASE, COMMAND_FLAGS_INDEX, COMMAND_JOKE_CONFIG,
  COMMAND_JOKE_PERM, COMMAND_MENU_HANDLER, COMMAND_MENU_SIZE, COMMAND_MENU_UPDATE,
  COMMAND_NAME_BANK, COMMAND_STRING_BASE, COMMAND_TIME_OBJECT, JOKE_ACTOR_EXTRA,
  JOKE_ACTOR_HANDLER, JOKE_ACTOR_SIZE, JOKE_LABEL_BASE, JOKE_ROWS,
  type CommandMenuBlitHost, type CommandMenuHost,
} from "./native/fight-command-menu.ts";

export {
  COMMAND_JOKE_CONFIG, COMMAND_JOKE_PERM, JOKE_LABEL_BASE, JOKE_ACTOR_HANDLER, JOKE_ROWS,
} from "./native/fight-command-menu.ts";

/** The data file: the two menu configs and the blit rectangle. */
export const FIGHT_COMMAND_TABLES_SIZE = 72;
export const FIGHT_COMMAND_ROWS = 6;
/** Widget storage clear of the overlay data and of the task tree's first blocks. */
export const FIGHT_COMMAND_WIDGET_ARENA = { first: 0x80180000, limit: 0x801e0000 } as const;
/** The strip the blit copies from: VRAM (0, 0xF4), 156x12 (wfightmn loader). */
export const FIGHT_COMMAND_STRIP_VRAM = { x: 0, y: 0xf4, w: 156, h: 12 } as const;

export interface FightCommandResources {
  tables: Uint8Array;
  font: Uint8Array;
  banks: ReadonlyMap<number, Uint8Array>;
  /** The resident cursor glyph table (0x8004DCE0); forwarded or the shared default. */
  cursorGlyphs?: CursorGlyphTable;
}

export interface FightCommandSeed {
  /** The row the list opens on (the battle's current selection). */
  initialRow: number;
  /** The acting party slot, 0..2 ([0x800A4468]). */
  activeIndex: number;
  /** That member's ailment byte (combatant record +0x1C): 0x08 Sleep, 0x20 blocks DV. */
  ailmentBits: number;
  /**
   * The confused player's joke list (FIGHTSTG_F0x8009A898): the six row label ids
   * the shuffle produced, 0x6B + joke index each. Present means the list opens as
   * the joke owner on the joke config, with no grey rows and the joke confirm.
   */
  jokeLabels?: readonly number[];
}

export interface FightCommandHost {
  playSound(id: number): void;
}

/** One GP0 0x80 VRAM-to-VRAM copy the platform GPU executed this tick. */
export interface FightCommandMove {
  srcX: number; srcY: number; dstX: number; dstY: number; w: number; h: number;
}

export class FightCommandSession {
  readonly mem = new NativeMemory();
  readonly tree: TranslatedTaskTree;
  readonly widgets: ShopWidgetServices;
  readonly draw = new ShopDrawIntents(this.mem);
  readonly root: number;
  /** The GPU moves the vsync callback queued on the latest display tick. */
  readonly moves: FightCommandMove[] = [];
  /** The one shared packed-sound queue (F0x8002006C through [0x80055C48]). */
  private readonly audio = new PackedSoundCursor();
  /** The ids this screen asked the shared queue for. */
  get sounds(): number[] { return this.audio.sounds; }
  private readonly cell: number;
  private readonly banks: ScreenTextBanks;
  private readonly pad = new ScreenPad();
  private readonly revealHost: Parameters<typeof textRevealTick>[1];
  private readonly blitHost: CommandMenuBlitHost;
  private frame = 0;
  private readonly isJoke: boolean;
  private jokeChoice: number | null = null;

  constructor(language: number, seed: FightCommandSeed, resources: FightCommandResources,
              host: FightCommandHost) {
    if (resources.tables.length !== FIGHT_COMMAND_TABLES_SIZE) throw new Error("Invalid battle command tables");
    const row = seed.initialRow | 0;
    if (!Number.isInteger(seed.initialRow) || row < 0 || row >= FIGHT_COMMAND_ROWS) {
      throw new Error("Invalid battle command row");
    }
    if (!Number.isInteger(seed.activeIndex) || seed.activeIndex < 0 || seed.activeIndex > 2) {
      throw new Error("Invalid battle command party slot");
    }
    const jokeLabels = seed.jokeLabels ?? null;
    if (jokeLabels && jokeLabels.length !== JOKE_ROWS) throw new Error("Invalid battle joke rows");
    if (jokeLabels && jokeLabels.some((l) => !Number.isInteger(l)
      || l < JOKE_LABEL_BASE || l > JOKE_LABEL_BASE + JOKE_ROWS + 1)) {
      throw new Error("Invalid battle joke label");
    }
    this.isJoke = jokeLabels !== null;
    const mem = this.mem;
    loadResidentResources(mem, { font: resources.font,
      ...(resources.cursorGlyphs ? { cursorGlyphs: resources.cursorGlyphs } : {}), ranges: [
      { base: COMMAND_CONFIG, bytes: resources.tables.subarray(0, 32) },
      { base: COMMAND_BLIT_RECT, bytes: resources.tables.subarray(32, 40) },
      { base: COMMAND_JOKE_CONFIG, bytes: resources.tables.subarray(40, 72) },
    ] });
    this.banks = new ScreenTextBanks(mem, language, [COMMAND_NAME_BANK], resources.banks, "battle command");
    // The overlay's data (config 0x800A34CC, workspace 0x800A4460, blit packets
    // 0x800A4718) sits inside the default widget window, so this screen's widgets
    // live above the task storage instead.
    this.widgets = new ShopWidgetServices(mem, this.banks as never, FIGHT_COMMAND_WIDGET_ARENA);
    mem.write32(COMMAND_STRING_BASE, language);
    mem.write32(COMMAND_FLAGS_INDEX, seed.activeIndex);
    mem.write8(COMMAND_FLAGS_BASE + 0x10 + seed.activeIndex * 0x20 + 0x1c, seed.ailmentBits & 0xff);
    mem.write32(COMMAND_TIME_OBJECT, 0);
    this.cell = this.widgets.arena.alloc(8, 4);
    // The original's shuffle rewrites the overlay's own table in place
    // (fightstg.s:24622-24650) and the row build reads it from there, adding 0x6B
    // per row (:24257); the caller owns the eight draws and hands over the result.
    if (jokeLabels) {
      for (let i = 0; i < JOKE_ROWS; i++) {
        mem.write16(COMMAND_JOKE_PERM + i * 2, (jokeLabels[i]! - JOKE_LABEL_BASE) & 0xffff);
      }
    }

    const playSound = (id: number): void => { this.audio.play(id); host.playSound(id); };
    const menuHost: CommandMenuHost = {
      allocateActor: () => this.tree.allocate(COMMAND_ACTOR_HANDLER, COMMAND_ACTOR_SIZE, COMMAND_ACTOR_EXTRA),
      allocateJokeActor: () => this.tree.allocate(JOKE_ACTOR_HANDLER, JOKE_ACTOR_SIZE, JOKE_ACTOR_EXTRA),
      allocateMenu: () => this.tree.allocate(COMMAND_MENU_HANDLER, COMMAND_MENU_SIZE, 0),
      createTextElement: (target, kind, x, y) => this.widgets.createTextElement(target, kind, x, y),
      resourceBase: (id) => this.banks.source(id),
      packResolve: (handle) => this.draw.packResolve(handle),
      padReadA: () => this.pad.pressed(),
      padReadB: () => this.pad.repeated(),
      playSound,
        frameDelta,
      initDrawContext: () => this.draw.initDrawContext(),
      setLayer: this.draw.setLayer,
      setOrigin: this.draw.setOrigin,
      setPaletteRow: this.draw.paletteShift,
      drawSprite: this.draw.drawSprite,
      callMethod: (target, slot, args) => { callTaskOrWidget(mem, this.tree, this.widgets, target, slot, args); },
    };

    const otAddress = this.widgets.arena.alloc(8, 4);
    const packetArea = this.widgets.arena.alloc(0x4000, 4);
    const drawScratch = this.widgets.arena.alloc(0x48, 4);
    const drawerHost: TextDrawerStepperHost = {
      // The browser paints the glyphs from the widgets' own fields; the drawer
      // still runs so every per-frame side effect of the text box is kept.
      viewForKey: () => 1,
      bucketFor: () => otAddress,
      packetCursor: () => packetArea,
      flushPacketCursor: () => {},
      rotMatrixYXZ: () => { throw new Error("Battle command: rotated text is not translated"); },
      scaleMatrix: () => { throw new Error("Battle command: scaled text is not translated"); },
      applyMatrixSV: () => { throw new Error("Battle command: transformed text is not translated"); },
      alloc: this.widgets.arena.alloc,
      free: this.widgets.arena.free,
      stringById: (bank, id) => this.banks.stringById(mem, bank, id),
    };
    this.revealHost = {
      draw: (self) => drawTextElement(mem, drawerHost, self, drawScratch),
      playPackedSound: playSound,
      padButtonWord: () => this.pad.pressed(),
      logicalButtonBit: (code) => code,
      free: (ptr) => { if (this.widgets.arena.has(ptr)) this.widgets.arena.free(ptr); },
    };
    this.blitHost = {
      breakDraw: () => 0, // Platform GPU: never busy, so BreakDraw's idle arm returns 0.
      clearOTag: (ot, count) => {
        clearOtag(mem, ot, count, { debugDispatch: () => { throw new Error("libgpu debug output is not translated"); } });
      },
      setDrawMove: (packet, rect, x, y) => setDrawMove(mem, packet, rect, x, y),
      drawSync: () => 0, // Platform GPU: the idle bit is always set.
      continueDraw: (ot) => this.executeChain(ot),
    };

    const classes = new Map<number, TranslatedTaskClass>();
    classes.set(COMMAND_ACTOR_HANDLER, {
      name: "battle command actor", childSlots: [0], terminalTick: true,
      tick: (actor, children) => commandMenuActorTick(mem, actor, children, menuHost),
    });
    classes.set(JOKE_ACTOR_HANDLER, {
      name: "battle joke actor", childSlots: [0], terminalTick: true, closeTick: true,
      tick: (actor, children) => jokeMenuActorTick(mem, actor, children, menuHost),
    });
    classes.set(COMMAND_MENU_HANDLER, {
      name: "battle command menu", childSlots: [], terminalTick: true, closeTick: true,
      tick: (menu) => commandMenuStateMachine(mem, menu, menuHost),
    });
    this.tree = new TranslatedTaskTree(mem, classes, (task) => this.widgets.retireTask(task));
    this.root = jokeLabels
      ? jokeMenuActorConstruct(mem, this.cell, 0, 0, menuHost)
      : commandMenuActorConstruct(mem, row, this.cell, menuHost);
  }

  /** One display tick. */
  tick(buttons: Iterable<PadButton> = [], displayTick?: number): void {
    this.frame = displayTick ?? this.frame + 1;
    this.draw.beginFrame(this.frame);
    this.moves.length = 0;
    this.pad.update(buttons, this.frame);
    this.tree.tick(this.root);
    // The joke owner keeps its chosen joke at +0x54 and closes itself on the
    // confirm (jokeMenuActorTick); read it before the tree retires the actor.
    if (this.isJoke && this.jokeChoice === null && this.tree.tasks.has(this.root)
        && (this.mem.read32(this.root + 0x0c) | 0) === 3) {
      this.jokeChoice = this.mem.read32(this.root + 0x54) | 0;
    }
    // Each text box is its own scheduled object in the original (the actor's
    // child slots 1..6); it ticks after the menu in slot 0.
    this.widgets.forEachText((w) => textRevealTick(this.mem, this.revealHost, w));
    this.vsync();
  }

  /** The resident vsync handler's hook: [0x8004DE10](arg [0x8004DE14]). */
  private vsync(): void {
    const hook = this.mem.read32(COMMAND_TIME_OBJECT) >>> 0;
    if (hook === 0) return;
    if (hook !== COMMAND_MENU_UPDATE) throw new Error(`Untranslated vsync callback ${hook.toString(16)}`);
    commandMenuVsyncBlit(this.mem, this.mem.read32(COMMAND_TIME_OBJECT + 4) >>> 0, this.blitHost);
  }

  /** Platform GPU: run the packets linked from `ot` up to the libgpu terminator. */
  private executeChain(ot: number): void {
    let node = ot >>> 0;
    for (let guard = 0; guard < 64; guard++) {
      if (node === CLEAR_OTAG_HEAD) return;
      const tag = this.mem.read32(node) >>> 0;
      const length = tag >>> 24;
      for (let i = 0; i < length;) {
        const word = this.mem.read32(node + 4 + i * 4) >>> 0;
        const command = word >>> 24;
        if (command === 0x01) { i += 1; continue; } // texture cache flush
        if (command === 0x80 && i + 4 <= length) {
          const src = this.mem.read32(node + 8 + i * 4) >>> 0;
          const dst = this.mem.read32(node + 12 + i * 4) >>> 0;
          const size = this.mem.read32(node + 16 + i * 4) >>> 0;
          this.moves.push({ srcX: src & 0xffff, srcY: src >>> 16, dstX: dst & 0xffff, dstY: dst >>> 16,
            w: size & 0xffff, h: size >>> 16 });
          i += 4;
          continue;
        }
        throw new Error(`Battle command: untranslated GPU command ${command.toString(16)}`);
      }
      const next = tag & 0xffffff;
      if (next === 0xffffff) return;
      node = (0x80000000 | next) >>> 0;
    }
    throw new Error("Battle command: GPU chain does not terminate");
  }

  finished(): boolean { return !this.tree.tasks.has(this.root); }

  /**
   * The joke the player picked on the confused list, 0..5, once the joke owner
   * has closed (jokeMenuActorTick). The gag roll and the sequencer's mapping of
   * its result are the caller's; this is the row the list answered with.
   */
  joke(): number | null { return this.jokeChoice; }

  /** The confirmed row 0..5 once the actor has written its output cell, else null. */
  chosen(): number | null {
    if (this.isJoke) return this.jokeChoice;
    const value = this.mem.read32(this.cell) >>> 0;
    return value === 0xffffffff ? null : value;
  }

  /** True once the actor reads the pad (state 1): the list is built and live. */
  ready(): boolean {
    return this.tree.tasks.has(this.root) && (this.mem.read32(this.root + 0x0c) | 0) === 1;
  }

  /** The selected row the list currently shows. */
  selection(): number | null {
    const menu = this.tree.tasks.has(this.root) ? this.mem.read32(this.tree.tasks.get(this.root)!.children) >>> 0 : 0;
    return menu && this.tree.tasks.has(menu) ? this.mem.read32(menu + 0x50) | 0 : null;
  }

  /** Whether the vsync marker callback is installed. */
  vsyncInstalled(): boolean { return (this.mem.read32(COMMAND_TIME_OBJECT) >>> 0) !== 0; }

  /** Dispose of every task (the battle left the command phase another way). */
  dispose(): void { this.tree.dispose(this.root); }
}
