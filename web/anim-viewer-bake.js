// K21f — "DW3 body + DW2 motion" in the animation viewer.
//
// K21d's retarget wrote complete DW3-shaped models whose geometry, texture path, clips, actions and
// every other timeline table are the disc model's own, and whose ONE extra timeline table holds a
// Digimon World 2 motion retargeted onto the DW3 rig (`bakeRetargetByRole`). They live OUTSIDE the
// repo (`~/dw2-models/converted/bakes/<folder>-dw2<letter>.json`, served through the same
// git-excluded `web/dw2-models` symlink the K21b DW2 source uses) because a bake is derived from
// both games.
//
// The renderer (web/battle3d.js) only knows how to load a model by FOLDER: `<base>/anim.json`,
// `<base>/slot_map.json`, `assets/battle/textures/<folder>.png`. So a bake is presented to it as a
// model folder of its own — `<folder>-dw2<letter>` — and this module rewrites those three asset
// URLs to the real files. Nothing else is faked: battle3d parses the bake with its own loader, builds
// the same GL buffers, uses the same texture, the same camera, the same animator, the same tick
// scrubber. The real model keeps its own cache entry, so the bake and the disc model can stand
// side by side in one page.
//
// The A/B this enables is exact and needs no second model: every table except the baked one is the
// target's own (byte-identical channels, only the end sentinel moved past the inserted block), so
// "the bake's clip 9" IS the disc's clip 9 and "the bake's table 5" is the DW2 motion on the same body.
//
// Pure functions only; the DOM/renderer wiring lives in anim-viewer.html (tests/anim-viewer-bake.test.js).

export const BAKE_ROOT = "dw2-models/converted/bakes";

// A bake folder: the DW3 folder, a dash, `dw2`, the DW2 clip letter (Kokatorimon F/G/H, Meramon I/K).
const BAKE_FOLDER = /^(m\d{3}[a-z0-9]*)-(?:dw2|gen)([A-Z])$/;

/** The 5 bakes K21d wrote (BRIEF15's inputs) — the picker's fallback when no manifest is served. */
export const K21D_BAKES = ["m009mera-dw2I", "m009mera-dw2K", "m050coca-dw2F", "m050coca-dw2G", "m050coca-dw2H"];

export const isBakeFolder = (folder) => BAKE_FOLDER.test(String(folder || ""));
/** `m050coca-dw2F` -> `m050coca` (null when the id is not a bake). */
export function bakeRealFolder(id) {
  const m = BAKE_FOLDER.exec(String(id || ""));
  return m ? m[1] : null;
}
/** `m050coca-dw2F` -> `F` (null when the id is not a bake). */
export function bakeLetter(id) {
  const m = BAKE_FOLDER.exec(String(id || ""));
  return m ? m[2] : null;
}
export const bakeUrl = (id, root = BAKE_ROOT) => `${root}/${id}.json`;
export const bakeIndexUrl = (root = BAKE_ROOT) => `${root}/index.json`;

// ── the asset-URL rewrite (pure) ────────────────────────────────────────────────────────────────
// Three URLs per model reach the network, and only these three:
//   <prefix>battle/models/<folder>/anim.json       the model (bake: the bake file)
//   <prefix>battle/models/<folder>/slot_map.json   optional, the disc's own (bake: the real folder's)
//   <prefix>battle/textures/<folder>.png           the body's texture (bake: the real folder's)
// `<prefix>` is `assets/`, `assets-hd/` (HD pack mode) or a full origin + path.
export const MODEL_ANIM = /^(.*?)battle\/models\/([^/?#]+)\/(anim|slot_map)\.json([?#].*)?$/;
export const MODEL_TEXTURE = /^(.*?)battle\/textures\/([^/?#]+)\.png([?#].*)?$/;

/**
 * Rewrite one asset URL for a bake folder. Returns null when the URL is not a bake's asset, so the
 * caller can pass the original request straight through.
 */
export function mapBakeAssetUrl(url) {
  const s = String(url || "");
  let m = MODEL_ANIM.exec(s);
  if (m) {
    const [, prefix, folder, kind, tail = ""] = m;
    if (!isBakeFolder(folder)) return null;
    if (kind === "anim") return `${bakePathPrefix(prefix)}${bakeUrl(folder)}`;
    return `${prefix}battle/models/${bakeRealFolder(folder)}/slot_map.json${tail}`;
  }
  m = MODEL_TEXTURE.exec(s);
  if (m) {
    const [, prefix, folder, tail = ""] = m;
    if (!isBakeFolder(folder)) return null;
    return `${prefix}battle/textures/${bakeRealFolder(folder)}.png${tail}`;
  }
  return null;
}

// A bake file is never inside `assets/` — it is served from the dw2-models mount, next to the page.
// Keep the ORIGIN of the original URL (an absolute request must stay absolute) and drop the path.
function bakePathPrefix(prefix) {
  const abs = /^(https?:\/\/[^/]+)\//.exec(prefix || "");
  return abs ? `${abs[1]}/` : "";
}

/** Install the rewrite once, in front of everything else the page fetches. Returns the shim. */
export function installBakeFetch(target = globalThis) {
  const orig = target.fetch;
  if (typeof orig !== "function") return null;
  if (orig.__bakeShim) return orig;
  const shim = (input, init) => {
    const url = typeof input === "string" ? input : input?.url || "";
    const mapped = mapBakeAssetUrl(url);
    if (!mapped) return orig.call(target, input, init);
    shim.hits.push({ from: url, to: mapped });
    return orig.call(target, mapped, init);
  };
  shim.__bakeShim = true;
  shim.hits = [];
  target.fetch = shim;
  return shim;
}

// ── the manifest (what the picker lists and the Info tab shows) ─────────────────────────────────
// `~/dw2-models/converted/bakes/index.json` is written by ~/scratch-research/k21f/make_bake_index.py
// from K21d's retarget-*.json rows (gate verdict, feet drift, penetration, jump) plus the bake files
// themselves. Numbers are K21d's measurements; when the manifest is missing the picker still lists
// K21D_BAKES and the Info tab says the numbers are not served.
export function bakeRows(manifest) {
  const list = Array.isArray(manifest?.bakes) ? manifest.bakes : [];
  const rows = [];
  for (const r of list) {
    const id = r?.id || r?.folder;
    if (!id || !isBakeFolder(id)) continue;
    rows.push({ ...r, id, folder: r.folder && !isBakeFolder(r.folder) ? r.folder : bakeRealFolder(id), letter: r.letter || bakeLetter(id) });
  }
  return rows;
}

/** One row from the id alone (no numbers): what a deep link to an un-manifested bake still gets. */
export function bakeStubRow(id) {
  const folder = bakeRealFolder(id);
  if (!folder) return null;
  return { id, folder, letter: bakeLetter(id), table: null, clip: null, frames: null, stub: true };
}

/** The script that plays ONE timeline table through the actor's own ActionVM (op2 [0,0,table]). */
export function bakeScript(table) {
  return table == null
    ? { ops: [], overrun: false, buildKind: "bake" }
    : { ops: [{ op: 2, words: [0, 0, table | 0] }, { op: 255, words: [] }], overrun: false, buildKind: "bake" };
}

/** The two rows of the A/B pair, as viewer actions (see anim-viewer.html's action kinds). */
export function bakeActions(row, { group = "A/B: DW2 motion vs its own clip" } = {}) {
  if (!row) return [];
  const out = [];
  if (row.table != null) {
    out.push({
      kind: "bake", clip: row.clip ?? null, table: row.table | 0, bake: row.id,
      name: `DW2-${row.letter || "?"} motion on this body (table ${row.table}${row.frames ? `, ${row.frames} frames` : ""})`,
      group: { key: "bake|motion", label: group },
    });
  }
  if (row.clip != null) {
    out.push({
      kind: "own", clip: row.clip | 0, bake: row.id,
      name: row.label ? `${row.label} (clip ${row.clip})` : `own DW3 clip ${row.clip} (the disc's motion, same body)`,
      group: { key: "bake|own", label: group },
    });
  }
  return out;
}

const h = (v, d = 3) => (v == null || Number.isNaN(+v) ? null : +(+v).toFixed(d));

/**
 * The K21d numbers for one bake, as [key, value, class] rows for the Info tab. Null entries are
 * dropped, so a stub row degrades to the three rows that need no measurements.
 */
export function bakeInfoRows(row) {
  if (!row) return [];
  const out = [];
  out.push(["bake", `${row.id} · DW2 clip ${row.letter || "?"}${row.sourceMotion != null ? ` (motion ${row.sourceMotion})` : ""}`]);
  out.push(["DW3 body", `${row.folder}${row.sizeRatio != null ? ` · sizeRatio ${h(row.sizeRatio, 2)}` : ""} — the disc's geometry, texture and every other table`]);
  if (row.clip != null || row.table != null) {
    out.push(["baked motion", `lands on clip ${row.clip ?? "?"} · table ${row.table ?? "?"}${row.frames ? ` · ${row.frames} frames` : ""}`]);
  }
  if (row.gate) {
    const g = row.gate;
    const reasons = g.used ? "none" : (g.reasons || []).join(", ") || "none";
    const metrics = [
      `covered ${h(g.covered, 3)}`, `hand ${h(g.hand, 2)}`, `energy ${h(g.energy, 2)}`,
      `speed ${h(g.speed, 2)}`, `ankle ${h(g.ankle, 3)} H`, `return ${h(g.returnGap, 2)} rad`,
      `folds ${g.folds}`, `motion ${h(g.motion, 2)}`,
    ].join(" · ");
    out.push(["castGate", `${g.used ? "USED" : "REFUSE"}: ${reasons} — ${metrics}`, g.used ? "ok" : "bad"]);
  }
  if (Array.isArray(row.feet) && row.feet.length) {
    out.push(["feet drift", row.feet.map((f) => `${f.side} y ${h(f.dyShare, 3)} / lateral ${h(f.dxzShare, 3)} H`).join(" · ")]);
  }
  if (row.ground) {
    out.push(["ground", `lowest vertex ${h(row.ground.belowRestH, 3)} H below rest · ${h(row.ground.aboveRestH, 3)} H above`]);
  }
  if (row.penetration) {
    const p = row.penetration;
    out.push(["penetration", `worst ${h(p.worstClearanceH, 3)} H (body's own floor ${h(p.toleranceH, 3)}) · over its own range on ${p.framesOverOwnH}/${p.ofFrames} frames · worst pair ${p.worstPair}`]);
  }
  if (row.jump) {
    out.push(["worst pose jump", `${h(row.jump.clip, 2)} rad/frame at frame ${row.jump.atFrame} (bone ${row.jump.bone}) vs the body's own ${h(row.jump.targetOwn, 3)} for that clip`]);
  }
  if (row.donor) {
    const a = Array.isArray(row.donor.ankle) ? row.donor.ankle.map((x) => `${x.side} ${h(x.dyShare, 3)}`).join("/") : "—";
    out.push(["donor's own motion", `step ${h(row.donor.step, 3)} rad/frame · ankles ${a} H`]);
  }
  if (row.source) out.push(["source", String(row.source)]);
  return out.filter((r) => r[1] != null && r[1] !== "");
}

/** The deep link for one bake (`?bake=<id>&table=<n>`), without touching the camera hash. */
export function bakeQuery({ id, table = null, clip = null } = {}) {
  const q = new URLSearchParams();
  if (!id) return "";
  q.set("bake", id);
  if (table != null) q.set("table", String(table));
  if (clip != null) q.set("clip", String(clip));
  return q.toString();
}
