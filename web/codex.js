// web/codex.js — the Digimon Codex, part 1: the book and the partner pages.
//
// A paged in-game book of every partner profile the game can hold. It has no table of its own:
// each row is read from the same digimon.json the battle reads, after web/extra-roster.js has
// merged the 135 enemy-only species the project made obtainable, so tonight the book lists 190
// rows and a build with ?noextras=1 lists the disc's 55. The line page's list of learnable forms
// comes from evolutions.json, again after the extra roster's merge.
//
// Row data, all from the profile the battle uses:
//   id, name, added (id > 55), hp, mp, family, is_starter,
//   stats ({str, def, spt, wis, spd, chr} — the six core-stat halfwords),
//   resistances + resistanceGrowth (seven elements), statusResist (five statuses),
//   signature ({id, name, power, element} resolved through skills),
//   blasts (the five target forms' names, resolved through the profile ids),
//   techSlots (six skill ids), learnLevels (six), loadLevels (five).
//
// OFF unless F2 -> Extras -> "Digimon Codex (new)" is switched on (web/ambience.js). It opens on
// that switch's rising edge, owns the pad while it is up (Left/Right page, Up/Down row,
// Cross/Start close) and draws over everything. With the switch off nothing exists and the
// frame loop pays one comparison. The module is DOM-free at the top level so node tests import
// it; drawing takes a canvas context.

const DISC_LAST_ID = 55;          // digimon.json ships ids 1..55; extra_species.json starts at 56
const PER_PAGE = 24;              // rows on one book page
const ELEMENTS = ["fire", "water", "ice", "wind", "thunder", "machine", "dark"];
const STATUSES = ["poison", "paralyze", "confuse", "sleep", "ko"];

const pick = (source, keys) =>
  Object.fromEntries(keys.map((k) => [k, Number(source?.[k] ?? 0)]));

/**
 * One row per profile in a digimon.json-shaped table (`digimon` rows + `skills`). Pure.
 * `digimon` may be the whole JSON object or just the profile array; `skills` overrides the
 * JSON's own list when given.
 */
export function partnerRows(digimon, skills) {
  const profiles = Array.isArray(digimon) ? digimon : digimon?.digimon ?? [];
  const skillList = Array.isArray(skills) ? skills : Array.isArray(digimon) ? [] : digimon?.skills ?? [];
  const skillById = new Map(skillList.map((s) => [s.id, s]));
  const nameById = new Map(profiles.map((p) => [p.id, p.name]));
  return profiles.map((p) => {
    const skill = skillById.get(p.tech_signature) ?? null;
    return {
      id: p.id,
      name: p.name,
      added: p.id > DISC_LAST_ID,
      hp: p.hp,
      mp: p.mp,
      family: p.family,
      is_starter: !!p.is_starter,
      stats: { str: p.str, def: p.def, spt: p.spt, wis: p.wis, spd: p.spd, chr: p.chr },
      resistances: pick(p.resistances, ELEMENTS),
      resistanceGrowth: pick(p.resistance_growth, ELEMENTS),
      statusResist: pick(p.status_resist, STATUSES),
      signature: skill
        ? { id: skill.id, name: skill.name, power: skill.power, element: skill.element }
        : null,
      // the five Blast forms are profile ids: resolve them through the same profile table
      blasts: (p.blasts ?? [])
        .map((id) => nameById.get(id))
        .filter((name) => typeof name === "string"),
      techSlots: [...(p.tech_slots ?? [])],
      learnLevels: [...(p.tech_learn_levels ?? [])],
      loadLevels: [...(p.tech_load_levels ?? [])],
    };
  });
}

/**
 * The names of one digivolution line's records (evolutions.json's `lines[slot].records`, each
 * record's `to` is a profile id). Pure. An unknown slot is an empty list, never a guess.
 * `profiles` may be the profile array or a digimon.json-shaped object.
 */
export function lineTargets(evolutions, slot, profiles) {
  const list = Array.isArray(profiles) ? profiles : profiles?.digimon ?? [];
  const nameById = new Map(list.map((p) => [p.id, p.name]));
  const line = evolutions?.lines?.[slot];
  if (!line) return [];
  return (line.records ?? [])
    .map((record) => nameById.get(record.to))
    .filter((name) => typeof name === "string");
}

/** Cut the roster into book pages. The last page holds the remainder; no page is ever empty. */
export function codexPages(rows, perPage = PER_PAGE) {
  const size = Math.max(1, Math.floor(Number(perPage)) || PER_PAGE);
  const pages = [];
  for (let i = 0; i < rows.length; i += size) pages.push(rows.slice(i, i + size));
  return pages;
}

const S = {
  open: false,          // the book is up
  wasOn: false,         // the F2 flag last frame: the book opens on its rising edge only
  page: 0,
  cursor: 0,
  rows: [],
  pages: [],
  skills: new Map(),
  evolutions: null,
  lineByRoot: new Map(),   // profile id -> the line slot it roots (the eight starters)
  linesOf: new Map(),      // profile id -> the line slots whose records can reach it
  loading: null,
  error: null,
};

/** Close and forget everything (tests, and ?noextras reloads in a browser console). */
export function codexReset() {
  S.open = false;
  S.wasOn = false;
  S.page = 0;
  S.cursor = 0;
  S.rows = [];
  S.pages = [];
  S.skills = new Map();
  S.evolutions = null;
  S.lineByRoot = new Map();
  S.linesOf = new Map();
  S.loading = null;
  S.error = null;
}

/** Install a loaded pair of tables (the browser load and the node test both land here). */
export function setCodexData(digimon, evolutions) {
  const rows = partnerRows(digimon, Array.isArray(digimon) ? [] : digimon?.skills);
  S.rows = rows;
  S.pages = codexPages(rows, PER_PAGE);
  S.page = 0;
  S.cursor = 0;
  S.skills = new Map((Array.isArray(digimon) ? [] : digimon?.skills ?? []).map((s) => [s.id, s]));
  S.evolutions = evolutions;

  const lineByRoot = new Map();
  const linesOf = new Map();
  for (const [slot, line] of (evolutions?.lines ?? []).entries()) {
    if (line?.digimonId != null) lineByRoot.set(line.digimonId, slot);
    for (const record of line?.records ?? []) {
      if (!linesOf.has(record.to)) linesOf.set(record.to, []);
      const slots = linesOf.get(record.to);
      if (!slots.includes(slot)) slots.push(slot);
    }
  }
  S.lineByRoot = lineByRoot;
  S.linesOf = linesOf;
  return rows;
}

const asJson = (value) => (typeof value?.json === "function" ? value.json() : value);

/**
 * Fetch and install the two tables through the page's own fetch, so the extra roster's wrapped
 * fetch has already merged the added species and their line records. Cached per book load.
 * `fetchJson` is injectable for tests.
 */
export function codexLoad(fetchJson = globalThis.fetch) {
  if (S.loading) return S.loading;
  if (typeof fetchJson !== "function") return Promise.resolve(false);
  S.loading = (async () => {
    try {
      const [digimon, evolutions] = await Promise.all([
        Promise.resolve(fetchJson("assets/data/digimon.json")).then(asJson),
        Promise.resolve(fetchJson("assets/data/evolutions.json")).then(asJson),
      ]);
      setCodexData(digimon, evolutions);
      S.error = null;
      return true;
    } catch (err) {
      S.error = String(err?.message ?? err);
      return false;
    } finally {
      S.loading = null;
    }
  })();
  return S.loading;
}

/** Is the book up? (web/game.js freezes the field and routes the pad to it while true.) */
export function codexOpen() {
  return S.open;
}

/** The page on screen, 0-based; how many pages; the rows of the page; where the cursor is. */
export function codexPageIndex() {
  return S.page;
}
export function codexPageCount() {
  return S.pages.length;
}
export function codexPageRows() {
  return S.pages[S.page] ?? [];
}
export function codexCursor() {
  return S.cursor;
}
export function codexRows() {
  return S.rows;
}

/**
 * Follow F2 -> Extras -> "Digimon Codex (new)". It opens once when the switch turns on (the
 * rising edge) and closes when it turns off; closing with Cross while the switch stays on does
 * not reopen it, switching the switch off and on again does. With it off no data is fetched.
 */
export function tickCodex(enabled) {
  const on = enabled === true;
  if (on && !S.wasOn) {
    S.open = true;
    S.page = 0;
    S.cursor = 0;
    if (!S.rows.length && !S.loading) codexLoad();
  } else if (!on && S.wasOn) {
    S.open = false;
  }
  S.wasOn = on;
  return S.open;
}

function setPage(page) {
  const n = S.pages.length;
  if (!n) return;
  S.page = ((page % n) + n) % n;
  const rows = codexPageRows();
  S.cursor = Math.max(0, Math.min(S.cursor, rows.length - 1));
}

function moveCursor(delta) {
  const rows = codexPageRows();
  if (!rows.length) return;
  const next = S.cursor + delta;
  if (next < 0 && S.page > 0) {
    setPage(S.page - 1);
    S.cursor = codexPageRows().length - 1;
    return;
  }
  if (next >= rows.length && S.page < S.pages.length - 1) {
    setPage(S.page + 1);
    S.cursor = 0;
    return;
  }
  S.cursor = Math.max(0, Math.min(rows.length - 1, next));
}

/**
 * The pad while the book is up: Left/Right turn a page (wrapping), Up/Down move the row cursor
 * (walking over a page edge), Cross/Start close it, every other press is swallowed. Returns false
 * when the book is closed, so the press falls through exactly as before.
 */
export function codexPress(button) {
  if (!S.open) return false;
  if (button === "left") setPage(S.page - 1);
  else if (button === "right") setPage(S.page + 1);
  else if (button === "up") moveCursor(-1);
  else if (button === "down") moveCursor(1);
  else if (button === "cross" || button === "start") S.open = false;
  return true;
}

/** Break text into lines no longer than `cols` characters, on spaces. */
function wrapText(text, cols) {
  const out = [];
  let line = "";
  for (const word of String(text).split(/\s+/)) {
    if (!word) continue;
    if (!line) line = word;
    else if (line.length + 1 + word.length <= cols) line += " " + word;
    else {
      out.push(line);
      line = word;
    }
  }
  if (line) out.push(line);
  return out;
}

const STATUS_LABELS = { poison: "Poison", paralyze: "Paralyze", confuse: "Confuse", sleep: "Sleep", ko: "KO" };
const ELEMENT_LABELS = { fire: "Fire", water: "Water", ice: "Ice", wind: "Wind", thunder: "Thunder", machine: "Machine", dark: "Dark" };

/** One partner's detail as ready-to-draw strings (pure; the draw uses it). */
function detailLines(row) {
  if (!row) return null;
  const lineSlot = S.lineByRoot.get(row.id);
  const reachable = S.linesOf.get(row.id) ?? [];
  const lineNamesOf = (slot) => lineTargets(S.evolutions, slot, S.rows);
  let lineTitle;
  let lineNames;
  if (lineSlot != null) {
    lineNames = lineNamesOf(lineSlot);
    lineTitle = `${row.name}'s line: ${lineNames.length} forms it can learn`;
  } else if (reachable.length) {
    const roots = reachable
      .map((slot) => S.rows.find((r) => r.id === S.evolutions?.lines?.[slot]?.digimonId)?.name)
      .filter(Boolean);
    const total = S.evolutions?.lines?.length ?? reachable.length;
    lineTitle = reachable.length === total
      ? `Can be reached from any of the ${total} lines`
      : `Can be reached from: ${roots.join(", ") || `${reachable.length} lines`}`;
    lineNames = reachable.length === 1 ? lineNamesOf(reachable[0]) : [];
  } else {
    lineTitle = "No digivolution line names this form";
    lineNames = [];
  }
  const stat = (k, label) => `${label} ${row.stats[k]}`;
  const res = (k) => `${ELEMENT_LABELS[k]} ${row.resistances[k]}`;
  const st = (k) => `${STATUS_LABELS[k]} ${row.statusResist[k]}`;
  return {
    name: row.name,
    id: row.id,
    sub: `Family ${row.family}  ·  ${row.is_starter ? "starter" : "form"}  ·  ${row.added ? "new species" : "disc species"}`,
    hpmp: `HP ${row.hp}   MP ${row.mp}`,
    statsA: [stat("str", "STR"), stat("def", "DEF"), stat("spt", "SPT")].join("   "),
    statsB: [stat("wis", "WIS"), stat("spd", "SPD"), stat("chr", "CHR")].join("   "),
    resA: [res("fire"), res("water"), res("ice")].join("   "),
    resB: [res("wind"), res("thunder"), res("machine")].join("   "),
    resC: res("dark"),
    stA: [st("poison"), st("paralyze"), st("confuse")].join("   "),
    stB: [st("sleep"), st("ko")].join("   "),
    signature: row.signature
      ? `${row.signature.name} (${row.signature.element}, power ${row.signature.power})`
      : "none",
    blasts: row.blasts.length ? wrapText(row.blasts.join(", "), 44) : ["none"],
    lineTitle: wrapText(lineTitle, 46)[0],
    lineMore: lineNames.length ? wrapText(lineNames.slice(0, 8).join(", ") + (lineNames.length > 8 ? ", …" : ""), 46) : [],
  };
}

function drawEmpty(ctx, W, H, message) {
  ctx.save();
  ctx.fillStyle = "rgba(4,6,12,0.96)";
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = "#c9a54a";
  ctx.lineWidth = 2;
  ctx.strokeRect(12, 10, W - 24, H - 20);
  ctx.textBaseline = "top";
  ctx.textAlign = "center";
  ctx.font = "bold 16px monospace";
  ctx.fillStyle = "#ffd34d";
  ctx.fillText("DIGIMON CODEX", W / 2, 24);
  ctx.font = "13px monospace";
  ctx.fillStyle = "#d8e2f0";
  ctx.fillText(message, W / 2, H / 2 - 10);
  ctx.restore();
}

/**
 * Draw the book over the whole view. `page` is a page index, a page (array of rows), or null for
 * the page the pad is on. `W`/`H` are the canvas box (640x480 in the game), so the panel also
 * reads correctly in a smaller test canvas. Returns false when the book is closed.
 */
export function codexDraw(ctx, page = null, W = 640, H = 480) {
  if (!S.open) return false;
  if (!S.rows.length) {
    drawEmpty(ctx, W, H, S.error ? `The book could not be opened: ${S.error}` : "Opening the book…");
    return true;
  }

  let rows;
  let index;
  if (Array.isArray(page)) {
    rows = page;
    index = S.page;
  } else if (Number.isInteger(page)) {
    rows = S.pages[page] ?? [];
    index = page;
  } else {
    rows = codexPageRows();
    index = S.page;
  }
  if (!rows.length) {
    drawEmpty(ctx, W, H, "This page is empty.");
    return true;
  }

  const x = Math.round(W * 0.03);
  const y = Math.round(H * 0.02);
  const w = W - 2 * x;
  const h = H - 2 * y;
  const left = x + 14;

  ctx.save();
  // the page
  ctx.fillStyle = "rgba(4,6,12,0.96)";
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = "#c9a54a";
  ctx.lineWidth = 2;
  ctx.strokeRect(x, y, w, h);
  ctx.strokeStyle = "rgba(201,165,74,0.35)";
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 5, y + 5, w - 10, h - 10);
  ctx.textBaseline = "top";
  ctx.textAlign = "left";

  // header
  ctx.font = "bold 16px monospace";
  ctx.fillStyle = "#ffd34d";
  ctx.fillText("DIGIMON CODEX", left, y + 12);
  ctx.font = "11px monospace";
  ctx.fillStyle = "#8a93a8";
  ctx.fillText("PARTNERS — every form the game can hold", left + 172, y + 17);
  ctx.textAlign = "right";
  ctx.fillStyle = "#9fd0ff";
  ctx.fillText(`${index + 1} / ${S.pages.length}`, x + w - 16, y + 16);
  ctx.textAlign = "left";

  const top = y + 44;
  const bottom = y + h - 30;

  // ---- the roster (left): the page's rows, the cursor's row lit
  const listX = left;
  const listW = Math.round(w * 0.36);
  const rowH = Math.floor((bottom - top - 22) / Math.max(rows.length, 1));
  const lh = Math.max(11, Math.min(14, rowH));
  ctx.font = "10px monospace";
  let ry = top + 18;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const hit = i === S.cursor;
    if (hit) {
      ctx.fillStyle = "rgba(201,165,74,0.22)";
      ctx.fillRect(listX - 2, ry - 2, listW - 4, lh);
    }
    ctx.fillStyle = hit ? "#ffe9a8" : r.added ? "#9ad0a8" : "#c8d2e2";
    ctx.fillText(`${hit ? ">" : " "} ${String(r.id).padStart(3, "0")} ${r.name}${r.added ? " +" : ""}`, listX, ry);
    ry += lh;
  }
  ctx.font = "9px monospace";
  ctx.fillStyle = "#5f6b80";
  ctx.fillText("+ new species", listX, bottom - 2);

  // ---- the open partner (right)
  const dx = listX + listW + 14;
  const dw = x + w - 16 - dx;
  const d = detailLines(rows[Math.max(0, Math.min(S.cursor, rows.length - 1))]);
  ctx.strokeStyle = "rgba(201,165,74,0.35)";
  ctx.strokeRect(dx - 8, top, dw, bottom - top);
  const tx = dx + 2;
  let ty = top + 8;
  const step = 15;
  ctx.textAlign = "left";

  ctx.font = "bold 14px monospace";
  ctx.fillStyle = "#ffd34d";
  ctx.fillText(`${d.name}  #${d.id}`, tx, ty);
  ty += 19;
  ctx.font = "10px monospace";
  ctx.fillStyle = "#8a93a8";
  ctx.fillText(d.sub, tx, ty);
  ty += 16;
  ctx.fillStyle = "#d8e2f0";
  ctx.fillText(d.hpmp, tx, ty);
  ty += 18;

  const label = (text) => {
    ctx.font = "9px monospace";
    ctx.fillStyle = "#6fd0a8";
    ctx.fillText(text, tx, ty);
    ty += 13;
    ctx.font = "10px monospace";
    ctx.fillStyle = "#d8e2f0";
  };
  label("CORE STATS");
  ctx.fillText(d.statsA, tx, ty); ty += step;
  ctx.fillText(d.statsB, tx, ty); ty += step + 3;
  label("RESISTANCES");
  ctx.fillText(d.resA, tx, ty); ty += step;
  ctx.fillText(d.resB, tx, ty); ty += step;
  ctx.fillText(d.resC, tx, ty); ty += step + 3;
  label("STATUS RESIST");
  ctx.fillText(d.stA, tx, ty); ty += step;
  ctx.fillText(d.stB, tx, ty); ty += step + 3;
  label("SIGNATURE");
  ctx.fillStyle = "#ffd34d";
  ctx.fillText(d.signature, tx, ty); ty += step + 3;
  label("BLASTS");
  for (const line of d.blasts) {
    ctx.fillText(line, tx, ty);
    ty += step;
  }
  ty += 3;
  label("LINE");
  ctx.fillText(d.lineTitle, tx, ty); ty += step;
  ctx.fillStyle = "#9ad0a8";
  for (const line of d.lineMore) {
    ctx.fillText(line, tx, ty);
    ty += step;
  }

  // controls, in the book's own margin
  ctx.font = "10px monospace";
  ctx.fillStyle = "#7a90b0";
  ctx.textAlign = "left";
  ctx.fillText("Left / Right: page    Up / Down: row    Cross / Start: close    F2 -> Extras switches it off", left, bottom + 8);
  ctx.restore();
  return true;
}

// Browser-only debug hook: what the page is showing right now (console: __codex.page()).
if (typeof window !== "undefined") {
  window.__codex = {
    open: () => S.open,
    page: () => S.page,
    pages: () => S.pages.length,
    cursor: () => S.cursor,
    row: () => codexPageRows()[S.cursor] ?? null,
    rows: () => S.rows,
    error: () => S.error,
    reload: () => codexLoad(),
  };
}
