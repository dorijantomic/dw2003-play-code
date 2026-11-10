// Browser state and painting adapter for the translated merchant task tree.
// The screen logic runs in engine/dw3/ui; this file loads data, forwards pad
// state, paints draw intents and commits the translated save fields.
import {
  commitMerchantClose, ui, rosterSlotOfCharId,
  wornCount, wornItemIds,
} from "./vendor/engine.js";
import { createNativeScreenRenderer } from "./native-screen-render.js";
import { encodeNativeScreenText } from "./name-bytes.js";
import { paintNativeSession } from "./native-session.js";
import { CLOSE_NOTIFY, DISPOSE_NEVER, createTranslatedScreenHost } from "./translated-screen-host.js";
import { partyRosterView, storedNumbers, syncLeadEquipBonuses } from "./party.js";
import { ensureStoredStats } from "./battle.js";
import { fetchBytes, fetchJson, loadResidentResources } from "./resident-data.js";

const BANK_OFFSETS = [0x63, 0x6a, 0x71, 0x94];
const PACKS = { 646: "cmfont", 1026: "stshop" };

const DATA_LABEL = "Merchant data";
const readJson = (path) => fetchJson(path, DATA_LABEL);
const readBytes = (path) => fetchBytes(path, DATA_LABEL);

let catalogPromise = null;
function loadCatalog() {
  catalogPromise ??= readJson("shop_catalog.json").then(async (catalog) => ({
    catalog,
    itemRecords: await readBytes(catalog.itemRecords.file),
    descriptors: await Promise.all(catalog.itemDescriptors.map((row) => readBytes(row.file))),
    font: (await loadResidentResources()).font,
  })).catch((error) => { catalogPromise = null; throw error; });
  return catalogPromise;
}

function saveSeed(state, db) {
  const view = partyRosterView(state.party, state.partnerStats, state.partyStats,
    db, state.digimonNames);
  return {
    bits: Number(state.bits) || 0,
    inventory: Array.isArray(state.inventory) ? state.inventory : [],
    // The merchant's info band draws "Equip n" out of the block's SECOND count
    // array (`stitshop.s:7310`, RAM 0x80089ECC, `lb 0x20f($v0)`), so the seed has
    // to carry the store's stored worn array: it counts gear on a partner who is
    // switched out too, and counting the three deployed members instead read 0
    // beside a sword that was on the shelf.
    worn: wornItemIds(state).map((id) => ({ id, qty: wornCount(state, id) })),
    party: view.slice(0, 3).map((member, i) => {
      const rosterSlot = rosterSlotOfCharId(member.charId);
      if (rosterSlot == null) throw new Error("Merchant partner has no roster slot");
      const record = (i === 0 ? state.partnerStats : state.partyStats?.[i]) ?? {};
      if (member.profile) ensureStoredStats(record, db[member.rookieId] ?? member.profile);
      return {
        rosterSlot, starterSlot: rosterSlot, nameBytes: encodeNativeScreenText(member.name),
        exp: Number(member.xp) || 0, level: Number(member.level) || 0,
        tp: Number(member.tp) || 0, hp: Number(member.hp) || 0,
        maxHp: Number(member.maxHp) || 0, mp: Number(member.mp) || 0,
        maxMp: Number(member.maxMp) || 0,
        // The roster record's thirteen stored halfwords come from ONE shared
        // helper (web/party.js storedNumbers): the STARTER's row plus the
        // trained points and chips, never the worn form. The screen's own
        // F0x80017174 fill adds the worn gear's resist on top.
        ...storedNumbers(member.charId, record, db),
        equipment: state.equipment?.[i] ?? {},
      };
    }),
  };
}

export function createShopTranslated(sfx = null, options = {}) {
  const shop = {
    _open: false, _session: null, _state: null, _onClose: null,
    _renderer: null, _clock: null, _error: null, _request: 0,
  };
  const renderer = createNativeScreenRenderer({ pack: "stshop", packs: PACKS },
    (directory) => PACKS[directory >>> 16] ?? null);
  shop._renderer = renderer;

  shop.open = (_stock, onClose = null, opts = {}) => {
    const id = Number(opts.shopId);
    if (!Number.isInteger(id) || id < 0 || id >= 30) {
      throw new Error("Merchant has no decoded shop id");
    }
    const request = host.begin({ onClose });
    shop._state = opts.state ?? shop._state;
    shop._error = null;
    shop._clock = new ui.MenuDisplayClock();
    shop._session = null;
    loadCatalog().then(async (data) => {
      const selectedLanguage = shop._state?.languageByte;
      const language = Number.isInteger(selectedLanguage) ? selectedLanguage : 2;
      if (language < 0 || language > 6) throw new Error("Merchant language index is invalid");
      const banks = new Map(await Promise.all(BANK_OFFSETS.map(async (offset) => {
        const bank = offset + language;
        return [bank, await readBytes(`shop-banks/${bank}.bin`)];
      })));
      if (!host.current(request)) return;
      shop._session = new ui.ShopRootSession(id, language,
        saveSeed(shop._state ?? {}, options.digimonDB?.() ?? {}),
        { ...data, banks },
        { playSound(sound) { sfx?.playPacked(sound); }, closeSave() {} });
    }).catch((error) => {
      if (!host.current(request)) return;
      shop._error = error;
      console.error("Translated merchant failed to open", error);
    });
  };

  // The merchant's lifecycle lives in web/translated-screen-host.js. `release` is the old `_finish`
  // body; the merchant never disposed its session, so both close modes leave it alone here.
  // `tracksPending` is off: this screen reports pending as "open with no session yet".
  const host = createTranslatedScreenHost(shop, {
    closeMode: CLOSE_NOTIFY, closeDispose: DISPOSE_NEVER, finishDispose: DISPOSE_NEVER, tracksPending: false,
    release(session) {
      const state = shop._state;
      if (!state || !session) return;
      const result = session.result();
      // One commit, in the original's order: the hand swaps the merchant made go
      // through the shared store (so the stored worn byte rises ONCE per piece and
      // the wearer record moves with it), then the block's own count arrays become
      // the bag. Re-diffing the six slots here raised a two-handed piece's worn
      // byte twice and put the displaced piece in the bag twice.
      commitMerchantClose(state, result);
      syncLeadEquipBonuses(state);
      localStorage.setItem("inventory", JSON.stringify(state.inventory));
      localStorage.setItem("worn", JSON.stringify(state.worn ?? {}));
      localStorage.setItem("equipment", JSON.stringify(state.equipment));
    },
  });

  shop.isOpen = () => shop._open;
  shop.handleKey = (_button, state) => { if (state) shop._state = state; };
  shop.update = (dt) => {
    if (!shop._open || !shop._session || shop._error) return;
    for (const frame of shop._clock.advance(dt)) {
      shop._session.tick(shop._state?.keys ?? [], frame.tick);
      if (shop._session.finished()) { host.finish(); break; }
    }
  };
  shop.draw = (ctx, viewW) => {
    if (!shop._open || !shop._session) return;
    ctx.save();
    ctx.scale(viewW / 320, viewW / 320);
    paintNativeSession(ctx, renderer, shop._session);
    ctx.restore();
  };
  shop.close = () => host.close();
  shop.diagnostics = () => ({
    execution: "translated",
    open: shop._open, pending: shop._open && !shop._session,
    error: shop._error?.message ?? null,
    tasks: shop._session?.tree.tasks.size ?? 0,
    state: shop._session ? shop._session.mem.read32(shop._session.root + 0x10) : null,
    renderer: renderer.stats,
  });
  return shop;
}
