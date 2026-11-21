// What web/quest-readback.ts reads a scene back against.

/** readBack()'s options: the map the scene runs on, and the names to print it with. */
export interface QuestReadbackOpts {
  mapId?: string;
  mapName?: string;
  /** map id -> place name (the CLI passes the manifest) */
  maps?: Record<string, string>;
}
