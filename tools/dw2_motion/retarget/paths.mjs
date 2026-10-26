// Where the DW2-motion converter reads and writes. Everything it reads from a disc is built on the player's own computer:
//   DW2M_GAME  the DW3 battle folder (models/<folder>/anim.json from the player's DW3 disc; dw2motion/ is written here)
//   DW2M_DW2   the DW2 models in our format (dw2_<id>/anim.json, from the player's DW2 disc: tools/dw2/dw2_addon.py --motion)
//   DW2M_WORK  scratch space for the runs (maps, scenes, packs, reports)
// The two tables that are ours (no disc data, only bone numbers, role names, flags and a few measured positions) are
// committed in data/authored/dw2_motion/: rigs.json (each DW3 body's bones, chains, joints, sites) and pairs.json (which
// DW3 bone follows which DW2 bone, per species). Copied from the reviewed research tables on 2026-10-26.
import os from "node:os";
import path from "node:path";
import url from "node:url";

export const REPO = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..", "..", "..");
export const GAME = process.env.DW2M_GAME || path.join(REPO, "web", "assets", "battle");
export const DW2 = process.env.DW2M_DW2 || path.join(os.homedir(), ".cache", "dw2003-play", "dw2-anim");
export const WORK = process.env.DW2M_WORK || path.join(os.homedir(), ".cache", "dw2003-play", "dw2-motion-work");
export const DATA = path.join(REPO, "data", "authored", "dw2_motion");
export const RIGS = path.join(DATA, "rigs.json");
export const PAIRS = path.join(DATA, "pairs.json");

export const modelPath = (folder) => path.join(GAME, "models", folder, "anim.json");
export const dw2Path = (id) => path.join(DW2, `dw2_${id}`, "anim.json");
export const fightModule = (name) => url.pathToFileURL(path.join(REPO, "web", "fight", name)).href;
