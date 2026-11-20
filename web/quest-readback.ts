// Say It Back: a scene's steps read back as plain English, the way a screenplay reads.
//
// The inverse of the scene planner: one block per step, in order, saying who stands where, who walks to whom,
// what the camera does, what is said and what the weather does. It never compiles, never times and never runs
// anything; a step kind it does not know is a problem, never silence. `diffReadback` compares two readings
// block by block, so the five-second check also shows what changed between two versions of the sentence.
//
// Pure: no DOM and no fs (the CLI in tools/scene_readback.mjs does the reading and the printing). The wording
// follows docs/quests-fx-brief.md and web/quest-scenes.js, which is the closed vocabulary this reads.
import { paginate } from "./dialogue-pack.js";

/** Every step kind web/quest-scenes.js compiles, plus the approved registry step ({ scene: "<id>" }). */
export const KINDS = [
    "walk", "together", "apart", "arrive", "wait", "face", "put", "look", "say", "ask", "sfx",
    "fx", "fxplay", "fxmove", "fxwait", "fxremove", "pan", "drop", "rise", "fade", "battle",
    "shake", "weather", "time", "lightning", "chase", "ghost", "warp", "scene",
];

// The game's facing index (cutscene-manager DIR8), the same list web/quest-scenes.js turns a name into.
const DIRS = ["down", "down-left", "left", "up-left", "up", "up-right", "right", "down-right"];
const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Math.round(Number(v)) : d);
const cap = (s) => (typeof s === "string" && s.length ? s[0].toUpperCase() + s.slice(1) : s);

/** The name tab for an npc id: the scene's own `name`, else opts.names, else "npc 27". "player" is the player label. */
function nameOf(who, opts) {
    if (who === "player") return opts.playerLabel ?? "you";
    let v;
    if (typeof opts.names === "function") v = opts.names(who);
    else if (opts.names instanceof Map) v = opts.names.get(Number(who)) ?? opts.names.get(String(who));
    else v = opts.names?.[who] ?? opts.names?.[String(who)];
    if (v && typeof v === "object") v = v.name;
    return typeof v === "string" && v.trim() ? v.trim() : `npc ${who}`;
}
const actorOf = (who, opts) => cap(nameOf(who, opts));

/** The sheet a step names (its `sheet`, else the instance name), looked up in opts.sheets. */
const sheetOf = (s, opts) => {
    const sheet = typeof s.sheet === "string" ? s.sheet : typeof s.fx === "string" ? s.fx : "";
    return { sheet, spec: opts.sheets?.[sheet] ?? (opts.sheets instanceof Map ? opts.sheets.get(sheet) : undefined) };
};
const missingSheet = (sheet) => `The sheet '${sheet}' is not in web/extra_fx, so this effect is skipped.`;

/** How far dx/dy put a spot from someone, in words ("20 px right and 10 px below you"). */
function offsetText(v, opts) {
    const who = v.near === "player" ? opts.playerLabel ?? "you" : nameOf(v.near, opts);
    const dx = num(v.dx, 0), dy = num(v.dy, 0), parts = [];
    if (dx) parts.push(`${Math.abs(dx)} px ${dx > 0 ? "right" : "left"}`);
    if (dy) parts.push(`${Math.abs(dy)} px ${dy > 0 ? "below" : "above"}`);
    return parts.length ? `a spot ${parts.join(" and ")} ${who}` : `where ${who} ${who === "you" ? "stand" : "stands"}`;
}

/** A walk's destination in words: a point, a gap in front of someone, or an offset from someone. */
function targetText(to, opts) {
    if (Array.isArray(to)) return `(${num(to[0])}, ${num(to[1])})`;
    if (to && typeof to === "object" && "near" in to) {
        const who = to.near === "player" ? opts.playerLabel ?? "you" : nameOf(to.near, opts);
        if (to.gap != null) return `${num(to.gap, 34)} px in front of ${who}`;
        return offsetText(to, opts);
    }
    return "somewhere";
}

/** A point an event is placed or aimed at (a pair, or a character plus an offset). */
function placeText(at, opts) {
    if (Array.isArray(at)) return `at (${num(at[0])}, ${num(at[1])})`;
    if (at && typeof at === "object" && "near" in at) {
        const who = at.near === "player" ? opts.playerLabel ?? "you" : nameOf(at.near, opts);
        const dx = num(at.dx, 0), dy = num(at.dy, 0), parts = [];
        if (dx) parts.push(`${Math.abs(dx)} px ${dx > 0 ? "right" : "left"}`);
        if (dy) parts.push(`${Math.abs(dy)} px ${dy > 0 ? "below" : "above"}`);
        return parts.length ? `at a spot ${parts.join(" and ")} ${who}` : `next to ${who}`;
    }
    return "somewhere";
}

/** 30 frames -> "half a second"; 60 -> "one second". */
function framesText(n) {
    if (n === 60) return "one second";
    if (n === 30) return "half a second";
    if (n % 60 === 0) return `${n / 60} seconds`;
    return `${(n / 60).toFixed(1)} seconds`;
}

const dirOf = (v) => (typeof v === "string" && DIRS.includes(v) ? v : DIRS[num(v, 0) & 7]);

/** A say as the game's box will show it: wrapped at 22, 3 lines a page, a blank line between pages. */
function speech(text, label) {
    return `${label}: ${paginate(String(text)).map((page) => page.join("\n")).join("\n\n")}`;
}

/** The one line for an effect's motion, or "" when it has none. */
function motionText(s) {
    if (s.fall != null) return `, and falls to y ${num(s.fall.floor)}`;
    if (s.slide != null) return `, and slides to (${num(s.slide.to?.[0])}, ${num(s.slide.to?.[1])}) over ${Math.max(1, num(s.slide.frames, 30))} frames`;
    if (s.rise != null) return `, and rises ${num(s.rise.pixels)} px over ${Math.max(1, num(s.rise.frames, 30))} frames`;
    return "";
}

const WEATHER_WORDS = {
    fog: "Fog rolls in", rain: "It starts raining", storm: "A storm breaks", snow: "It starts snowing",
    blizzard: "A blizzard blows in", sand: "A sandstorm blows in", leaves: "Leaves blow past",
    fireflies: "Fireflies come out", clear: "The weather clears",
};

/**
 * Read a scene's steps back as plain English.
 * @param steps  the scene's steps (web/quests.json's scene slots, or a plan's steps)
 * @param opts   { mapId, mapName, maps, names, sheets, playerLabel }
 *               names: npc id -> name (or {name}), a Map, or a function; sheets: name -> the web/extra_fx json;
 *               maps: map id -> place name (the CLI passes the manifest); playerLabel defaults to "you".
 * @returns { title, blocks: [{ step, kind, text }], problems }  step is 1-based, like the compiler's errors.
 */
export function readBack(steps, opts = {}) {
    const o = opts ?? {};
    const title = `## ${o.mapName ?? o.maps?.[o.mapId] ?? o.mapId ?? "unknown map"}`;
    const blocks = [], problems = [];
    if (!Array.isArray(steps) || !steps.length) {
        problems.push("a scene needs at least one step");
        return { title, blocks, problems };
    }
    const add = (step, kind, text) => blocks.push({ step, kind, text });
    steps.forEach((s, index) => {
        const n = index + 1;
        const bad = (why) => problems.push(`step ${n}: ${why}`);
        if (s == null || typeof s !== "object" || Array.isArray(s)) {
            bad("not an object");
            return add(n, "unknown", "This step is not an object, so there is nothing to read.");
        }
        const actor = (who) => actorOf(who, o);
        if ("walk" in s) {
            let text;
            if (s.path != null && s.to == null) {
                text = `${actor(s.walk)} walks the named path "${s.path}"`;
            } else if (s.to === "origin") {
                text = `${actor(s.walk)} walks back to where they stood`;
            } else if (s.to != null) {
                const point = Array.isArray(s.to) && s.to.length === 2;
                const near = s.to && typeof s.to === "object" && "near" in s.to;
                if (!point && !near) {
                    bad("walk needs to: [x, y] or { near, dx, dy }");
                    text = `${actor(s.walk)} has nowhere to walk`;
                } else {
                    text = `${actor(s.walk)} walks to ${targetText(s.to, o)}`;
                }
            } else {
                bad("walk needs to: [x, y], { near, dx, dy } or \"origin\"");
                text = `${actor(s.walk)} has nowhere to walk`;
            }
            if (s.face != null) text += `, facing ${dirOf(s.face)}`;
            return add(n, "walk", `${text}.`);
        }
        if ("together" in s) {
            return add(n, "together", `${actor(s.together)} and you walk side by side for up to ${num(s.dist, 120)} px.`);
        }
        if ("apart" in s) {
            return add(n, "apart", `${actor(s.apart)} and you walk back to where you stood.`);
        }
        if ("arrive" in s) {
            const who = s.arrive === "player" ? "you" : nameOf(s.arrive, o);
            return add(n, "arrive", `The scene waits for ${who} to stop walking.`);
        }
        if ("wait" in s) {
            const frames = Math.max(1, num(s.wait, 30));
            return add(n, "wait", `A pause of ${frames} frames (${framesText(frames)}).`);
        }
        if ("face" in s) {
            return add(n, "face", `${actor(s.face)} turns to face ${dirOf(s.dir)}.`);
        }
        if ("put" in s) {
            if (!Array.isArray(s.at) || s.at.length !== 2) {
                bad("put needs at: [x, y]");
                return add(n, "put", `${actor(s.put)} is placed somewhere unknown.`);
            }
            const verb = s.put === "player" ? "are" : "is";
            return add(n, "put", `${actor(s.put)} ${verb} placed at (${num(s.at[0])}, ${num(s.at[1])}).`);
        }
        if ("look" in s) {
            return add(n, "look", `The camera follows ${s.look === "player" ? "you" : nameOf(s.look, o)}.`);
        }
        if ("say" in s) {
            const label = s.say == null
                ? String((typeof s.name === "string" && s.name.trim()) || "Narration").toUpperCase()
                : String((typeof s.name === "string" && s.name.trim()) || nameOf(s.say, o)).toUpperCase();
            if (typeof s.text !== "string" || !s.text.trim()) {
                bad("say needs text");
                return add(n, "say", `${label} says nothing (the step has no text).`);
            }
            return add(n, "say", speech(s.text, label));
        }
        if ("ask" in s) {
            if (!Array.isArray(s.options) || s.options.length < 2) {
                bad("ask needs options");
                return add(n, "ask", `The game asks: ${s.ask ?? "..."} (no options).`);
            }
            return add(n, "ask", `The game asks: ${s.ask} (options: ${s.options.join(" / ")})`);
        }
        if ("sfx" in s) {
            if (typeof s.sfx !== "string" || !s.sfx.trim()) {
                bad("sfx needs the name of a sound");
                return add(n, "sfx", "A sound is asked for, but the step names none.");
            }
            return add(n, "sfx", `A sound plays: ${s.sfx}.`);
        }
        if ("fx" in s) {
            const { sheet, spec } = sheetOf(s, o);
            if (!sheet) {
                bad("fx needs a name (the instance later steps use)");
                return add(n, "fx", "An effect is asked for, but the step names none.");
            }
            if (!spec) return add(n, "fx", missingSheet(sheet));
            if (!Array.isArray(s.at) && !(s.at && typeof s.at === "object" && "near" in s.at)) {
                bad("fx needs at: [x, y] or { near: <character>, dx, dy }");
            }
            const clip = typeof s.clip === "string" ? s.clip : spec.default;
            let text = `The ${sheet} effect is placed ${placeText(s.at, o)}`;
            if (clip) text += `, playing "${clip}"`;
            text += motionText(s);
            text += ".";
            if (s.layer === "front") text += " It is drawn over everyone.";
            else if (s.layer === "behind") text += " It is drawn behind every person.";
            return add(n, "fx", text);
        }
        if ("fxplay" in s) {
            if (typeof s.fxplay !== "string" || !s.fxplay) {
                bad("fxplay needs the effect's name and clip");
                return add(n, "fxplay", "An effect is asked to change clip, but the step names none.");
            }
            if (typeof s.clip !== "string") {
                bad("fxplay needs the effect's name and clip");
                return add(n, "fxplay", `The ${s.fxplay} effect is asked to change clip, but the step names none.`);
            }
            return add(n, "fxplay", `The ${s.fxplay} effect switches to clip "${s.clip}"${s.loop === true ? " and loops" : ""}.`);
        }
        if ("fxmove" in s) {
            if (typeof s.fxmove !== "string" || !s.fxmove) {
                bad("fxmove needs the effect's name");
                return add(n, "fxmove", "An effect is asked to move, but the step names none.");
            }
            const motion = motionText(s);
            if (!motion) {
                bad("fxmove needs fall, slide or rise");
                return add(n, "fxmove", `The ${s.fxmove} effect is moved, but the step names no motion.`);
            }
            return add(n, "fxmove", `The ${s.fxmove} effect starts${motion.replace(", and ", " to ")}.`);
        }
        if ("fxwait" in s) {
            if (typeof s.fxwait !== "string" || !s.fxwait) {
                bad("fxwait needs the effect's name");
                return add(n, "fxwait", "The scene waits for an effect it does not name.");
            }
            return add(n, "fxwait", `The scene waits for the ${s.fxwait} effect.`);
        }
        if ("fxremove" in s) {
            if (typeof s.fxremove !== "string" || !s.fxremove) {
                bad("fxremove needs the effect's name");
                return add(n, "fxremove", "An effect is removed, but the step names none.");
            }
            const fade = s.fade != null && Number(s.fade) >= 0 ? Math.max(0, num(s.fade, 0)) : null;
            return add(n, "fxremove", `The ${s.fxremove} effect is removed${fade ? ` over ${fade} frames` : ""}.`);
        }
        if ("pan" in s) {
            const t = s.pan;
            if (t === "player") return add(n, "pan", "The camera follows you.");
            if (t != null && typeof t !== "object") return add(n, "pan", `The camera follows ${nameOf(t, o)}.`);
            if (Array.isArray(t)) return add(n, "pan", `The camera moves to (${num(t[0])}, ${num(t[1])}).`);
            if (t && typeof t === "object" && "near" in t) {
                return add(n, "pan", `The camera moves to ${targetText(t, o)}.`);
            }
            bad('pan needs [x, y], a character id or "player"');
            return add(n, "pan", "The camera is asked to move, but the step names no place.");
        }
        if ("drop" in s || "rise" in s) {
            const down = "drop" in s;
            const px = Math.abs(num(down ? s.drop : s.rise, 0));
            if (!(px > 0)) {
                bad(`${down ? "drop" : "rise"} needs a distance in pixels`);
                return add(n, down ? "drop" : "rise", `The player is asked to ${down ? "drop" : "rise"}, but the step names no distance.`);
            }
            return add(n, down ? "drop" : "rise", `The player ${down ? "drops" : "rises"} ${px} px through the field.`);
        }
        if ("fade" in s) {
            const mode = s.fade === true ? "out" : String(s.fade ?? "");
            const frames = Math.max(1, num(s.frames, 30));
            const words = {
                out: `The screen fades out over ${frames} frames.`,
                in: `The screen fades back in over ${frames} frames.`,
                black: "The screen goes black at once.",
                clear: "The screen clears at once.",
            }[mode];
            if (!words) {
                bad(`fade ${JSON.stringify(s.fade)} is not "out", "in", "black" or "clear"`);
                return add(n, "fade", "The screen is asked to fade, but the step names no mode.");
            }
            return add(n, "fade", words);
        }
        if ("battle" in s) {
            const screen = Number(s.battle);
            if (!Number.isInteger(screen) || screen <= 0) {
                bad("battle needs a fight screen id");
                return add(n, "battle", "A fight is asked for, but the step names no screen.");
            }
            return add(n, "battle", `A fight starts: screen ${screen}, and the scene goes on after a win or a flee.`);
        }
        if ("shake" in s) {
            const amp = Number(s.shake), frames = Math.max(1, num(s.frames, 20));
            const times = s.times == null ? 1 : num(s.times, 1);
            if (!(Number.isFinite(amp) && amp > 0)) {
                bad("shake needs an amplitude of 1 to 40 pixels");
                return add(n, "shake", "The field is asked to shake, but the step names no amplitude.");
            }
            const text = times > 1
                ? `The field shakes by ${amp} px, ${times} times, every ${Math.max(1, num(s.every, frames))} frames.`
                : `The field shakes by ${amp} px for ${frames} frames.`;
            return add(n, "shake", s.decay === false ? `${text} It does not die down.` : text);
        }
        if ("weather" in s) {
            const w = String(s.weather);
            const words = WEATHER_WORDS[w];
            if (!words) {
                bad(`weather ${JSON.stringify(s.weather)} is not one of ${Object.keys(WEATHER_WORDS).join(", ")}`);
                return add(n, "weather", "The scene asks for a weather it does not name.");
            }
            const frames = Math.max(0, num(s.frames, 30));
            const strength = w === "clear" ? "" : ` (strength ${s.strength == null ? 0.75 : Number(s.strength)})`;
            const forced = s.force === true ? ", even if the player turned it off" : "";
            return add(n, "weather", `${words}${strength} over ${frames} frames${forced}.`);
        }
        if ("time" in s) {
            const t = String(s.time);
            if (!["day", "golden", "dusk", "night"].includes(t)) {
                bad(`time ${JSON.stringify(s.time)} is not one of day, golden, dusk, night`);
                return add(n, "time", "The scene asks for a time of day it does not name.");
            }
            const frames = Math.max(0, num(s.frames, 60));
            const forced = s.force === true ? ", even if the player turned it off" : "";
            return add(n, "time", `The time of day becomes ${t} over ${frames} frames${forced}.`);
        }
        if ("lightning" in s) {
            const count = s.lightning === true ? 1 : num(s.lightning, 1);
            if (!(count >= 1)) {
                bad("lightning is 1 to 6 flashes");
                return add(n, "lightning", "Lightning is asked for, but the step names no count.");
            }
            const forced = s.force === true ? " It happens even if the player turned lightning off." : "";
            return add(n, "lightning", `Lightning flashes ${count === 1 ? "once" : `${count} times`}.${forced}`);
        }
        if ("chase" in s) {
            const isNpc = Number.isFinite(Number(s.chase)) && typeof s.chase !== "string";
            const target = isNpc ? nameOf(Number(s.chase), o) : String(s.chase);
            if (!isNpc && !target) {
                bad("chase needs a character id or an fx name");
                return add(n, "chase", "A chase is asked for, but the step names no target.");
            }
            if (!Array.isArray(s.path) || !s.path.length) {
                bad("chase needs a path of 1 to 64 points");
                return add(n, "chase", `A chase after ${target} is asked for, but the step names no path.`);
            }
            const speed = Number.isFinite(Number(s.speed)) && Number(s.speed) > 0 ? Number(s.speed) : 130;
            const lose = Number.isFinite(Number(s.lose)) && Number(s.lose) > 0 ? Number(s.lose) : 90;
            const limit = s.frames != null ? ` for up to ${num(s.frames)} frames` : "";
            return add(n, "chase", `The chase is on: ${target} runs a path of ${s.path.length} points at ${speed} px a second, and you must stay within ${lose} px${limit}.`);
        }
        if ("ghost" in s) {
            const who = s.ghost === "player" ? "player" : Number(s.ghost);
            if (!(who === "player" || Number.isFinite(who))) {
                bad('ghost needs a character id or "player"');
                return add(n, "ghost", "A character is asked to appear as a memory, but the step names none.");
            }
            if (s.off === true) return add(n, "ghost", `${actor(who)} is drawn normally again.`);
            const alpha = s.alpha == null ? 0.5 : Number(s.alpha);
            const tint = typeof s.tint === "string" ? `, tint ${s.tint}` : "";
            return add(n, "ghost", `${actor(who)} is drawn as a faded memory (alpha ${alpha}${tint}).`);
        }
        if ("warp" in s) {
            const w = s.warp;
            const to = typeof w === "string" || typeof w === "number" ? w : w?.map ?? w?.to ?? w?.screen ?? null;
            const at = Array.isArray(w?.at) ? w.at : Array.isArray(s.at) ? s.at : null;
            const dir = w?.dir ?? s.dir;
            if (to == null || to === "" || !Array.isArray(at) || at.length !== 2) {
                bad("warp needs a map id and at: [x, y] on the new map");
                return add(n, "warp", "The player is asked to leave the map, but the step names no place to land.");
            }
            const facing = dir != null ? `, facing ${dirOf(dir)}` : "";
            const then = typeof s.then === "string" && s.then ? `; on arrival the registered scene '${s.then}' plays once` : ". The scene ends there";
            return add(n, "warp", `The player is moved to ${to} at (${num(at[0])}, ${num(at[1])})${facing}${then}.`);
        }
        if ("scene" in s) {
            if (typeof s.scene !== "string" || !s.scene) {
                bad("scene needs the registry id");
                return add(n, "scene", "A registered scene is asked for, but the step names none.");
            }
            return add(n, "scene", `The registered scene '${s.scene}' plays here, not expanded by this tool.`);
        }
        const keys = Object.keys(s);
        bad(`unknown step ${JSON.stringify(keys)}`);
        add(n, "unknown", `Unknown step: ${keys.map((k) => `"${k}"`).join(", ")}. This tool does not know it.`);
    });
    return { title, blocks, problems };
}

/**
 * Compare two readings block by block (LCS over the block text). Unchanged blocks are byte-identical;
 * a block whose text changed is exactly one removed and one added line.
 * @returns { added, removed, same, lines: [{ type: "same"|"removed"|"added", step, kind, text }] }
 */
export function diffReadback(a, b) {
    const A = a?.blocks ?? [], B = b?.blocks ?? [];
    const n = A.length, m = B.length;
    const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) {
        for (let j = m - 1; j >= 0; j--) {
            dp[i][j] = A[i].text === B[j].text ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
        }
    }
    const lines = [];
    let added = 0, removed = 0, same = 0, i = 0, j = 0;
    const take = (block, type) => {
        lines.push({ type, step: block.step, kind: block.kind, text: block.text });
        if (type === "added") added++;
        else if (type === "removed") removed++;
        else same++;
    };
    while (i < n && j < m) {
        if (A[i].text === B[j].text) { take(B[j], "same"); i++; j++; }
        else if (dp[i + 1][j] >= dp[i][j + 1]) { take(A[i], "removed"); i++; }
        else { take(B[j], "added"); j++; }
    }
    while (i < n) { take(A[i], "removed"); i++; }
    while (j < m) { take(B[j], "added"); j++; }
    return { added, removed, same, lines };
}
