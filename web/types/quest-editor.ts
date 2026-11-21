// The quest editor's data (web/quest-editor.ts) and the rules it checks it with (web/quest-editor-lib.ts):
// what tools/quest_editor_server.py, web/extra_npcs.json and web/quest-paths.json hold.

// A walkable map grid in the shape web/quest-walk.ts works on.
export interface QuestWalkGrid {
  cell: number;
  cols: number;
  rows: number;
  cells: Uint8Array;
}

// One place a quest character stands (a resident row of web/extra_npcs.json).
export interface QuestResident {
  map: string;
  x: number;
  y: number;
  dir: string;
}

// A quest-only character (npc_id 1000+, sprite named after it: extra_sprites/q<npc_id>.png).
export interface QuestCharacter {
  npc_id: number;
  name: string;
  residents: QuestResident[];
}

// A named walking route a quest scene walks (web/quest-paths.json), owned by a character when npc is set.
export interface QuestPath {
  map: string;
  npc?: number;
  points: number[][];
}

// Everything the editor loads, edits and saves.
export interface QuestEditorWork {
  characters: QuestCharacter[];
  paths: Record<string, QuestPath>;
}

// GET /load of the save helper: the saved work plus the map ids it knows.
export interface QuestEditorLoaded extends QuestEditorWork {
  maps?: string[];
}

// POST /save of the save helper.
export interface QuestEditorSaveReply {
  problems?: string[];
  built?: string;
}

// What a click on the map picked: a path point or a character standing there.
export type QuestEditorPick =
  | { kind: "pt"; name: string; i: number }
  | { kind: "res"; ch: QuestCharacter; r: QuestResident };

// A pick being dragged, from the spot it started on.
export type QuestEditorDrag = QuestEditorPick & { from: number[] };
