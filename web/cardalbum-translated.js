// The Card Album as a translated production screen: data loading, held input,
// painting and the one state read. The screen's own decisions run as the
// AlbumSession (engine/dw3/ui/album-session.ts) over the already-oracled
// pro/stcrdabm controllers; this file only loads data-only assets, forwards the
// pad word, paints the stalbm pack and the resident text widgets. It links no
// interpreter host; the shipped-overlay reference is web/cardalbum-native.js
// behind ?nativeAlbum=1.
//
// The album is browse-only: it has no commit path, so close returns the walker's
// collection unchanged. The collection the player has ever obtained seeds the
// album's own flags before the first tick.
import { ui } from "./vendor/engine.js";
import { createNativeScreenRenderer } from "./native-screen-render.js";
import { paintNativeSession } from "./native-session.js";
import { fetchJson, fetchBytes, loadResidentResources } from "./resident-data.js";
import { cards } from "./cardstate.js";

const LABEL = "Card album";
const PACKS = { 0x605: "stalbm" };
const TEXT_OFFSETS = [0x16, 0x1d, 0x24];
const COLOURS = { white: 1, blue: 2, green: 3, red: 4, black: 5, brown: 6 };
const STAGES = { "in-training": 1, rookie: 2, champion: 3, ultimate: 4, mega: 5 };

let dataPromise;
function loadData(language) {
  dataPromise ??= Promise.all([
    fetchJson("card_catalog.json", LABEL), loadResidentResources(),
  ]).then(async ([catalog, resident]) => {
    const banks = new Map();
    for (const offset of TEXT_OFFSETS) {
      const id = offset + language;
      banks.set(id, await fetchBytes(`album/banks/${id}.bin`, LABEL));
    }
    const cards = catalog.cards.map((card) => ({
      colour: COLOURS[card.colour] ?? 0,
      ap: card.ap ?? 0, hp: card.hp ?? 0,
      kind: card.kind === "digimon" ? 0x10 : (card.programCategory ?? 0),
      // The shared card-view context reads every leading record byte, so carry
      // the catalogue's own fields (each of which the extractor reads off the
      // disc) rather than a derived value. `cost` is the older spelling of a
      // Program's program cost; `STAGES[stage]` the older trip through the
      // stage name for a Digimon's level.
      programCost: card.programCost ?? card.cost ?? 0,
      summonCost: card.summonCost ?? 0,
      level: card.level ?? STAGES[card.stage] ?? 0,
    }));
    return { resident, banks, cards };
  }).catch((error) => { dataPromise = null; throw error; });
  return dataPromise;
}

export function createCardAlbumTranslated(sfx = null) {
  const album = {
    _open: false, _session: null, _state: null, _onClose: null,
    _clock: null, _error: null, _request: 0,
  };
  const renderer = createNativeScreenRenderer({ pack: "stalbm", packs: PACKS },
    (directory) => PACKS[directory >>> 16] ?? null);

  function seed(state) {
    const collection = cards();
    const seen = new Set();
    const owned = new Map();
    for (const id of collection?.seen ?? []) seen.add(Number(id));
    for (const [id, count] of collection?.owned ?? []) { seen.add(Number(id)); owned.set(Number(id), count); }
    void state;
    return { seen, owned };
  }

  // The walker's call site passes only onClose; the lab passes the state.
  album.open = (stateOrClose = null, onClose = null) => {
    album._open = true;
    if (typeof stateOrClose === "function") {
      album._onClose = stateOrClose;
    } else {
      album._state = stateOrClose ?? album._state ?? null;
      album._onClose = onClose;
    }
    album._error = null;
    album._session = null;
    album._clock = new ui.MenuDisplayClock();
    const request = ++album._request;
    const language = Number.isInteger(album._state?.languageByte) ? album._state.languageByte : 2;
    loadData(language).then((data) => {
      if (!album._open || request !== album._request) return;
      const session = new ui.AlbumSession(language,
        { banks: data.banks, cards: data.cards, font: data.resident.font,
          ranges: data.resident.ranges, cursorGlyphs: data.resident.cursorGlyphs },
        { playSound: (id) => sfx?.playPacked(id) });
      const { seen, owned } = seed(album._state);
      session.seedCollection(seen, owned);
      album._session = session;
    }).catch((error) => {
      if (request !== album._request) return;
      album._error = error;
      console.error("Translated card album failed to open", error);
    });
  };

  album.isOpen = () => album._open;
  album.handleKey = (_key, state) => { if (state) album._state = state; };
  album.update = (dt) => {
    if (!album._open || !album._session || album._error) return;
    for (const frame of album._clock.advance(dt)) {
      album._session.tick(album._state?.keys ?? [], frame.tick);
      if (album._session.finished()) { album._finish(); break; }
    }
  };
  album.draw = (ctx, viewW) => {
    if (!album._open || !album._session) return;
    ctx.save();
    ctx.scale(viewW / 320, viewW / 320);
    paintNativeSession(ctx, renderer, album._session);
    ctx.restore();
  };
  album.close = () => { if (album._open) album._finish(); };
  album._finish = () => {
    if (!album._open) return;
    album._open = false;
    ++album._request;
    album._session = null;
    const callback = album._onClose;
    album._onClose = null;
    callback?.();
  };
  album.diagnostics = () => ({
    execution: "translated",
    open: album._open,
    pending: album._open && !album._session,
    error: album._error?.message ?? null,
    translated: true,
    session: album._session?.diagnostics() ?? null,
    renderer: renderer.stats,
  });
  return album;
}
