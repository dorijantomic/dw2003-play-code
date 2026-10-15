// Scripted scenes for the extra quests: data in, the game's own cutscene commands out.
//
// A scene is a list of steps in quests.json (nothing here is code a quest author has to touch):
//
//   { "walk": 27, "to": [900, 400], "face": 2 }   an NPC (its npc_id from the scene files) walks there; keeps going while
//                                                 the next steps run, so two walks side by side move together
//   { "walk": 27, "to": "origin" }                back to where they stood when the scene began
//   { "walk": 27, "to": { "near": "player", "dx": -40, "dy": 10 } }   walk to a place relative to someone (or "player"), so a
//                                                 scene works wherever the player happens to be standing
//   { "walk": "player", "to": [x, y] }            the player walks (the party follows as in any cutscene)
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
// compileScene() is pure: it returns the cutscene opcode strings the game's script VM (engine/systems/cutscene-manager.ts)
// runs, plus the speech table the VM's after-say hooks read. Walking, facing and the camera are therefore the same code the
// story cutscenes use. The only new thing is that the words come from the quest, not from the disc's esdmg files.

const isPlayer = (w) => w === "player";
const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Math.round(Number(v)) : d);
// the game's facing index (cutscene-manager DIR8); a scene may write the name instead
const DIRS = ["down", "down-left", "left", "up-left", "up", "up-right", "right", "down-right"];
const facing = (v) => (typeof v === "string" && DIRS.includes(v) ? DIRS.indexOf(v) : v == null ? null : num(v, 0) & 7);

/**
 * @param steps      the scene's steps (see above)
 * @param opts.playerId  the script id the player answers to in this scene (cutscene.playerActorId: 1 or 2)
 * @param opts.pos       (actorId) -> { x, y } | null, the current place of a character (for "face" and for safe defaults)
 * @returns { opcodes, speech, errors }  speech[n] = { who, name, text } for the SAY opcode numbered n
 */
export function compileScene(steps, opts = {}) {
    const playerId = opts.playerId ?? 2;
    const idOf = (w) => (isPlayer(w) ? playerId : Number(w));
    const opcodes = [], speech = {}, errors = [];
    let say = 0;
    if (!Array.isArray(steps) || !steps.length) return { opcodes: ["END"], speech, errors: ["a scene needs at least one step"] };
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
                to = [p.x + num(to.dx, 0), p.y + num(to.dy, 0)];
            }
            if (!Array.isArray(to) || to.length !== 2) return bad("walk needs to: [x, y] or { near, dx, dy }");
            // without "face" the character keeps looking the way they walked
            const f = facing(s.face);
            opcodes.push(`WALKTO ${idOf(s.walk)} ${num(to[0])} ${num(to[1])}${f == null ? "" : " " + f}`);
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
            // reserved: hosts may map it; the VM ignores unknown opcodes
        } else {
            bad(`unknown step ${JSON.stringify(Object.keys(s))}`);
        }
    });
    opcodes.push("END");
    return { opcodes, speech, errors };
}

/** Everyone a scene moves or speaks as (npc ids; "player" excluded): the caller checks they can be found on the map. */
export function castOf(steps) {
    const ids = new Set();
    for (const s of steps ?? []) {
        for (const k of ["walk", "arrive", "face", "put", "look", "say"]) {
            if (k in s && s[k] != null && !isPlayer(s[k]) && Number.isFinite(Number(s[k]))) ids.add(Number(s[k]));
        }
        const n = s.to?.near;
        if (n != null && !isPlayer(n) && Number.isFinite(Number(n))) ids.add(Number(n));
    }
    return [...ids];
}

/** Static check of a scene (no game needed): returns a list of problems, empty when it is well formed. */
export function validateScene(steps) {
    const { errors } = compileScene(steps, { pos: () => ({ x: 0, y: 0 }) });
    return errors;
}
