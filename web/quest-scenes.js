// Scripted scenes for the extra quests: data in, the game's own cutscene commands out.
//
// A scene is a list of steps in quests.json (nothing here is code a quest author has to touch):
//
//   { "walk": 27, "to": [900, 400], "face": 2 }   an NPC (its npc_id from the scene files) walks there; keeps going while
//                                                 the next steps run, so two walks side by side move together. The walker
//                                                 walks a straight line, and the map is not flat: when that line crosses a
//                                                 wall the compiler routes it around the wall instead (a few WALKTO legs
//                                                 from web/quest-walk.js; only those walks wait for each other).
//   { "walk": 27, "to": "origin" }                back to where they stood when the scene began
//   { "walk": 27, "to": { "near": "player", "gap": 34 } }   walk straight toward someone and stop `gap` pixels in front of
//                                                 them, facing them; a larger gap than the distance means stepping back
//   { "walk": 27, "to": { "near": "player", "dx": -40, "dy": 10 } }   walk to a place relative to someone (or "player"), so a
//                                                 scene works wherever the player happens to be standing
//   { "walk": "player", "to": [x, y] }            the player walks (the party follows as in any cutscene)
//   { "together": 27, "dist": 120 }               that character and the player walk side by side for up to `dist` pixels, in a
//                                                 direction that is free ground for both (it prefers going on away from the
//                                                 character's post); if there is no room it does nothing and the scene goes on
//   { "apart": 27 }                                both walk back to where they stood when the scene began
//   { "wait": 30 }                                 pause, in frames (60 = one second)
//   { "arrive": 27 }                               wait until that character has stopped walking
//   { "face": 27, "dir": 6 }                       turn on the spot (0..7, the game's facing index)
//   { "put": 27, "at": [x, y] }                    place a character (an NPC that is not on this map is spawned, if its
//                                                  sprite is known, so a visitor can walk in from the edge)
//   { "say": 27, "name": "Leomon", "text": "..." } speak, in the game's own conversation box. say: "player" for the
//                                                  player, null for a plain narration window. A blank line = new page.
//   { "ask": "Take the job?", "options": ["I will do it", "Not now"] }   the game's choice list, with the scene still
//                                                 running around it; the answer (0, 1, ...) goes back to the quest
//   { "look": 27 } / { "look": "player" }          the camera follows that character (the first step is "player" by default)
//   { "sfx": "name" }                              a sound cue the host knows (optional)
//
// Events (our own art and the screen; each one is documented in docs/quests-fx-brief.md):
//
//   { "fx": "crate", "sheet": "crate", "at": [x, y], "clip": "fall", "layer": "entity" }
//                                                  place one of our own sprite sheets (web/extra_fx/<sheet>.png + .json) on the
//                                                  map; "at" is a world point, or { "near": 27, "dx": 0, "dy": -8 } to
//                                                  stand it relative to a character (resolved when the scene begins). It is
//                                                  drawn in the field's own y-sorted list, so it stands in front of or behind
//                                                  people like any sprite. "layer": "entity" (default, y-sorted), "behind"
//                                                  (over the map, behind every person) or "front" (over every person).
//                                                  Optional motion, run as it appears: "fall": { "floor": y, "step": 0.75,
//                                                  "bounce": true } (gravity, then -v/3 bounces, settle on the floor -- the
//                                                  s415 rock fall), "slide": { "to": [x, y], "frames": 30 },
//                                                  "rise": { "pixels": 60, "frames": 30 }
//   { "fxplay": "crate", "clip": "land", "loop": false }   switch a placed effect's clip
//   { "fxmove": "crate", "fall"|"slide"|"rise": {...} }    start a motion on one that is already placed
//   { "fxwait": "crate" }                          wait until that effect has arrived (its motion is over, it faded, or it
//                                                  was removed); an effect that could not be placed resolves at once
//   { "fxremove": "crate", "fade": 20 }            remove it (optionally fading out over 20 frames)
//   { "pan": [x, y], "snap": true }                the camera to a point (the game's FN6B), then back with a second pan
//   { "pan": "player" } / { "pan": 27 }            the camera back to following that character (FN6A)
//   { "drop": 180, "step": 0.25 } / { "rise": 180 }  move the PLAYER that many pixels down/up through the field
//                                                  character's own Y (the s680 floor collapse: the room scrolls, the camera
//                                                  follows); blocks until the whole distance is travelled
//   { "fade": "out", "frames": 30 }                the screen to black; "in" back to the field; "black"/"clear" at once
//   { "battle": 12 }                               start that fight screen mid-scene and go on after a WIN (a flee also goes
//                                                  on, as the story's own scripted fights do); a loss ends the scene, since the
//                                                  game takes a loss to the title
//   { "warp": { "map": "s320", "at": [x, y], "dir": 0 } }   move the player to another map and spot (the game's HANDOFF
//                                                  route: screen routing then the ordinary stage transition). The scene ends
//                                                  there, so it is the last step
//
// Atmosphere, the screen and the world (each documented in docs/quests-fx-brief.md section 5):
//
//   { "shake": 6, "frames": 20 }                  shake the field by up to 6 px for 20 frames (a rumble; the amplitude dies
//                                                 out to 0 unless "decay": false). The whole field moves, never the text box
//                                                 or a menu: the offset is applied inside the field's own transform.
//   { "shake": 5, "every": 24, "times": 4 }       repeated thuds, one every 24 frames (a giant's footsteps). It blocks
//                                                 until the last one has died out, so the next line is heard after it
//   { "weather": "fog" | "rain" | "storm" | "snow" | "blizzard" | "sand" | "leaves" | "fireflies" | "clear",
//     "strength": 0..1, "frames": 60, "force": true }
//                                                 any panel effect on ANY map, whatever the map's own profile says (fog on a
//                                                 bridge, snow in a desert); "storm" is rain + lightning, "clear" is no
//                                                 weather at all. It fades in over "frames" and blocks until it is there.
//                                                 The player's own Effects switch is respected: an effect they turned OFF
//                                                 stays off unless the step says "force": true
//   { "time": "day" | "golden" | "dusk" | "night", "frames": 60, "force": true }
//                                                 the time of day and its night lighting, indoors too (the map's own
//                                                 day/night profile is not consulted). It slides there over "frames" (the
//                                                 day literally passes), and blocks until it arrives
//   { "lightning": 1 }                            one flash on cue (thunder follows when weather sound is on)
//   { "chase": 27, "path": [[x, y], ...], "speed": 130, "lose": 90, "frames": 600 }
//                                                 the target (an NPC id, or an fx instance's name) runs the path while the
//                                                 PLAYER keeps control and must stay within "lose" px; the camera follows
//                                                 the player. The answer it returns is 0 = kept up, 1 = lost it (the same
//                                                 channel an "ask" uses). A loss ends the rest of the scene there, so the
//                                                 lines after it never claim a success: retake the quest and try again
//   { "ghost": 27, "alpha": 0.5, "tint": "#9fc8ff" }   draw that character as a faded, tinted figure for the rest of the
//                                                 scene (a memory replay); { "ghost": 27, "off": true } restores them
//
// A scene may also leave our own art on a map AFTER the quest is over: that is the quest data's own "props" list (see
// docs/quests-fx-brief.md section 6), not a step.
//
// compileScene() is pure: it returns the cutscene opcode strings the game's script VM (engine/systems/cutscene-manager.ts)
// runs, plus the speech table the VM's after-say hooks read, plus the `events` table the host performs (each event opcode is
// `SCENEEVENT <index>`). Walking, facing and the camera are therefore the same code the story cutscenes use. The only new
// thing is that the words come from the quest, not from the disc's esdmg files.

const isPlayer = (w) => w === "player";
const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Math.round(Number(v)) : d);
// the game's facing index (cutscene-manager DIR8); a scene may write the name instead
const DIRS = ["down", "down-left", "left", "up-left", "up", "up-right", "right", "down-right"];
// the facing index that looks along (vx, vy) in screen space (y grows downward)
const lookAlong = (vx, vy) => [6, 7, 0, 1, 2, 3, 4, 5][(Math.round(Math.atan2(vy, vx) / (Math.PI / 4)) + 8) % 8];
/**
 * Where a character and the player can walk side by side from here: up to `dist` px along one of the eight directions, both
 * on free ground the whole way (opts.free(x, y) is true on walkable ground). Prefers carrying on away from the character.
 */
function planTogether(p, w, dist, free) {
    if (!free) return null;
    const away = Math.hypot(p.x - w.x, p.y - w.y) < 4 ? Math.PI / 2 : Math.atan2(p.y - w.y, p.x - w.x);
    const line = (a, b) => { const n = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 8); for (let i = 1; i <= n; i++) if (!free(a.x + ((b.x - a.x) * i) / n, a.y + ((b.y - a.y) * i) / n)) return false; return true; };
    const SIDE = 38;                                          // wide enough that two sprites never overlap
    let best = null;
    for (let i = 0; i < 8; i++) {
        const a = (i * Math.PI) / 4, dx = Math.round(Math.cos(a)), dy = Math.round(Math.sin(a)), len = Math.hypot(dx, dy);
        for (const side of [1, -1]) {
            let run = 0;
            for (let d = 8; d <= dist; d += 8) {
                const x = p.x + (dx / len) * d, y = p.y + (dy / len) * d;
                if (!free(x, y) || !free(x - (dy / len) * SIDE * side, y + (dx / len) * SIDE * side)) break;
                run = d;
            }
            if (run < 48) continue;
            const end = { x: p.x + (dx / len) * run, y: p.y + (dy / len) * run };
            const mate = { x: end.x - (dy / len) * SIDE * side, y: end.y + (dx / len) * SIDE * side };
            if (!line(p, end) || !line(w, mate)) continue;
            const score = run + Math.cos(a - away) * 30;
            if (!best || score > best.score) best = { score, end, mate, f: lookAlong(dx, dy) };
        }
    }
    return best;
}

const facing = (v) => (typeof v === "string" && DIRS.includes(v) ? DIRS.indexOf(v) : v == null ? null : num(v, 0) & 7);

/** The atmosphere a scene may ask for (web/ambience.js draws them; "storm" is rain + lightning, "clear" is none). */
const WEATHERS = ["fog", "rain", "storm", "snow", "blizzard", "sand", "leaves", "fireflies", "clear"];
/** The times of day a scene may pin (web/ambience.js TOD_PHASES holds the phase each one means). */
const TIMES = ["day", "golden", "dusk", "night"];
const clamp01 = (v) => Math.max(0, Math.min(1, v));

/**
 * @param steps      the scene's steps (see above)
 * @param opts.playerId  the script id the player answers to in this scene (cutscene.playerActorId: 1 or 2)
 * @param opts.pos       (actorId) -> { x, y } | null, the current place of a character (for "face" and for safe defaults)
 * @returns { opcodes, speech, errors }  speech[n] = { who, name, text } for the SAY opcode numbered n
 */
export function compileScene(steps, opts = {}) {
    const playerId = opts.playerId ?? 2;
    const idOf = (w) => (isPlayer(w) ? playerId : Number(w));
    const opcodes = [], speech = {}, events = [], errors = [];
    let say = 0;
    if (!Array.isArray(steps) || !steps.length) return { opcodes: ["END"], speech, events, errors: ["a scene needs at least one step"] };
    // A point in the world: a pair, or a character plus an offset (resolved once, when the scene begins, like walk targets)
    // `put` records where it sets a character, and every later "where is X" question falls back to it: a visitor a scene
    // brings in with `put` has no record on the map, so face / walk to "origin" / {near} could not answer for them.
    const putAt = new Map();
    const basePos = opts.pos;
    opts = { ...opts, pos: (id) => putAt.get(Number(id)) ?? (basePos ? basePos(id) : null) };
    // Where each walk left the character: the start of their NEXT walk, for routing only. "origin" and { near } still
    // answer from where they stood when the scene began (a scene is written against that), but a second walk of the same
    // character is routed from where the first one put them, not from their post.
    const walkAt = new Map();
    const walkStart = (id) => walkAt.get(Number(id)) ?? opts.pos?.(Number(id)) ?? null;
    const point = (v) => {
        if (Array.isArray(v) && v.length === 2 && v.every((n) => Number.isFinite(Number(n)))) return [num(v[0]), num(v[1])];
        if (v && typeof v === "object" && "near" in v) {
            const p = opts.pos?.(idOf(v.near));
            if (!p) return null;
            return [num(p.x + num(v.dx, 0)), num(p.y + num(v.dy, 0))];
        }
        return null;
    };
    // The one motion an effect may carry (or be given later): fall, slide or rise, checked here so a bad scene fails loudly
    const takeMotion = (s, spec) => {
        const kinds = ["fall", "slide", "rise"].filter((k) => s[k] != null);
        if (kinds.length > 1) return "an effect takes one motion (fall, slide or rise)";
        if (!kinds.length) return null;
        const kind = kinds[0], m = s[kind];
        if (!m || typeof m !== "object" || Array.isArray(m)) return `${kind} needs an object`;
        if (kind === "fall") {
            if (!Number.isFinite(Number(m.floor))) return "fall needs floor: the y it lands on";
            spec.fall = { floor: num(m.floor), step: Math.max(0.05, Number(m.step) || 0.75) };
            if (m.bounce === false) spec.fall.bounce = false;
            if (Number.isFinite(Number(m.v0))) spec.fall.v0 = Number(m.v0);
        } else if (kind === "slide") {
            if (!Array.isArray(m.to) || m.to.length !== 2 || !m.to.every((n) => Number.isFinite(Number(n)))) return "slide needs to: [x, y]";
            spec.slide = { to: [num(m.to[0]), num(m.to[1])], frames: Math.max(1, num(m.frames, 30)) };
        } else {
            if (!Number.isFinite(Number(m.pixels)) || Number(m.pixels) === 0) return "rise needs pixels";
            spec.rise = { pixels: num(m.pixels), frames: Math.max(1, num(m.frames, 30)) };
        }
        return null;
    };
    // A host event: one opcode the VM hands to the game (`SCENEEVENT <index>`) and the spec that says what to do
    const event = (spec) => { events.push(spec); opcodes.push(`SCENEEVENT ${events.length - 1}`); };
    opcodes.push(`FN6A 1 ${playerId}`);                       // the camera starts on the player, as in the story scenes
    steps.forEach((s, i) => {
        const bad = (why) => errors.push(`step ${i + 1}: ${why}`);
        if (s == null || typeof s !== "object") return bad("not an object");
        if ("walk" in s) {
            let to = s.to;
            if (to === "origin") {                                // back to where they stood when the scene began
                const p = opts.pos?.(idOf(s.walk));
                if (!p) return bad(`walk: nobody ${s.walk} to send home`);
                to = [p.x, p.y];
            } else if (to && !Array.isArray(to) && typeof to === "object" && "near" in to) {
                const p = opts.pos?.(idOf(to.near));
                if (!p) return bad(`walk: nobody ${to.near} to walk to`);
                if (to.gap != null) {
                    // on the line from the walker to the target, `gap` short of the target, looking at it
                    const w = opts.pos?.(idOf(s.walk));
                    if (!w) return bad(`walk: nobody ${s.walk} to walk`);
                    const vx = p.x - w.x, vy = p.y - w.y, len = Math.hypot(vx, vy) || 1;
                    to = [p.x - (vx / len) * num(to.gap, 34), p.y - (vy / len) * num(to.gap, 34)];
                    if (s.face == null) s = { ...s, face: lookAlong(vx, vy) };
                } else {
                    to = [p.x + num(to.dx, 0), p.y + num(to.dy, 0)];
                }
            }
            if (!Array.isArray(to) || to.length !== 2) return bad("walk needs to: [x, y] or { near, dx, dy }");
            // without "face" the character keeps looking the way they walked
            const f = facing(s.face);
            // The straight line the cutscene VM would take is what the walker really walks (it steps toward the target
            // with no collision test), so a line that crosses a wall would walk through it. The host hands us a router
            // (opts.walk, web/quest-walk.js over the map's collision grid): a clear line stays one WALKTO exactly as
            // before, a blocked one becomes a few legs. The VM holds one target per actor, so every leg but the last is
            // waited out; only walks that actually cross something pay that cost.
            const from = walkStart(idOf(s.walk));
            const legs = from && opts.walk ? opts.walk(from.x, from.y, num(to[0]), num(to[1])) : null;
            const routed = legs && legs.length && (legs.length > 1 || legs[0][0] !== num(to[0]) || legs[0][1] !== num(to[1]));
            if (routed) {
                legs.forEach((leg, k) => {
                    const last = k === legs.length - 1;
                    opcodes.push(`WALKTO ${idOf(s.walk)} ${num(leg[0])} ${num(leg[1])}${last && f != null ? " " + f : ""}`);
                    if (!last) opcodes.push(`WAITIDLE ${idOf(s.walk)}`);
                });
            } else {
                opcodes.push(`WALKTO ${idOf(s.walk)} ${num(to[0])} ${num(to[1])}${f == null ? "" : " " + f}`);
            }
            walkAt.set(Number(idOf(s.walk)), { x: num(to[0]), y: num(to[1]) });
        } else if ("together" in s) {
            const w = opts.pos?.(idOf(s.together)), p = opts.pos?.(playerId);
            if (!w || !p) return bad(`together: nobody ${s.together} to walk with`);
            const plan = planTogether(p, w, num(s.dist, 120), opts.free);
            if (plan) {
                opcodes.push(`WALKTO ${playerId} ${Math.round(plan.end.x)} ${Math.round(plan.end.y)} ${plan.f}`,
                    `WALKTO ${idOf(s.together)} ${Math.round(plan.mate.x)} ${Math.round(plan.mate.y)} ${plan.f}`,
                    `WAITIDLE ${playerId}`, `WAITIDLE ${idOf(s.together)}`);
                walkAt.set(Number(playerId), { x: Math.round(plan.end.x), y: Math.round(plan.end.y) });
                walkAt.set(Number(idOf(s.together)), { x: Math.round(plan.mate.x), y: Math.round(plan.mate.y) });
            }
        } else if ("apart" in s) {
            const w = opts.pos?.(idOf(s.apart)), p = opts.pos?.(playerId);
            if (!w || !p) return bad(`apart: nobody ${s.apart} to send home`);
            opcodes.push(`WALKTO ${playerId} ${Math.round(p.x)} ${Math.round(p.y)}`, `WALKTO ${idOf(s.apart)} ${Math.round(w.x)} ${Math.round(w.y)}`,
                `WAITIDLE ${playerId}`, `WAITIDLE ${idOf(s.apart)}`);
            walkAt.set(Number(playerId), { x: Math.round(p.x), y: Math.round(p.y) });
            walkAt.set(Number(idOf(s.apart)), { x: Math.round(w.x), y: Math.round(w.y) });
        } else if ("arrive" in s) {
            opcodes.push(`WAITIDLE ${idOf(s.arrive)}`);
        } else if ("wait" in s) {
            opcodes.push(`WAIT ${Math.max(1, num(s.wait, 30))}`);
        } else if ("face" in s) {
            // turning on the spot is a walk to where the character already stands: it arrives on the first tick and sets the facing
            const p = opts.pos?.(idOf(s.face));
            if (!p) return bad(`face: nobody ${s.face} to turn`);
            opcodes.push(`WALKTO ${idOf(s.face)} ${Math.round(p.x)} ${Math.round(p.y)} ${facing(s.dir) ?? 0}`);
        } else if ("put" in s) {
            if (!Array.isArray(s.at) || s.at.length !== 2) return bad("put needs at: [x, y]");
            putAt.set(Number(idOf(s.put)), [num(s.at[0]), num(s.at[1])]);
            walkAt.set(Number(idOf(s.put)), { x: num(s.at[0]), y: num(s.at[1]) });
            opcodes.push(`SETPOS ${idOf(s.put)} ${num(s.at[0])} ${num(s.at[1])}`);
        } else if ("look" in s) {
            opcodes.push(`FN6A ${s.snap ? 1 : 0} ${idOf(s.look)}`);
        } else if ("say" in s) {
            if (typeof s.text !== "string" || !s.text.trim()) return bad("say needs text");
            say += 1;
            speech[say] = { who: s.say == null ? null : s.say, name: s.name ?? "", text: s.text };
            // mode 0 = a balloon over the speaker; 4 = the plain window (narration or an unseen speaker)
            opcodes.push(`SAY 0 ${say} ${s.say == null ? 0 : idOf(s.say)} ${s.say == null ? 4 : 0}`, "WAITCTX");
        } else if ("ask" in s) {
            if (!Array.isArray(s.options) || s.options.length < 2) return bad("ask needs options");
            say += 1;
            speech[say] = { ask: String(s.ask), options: s.options.map(String) };
            opcodes.push(`SAY 0 ${say} 0 4`, "WAITCTX");
        } else if ("sfx" in s) {
            // a sound cue by the name the audio layer knows ("dooropen", "item_get", ...); the host plays it, the scene
            // never waits on it
            if (typeof s.sfx !== "string" || !s.sfx.trim()) return bad("sfx needs the name of a sound");
            event({ kind: "sfx", name: s.sfx });
        } else if ("fx" in s) {
            // one of our own sprite sheets, placed on the map and drawn with the people
            const name = typeof s.fx === "string" ? s.fx : "";
            if (!name) return bad("fx needs a name (the instance later steps use)");
            const at = point(s.at);
            if (!at) return bad("fx needs at: [x, y] or { near: <character>, dx, dy }");
            const spec = { kind: "fx", name, sheet: typeof s.sheet === "string" ? s.sheet : name, x: at[0], y: at[1] };
            if (typeof s.clip === "string") spec.clip = s.clip;
            if (s.scale != null) {
                const k = Number(s.scale);
                if (!(Number.isFinite(k) && k >= 0.1 && k <= 8)) return bad("fx scale is a number 0.1 to 8");
                spec.scale = k;
            }
            if (s.layer != null) {
                if (!["entity", "behind", "front"].includes(s.layer)) return bad(`fx layer ${JSON.stringify(s.layer)} is not "entity", "behind" or "front"`);
                spec.layer = s.layer;
            }
            const why = takeMotion(s, spec);
            if (why) return bad(`fx: ${why}`);
            event(spec);
        } else if ("fxplay" in s) {
            const name = typeof s.fxplay === "string" ? s.fxplay : "";
            if (!name || typeof s.clip !== "string") return bad("fxplay needs the effect's name and clip");
            const spec = { kind: "fxplay", name, clip: s.clip };
            if (typeof s.loop === "boolean") spec.loop = s.loop;
            event(spec);
        } else if ("fxmove" in s) {
            const name = typeof s.fxmove === "string" ? s.fxmove : "";
            if (!name) return bad("fxmove needs the effect's name");
            const spec = { kind: "fxmove", name };
            const why = takeMotion(s, spec);
            if (why) return bad(`fxmove: ${why}`);
            if (!spec.fall && !spec.slide && !spec.rise) return bad("fxmove needs fall, slide or rise");
            event(spec);
        } else if ("fxwait" in s) {
            const name = typeof s.fxwait === "string" ? s.fxwait : "";
            if (!name) return bad("fxwait needs the effect's name");
            event({ kind: "fxwait", name });
        } else if ("fxremove" in s) {
            const name = typeof s.fxremove === "string" ? s.fxremove : "";
            if (!name) return bad("fxremove needs the effect's name");
            const spec = { kind: "fxremove", name };
            if (s.fade != null) {
                if (!(Number(s.fade) >= 0)) return bad("fxremove fade must be a number of frames");
                spec.fade = Math.max(0, num(s.fade, 0));
            }
            event(spec);
        } else if ("pan" in s) {
            // the game's own camera ops: FN6B to a point, FN6A to follow a character again
            const t = s.pan;
            if (isPlayer(t) || (t != null && typeof t !== "object" && Number.isFinite(Number(t)))) {
                opcodes.push(`FN6A 0 ${idOf(isPlayer(t) ? "player" : Number(t))}`);
            } else {
                const at = point(t);
                if (!at) return bad('pan needs [x, y], a character id or "player"');
                opcodes.push(`FN6B ${s.snap ? 1 : 0} ${at[0]} ${at[1]}`);
            }
        } else if ("drop" in s || "rise" in s) {
            // the player's own Y (the s680 floor collapse), down for drop, up for rise
            const down = "drop" in s;
            const px = Math.abs(num(down ? s.drop : s.rise, 0));
            if (!(px > 0)) return bad(`${down ? "drop" : "rise"} needs a distance in pixels`);
            event({ kind: down ? "drop" : "rise", pixels: down ? px : -px, step: Number(s.step) > 0 ? Number(s.step) : 0.25 });
        } else if ("fade" in s) {
            const mode = s.fade === true ? "out" : String(s.fade ?? "");
            if (!["out", "in", "black", "clear"].includes(mode)) return bad(`fade ${JSON.stringify(s.fade)} is not "out", "in", "black" or "clear"`);
            event({ kind: "fade", to: mode, frames: Math.max(1, num(s.frames, 30)) });
        } else if ("battle" in s) {
            const screen = Number(s.battle);
            if (!Number.isInteger(screen) || screen <= 0) return bad("battle needs a fight screen id");
            event({ kind: "battle", screen });
        } else if ("shake" in s) {
            // the field's own screen shake: an amplitude in view pixels and a length in frames, optionally a row of thuds
            const amp = Number(s.shake);
            if (!(Number.isFinite(amp) && amp > 0 && amp <= 40)) return bad("shake needs an amplitude of 1 to 40 pixels");
            const frames = Math.max(1, num(s.frames, 20));
            const spec = { kind: "shake", amp, frames };
            if (s.decay === false) spec.decay = false;
            const times = s.times == null ? 1 : num(s.times, 1);
            if (!(times >= 1 && times <= 12)) return bad("shake times is 1 to 12 thuds");
            if (times > 1) { spec.every = Math.max(1, num(s.every, frames)); spec.times = times; }
            event(spec);
        } else if ("weather" in s) {
            // any panel weather on any map (web/ambience.js scene override); the player's own switches still apply
            const w = String(s.weather);
            if (!WEATHERS.includes(w)) return bad(`weather ${JSON.stringify(s.weather)} is not one of ${WEATHERS.join(", ")}`);
            if (s.strength != null && !Number.isFinite(Number(s.strength))) return bad("weather strength is a number 0 to 1");
            const spec = {
                kind: "weather", weather: w,
                strength: clamp01(s.strength == null ? 0.75 : Number(s.strength)),
                frames: Math.max(0, num(s.frames, 30)),
            };
            if (s.force === true) spec.force = true;
            event(spec);
        } else if ("time" in s) {
            const t = String(s.time);
            if (!TIMES.includes(t)) return bad(`time ${JSON.stringify(s.time)} is not one of ${TIMES.join(", ")}`);
            const spec = { kind: "time", time: t, frames: Math.max(0, num(s.frames, 60)) };
            if (s.force === true) spec.force = true;
            event(spec);
        } else if ("lightning" in s) {
            const n = s.lightning === true ? 1 : num(s.lightning, 1);
            if (!(n >= 1 && n <= 6)) return bad("lightning is 1 to 6 flashes");
            const spec = { kind: "lightning", count: n };
            if (s.force === true) spec.force = true;      // show it even if the player switched lightning off in F2
            event(spec);
        } else if ("chase" in s) {
            // the player keeps control and must keep up with the target along the path; the result comes back as the answer
            const t = s.chase;
            const isNpc = Number.isFinite(Number(t)) && typeof t !== "string";
            if (!(isNpc || (typeof t === "string" && t.length))) return bad("chase needs a character id or an fx name");
            if (!Array.isArray(s.path) || !s.path.length || s.path.length > 64) return bad("chase needs a path of 1 to 64 points");
            for (const p of s.path) {
                if (!Array.isArray(p) || p.length !== 2 || !p.every((n) => Number.isFinite(Number(n)))) return bad("chase path points are [x, y] pairs");
            }
            const spec = {
                kind: "chase", target: isNpc ? Number(t) : t,
                path: s.path.map((p) => [num(p[0]), num(p[1])]),
                speed: Number.isFinite(Number(s.speed)) && Number(s.speed) > 0 ? Number(s.speed) : 130,
                lose: Number.isFinite(Number(s.lose)) && Number(s.lose) > 0 ? Number(s.lose) : 90,
            };
            if (s.frames != null) {
                const frames = num(s.frames, 0);
                if (!(frames >= 1)) return bad("chase frames is a time limit in frames");
                spec.frames = frames;
            }
            // the camera belongs on the player for the whole run, whatever an earlier pan was doing
            opcodes.push(`FN6A 1 ${playerId}`);
            event(spec);
        } else if ("ghost" in s) {
            // a character drawn faded and tinted for the rest of the scene (a memory replay)
            const t = s.ghost;
            const who = t === "player" ? "player" : Number(t);
            if (!(who === "player" || Number.isFinite(who))) return bad('ghost needs a character id or "player"');
            const spec = { kind: "ghost", npc: who };
            if (s.off === true) {
                spec.off = true;
            } else {
                if (s.alpha != null && !(Number.isFinite(Number(s.alpha)) && Number(s.alpha) >= 0 && Number(s.alpha) <= 1)) return bad("ghost alpha is 0 to 1");
                spec.alpha = s.alpha == null ? 0.5 : clamp01(Number(s.alpha));
                if (s.tint != null) {
                    if (typeof s.tint !== "string" || !/^#[0-9a-fA-F]{6}$/.test(s.tint)) return bad("ghost tint is a #rrggbb colour");
                    spec.tint = s.tint;
                }
            }
            event(spec);
        } else if ("warp" in s) {
            const w = s.warp, spec = { kind: "warp" };
            if (typeof w === "string" || typeof w === "number") spec.to = w;
            else if (w && typeof w === "object") {
                spec.to = w.map ?? w.to ?? w.screen ?? null;
                if (Array.isArray(w.at)) spec.at = [num(w.at[0]), num(w.at[1])];
                if (w.dir != null) spec.dir = num(w.dir, 0) & 7;
            }
            if (spec.to == null || spec.to === "") return bad("warp needs a map id or a screen id");
            if (typeof spec.to === "string" && Number.isFinite(Number(spec.to))) spec.to = Number(spec.to);
            if (!spec.at && Array.isArray(s.at)) spec.at = [num(s.at[0]), num(s.at[1])];
            if (!Array.isArray(spec.at) || spec.at.length !== 2) return bad("warp needs at: [x, y] on the new map");
            if (spec.dir == null && s.dir != null) spec.dir = num(s.dir, 0) & 7;
            event(spec);
        } else {
            bad(`unknown step ${JSON.stringify(Object.keys(s))}`);
        }
    });
    opcodes.push("END");
    return { opcodes, speech, events, errors };
}

/** Everyone a scene moves or speaks as (npc ids; "player" excluded): the caller checks they can be found on the map. */
export function castOf(steps) {
    const ids = new Set();
    for (const s of steps ?? []) {
        for (const k of ["walk", "arrive", "face", "put", "look", "say"]) {
            if (k in s && s[k] != null && !isPlayer(s[k]) && Number.isFinite(Number(s[k]))) ids.add(Number(s[k]));
        }
        // an effect or a camera pan may be placed or aimed relative to a character ("near": 27, { "pan": 27 })
        for (const near of [s.at?.near, s.pan && typeof s.pan === "object" ? s.pan.near : null]) {
            if (near != null && !isPlayer(near) && Number.isFinite(Number(near))) ids.add(Number(near));
        }
        if (s.pan != null && !isPlayer(s.pan) && typeof s.pan !== "object" && Number.isFinite(Number(s.pan))) ids.add(Number(s.pan));
        const n = s.to?.near;
        if (n != null && !isPlayer(n) && Number.isFinite(Number(n))) ids.add(Number(n));
        // a chase target or a ghosted character is drawn, so they must be on this map too
        for (const who of [s.chase, s.ghost]) {
            if (who != null && !isPlayer(who) && typeof who !== "string" && Number.isFinite(Number(who))) ids.add(Number(who));
        }
    }
    return [...ids];
}

/** Static check of a scene (no game needed): returns a list of problems, empty when it is well formed. */
export function validateScene(steps) {
    const { errors } = compileScene(steps, { pos: () => ({ x: 0, y: 0 }) });
    return errors;
}
