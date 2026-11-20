// THE HAND-PICKED DW2 / DW3 CLIPS — web/dw2-motion-picks.json (committed: folder, clip slot, "dw2"|"dw3",
// no disc data). The animation viewer writes it (Actions -> DW2 motion -> Your picks -> Save, through the
// launcher's PUT /__dw2003/dw2-picks). It ships with the game, so every install gets the same picks.
//
// It only matters while the player has Digimon World 2 motion on (F2 -> Battle): then a listed clip
// overrides the automatic rule in clip-fallback.js resolveClipScript ("dw2" plays the DW2 motion even
// where the body owns a clip, "dw3" never takes DW2 there). An unlisted clip follows the rule as before.
export const DW2_PICKS_URL = "dw2-motion-picks.json";
export const PICK_VALUES = ["dw2", "dw3"];

let picks = null;              // folder -> { slot: "dw2"|"dw3" }, null until loaded
let loading = null;

/** Keep only well-formed rows (a hand-edited or old file can never break a fight). */
export function cleanPicks(raw) {
  const out = {};
  const src = raw && typeof raw === "object" ? raw : {};
  for (const [folder, slots] of Object.entries(src)) {
    if (!/^[A-Za-z0-9_]+$/.test(folder) || !slots || typeof slots !== "object") continue;
    const row = {};
    for (const [slot, v] of Object.entries(slots)) {
      if (/^\d{1,2}$/.test(slot) && PICK_VALUES.includes(v)) row[String(slot | 0)] = v;
    }
    if (Object.keys(row).length) out[folder] = row;
  }
  return out;
}

/** Load the file once (browser fetch; Node reads it from disk). Never throws: no file = no picks. */
export async function ensureDw2Picks() {
  if (picks) return picks;
  if (!loading) {
    loading = (async () => {
      let json = null;
      try {
        if (typeof fetch === "function" && typeof window !== "undefined") {
          const r = await fetch(DW2_PICKS_URL, { cache: "no-store" });
          json = r && r.ok ? await r.json() : null;
        } else {
          const fs = await import("node:fs/promises");
          const path = await import("node:path");
          const url = await import("node:url");
          const root = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
          json = JSON.parse(await fs.readFile(path.join(root, DW2_PICKS_URL), "utf8"));
        }
      } catch { json = null; }
      picks = cleanPicks(json?.picks);
      return picks;
    })();
  }
  return loading;
}

/** Tests and the viewer set the picks directly. */
export function setDw2Picks(raw) { picks = cleanPicks(raw); loading = Promise.resolve(picks); }

/** "dw2" | "dw3" | null for one body's clip slot. */
export function dw2Pick(folder, slot) {
  if (!picks || !folder || slot == null) return null;
  return picks[folder]?.[String(slot | 0)] ?? null;
}
