// The shipped sound tables web/silence-report.ts checks a build against.

/** One row of the Sound-Test catalogue: the sound's packed id and its name. */
export interface CatalogueSound {
  id: string;
  name: string;
}

/** One of the catalogue's 71 categories: a bank name and the sounds the original lists under it. */
export interface CatalogueCategory {
  name: string;
  sounds: CatalogueSound[];
}

/** web/assets/sfx/catalogue.json (the Sound-Test catalogue). */
export interface SoundCatalogue {
  categories: CatalogueCategory[];
}

/** One entry of a built sfx manifest (the id the sample was packed under). */
export interface SfxManifestEntry {
  id?: string;
}

/** A built sfx manifest: web/assets/sfx/manifest.json, or one area bank of area_manifest.json. */
export type SfxManifest = Record<string, SfxManifestEntry | undefined>;

/** One catalogue row, marked with how this build can sound it. */
export interface CoverageMark {
  /** the category (bank) the row was listed under */
  category: string;
  /** "sample": the bank has the extracted sample; "stem": build_music.py rendered it; "bankTheme": only the bank's theme covers it; "silent": nothing does */
  kind: "sample" | "stem" | "bankTheme" | "silent";
  name: string;
  id: string;
  /** the music stem the start maps to, null when it is not a music start or has none */
  stem: string | null;
  /** for the silent rows the original really does play: what fires it */
  fires?: boolean;
  how?: string;
  why: string;
}

/** The tables the shipped build has: the Sound-Test catalogue, the sfx and area manifests, the music index. */
export interface CoverageTables {
  /** the 71-category Sound-Test catalogue */
  catalogue?: SoundCatalogue;
  /** web/assets/sfx/manifest.json */
  common?: SfxManifest;
  /** web/assets/data/area_manifest.json: bank name -> that bank's manifest */
  area?: Record<string, SfxManifest>;
  /** web/assets/music/index.json: the stems build_music.py wrote */
  stems?: string[];
  /** the hand-named jingles */
  startWords?: Record<string, string>;
}

/** What coverage() reports: the four counts, the rows behind two of them, and every mark. */
export interface CoverageReport {
  bankTheme: number;
  marks: CoverageMark[];
  rows: number;
  sample: number;
  silent: CoverageMark[];
  stem: number;
  themes: CoverageMark[];
}
