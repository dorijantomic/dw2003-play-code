// Browser state and painting adapter for the translated Card Folder editor.
// The screen logic runs in engine/dw3/ui (FolderSession over the folder-list
// controllers, the editor card grid and the rename keyboard); this file loads
// data, forwards pad state, paints the recorded draw intents and commits the
// folder records back to the walker's collection.
import { ui } from "./vendor/engine.js";
import type { PackedSfx, ResidentGlyphs } from "./types/translated-screens.js";
import type { EngineUi } from "./types/battle.js";
import { createNativeScreenRenderer } from "./native-screen-render.js";
import { paintNativeSession } from "./native-session.js";
import { composeDeck } from "./ui-c/screens.js";
import { fetchJson, fetchBytes, loadResidentResources } from "./resident-data.js";
import { cards, persistCollection, loadCatalog, catalog, loadCardIcons, drawCardIcon } from "./cardstate.js";
import type { CardDeckScreen } from "./types/carddeck-translated.js";
interface CardDeckSlab {
  base: number;
  bytes: Uint8Array;
}
interface CardDeckLoadedData {
  resident: Awaited<ReturnType<typeof loadResidentResources>>;
  banks: Map<number, Uint8Array>;
  tables: CardDeckSlab[];
}


// 1904 = namedt: the folder rename is the name keyboard (without it every keyboard clip was skipped, text only)
const PACKS: Record<string, string> = { 1598: "stcdsp", 1904: "namedt" };
const COLOURS: Record<string, number> = { white: 1, blue: 2, green: 3, red: 4, black: 5, brown: 6 };
const STAGES: Record<string, number> = { "in-training": 1, rookie: 2, champion: 3, ultimate: 4, mega: 5 };
const LABEL = "Card folder";
// The editor's four text banks, each language + a fixed offset: the card-name
// (CARDNM) and card-text (CARDST) runs the album also loads, the card-shop bank
// (CRDSHP) and the rename keyboard's NAMEDT bank.
const SHOP_OFFSET = 0x32;
const BANK_SOURCES = [
  { offset: 0x16, path: (id: number) => `album/banks/${id}.bin` },   // CARDNM
  { offset: 0x1d, path: (id: number) => `album/banks/${id}.bin` },   // CARDST
  { offset: 0x32, path: (id: number) => null },                      // CRDSHP (from cardshop-data)
  { offset: 0x86, path: (id: number) => `name/${id}.bin` },          // NAMEDT
];

let dataPromise = null;
function loadData(language: number | undefined): Promise<CardDeckLoadedData> {
  dataPromise ??= loadAll(language).catch((error) => { dataPromise = null; throw error; });
  return dataPromise;
}

async function loadAll(language: number): Promise<CardDeckLoadedData> {
  const [resident] = await Promise.all([loadResidentResources(), loadCatalog()]);
  const shopBank = await fetch(`cardshop-data/${SHOP_OFFSET + language}.bin`).then((response) => {
    if (!response.ok) throw new Error(`Folder text bank ${SHOP_OFFSET + language}: ${response.status}`);
    return response.arrayBuffer().then((buffer) => new Uint8Array(buffer));
  });
  const banks = new Map([[SHOP_OFFSET + language, shopBank]]);
  for (const { offset, path } of BANK_SOURCES) {
    const id = offset + language;
    if (path(id) === null) continue;
    banks.set(id, await fetchBytes(path(id), LABEL));
  }
  const spec = await fetchJson("stcrddek_tables.json", LABEL);
  const tables = spec.slabs.map((slab: { base: number; bytes_base64: string }) => ({
    base: slab.base, bytes: Uint8Array.from(atob(slab.bytes_base64), (c) => c.charCodeAt(0)),
  }));
  return { resident, banks, tables };
}

function resources(resident: CardDeckLoadedData["resident"], banks: CardDeckLoadedData["banks"], tables: CardDeckLoadedData["tables"]) {
  const col = cards();
  const catalogue = catalog() ?? { cards: [] };
  // The full disc record: the shared card-view text context reads AP, HP, kind,
  // the summon cost and the level from these, not just the colour.
  const cardRecords = catalogue.cards.map((card) => ({
    colour: COLOURS[card.colour] ?? 0,
    ap: card.ap ?? 0, hp: card.hp ?? 0,
    kind: card.kind === "digimon" ? 0x10 : (card.programCategory ?? 0),
    programCost: card.programCost ?? card.cost ?? 0,
    summonCost: card.summonCost ?? 0,
    level: card.level ?? STAGES[card.stage] ?? 0,
  }));
  const folders = (col?.folders ?? []).map((folder) => ({
    name: folder?.name ?? "", cards: Array.isArray(folder?.cards) ? folder.cards : [],
  }));
  return {
    banks,
    cards: cardRecords,
    font: resident.font,
    // ETS item 9: web/resident-data.ts types the glyph table as {}; it is the engine's CursorGlyphTable
    cursorGlyphs: resident.cursorGlyphs as ResidentGlyphs,
    folders,
    owned: col?.owned ?? new Map(),
    seen: col?.seen ?? [],
    tables,
  };
}

export function createCardDeckTranslated(sfx: PackedSfx | null = null, _options = {}) {
  const deck: CardDeckScreen = {
    _open: false, _session: null, _state: null, _onClose: null,
    _renderer: null, _clock: null, _error: null, _request: 0,
  };
  const renderer = createNativeScreenRenderer({ pack: "stcdsp", packs: PACKS },
    (directory) => PACKS[directory >>> 16] ?? null, {
      // the grid cell's card picture (same painter as the card shop)
      paintPrim(ctx, call) {
        if (call.method !== "cardSprite") throw new Error("Unknown card-folder picture");
        const [id, x, y, alpha] = call.args;
        ctx.save(); ctx.globalAlpha = alpha / 255; drawCardIcon(ctx, id, x, y); ctx.restore();
      },
    });
  deck._renderer = renderer;

  deck.open = (stateOrClose = null, onClose = null) => {
    deck._open = true;
    if (typeof stateOrClose === "function") {
      deck._onClose = stateOrClose;
    } else {
      deck._state = stateOrClose ?? deck._state ?? null;
      deck._onClose = onClose;
    }
    deck._error = null;
    deck._session = null;
    loadCardIcons();
    deck._clock = new (ui as EngineUi).MenuDisplayClock();
    const request = ++deck._request;
    const language = Number.isInteger(deck._state?.languageByte) ? deck._state!.languageByte : 2;
    loadData(language).then(({ resident, banks, tables }) => {
      if (!deck._open || request !== deck._request) return;
      deck._session = new (ui as EngineUi).FolderSession(language, resources(resident, banks, tables),
        { playSound(sound) { sfx?.playPacked(sound); } });
    }).catch((error) => {
      if (request !== deck._request) return;
      deck._error = error;
      console.error("Translated folder editor failed to open", error);
    });
  };

  deck.isOpen = () => deck._open;
  deck.handleKey = (_key, state) => { if (state) deck._state = state; };
  deck.update = (dt) => {
    if (!deck._open || !deck._session || deck._error) return;
    for (const frame of deck._clock!.advance(dt)) {
      deck._session.tick(deck._state?.keys ?? [], frame.tick);
      if (deck._session.finished()) { deck._finish!(); break; }
    }
  };
  deck.draw = (ctx, viewW) => {
    if (!deck._open || !deck._session) return;
    ctx.save();
    ctx.scale(viewW! / 320, viewW! / 320);
    paintNativeSession(ctx, renderer, deck._session, { ui: { key: "ui-deck", compose: composeDeck } });
    ctx.restore();
  };
  deck.close = () => { if (deck._open) deck._finish!(); };
  deck._finish = () => {
    if (!deck._open) return;
    deck._open = false;
    ++deck._request;
    const col = cards();
    if (col && Array.isArray(col.folders) && deck._session) {
      // Commit the (possibly edited) card lists back to the walker's collection:
      // the card grid writes the folder's slots in memory, and result() reads
      // them back exactly as the walker holds them.
      const result = deck._session.result();
      for (let f = 0; f < result.length && f < col.folders.length; f++) {
        const folder = col.folders[f];
        if (!folder) continue;
        folder.cards = result[f].cards;
      }
      col.activeFolder = 0;
      persistCollection();
    }
    deck._session = null;
    const callback = deck._onClose;
    deck._onClose = null;
    callback?.();
  };
  deck.diagnostics = () => ({
    execution: "translated",
    open: deck._open, pending: deck._open && !deck._session,
    error: deck._error?.message ?? null,
    tasks: deck._session?.tree.tasks.size ?? 0,
    state: deck._session ? deck._session.mem.read32(deck._session.root + 0x0c) : null,
    picker: deck._session ? deck._session.mem.read32(deck._session.root + 0x10) : null,
    cursor: deck._session ? deck._session.mem.read32(deck._session.root + 0x60) : null,
    renderer: renderer.stats,
  });
  return deck;
}
