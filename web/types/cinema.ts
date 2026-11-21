
/** One record of the movie manifest: the disc file index it maps, its frame count and its file. */
export interface CinemaManifestRecord {
  index?: number;
  frames?: number;
  file?: string;
}
