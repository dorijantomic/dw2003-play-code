// The State Shelf: name a quest state, jump back to it, diff two in plain lines, undo.
//
// The quest layer keeps all of its progress in one stored key, "dw.quests.v1" (web/quests.js:26), and has no
// setter for the whole state -- a restore is "write the key, reload the page". This module is the pure part of that:
// the lab (web/quest-lab.js, opened with ?questlab=1) does the reading, writing and drawing. It touches nothing else:
// no story flag, no memory card, no game save.
//
// A snapshot is the shape web/quests.js freshState() returns (:60):
//   { v: 1, active: {}, done: {}, visited: [], met: [], duelWins: 0, announced: {}, seen: {}, triggers: {}, gen: {} }
// `done` values are numbers today (:159); an object with a numeric `at` (the Ledger's shape) is accepted too, and a
// `picks` map ({ pick, at } per quest) is accepted when a state carries one. Unknown extra keys are left alone: the
// quest layer's own loadState() only looks at the ones it knows.
//
// Pure: no DOM, no storage, no fs, no clock beyond the `at` stamp shelfAdd() writes.

const isObject = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const isNumber = (v) => typeof v === "number" && Number.isFinite(v);
const isName = (v) => typeof v === "string" && v.trim().length > 0;
const clone = (v) => JSON.parse(JSON.stringify(v));
const listOf = (v) => (Array.isArray(v) ? v : []);
const byName = (shelf, name) => listOf(shelf).find((x) => x?.name === name) ?? null;

/**
 * What is wrong with this snapshot, as plain strings (empty = good). Checks only what a restore would put back into
 * "dw.quests.v1": the version, the two records, the two lists, the duel count, the optional blocks, the done values
 * (a time, or an object with a numeric `at`) and the optional picks ({ pick, at } each). The first structural
 * problem ends the walk, so a state with a wrong version is one problem, not five.
 */
export function validateSnapshot(s) {
    if (!isObject(s)) return ["the state is not an object"];
    if (s.v !== 1) return [`state version ${JSON.stringify(s.v)} is not 1`];
    const problems = [];
    if (!isObject(s.active)) problems.push("active is not an object");
    if (!isObject(s.done)) problems.push("done is not an object");
    if (!Array.isArray(s.visited) || !s.visited.every((m) => typeof m === "string")) problems.push("visited is not a list of place ids");
    if (!Array.isArray(s.met) || !s.met.every((m) => typeof m === "string")) problems.push("met is not a list of npc@place keys");
    if (!isNumber(s.duelWins)) problems.push("duelWins is not a number");
    for (const key of ["announced", "seen", "triggers", "gen"]) {
        if (s[key] != null && !isObject(s[key])) problems.push(`${key} is not an object`);
    }
    if (isObject(s.done)) {
        for (const [id, v] of Object.entries(s.done)) {
            if (!isNumber(v) && !(isObject(v) && isNumber(v.at))) problems.push(`done ${id} is neither a time nor { at }`);
        }
    }
    if (s.picks != null) {
        if (!isObject(s.picks)) problems.push("picks is not an object");
        else for (const [id, p] of Object.entries(s.picks)) {
            if (!isObject(p) || !isNumber(p.pick) || !isNumber(p.at)) problems.push(`picks ${id} is not { pick, at }`);
        }
    }
    return problems;
}

/**
 * What changed from state `a` to state `b`, as ids and plain rows. `addedActive`/`removedActive`/`addedDone`/
 * `removedDone` are quest ids; `visitedAdded`/`visitedRemoved` are place ids; `metAdded` are npc@place keys;
 * `picksChanged` are quest ids whose `picks` value's `pick` differs. `rows` has one `{ kind, id, from, to }` per
 * change, in a fixed order (active, done, visited, met, picks): `from`/`to` are the records for active and done,
 * false/true for visited and met, and the two pick numbers for picks. A state with itself is all zeros.
 */
export function diffSnapshots(a, b) {
    const A = isObject(a) ? a : {}, B = isObject(b) ? b : {};
    const activeA = isObject(A.active) ? A.active : {}, activeB = isObject(B.active) ? B.active : {};
    const doneA = isObject(A.done) ? A.done : {}, doneB = isObject(B.done) ? B.done : {};
    const picksA = isObject(A.picks) ? A.picks : {}, picksB = isObject(B.picks) ? B.picks : {};
    const visitedA = listOf(A.visited), visitedB = listOf(B.visited);
    const metA = listOf(A.met), metB = listOf(B.met);
    const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

    const addedActive = Object.keys(activeB).filter((id) => !has(activeA, id));
    const removedActive = Object.keys(activeA).filter((id) => !has(activeB, id));
    const addedDone = Object.keys(doneB).filter((id) => !has(doneA, id));
    const removedDone = Object.keys(doneA).filter((id) => !has(doneB, id));
    const visitedAdded = visitedB.filter((m) => !visitedA.includes(m));
    const visitedRemoved = visitedA.filter((m) => !visitedB.includes(m));
    const metAdded = metB.filter((k) => !metA.includes(k));
    const picksChanged = Object.keys(picksB).filter((id) => has(picksA, id) && picksA[id]?.pick !== picksB[id]?.pick);

    const rows = [
        ...addedActive.map((id) => ({ kind: "active", id, from: null, to: activeB[id] })),
        ...removedActive.map((id) => ({ kind: "active", id, from: activeA[id], to: null })),
        ...addedDone.map((id) => ({ kind: "done", id, from: null, to: doneB[id] })),
        ...removedDone.map((id) => ({ kind: "done", id, from: doneA[id], to: null })),
        ...visitedAdded.map((id) => ({ kind: "visited", id, from: false, to: true })),
        ...visitedRemoved.map((id) => ({ kind: "visited", id, from: true, to: false })),
        ...metAdded.map((id) => ({ kind: "met", id, from: false, to: true })),
        ...picksChanged.map((id) => ({ kind: "picks", id, from: picksA[id].pick, to: picksB[id].pick })),
    ];
    return { addedActive, removedActive, addedDone, removedDone, visitedAdded, visitedRemoved, metAdded, picksChanged, rows };
}

/**
 * Put a snapshot on the shelf under a name. Returns `{ shelf, problems }`: the shelf is unchanged when the name is
 * empty, already on the shelf, or the snapshot has a shape problem (exactly the problem list validateSnapshot gives).
 * The snapshot is copied, so later play cannot change a saved state. `at` defaults to now.
 */
export function shelfAdd(shelf, name, snap, at = Date.now()) {
    const items = listOf(shelf);
    if (!isName(name)) return { shelf: items, problems: ["the name is empty"] };
    const clean = name.trim();
    if (byName(items, clean)) return { shelf: items, problems: [`"${clean}" is already on the shelf`] };
    const problems = validateSnapshot(snap);
    if (problems.length) return { shelf: items, problems };
    return { shelf: [...items, { name: clean, at, snap: clone(snap) }], problems: [] };
}

/** Rename one shelf item; same refusals as shelfAdd, and the snapshot and time are kept. */
export function shelfRename(shelf, from, to) {
    const items = listOf(shelf);
    const item = byName(items, from);
    if (!item) return { shelf: items, problems: [`no state named "${from}"`] };
    if (!isName(to)) return { shelf: items, problems: ["the new name is empty"] };
    const clean = to.trim();
    if (clean !== from && byName(items, clean)) return { shelf: items, problems: [`"${clean}" is already on the shelf`] };
    return { shelf: items.map((x) => (x === item ? { ...x, name: clean } : x)), problems: [] };
}

/** Drop one shelf item by name. */
export function shelfRemove(shelf, name) {
    const items = listOf(shelf);
    if (!byName(items, name)) return { shelf: items, problems: [`no state named "${name}"`] };
    return { shelf: items.filter((x) => x.name !== name), problems: [] };
}

/** The shelf as one versioned, JSON-ready object: `{ v: 1, items: [{ name, at, snap }] }`. */
export function shelfExport(shelf) {
    return { v: 1, items: listOf(shelf).map(({ name, at, snap }) => ({ name, at, snap: clone(snap) })) };
}

/**
 * Read a shelf back from shelfExport()'s shape (a JSON string or the object itself). Shape-checked, never a guess:
 * a bad root, an unknown version, a bad item, a repeated name or a bad snapshot refuses the WHOLE import and returns
 * `{ shelf: null, problems }`. A good one returns `{ shelf, problems: [] }`.
 */
export function shelfImport(json) {
    let root = json;
    if (typeof json === "string") {
        try { root = JSON.parse(json); } catch { return { shelf: null, problems: ["the text is not JSON"] }; }
    }
    if (!isObject(root)) return { shelf: null, problems: ["the shelf is not an object"] };
    if (root.v !== 1) return { shelf: null, problems: [`shelf version ${JSON.stringify(root.v)} is not 1`] };
    if (!Array.isArray(root.items)) return { shelf: null, problems: ["items is not a list"] };

    const problems = [], seen = new Set(), shelf = [];
    root.items.forEach((item, i) => {
        const where = `item ${i + 1}`;
        if (!isObject(item)) { problems.push(`${where} is not an object`); return; }
        if (!isName(item.name)) { problems.push(`${where} has no name`); return; }
        const name = item.name.trim();
        if (seen.has(name)) { problems.push(`${where} repeats the name "${name}"`); return; }
        seen.add(name);
        if (!isNumber(item.at)) problems.push(`${where} has no time`);
        const bad = validateSnapshot(item.snap);
        if (bad.length) { problems.push(...bad.map((p) => `${where}: ${p}`)); return; }
        shelf.push({ name, at: item.at, snap: clone(item.snap) });
    });
    return problems.length ? { shelf: null, problems } : { shelf, problems: [] };
}
