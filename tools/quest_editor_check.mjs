#!/usr/bin/env node
// Used by tools/quest_editor_server.py: reads { characters, paths } as JSON on stdin, prints the problems as a JSON list.
// Same rules as web/quest-editor-lib.js (which is web/quest-walk.js on web/assets/collision/<map>.json).
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkData, questGrid } from "../web/quest-editor-lib.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const cache = new Map();
const gridOf = (id) => {
    if (!/^s\d+$/.test(String(id))) return null;
    if (!cache.has(id)) {
        const f = join(ROOT, "web", "assets", "collision", `${id}.json`);
        cache.set(id, existsSync(f) ? questGrid(JSON.parse(readFileSync(f, "utf8"))) : null);
    }
    return cache.get(id);
};
const data = JSON.parse(readFileSync(0, "utf8"));
process.stdout.write(JSON.stringify(checkData(data, gridOf)));
