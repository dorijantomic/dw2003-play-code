// Types only: the shapes web/anim-viewer-data.ts reads from the data files and hands to the panel.
// Nothing here is emitted (node's strip mode erases it), so this file must never hold runtime code.

/**
 * One row of assets/data/extra_species_canon.json: a species the canon adds on top of the disc's,
 * with the names it evolves from (`from`), its stage tier and the evolution lines it belongs to.
 */
export interface ExtraSpeciesCanon {
  id?: number;
  name?: string;
  from?: string[];
  tier?: number;
  lines?: number[];
}

/** Where the animator found the script it is showing: the clip's folder and clip, plus the donor row it may reuse. */
export interface ScriptOrigin {
  folder?: string;
  clip?: string | number | null;
  donorRow?: { d?: string; m?: string } | null;
  castBake?: { donor?: string } | null;
}
