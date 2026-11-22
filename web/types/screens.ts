// Shared shapes of the book and native-screen modules (web/glossary-*.ts, web/book-host.ts, web/cntysel-native.ts).
import type { DropDropper } from "./codex-data.js";
import type { createBattle3D } from "../battle3d.js";
import type { SfxPlayerContext } from "./audio.js";
import type { AnimViewerCamera, CameraBounds, CameraBox, FreeCameraOptions } from "./anim-viewer-camera.js";
import type { CountryScreen } from "../../engine/dw3/ui/country-screen.js";
import type { NativeScreenRenderStats } from "./native-screen-render.js";
import type { BookOpts } from "../ui-c/types.js";
import type { DigimonLog, GlossaryPartner, GlossarySpeciesData } from "./glossary-digimon.js";

// ---------------------------------------------------------------- GLOSSARY > ITEMS (web/glossary-items.ts)

/** One place an item comes from in item_obtain_index.json. */
export interface ItemObtainSource {
  kind?: string;
  shop_id?: number | string;
}

/** One item of item_obtain_index.json: its name and where it comes from. */
export interface ItemObtainRecord {
  name?: string;
  sources?: ItemObtainSource[];
}

/** item_obtain_index.json: the items by id. */
export interface ItemObtainIndex {
  items?: Record<string, ItemObtainRecord>;
}

/** One shop of shops.json (the disc's unopened shop has no name). */
export interface ShopRecord {
  shop_id: number | string;
  name?: unknown;
}

/** shops.json: the shop list or the file holding it. */
export type ShopsFile = ShopRecord[] | { shops?: ShopRecord[] };

/** One record of battlecmd/enemy_stats.json: the index of the enemy's name line. */
export interface EnemyStatRecord {
  nameId?: number | null;
}

/** battlecmd/enemy_stats.json: the records, in the order of enemies.json. */
export interface EnemyStatsFile {
  records?: EnemyStatRecord[];
}

/** What buildItemsData() answers for the page. */
export interface ItemsData {
  enemyName: (id: string) => string;
  groups: Map<string, string[]>;
  shopName: (id: number | string) => string;
  obtainName: (itemId: number | string) => string;
  shopIds: (itemId: number | string) => number[];
  droppers: (itemId: number | string) => DropDropper[];
}

/** One "Where to get it" line: a shop or a Digimon that drops it (`right` = the percent). */
export interface WhereLine {
  kind: string;
  text: string;
  right?: string;
}

/** The game's name and description of one item. */
export interface ItemInfo {
  name?: string;
  desc?: string;
}

/** One item's page. */
export interface ItemPage {
  id: number;
  name: string;
  count: number;
  does: string;
  where: WhereLine[];
}

/** One slot of a bag. */
export interface BagSlot {
  id?: number;
  qty?: number;
}

// ---------------------------------------------------------------- GLOSSARY partner picture (web/glossary-fallback.ts)

/** One new partner as the roster lists it: its profile id and roster slot. */
export interface PartnerSlotRecord {
  id: number;
  slot: number;
}

/** What the fallback picture is asked for: the species' partner id, when it has one. */
export interface PartnerFallbackTarget {
  partnerId?: number | null;
}

/** The parts the partner fallback picture can be given instead of the real ones. */
export interface PartnerFallbackDeps {
  partners?: () => readonly (PartnerSlotRecord | null)[];
  draw?: (ctx: CanvasRenderingContext2D, id: number, x: number, y: number) => boolean;
  now?: () => number;
}

// ---------------------------------------------------------------- GLOSSARY model stage (web/glossary-stage.ts)

/** A point or direction in world units. */
export type Vec3 = [number, number, number];

/** The free camera's view: where it stands, what it looks at, which way is up. */
export interface StageView {
  eye: number[];
  look: number[];
  up: number[];
  fovDeg: number;
}

/** The battle renderer the stage drives (web/battle3d.ts createBattle3D, built with a transparent canvas). */
export type StageRenderer = ReturnType<typeof createBattle3D>;

/** The viewer's free camera (web/anim-viewer-camera.ts createFreeCamera); the stage also frames a box given as centre and half-extents, which the camera reads. */
export interface StageCamera extends Omit<AnimViewerCamera, "frameBounds"> {
  frameBounds?: (bounds: CameraBounds | CameraBox, aspect?: number, opts?: { immediate?: boolean; padding?: number }) => boolean;
}

/** The canvas the renderer draws on: a page canvas, or an offscreen one. */
export type StageCanvas = HTMLCanvasElement | OffscreenCanvas;

/** The species the stage was asked for last. */
export interface StageShown {
  name: string;
  partnerId: number | null;
}

/** Where the model's feet stand, for the floor shadow. */
export interface StageFeet {
  center: number[];
  radius: number;
}

/** The model load in flight: its folder and the promise of its result. */
export interface StageLoading {
  folder: string;
  promise: Promise<boolean>;
}

/** What createStage() is built from. */
export interface StageOptions {
  makeRenderer: (canvas: StageCanvas) => StageRenderer;
  makeCamera: (opts: FreeCameraOptions) => StageCamera;
  resolveFolder: (name: string) => string | null | Promise<string | null>;
  setTint: (side: string, tint: number[] | null) => void;
  size?: [number, number];
  canvasFactory?: ((width: number, height: number) => StageCanvas | null) | null;
  drawFallback?: ((ctx: CanvasRenderingContext2D, who: StageShown, x: number, y: number, w: number, h: number) => boolean) | null;
}

// ---------------------------------------------------------------- GLOSSARY book (web/glossary-book.ts)

/** What the book draws a species' model with: its picture is painted into a rectangle of the canvas. */
export interface GlossaryArtStage {
  draw(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, dt?: number): boolean;
}

/** The turning model stage (web/glossary-stage.ts createStage) as the book asks it. */
export interface GlossaryBookStage extends GlossaryArtStage {
  show(name: string, opts: { shadow?: boolean; partnerId?: number | null }): Promise<boolean>;
  close?(): void;
}

/** The ITEMS section's source: null data while the tables load, else the page data and the item answers. */
export interface GlossaryItemsSource {
  data: ItemsData | null | undefined;
  info: (id: number) => ItemInfo | null | undefined;
  ids: () => number[];
  held?: (id: number) => number;
}

/** The book's pages as it draws them: how far each window has unfolded, and the frame counters. */
export interface GlossaryBookView {
  progress(name: "list" | "model" | "title" | "footer"): number;
  ticks: number;
  dt?: number;
}

/** One drawable row of page 2 (the strength pane). */
export type Page2Row =
  | { kind: "head"; label: string; icon: null; text: string }
  | { kind: "bar"; label: string; icon: string | null; value: number; max: number; text: string }
  | { kind: "note"; label: string; icon: null; text: string; textX: number }
  | { kind: "text"; label: string; icon: null; text: string; textX: number; icons?: string[] };

/** Width in pixels of a text in the game font (kind 1 = plain, 3 = the orange digits). */
export type TextWidthFn = (text: string, kind?: number) => number;

/** What createGlossaryBook() is built from. */
export interface GlossaryBookArgs {
  sfx?: SfxPlayerContext | null;
  getSpecies: () => GlossarySpeciesData | null | undefined;
  getLog: () => DigimonLog;
  getPartners?: () => (GlossaryPartner | null)[];
  stage?: GlossaryBookStage | null;
  getItems?: (() => GlossaryItemsSource | null | undefined) | null;
}

// ---------------------------------------------------------------- book host (web/book-host.ts)

/** The F2 effect switches a book may read. */
export type BookFx = Record<string, boolean | number | string | undefined> | null | undefined;

/** What a book's draw() is told: how far each of its windows has unfolded, the frame counter and the last frame's seconds. */
export interface BookView {
  progress: (windowName: string) => number;
  ticks: number;
  dt: number;
}

/** One book screen (GLOSSARY, OPTIONS, ...): the windows it folds open, and its per-frame work. */
export interface Book {
  windows: string[];
  /** true = the drifting status wall behind it (full-screen pages); false = the dimmed field */
  wall: boolean;
  /** how the look C layer composes it */
  look?: BookOpts;
  /** one displayed frame's acting buttons; "back" shuts the book */
  act(buttons: ReadonlySet<string>): string | null;
  tick?(): void;
  draw(ctx: CanvasRenderingContext2D, view: BookView): void;
  close?(): void;
}

/** What the host hands a book factory. */
export interface BookFactoryArgs {
  sfx: SfxPlayerContext | null;
  fx: () => BookFx;
  setFx: (key: string, value: unknown) => void;
  setFxMany: (values: Record<string, unknown>) => void;
  host: BookHost;
}

/** Builds one book when the host opens it. */
export type BookFactory = (args: BookFactoryArgs) => Book;

/** Called with the buttons still held when the book has shut and the pause list returns. */
export type BookBack = (held: string[]) => void;

/** The host that runs one book over the pause menu. */
export interface BookHost {
  isOpen(): boolean;
  open(name: string, back?: BookBack | null, held?: Iterable<string>): boolean;
  close(): void;
  update(dt: number, held: Set<string>): void;
  draw(ctx: CanvasRenderingContext2D, viewW: number, viewH: number, padL?: number, sidesByField?: boolean): void;
}

/** What createBookHost() is built from. */
export interface BookHostArgs {
  sfx?: SfxPlayerContext | null;
  factories?: Record<string, BookFactory>;
  fx?: () => BookFx;
  setFx?: (key: string, value: unknown) => void;
  setFxMany?: (values: Record<string, unknown>) => void;
}

// ---------------------------------------------------------------- language screen (web/cntysel-native.ts)

/** Called when a language is chosen: the row, the language and the code of the screen it launches. */
/** game.ts reads the row as text, so the callback may take either */
export type CntyselPick = (row: string | number, language: number, launchCode: number) => void;

/** One recorded draw call of the language screen: the picture-service method and its numbers. */
export interface CntyselDraw {
  method: string;
  args: number[];
}

/** What the language screen's diagnostics() reports. */
export interface CntyselDiagnostics {
  open: boolean;
  pending: boolean;
  row: number;
  language: number;
  fade: number;
  queued: number;
  traps: number;
  lastDiagnostic: string | null;
  host: {
    module: string;
    execution: string;
    frames: number;
    objects: number;
    state: ReturnType<CountryScreen["tree"]["state"]>;
    transition: CountryScreen["transition"];
    renderer: NativeScreenRenderStats;
  } | null;
}

/** The language screen adapter (web/cntysel-native.ts). */
export interface CntyselNative {
  /** the game's close sweep clears it on screens that have no close() of their own */
  _open?: boolean;
  open(callback?: CntyselPick | null): void;
  isOpen: () => boolean;
  isPending: () => boolean;
  active: () => boolean;
  press(button: string): void;
  update(dt: number, keys: Set<string>): void;
  draw(ctx: CanvasRenderingContext2D, viewW: number, _viewH: number): void;
  close: () => void;
  diagnostics: () => CntyselDiagnostics;
}
