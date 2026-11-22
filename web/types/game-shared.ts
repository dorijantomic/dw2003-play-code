// Types the game files under web/game/, web/menu/ and their neighbours share. Type-only: nothing here is emitted.
import type { ScreenPack, ScreenPackIds } from "./misc-game2.js";

/** A screen pack whose sheet image and clip table have both arrived (what packReady() proves). */
export type ReadyScreenPack = ScreenPack & { img: HTMLImageElement; ids: ScreenPackIds };
