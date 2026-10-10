// engine/dw3/dialogue-parse.ts
// Parses ddw3 lang-file markup: [name]Speaker[name]text[pause][clear]text[pause]
// Unknown [codes] are stripped (some escape codes are undocumented upstream).
// Ported from web/dialogue.js. DW3-specific text format → engine/dw3.

export interface ParsedDialogue {
  name: string;
  pages: string[][];
}

export function parseEntry(raw: string | null | undefined, playerName = "Akira"): ParsedDialogue {
  raw = (raw ?? "")
    .replaceAll("[player_name]", playerName)
    .replaceAll("[player_name2]", playerName);
  let name = "";
  let text = raw;
  const m = raw.match(/^\[name\](.*?)\[name\]/s);
  if (m) {
    name = m[1]!;
    text = raw.slice(m[0].length);
  }
  const pages = text
    .split("[clear]")
    .map(page =>
      page
        .replaceAll("[pause]", "")
        .replace(/\[[^\]]*\]/g, "")
        .split("\n")
        .map(line => line.trim())
        .filter(line => line.length > 0),
    )
    .filter(page => page.length > 0);
  return { name, pages };
}
