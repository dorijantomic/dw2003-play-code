// web/ui-c/claims.js -- look C kit: pure data. Which (pack, clip id) the overlay draws itself, and as which part. A clip that is not
// listed is ART: it stays pixel art (drawn into the art canvas, never dropped). Only our own sizes live here (from the C files); a
// clip's native position comes from the game's own draw call at run time.
//
// Pause home (C1): the game draws nine clips on it. Ids and what they are:
//   cmfont 21 / 23 : the party card and its name plate, one pair per partner (y 17, 63, 109)
//   cmfont 24      : the header bar ("Button: Close Status")
//   cmfont 0x19 0x1b 0x1c 0x100+n : the list panel (n = row count, web/panel-kit.js)
//   cmfont 26      : the money band
export const PAUSE_PANEL_ROWS = Object.freeze({ 0x1c: 5, 0x1b: 6, 0x19: 7 });
export const PAUSE_PANEL_EXTRA_BASE = 0x100;
const panelRows = (id: number) => (PAUSE_PANEL_ROWS[id] ?? (id > PAUSE_PANEL_EXTRA_BASE + 7 && id <= PAUSE_PANEL_EXTRA_BASE + 12 ? id - PAUSE_PANEL_EXTRA_BASE : 0));

// Pages with the party sidebar (T1 leftovers + T2): ststat 29 = the scrolling diamond backdrop (its x = y = the scroll counter), 30 = the
// orange highlight (card edge, name plate corners, portrait corners; drawn at the selected card, a second one while SORT holds a partner),
// 32 = the footer band, 58 = the CARD FOLDERS window (title + rows); cmfont 22 = the portrait plate; the portrait pictures themselves
// (ststat 7, 8, 17, 18, 21, 22 ...) are 32 x 32 sprites = art by size.
// Lab, gym and shop screens (own packs): backdrop, header plate, window, hint plates, capsule window, info card, stat window.
const PL = (part: string, shape: string, o = {}) => ({ part, shape, layer: "under", ...o });
const BACKDROP = { part: "backdrop", layer: "under" };
const ART = { part: "art", layer: "art" };
// T3 lists and grids (lists.js): a claim with keepArt records the part AND draws the clip's own pixels (a frame goes under the picture)
const ROWLINE = { part: "rowLine", layer: "under" };
const CHIP = { part: "pageChip", layer: "over" };
const GRID_ART = { part: "gridArt", layer: "under", keepArt: true };
const CURSOR_BOX = { part: "cursorBox", layer: "over" };
// T5 the two-row confirm box (Buy / No, Yes / No): pages.js composeRows({ confirm }); layer "over" = above the art canvas, as the game
// draws it over the card / item pictures
const CONFIRM_BOX = Object.freeze({ part: "confirm", layer: "over" });
// a claimed clip that carries small pictures inside its frame (the deck's element cubes, 16 x 16 pieces): the frame becomes the C
// plate, the pieces of these sizes stay the game's pixels on the art canvas (capture.js reads the pieces from the sheet at run time)
const CUBES = Object.freeze({ artSizes: Object.freeze([[16, 16]]) });

// T7 full-screen pages (fullpages.js). Name entry keyboard (namedt; also the deck folder rename): title plate (29), portrait frame (30; its
// scanline backing 31 is replaced by the C body), the name slots (55 = 8, 53 = 10; the slot rects are the clip's own sheet layers), the
// keyboard window + key grid (37, grid blocks from its layers), the key cursor (39), the slot cursor (40), the buttons: 72 x 17 (DEL / SPC
// in every language), 16 x 17 (arrows), 40 x 17 (OK). A button's frame is the C plate; its word stays the game's pixels (artInset =
// the native px cut off its bounds), so every language keeps its own word and no word is stored here.
const LANG_CURSOR = { part: "langCursor", layer: "under" };
const KEY_BUTTON = Object.freeze({ part: "keyButton", layer: "under", artInset: Object.freeze([5, 2, 3, 3]) });
const WIZ_STEPS = Object.freeze({ part: "wizSteps", layer: "over", layers: true });
const NAMEDT: Record<string, { part: string; layer: string; } | { part: string; layer: string; layers: boolean; }> = { 29: { part: "nameHdr", layer: "under" }, 30: { part: "portraitFrame", layer: "under" }, 31: { part: "portraitBack", layer: "under" },
    55: { part: "nameSlots", layer: "under", layers: true }, 53: { part: "nameSlots", layer: "under", layers: true },
    37: { part: "keyboard", layer: "under", layers: true }, 39: { part: "keyCursor", layer: "over" }, 40: { part: "slotCursor", layer: "over" } };
for (const id of [60, 61, 62, 63, 64, 70, 71, 72, 44, 45, 46, 47, 48, 77, 78, 79]) NAMEDT[id] = KEY_BUTTON;

// T8 the battle chrome (pgfgc00, web/battle.js + the six translated battle menus; composer web/ui-c/battlehud.js). HUD: the two HP plates
// (0 enemy, 1 player), the face bezel (10, its 100 x 60 window is the live 3D close-up), the DV gauge frames (30 outer, 11 inner), the
// gauge fill (51-58, drawn with the revealed width), the party markers (12-15 the side's active member, 60-63 the others; cel & 3 = the
// member's state). Menus: the command / form row (34, 36: key box + plate), the Tag partner row (47: key box, name plate, HP / MP box), the
// technique and item list windows (42, 39: the row boxes are 12 x 12 sheet layers), the MP plate (41: plate in its layers below y 18), the
// item count plate (40), the Digivolve stat panel (37), the DNA species strip (43), the message / description pane (49). The page arrows
// (31, 32, 8 x 8) are pictures.
const PGF = (part: string, o = {}) => ({ part, layer: "under", ...o });
const PGFGC00: Record<string, { part: string; layer: string; }> = {
    0: PGF("hudPlate", { side: "enemy" }), 1: PGF("hudPlate", { side: "player" }), 10: PGF("bezel", { layer: "over" }),
    30: PGF("dvFrame"), 11: PGF("dvInner"),
    34: PGF("cmdRow", { layers: true }), 36: PGF("cmdRow", { layers: true }), 47: PGF("tagRow", { layers: true }),
    42: PGF("listWin", { layers: true }), 39: PGF("listWin", { layers: true }), 41: PGF("mpPlate", { layers: true }),
    40: PGF("qtyPlate"), 37: PGF("statPanel"), 43: PGF("strip"), 49: PGF("msgPane"), 31: ART, 32: ART,
};
for (let id = 51; id <= 58; id++) PGFGC00[id] = PGF("dvFill", { layer: "over" });
for (const id of [12, 13, 14, 15, 60, 61, 62, 63]) PGFGC00[id] = PGF("pip", { layer: "over" });

export const CLAIMS = Object.freeze({
    pgfgc00: Object.freeze(PGFGC00),
    namedt: Object.freeze(NAMEDT),
    // the partner chooser before the keyboard (stdgnm): the diamond backdrop (36; 49 is a corner piece drawn off screen), title plate (29),
    // Back hint (35), one row per partner (30), the portrait backing (31, replaced by the C body), the cursor frame (32)
    stdgnm: Object.freeze({
        36: BACKDROP, 49: ART, 29: { part: "nameHdr", layer: "under" }, 35: PL("hint", "ch"),
        30: { part: "pickRow", layer: "under" }, 31: { part: "portraitBack", layer: "under" }, 32: { part: "pickCursor", layer: "over" },
    }),
    // SAVE / LOAD (stmcrd): the machine-wall backdrop (30), the panel (33: frame + its divider lines, read from its layers), the slot box
    // "1 / 2" (29), the slot info frame (36: line art from its layers; the three 48 x 32 partner diamonds stay pictures), the diamond
    // halves (37), the top bar (32), the card reader (34) and the memory cards (35) are pictures; the pipe (31) runs BEHIND the panel in
    // the game, so it is a part (a C column under the panel plate), never art (art always sits over the plates)
    stmcrd: Object.freeze({
        30: BACKDROP, 33: { part: "mcPanel", layer: "under", layers: true }, 29: { part: "mcSlots", layer: "under" },
        36: { part: "mcInfo", layer: "under", layers: true, artSizes: Object.freeze([[48, 32]]) },
        31: { part: "mcPipe", layer: "under" }, 37: ART, 32: ART, 34: ART, 35: ART,
    }),
    // Digimon Online registration (stnmet): the message window (15; its 56 x 58 circuit wires each side stay pictures), the logo (56), the
    // data streams (24-35), the full-screen overlays (60-75); cmnbgd = the hex backdrop pictures (the C stripes)
    // the wizard's own pages (composeNet): the three step chips (12 / 13 / 14 = step 1 / 2 / 3), the starter pack window (7: its three
    // 48 x 32 pedestals stay pictures, the A / B / C tab frames and the rules come from its layers; 50 = the chosen tab, 8 = the pedestal
    // rims over the partners), the confirm page: the name window (2: the 32 x 32 portrait stays a picture), its portrait frame (6), the
    // pack window (9, pedestals kept; 10 = their rims), the wire band holding the Register box (1: the box is its 54 tall pieces)
    stnmet: Object.freeze({
        15: { part: "netWin", layer: "under", layers: true, artSizes: Object.freeze([[56, 58]]) }, 56: ART, 8: ART, 10: ART, 1: { part: "netWin", layer: "under", layers: true, artSizes: Object.freeze([[56, 58], [16, 58]]) },
        12: WIZ_STEPS, 13: WIZ_STEPS, 14: WIZ_STEPS, 7: { part: "packWin", layer: "under", layers: true, artSizes: Object.freeze([[48, 32]]) },
        50: { part: "packSel", layer: "over" }, 2: { part: "cfName", layer: "under", layers: true, artSizes: Object.freeze([[32, 32]]) },
        6: { part: "cfPortrait", layer: "under" }, 9: { part: "cfPack", layer: "under", layers: true, artSizes: Object.freeze([[48, 32]]) },
        // the base fill (60-75) and the falling data streams (24-35) belong to the hex backdrop: the C stripes replace them (a part nobody
        // composes), else their opaque pixels would sit over every plate (art is above the under layer)
        ...Object.fromEntries([24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75].map((i) => [i, { part: "wizBase", layer: "under" }])),
    }),
    cmnbgd: Object.freeze({ 0: BACKDROP, 1: BACKDROP, 2: BACKDROP }),
    // the END card: one picture (the END logo; its fade is the picture's own palette row) -- a logo stays pixels (SPEC decision 3)
    endall: Object.freeze({ 0: ART }),
    // the language page (cntselwn): the tile backdrop (0); the header band (1) with its SELECT LANGUAGE word (136 x 14) kept as a picture;
    // the right column (2) with the flags (44 x 28) and the language words (72 / 64 / 76 x 14, 64 x 16) kept as pictures; the logo band (3)
    // with the logo (120 x 58) kept; the cursor frame (4-8, one clip per row) = the focus plate under the row
    cntselwn: Object.freeze({
        0: BACKDROP, 1: { part: "langHeader", layer: "under", artSizes: Object.freeze([[136, 14]]) },
        2: { part: "langColumn", layer: "under", artSizes: Object.freeze([[44, 28], [72, 14], [64, 14], [76, 14], [64, 16]]) },
        3: { part: "langBand", layer: "under", artSizes: Object.freeze([[120, 58]]) },
        4: LANG_CURSOR, 5: LANG_CURSOR, 6: LANG_CURSOR, 7: LANG_CURSOR, 8: LANG_CURSOR,
    }),
    cmfont: Object.freeze({
        21: { part: "card", layer: "under" },
        22: { part: "portrait", layer: "under" },
        23: { part: "cardName", layer: "under" },
        24: { part: "header", layer: "under" },
        26: { part: "money", layer: "under" },
        // lab / gym: the pedestal under the portrait, the stat icon column, the glass lights and the light beam of the capsules
        13: ART, 14: ART, 15: ART, 16: ART, 17: ART,
        // lab "Switch with who?": the empty capsule (11) and its light (12)
        11: ART, 12: ART,
        // inn (Stay / Do not stay): the inn name plate (65), the money plate (66), the price window (67), the choice window (68)
        65: PL("name", "ch"), 66: PL("money", "sl"), 67: PL("priceWin", "sl"), 68: PL("window", "ch"),
        // T5 the field Yes / No question box (web/yesno-translated.js): full width, 320 x 50 -- the prompt line + the confirm rows
        69: { part: "question", layer: "over" },
        // help counter: the topic window (title rows + cursor)
        36: PL("window", "ch"),
        // item lists: the highlight box around the cursor row's item icon (the icons themselves, 12 x 12, are art)
        64: { part: "iconHl", layer: "over" },
        // See Digivolve: the stat icon column (the icons are pictures); the battle Digivolve / DNA stat panel's icon column (35, 78 x 96)
        20: ART, 35: ART,
        // T6 the field conversation box (web/dialogue-translated.js, message.js): the balloon's left / right pieces (0, 2; clip 1 is only the
        // fill texture), the four tails (3 4 5 6, one per quadrant), the "more" marker (7: dashes + shaft, the head in its bottom 10 rows),
        // the plain window's two band halves (8, 9) and the footer "more" marker (10, also the item-use message and the help pages)
        0: { part: "balloonCap", layer: "under" }, 2: { part: "balloonCap", layer: "under" },
        3: { part: "balloonTail", layer: "under" }, 4: { part: "balloonTail", layer: "under" },
        5: { part: "balloonTail", layer: "under" }, 6: { part: "balloonTail", layer: "under" },
        7: { part: "more", layer: "over", box: Object.freeze([0, 10, 5, 10]) }, 10: { part: "more", layer: "over" },
        8: { part: "msgBand", layer: "under" }, 9: { part: "msgBand", layer: "under" },
    }),
    ststat: Object.freeze({
        29: BACKDROP,
        30: { part: "highlight", layer: "over" },
        32: { part: "footer", layer: "under" },
        58: { part: "folderWin", layer: "under" },
        // SORT "Switch with who?": the bracket between the held partner and the cursor (40 = cards 1 and 3, 41 = neighbour cards)
        // the item detail line (item name | Equip n | Items n) on the item target picker and the bag
        47: { part: "detail", layer: "under" },
        40: { part: "bracket", layer: "over" },
        41: { part: "bracket", layer: "over" },
        // ITEMS bag: the list window (46, full width), the "Items" tab (48), one underline per item row (49)
        46: { part: "listWin", layer: "under" }, 48: { part: "tabHdr", layer: "under" }, 49: ROWLINE,
        // TECHNIQUES list (45 = 5 rows, 54 = 4, 55 = 3, 56 = 2, 57 = 1) and the equipment item grid (43): a title + rows window, the
        // same family as CARD FOLDERS (58)
        45: { part: "folderWin", layer: "under" }, 54: { part: "folderWin", layer: "under" }, 55: { part: "folderWin", layer: "under" },
        56: { part: "folderWin", layer: "under" }, 57: { part: "folderWin", layer: "under" }, 43: { part: "folderWin", layer: "under" },
        // T4 info sheets (sheets.js): status header window (31), stat window (33), the Digivolve / Equip tab panels (34, 35; 44 = the Equip
        // tab over the item grid), See Digivolve forms list (36) and form sheet (39), See Equipment slot window (42), the TP plate (60)
        31: { part: "headerWin", layer: "under" }, 33: { part: "statWin", layer: "under" }, 34: { part: "tabPanel", layer: "under" },
        35: { part: "tabPanel", layer: "under" }, 44: { part: "tabPanel", layer: "under" }, 36: { part: "formList", layer: "under" },
        39: { part: "formSheet", layer: "under" }, 42: { part: "slotWin", layer: "under" }, 60: { part: "tpPlate", layer: "under" },
        // T7 the pause MAP page: the place-name window (the map, its markers and the area title are pictures)
        59: { part: "mapName", layer: "under" },
    }),
    stdglabo: Object.freeze({
        55: BACKDROP,
        32: PL("header", "sl"), 37: PL("hint", "ch"), 38: PL("hint", "ch"), 36: PL("hint", "ch"),
        33: PL("window", "ch"), 30: PL("info", "sr"), 39: PL("capsule", "ch"),
        // "Switch with who?": one clip = window + four capsule cells + the navy arrow tree; the composer reads the cells and the tree from
        // the clip's own sheet layers at run time (layers: true), so no size is stored here
        45: { part: "switchWin", layer: "under", layers: true },
        // pictures on it: the white active arrows (56), the slot numbers 1 2 3 (51), the big up / down swap arrow (59)
        56: ART, 51: ART, 59: ART,
        // Digivolve Chart: title plate (68), page plate "1 / 4" (67), the R1 page arrow (70), the portrait cells (61; 63 = a cell with its
        // connector stub, split by its sheet layers), the connector line (64), the cursor box (71)
        68: PL("header", "sr"), 67: PL("pagePlate", "sl"), 70: CHIP, 61: { part: "cellFrame", layer: "under" },
        63: { part: "cellFrame", layer: "under", layers: true }, 64: { part: "connector", layer: "under" }, 71: CURSOR_BOX,
    }),
    sttrng3: Object.freeze({
        45: BACKDROP,
        // the drill grid adds the drill description plate under the grid (35, slanted left edge like the disc)
        34: PL("header", "sl"), 39: PL("hint", "ch"), 35: PL("hint", "sl"), 36: PL("capsule", "ch"), 33: PL("tp", "sr"), 32: PL("stats", "ch"), 31: PL("info", "sr"),
        // T5 gym confirm: the "Is this ok?" plate with its striped lead (38) and the Yes / No box (29)
        38: PL("hint", "sl"), 29: CONFIRM_BOX,
        // the drill result: the room frame (40; its 168 x 88 room picture stays the game's pixels) and the drill name plate (37)
        40: PL("frame", "ch", { artSizes: Object.freeze([[168, 88]]) }), 37: PL("plate", "ch"),
    }),
    stshop: Object.freeze({
        20: BACKDROP,
        0: PL("hint", "ch"), 5: PL("window", "ch"), 2: PL("money", "sl"), 1: PL("name", "ch"),
        // "Equip who?": the prompt plate (21), the item line + price (14, split by its own layers), the partner cards (8), the cursor
        // frame (15, palette row = colour cycle); the "cannot equip" cross (22) is a picture
        21: PL("header", "sl"), 14: { part: "shopDetail", layer: "under", layers: true }, 8: PL("pcard", "ch"),
        15: { part: "pickHl", layer: "over" }, 22: ART,
        // buy / sell lists: the list windows (6 buy, 7 sell), the item row underline (49), the R1 page arrow (17), the L1 page arrow (16), the Effects hint
        // plate (9), the description footer (3), the sell categories window (4)
        6: { part: "listWin", layer: "under" }, 7: { part: "listWin", layer: "under" }, 49: ROWLINE, 17: CHIP, 16: CHIP,
        9: PL("hint", "ch"), 3: { part: "footer", layer: "under" }, 4: PL("window", "ch"),
        // T5 confirm + quantity: "How many?" plate (10), the number spinner (11) and its up / down arrows (18), the two-row confirm box
        // (12: Buy / No, Equip? Yes / No, Sell / No)
        10: PL("header", "sl"), 11: { part: "spinner", layer: "under" }, 18: { part: "spinArrows", layer: "over" }, 12: CONFIRM_BOX,
    }),
    // fight report (T4): backdrop (30), total EXP badge (33), message band (29), partner group plate (31; its portrait, 8, is art by size),
    // form bars (32), the highlight of the partner the page is about (36, split by its own sheet layers)
    stfrpt: Object.freeze({
        30: BACKDROP, 33: { part: "expPlate", layer: "under" }, 29: { part: "msgBand", layer: "under" }, 31: { part: "reportCard", layer: "under" },
        32: { part: "formBar", layer: "under" }, 36: { part: "reportHl", layer: "over", layers: true },
    }),
    // card album: backdrop (8), title plate (9), Back hint (15), page plate (14), R1 arrow (27), the card back of a slot (6: a picture, kept
    // in its pixels on a C frame, as the disc shows a card back where the player has no card)
    stalbm: Object.freeze({
        8: BACKDROP, 9: PL("header", "sr"), 15: PL("hint", "ch"), 14: PL("pagePlate", "chip"), 27: CHIP, 6: GRID_ART,
    }),
    // card shop + deck editor: backdrop (8), shop name (40), money (41), root window (47), hint (15), card name window (10), count plates
    // (13), AP / HP panel (12), card faces (0-5, pixels kept), the card cursor (7); deck: header (48), folder rows (65 off, 66 on, 68 held),
    // actions window (45), card grid window (64), grid card pictures (83-88, pixels kept), the grid cursor (67)
    stcdsp: Object.freeze({
        8: BACKDROP, 40: PL("name", "ch"), 41: PL("money", "sl"), 47: PL("window", "ch"), 15: PL("hint", "ch"),
        10: PL("plate", "ch"), 13: PL("plate", "ch"), 12: PL("plate", "ch"),
        0: GRID_ART, 1: GRID_ART, 2: GRID_ART, 3: GRID_ART, 4: GRID_ART, 5: GRID_ART, 7: CURSOR_BOX,
        48: PL("header", "sl"), 65: PL("folder", "ch", CUBES), 66: PL("folder", "ch", { state: "on", ...CUBES }), 68: PL("folder", "ch", { state: "held", ...CUBES }),
        // T5: the BUY / NO box (45) and the price plate over it (44) -- both drawn over the card pictures, as the game does
        45: CONFIRM_BOX, 44: PL("header", "sl", { layer: "over" }), 64: PL("gridWin", "ch", CUBES),
        83: GRID_ART, 84: GRID_ART, 85: GRID_ART, 86: GRID_ART, 87: GRID_ART, 88: GRID_ART, 67: CURSOR_BOX,
    }),
});

/** Packs that are pictures through and through: the pause MAP page's map and its area pieces (stwmp<n>map / stwmp<n>area). */
export const isPicturePack = (pack: string) => /^stwmp\d+(map|area)$/.test(String(pack ?? ""));

/** T9 our own book screens (OPTIONS, GLOSSARY, map book, fly book): the list panels web/ui-kit.js builds from the pause list's tiles and
 *  registers in cmfont as "kit-<cols>x<bands>" (web/panel-kit.js). One C window each; books.js composes their rows. */
export const KIT_PANEL = Object.freeze({ part: "window", layer: "under" });
export const isKitPanel = (pack: string, id: string | number) => pack === "cmfont" && /^kit-\d+x\d+$/.test(String(id));

/** The claim for a clip: { part, layer, rows? } or null (art). `id` may be "n#row" (a palette variant of clip n). */
export function claimFor(pack: string, id: string | number) {
    if (isKitPanel(pack, id)) return KIT_PANEL;
    const base = Number(String(id).split("#")[0]);
    if (isPicturePack(pack)) return ART;
    if (pack === "cmfont" && panelRows(base)) return { part: "panel", layer: "under", rows: panelRows(base) };
    return CLAIMS[pack]?.[base] ?? null;
}

/** True when the draw calls are the pause home: a list panel, the money band and the cards (all in pack cmfont, dir 0x286). */
export function isPauseHome(calls = []) {
    let panel = false, money = false;
    for (const c of calls) {
        if (c.method !== "drawSprite") continue;
        const id = Number(c.args[1]), dir = (c.args[0] >>> 16) & 0xffff;
        if (dir !== 0x286) continue;
        if (panelRows(id) && c.args[2] === 168 && c.args[3] === 40) panel = true;
        if (id === 26) money = true;
    }
    // the items categories draw the same list, but with the portrait plates of the sidebar (cmfont 22); the home has none. The diamond
    // backdrop is NOT the test: back from a sidebar page the game keeps drawing it under the home.
    return panel && money && !hasClip(calls, CMFONT_DIR, 22);
}

export const CMFONT_DIR = 0x286, STSTAT_DIR = 0x404;
/** The status sheet family (status, See Digivolve, See Equipment, the equipment item grid): any of its own clips is drawn. */
export const STATUS_CLIPS = Object.freeze([31, 33, 36, 39, 42, 44, 60]);
/** Does the frame draw clip `id` of the pack directory `dir`? */
export const hasClip = (calls, dir: number, id: number) => calls.some((c) => c.method === "drawSprite" && ((c.args[0] >>> 16) & 0xffff) === dir && Number(c.args[1]) === id);

/** The party sidebar pages (picker, items categories, folders, demo): the party cards with their portrait plates. */
export const isSidebarPage = (calls = []) => hasClip(calls, CMFONT_DIR, 21) && hasClip(calls, CMFONT_DIR, 22);
