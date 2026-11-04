// web/blast-ladder.js — one card per starter: the five Blast forms, and the exact
// partner-level bracket that reaches each of them.
//
// WHAT A BLAST IS (all read, nothing guessed)
// ------------------------------------------
// Blast is the automatic in-battle digivolution. When the Blast gauge fills, the
// partner changes without a command; the new form is temporary and the partner
// goes back at the end of it. The form ledger is never written — a Blast form is
// not an acquired digivolution.
// (docs/research/battle/digivolution-tech-system-decoded-2026-07-11.md §9)
//
// WHERE THE FORM COMES FROM
// -------------------------
// Event 0x12 (F0x800a8bf4) reads the ROOKIE profile of the active party slot —
// `DIGIMON_PROFILES[slot]`, the starter's own row — and takes `blasts[tier]`
// (profile byte +0x50+tier, a DigimonId). The tier is the PARTNER's battle level,
// roster record +0x1c, on the ladder <4 -> 0, <19 -> 1, <39 -> 2, <70 -> 3, else 4.
// So the five forms belong to the STARTER and never to the form the partner
// happens to be in: a Kotemon in Kyukimon's body still reads Kotemon's ladder at
// its own level. That is the part guides get wrong.
//
// THE DATA
// --------
// Every card is read from the same digimon.json the battle reads: the eight rows
// with `is_starter`, then each row's five `blasts` ids resolved through the
// profile table (they are profile ids, not names). `skills` is optional and only
// names each target form's signature technique for the card's second line.
//
// OFF unless F2 -> Extras -> "Blast ladder (new)" is switched on (web/ambience.js).
// It opens on that switch's rising edge, owns the pad while it is up (Left/Right
// walk the eight starters, Cross/Start close) and draws over everything. With the
// switch off nothing is fetched, nothing is drawn and the frame loop pays one
// comparison. DOM-free: node imports this module and the tests draw into a fake
// context; the browser hands it the real one.

/** The partner-level brackets, one per tier: [min, max], level 1..99. */
export const BLAST_BRACKETS = [[1, 3], [4, 18], [19, 38], [39, 69], [70, 99]];

/**
 * The tier a partner battle level reads: the event-0x12 ladder, identical to
 * engine/dw3/battle-formulas.ts::levelTier (the tests hold the two together).
 */
export function tierForLevel(level) {
  if (level < 4) return 0;
  if (level < 19) return 1;
  if (level < 39) return 2;
  if (level < 70) return 3;
  return 4;
}

/**
 * The ladder text for a tier: "level 1-3", "level 4-18", ... Pure.
 */
export function bracketLabel(tier) {
  const [min, max] = BLAST_BRACKETS[tier] ?? BLAST_BRACKETS[0];
  return `level ${min}-${max}`;
}

/**
 * The eight starter cards, in starter-id order. Pure.
 *
 * `digimon` is a digimon.json-shaped object (or just its profile array) and
 * `skills` an optional skill table; each form is
 * `{ id, name, tier, min, max, technique }`, where `id` is the profile id the
 * card was read from and `technique` the form's signature technique name
 * ("" when no skill table was handed in).
 */
export function blastCards(digimon, skills) {
  const profiles = Array.isArray(digimon) ? digimon : digimon?.digimon ?? [];
  const skillList = Array.isArray(skills) ? skills : Array.isArray(digimon) ? [] : digimon?.skills ?? [];
  const skillById = new Map(skillList.map((s) => [s.id, s]));
  const profileById = new Map(profiles.map((p) => [p.id, p]));
  return profiles
    .filter((p) => p && p.is_starter)
    .slice()
    .sort((a, b) => a.id - b.id)
    .map((starter) => ({
      starter: starter.name,
      id: starter.id,
      forms: (starter.blasts ?? []).slice(0, 5).map((id, tier) => {
        const profile = profileById.get(id);
        const method = skillById.get(profile?.tech_signature);
        const [min, max] = BLAST_BRACKETS[tier];
        return {
          id,
          name: profile?.name ?? `#${id}`,
          tier,
          min,
          max,
          technique: method?.name ?? "",
        };
      }),
    }));
}

const S = {
  open: false,        // the page is up
  wasOn: false,       // the F2 flag last frame: it opens on the rising edge only
  index: 0,           // which starter's card
  cards: [],
  loading: null,
  error: null,
};

/** Close and forget everything (tests, and a console reload in the browser). */
export function blastReset() {
  S.open = false;
  S.wasOn = false;
  S.index = 0;
  S.cards = [];
  S.loading = null;
  S.error = null;
}

/** Install a loaded table (the browser load and the tests both land here). */
export function setBlastData(digimon, skills) {
  S.cards = blastCards(digimon, skills);
  S.index = Math.min(S.index, Math.max(0, S.cards.length - 1));
  return S.cards;
}

/** Is the page up? (web/game.js freezes the field and routes the pad while true.) */
export function blastOpen() {
  return S.open;
}

/** The card on screen: its index, and the card itself (null before data loads). */
export function blastCardIndex() {
  return S.index;
}
export function blastCard() {
  return S.cards[S.index] ?? null;
}
export function blastCardCount() {
  return S.cards.length;
}

const asJson = (value) => (typeof value?.json === "function" ? value.json() : value);

/**
 * Fetch and install digimon.json through the page's own fetch, so the extra
 * roster's wrapped fetch has already merged the added species. Cached per load.
 * `fetchJson` is injectable for tests.
 */
export function blastLoad(fetchJson = globalThis.fetch) {
  if (S.loading) return S.loading;
  if (typeof fetchJson !== "function") return Promise.resolve(false);
  S.loading = (async () => {
    try {
      const digimon = await Promise.resolve(fetchJson("assets/data/digimon.json")).then(asJson);
      setBlastData(digimon, digimon?.skills);
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

/** Open the card on the first starter (the F2 button "Open the blast ladder"). Fetches data on first open. */
export function openBlastLadder() {
  S.open = true;
  S.index = 0;
  if (!S.cards.length && !S.loading) blastLoad();
  return S.open;
}

/**
 * Follow F2 -> Extras -> "Blast ladder (new)". The switch only ENABLES the card: it never opens
 * it (not on page load, not on ticking the switch); openBlastLadder does, from the F2 button.
 * Cross closes it; switching the switch off closes it. With the switch off nothing is
 * fetched and nothing exists.
 */
export function tickBlastLadder(on) {
  const enabled = on === true;
  if (!enabled && S.open) S.open = false;
  S.wasOn = enabled;
  return S.open;
}

/**
 * The pad while the page is up: Left/Right walk the eight starters (wrapping),
 * Cross/Start close, every other press is swallowed. Returns false when the page
 * is closed, so the press falls through exactly as before.
 */
export function blastPress(button) {
  if (!S.open) return false;
  if (button === "left" || button === "right") {
    const n = S.cards.length;
    if (n) S.index = ((S.index + (button === "left" ? -1 : 1)) % n + n) % n;
  } else if (button === "cross" || button === "start") {
    S.open = false;
  }
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

/**
 * The four plain sentences every card carries. The page's whole point is that a
 * fan should not have to trust a guide about any of them.
 */
export const BLAST_NOTES = [
  "Blast is automatic: when its gauge fills in a fight, the partner changes on its own.",
  "Blast is temporary: the new form is only for that fight, and the partner goes back afterwards.",
  "Blast never changes your learned forms: the form ledger is not touched.",
  "The tier is read from the PARTNER's battle level (roster +0x1c), not from the form on the field, which is why many guides get it wrong.",
  "The form itself is the starter's own blasts[tier] (profile byte +0x50+tier).",
];

function drawMessage(ctx, W, H, message) {
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
  ctx.fillText("BLAST LADDER", W / 2, 24);
  ctx.font = "13px monospace";
  ctx.fillStyle = "#d8e2f0";
  ctx.fillText(message, W / 2, H / 2 - 10);
  ctx.restore();
}

/**
 * Draw the page over the whole view. `page` is a card, a card index, or null for
 * the card the pad is on; `W`/`H` are the canvas box (640x480 in the game), so the
 * card also reads correctly in a smaller test canvas. Returns false when the page
 * is closed — with the F2 switch off this draws nothing at all.
 */
export function blastDraw(ctx, page = null, W = 640, H = 480) {
  if (!S.open) return false;
  if (!S.cards.length) {
    drawMessage(ctx, W, H, S.error ? `The ladder could not be read: ${S.error}` : "Reading the partner table…");
    return true;
  }

  const asked = Number.isInteger(page) ? page : S.index;
  const index = Math.max(0, Math.min(asked, S.cards.length - 1));
  const card = (typeof page === "object" && page) ? page : S.cards[index] ?? S.cards[0];
  if (!card) {
    drawMessage(ctx, W, H, "This ladder is empty.");
    return true;
  }

  const x = Math.round(W * 0.03);
  const y = Math.round(H * 0.025);
  const w = W - 2 * x;
  const h = H - 2 * y;
  const left = x + 16;

  ctx.save();
  ctx.fillStyle = "rgba(4,6,12,0.97)";
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
  ctx.fillText("BLAST LADDER", left, y + 12);
  ctx.font = "10px monospace";
  ctx.fillStyle = "#8a93a8";
  ctx.fillText("the five forms a starter reaches, and the level that reaches each", left + 150, y + 17);
  ctx.textAlign = "right";
  ctx.fillStyle = "#9fd0ff";
  ctx.fillText(`${index + 1} / ${S.cards.length}`, x + w - 16, y + 16);
  ctx.textAlign = "left";

  // the starter
  const titleY = y + 48;
  ctx.font = "bold 22px monospace";
  ctx.fillStyle = "#ffe9a8";
  ctx.fillText(card.starter, left, titleY);
  ctx.font = "11px monospace";
  ctx.fillStyle = "#8a93a8";
  ctx.fillText(`starter #${card.id}  ·  Blast ladder`, left + 24 + card.starter.length * 13, titleY + 8);

  // the five rungs of the ladder
  const top = y + 88;
  const step = Math.round(h * 0.088);
  const railX = left + 12;
  ctx.strokeStyle = "rgba(201,165,74,0.55)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(railX, top + 2);
  ctx.lineTo(railX, top + step * 4 + 16);
  ctx.stroke();
  for (let tier = 0; tier < card.forms.length && tier < 5; tier++) {
    const form = card.forms[tier];
    const ry = top + tier * step;
    // the rung
    ctx.strokeStyle = tier === 0 ? "#ffd34d" : "rgba(201,165,74,0.8)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(railX - 6, ry + 10);
    ctx.lineTo(railX + 6, ry + 10);
    ctx.stroke();
    // the bracket
    ctx.font = "bold 14px monospace";
    ctx.fillStyle = "#ffd34d";
    ctx.fillText(bracketLabel(tier), left + 30, ry + 2);
    // the form
    ctx.font = "bold 18px monospace";
    ctx.fillStyle = "#eaf2ff";
    ctx.fillText(form.name, left + 150, ry);
    // what that form hits with
    if (form.technique) {
      ctx.font = "10px monospace";
      ctx.fillStyle = "#7f8ea6";
      ctx.fillText(form.technique, left + 150, ry + 21);
    }
  }

  // the plain sentences
  let noteY = top + step * 5 + 4;
  ctx.strokeStyle = "rgba(201,165,74,0.25)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(left, noteY - 6);
  ctx.lineTo(x + w - 16, noteY - 6);
  ctx.stroke();
  ctx.font = "11px monospace";
  ctx.fillStyle = "#d8e2f0";
  for (const note of BLAST_NOTES) {
    for (const line of wrapText(note, 84)) {
      ctx.fillText(line, left, noteY);
      noteY += 14;
    }
  }

  // controls, in the page's own margin
  ctx.font = "10px monospace";
  ctx.fillStyle = "#7a90b0";
  ctx.fillText("Left / Right: starter    Cross / Start: close    F2 -> Extras switches it off", left, y + h - 18);
  ctx.restore();
  return true;
}

// Browser-only debug hook: what the card is showing right now (console: __blast.card()).
if (typeof window !== "undefined") {
  window.__blast = {
    open: () => S.open,
    index: () => S.index,
    count: () => S.cards.length,
    card: () => blastCard(),
    cards: () => S.cards,
    error: () => S.error,
    reload: () => blastLoad(),
  };
}
