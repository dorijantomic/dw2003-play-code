// web/arrival-lab.js — the Arrival Lab's model: every gate object a place installs,
// its ordered candidate chain in plain words, and the engine's own answer to "which
// scene does this place start right now".
//
// The decision is NOT re-implemented here. `arrivalVerdict` builds the (beat, flag)
// predicate the chains are written in and hands the chain to the engine's own
// `chooseArrivalEvent(chain, test)` (engine/systems/scene-arrival.ts, exported through
// web/vendor/engine.js). A second matcher would be a second answer, and the whole point
// of the page is that it can never disagree with the engine.
//
// The predicate the chains use (engine/systems/scene-arrival.ts, ArrivalLeaf):
//   * an ORDINAL leaf is `0x6000 | beat` with expected 1 for "the master story beat
//     IS n" and expected 0 for "is not n" — the same bank-0x60 equality the flag
//     store's reader answers (web/flag-store.js: get_ordinal() == id & 0x1ff).
//     Rendering it as a flag would print "flag 24589" for 0x600d, which is not a flag
//     at all.
//   * every other leaf is a flag/predicate id read through get_flag, which returns
//     nonzero iff it reads as `expected`.
//
// Pure: no page, no DOM, no storage, no fetch, no fs. The page (web/arrival-lab.html)
// owns the fetch of the extracted chain data and the drawing.
import {
  chooseArrivalEvent,
  setArrivalChains,
  arrivalChains,
} from "./vendor/engine.js";

/** Bank 0x60 = the master story ordinal's equality predicate. Same test the flag
 *  store's reader uses (`(id >> 8) & 0xfe`), so the lab and the engine agree on
 *  which leaves are beats. */
export function isOrdinalLeaf(id) {
  return ((id >> 8) & 0xfe) === 0x60;
}

/** The beat an ordinal leaf names (bank 0x60 compares the low nine bits). */
export function beatOf(id) {
  return id & 0x1ff;
}

/** One condition leaf in plain words: "beat 13", "not beat 8", "flag 16397 = 0". */
export function leafWords(leaf) {
  const [id, expected] = leaf;
  if (isOrdinalLeaf(id)) return expected === 1 ? `beat ${beatOf(id)}` : `not beat ${beatOf(id)}`;
  return `flag ${id} = ${expected}`;
}

/** A candidate's routes in plain words. A candidate reached more than one way
 *  (s305 893 arrives both with and without the 0x4057 test passed) has one line per
 *  route; the candidate holds when ANY line's conjunction holds. */
export function candidateLines(candidate) {
  return (candidate?.paths ?? []).map((path) => path.map(leafWords).join(" and "));
}

/** The distinct flag ids one gate object's chain reads, in id order. Ordinal leaves
 *  are story beats, not flags, so they are not offered as flags to set. */
export function flagChoices(chain) {
  const ids = new Set();
  for (const c of chain?.candidates ?? []) {
    for (const path of c.paths ?? []) {
      for (const [id] of path) if (!isOrdinalLeaf(id)) ids.add(id);
    }
  }
  return [...ids].sort((a, b) => a - b);
}

/** The engine's answer for one gate object at one (beat, flags) state:
 *  `{event, index, lines}` — the winning candidate's position in the chain, and its
 *  conditions in plain words — or null when the object starts nothing.
 *
 *  `flagsSet` is a Set of the flag ids that currently read 1. The index is found by
 *  asking the engine about each prefix of the chain, so it is the SAME walk (first
 *  whole match wins), not a second one. */
export function arrivalVerdict(chain, beat, flagsSet) {
  const flags = flagsSet instanceof Set ? flagsSet : new Set(flagsSet ?? []);
  const test = (id, expected) =>
    isOrdinalLeaf(id)
      ? (beatOf(id) === beat) === (expected === 1)
      : flags.has(id) === (expected === 1);
  const event = chooseArrivalEvent(chain, test);
  if (event === null || !chain?.candidates?.length) return null;
  for (let i = 0; i < chain.candidates.length; i++) {
    const prefix = { ...chain, candidates: chain.candidates.slice(0, i + 1) };
    if (chooseArrivalEvent(prefix, test) !== null) {
      return { event, index: i, lines: candidateLines(chain.candidates[i]) };
    }
  }
  return null;   // unreachable: a chain that answers must answer at some prefix
}

/** One row per gate object, in the order the places install them, each with its
 *  ordered candidate chain. `order` is the object's position for its own place
 *  (0 = the entry object; s795/s800 install a second), `band` is the phase band the
 *  object tests its chain on, and `cite` is the extractor's wstag citation, passed
 *  through read-only. */
export function labRows(chains) {
  const seen = new Map();
  const rows = [];
  for (const chain of chains ?? []) {
    const order = seen.get(chain.mapId) ?? 0;
    seen.set(chain.mapId, order + 1);
    rows.push({
      mapId: chain.mapId,
      band: chain.band ?? "reset",
      order,
      tick: chain.tick,
      candidates: (chain.candidates ?? []).map((c) => ({
        event: c.event,
        lines: candidateLines(c),
        cite: c.cite ?? null,
      })),
    });
  }
  return rows;
}

/** Install the extracted chains (web/assets/data/scene/arrival_candidates.json) into
 *  the engine and return every gate object it now holds. */
export function loadChains(raw) {
  setArrivalChains(raw);
  return arrivalChains();
}
