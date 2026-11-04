// Every Ending: one page per job, every way it can go.
//
// A reader, not a rule: it runs nowhere in the game and changes nothing. Given one quest definition from
// web/quests.json it lists every branch a player can take and the exact words and numbers behind it -- accept or
// decline, every other question's answers, every hand-in choice with its pay and after lines, a lost chase, a lost
// fight, and a job with no closing words. The CLI in tools/quest_endings.mjs prints the pages; web/quest-lab.js puts
// one on the lab's own message bar.
//
// The rules it follows, read from web/quests.js (not changed by this file):
//   * the offer (:427-440): the scene's ask; answer 0 accepts, any other answer declines, and a declined offer is
//     not made again until the page reloads;
//   * reporting a finished job (:410-422): the hand-in scene, then `verdict` -> claim -> verdict.after[pick];
//   * claim (:151-173): the base `reward` plus `verdict.pay[pick]`, bits and items each;
//   * chaseLost (:378): a scene whose answer is 1 and that holds a chase keeps its step open (the rest of the
//     scene does not play, and the step waits for another talk);
//   * perform (:364-371): a lost fight (`failed`) ends the scene at the title screen, so nothing it would pay is
//     paid.
//
// Pure: no DOM and no fs (the CLI does the reading and the printing, the lab does the drawing). The words in a row
// are the data's own; where a branch has no words at all the row says that in plain tool words.
import { paginate } from "./dialogue-pack.js";

const DEFAULT_ASK = "Take the job?";                       // web/quests.js:433
const DEFAULT_OPTIONS = ["I will do it", "Not now"];       // web/quests.js:433
/** data/authored/quests/dsl.py:497-498 refuses a verdict option longer than this. */
export const VERDICT_OPTION_MAX = 28;
const CHASE_LOST = "the chase is lost; the rest of the scene does not play";   // web/quests.js:378

const isStep = (s) => !!s && typeof s === "object" && !Array.isArray(s);
const isAskStep = (s) => isStep(s) && "ask" in s && Array.isArray(s.options) && s.options.length > 0;
const isChaseStep = (s) => isStep(s) && "chase" in s;
const isBattleStep = (s) => isStep(s) && "battle" in s;
const sayLines = (steps) => (Array.isArray(steps) ? steps : [])
    .filter((s) => isStep(s) && "say" in s && typeof s.text === "string" && s.text.trim())
    .map((s) => s.text);
const payOf = (rw) => ({ bits: Math.max(0, Number(rw?.bits) || 0), items: Array.isArray(rw?.items) ? rw.items : [] });
const itemsText = (items) => items.map((it) => `${it?.count ?? 1} x ${it?.name ?? "?"}`);
const payText = (pay) => [pay.bits ? `${pay.bits} BIT` : "", ...itemsText(pay.items)].filter(Boolean).join(", ") || "nothing";
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/**
 * Every scene a def can play, in play order, with the slot name tools/scene_readback.mjs also uses:
 * offer, accept, done, turnin and objective-<n>. Only slots that actually hold steps are returned.
 */
function sceneSlots(def) {
    const out = [];
    const push = (slot, steps) => { if (Array.isArray(steps) && steps.length) out.push({ slot, steps }); };
    push("offer", def?.offer?.scene);
    push("accept", def?.acceptScene);
    push("done", def?.doneScene);
    push("turnin", def?.turnIn?.scene);
    (def?.objectives ?? []).forEach((o, i) => push(`objective-${i}`, o?.scene));
    return out;
}

/** The two offer rows: the scene's own ask and its two answers; when there is no scene, the ask happens at runtime. */
function offerRows(def) {
    if (!def?.offer) return { rows: [], skipAsk: null };
    const scene = sceneSlots(def).find((x) => x.slot === "offer") ?? null;
    // the scene's answer is the last ask answered (web/game.js playQuestScene: `answer = i` on every ask)
    const askIndexes = (scene?.steps ?? []).map((s, i) => (isAskStep(s) ? i : -1)).filter((i) => i >= 0);
    const pick = askIndexes.length ? askIndexes[askIndexes.length - 1] : -1;
    const askStep = pick >= 0 ? scene.steps[pick] : null;
    const ask = String(askStep?.ask ?? def.offer.ask ?? DEFAULT_ASK);
    const options = askStep?.options?.length ? askStep.options : DEFAULT_OPTIONS;
    const accept = String(options[0] ?? DEFAULT_OPTIONS[0]);
    const decline = String(options[1] ?? DEFAULT_OPTIONS[1]);
    const after = sayLines(def.acceptScene);
    const where = askStep ? "asked in the offer scene" : "asked at runtime";
    return {
        rows: [
            {
                kind: "offer", slot: "offer", choice: accept, lines: [ask, ...after], pay: null,
                note: after.length ? `${where}; then the accept scene's ${plural(after.length, "line", "lines")}` : where,
            },
            { kind: "offer", slot: "offer", choice: decline, lines: [ask], pay: null, note: `${where}; the offer closes until reload` },
        ],
        skipAsk: askStep ? { slot: "offer", index: pick } : null,
    };
}

/** Every other ask step: one row per option, with the question it answers. */
function askRows(def, skipAsk) {
    const rows = [];
    for (const { slot, steps } of sceneSlots(def)) {
        const chase = steps.some(isChaseStep);
        steps.forEach((step, index) => {
            if (!isAskStep(step)) return;
            if (skipAsk && skipAsk.slot === slot && skipAsk.index === index) return;
            const ask = String(step.ask ?? DEFAULT_ASK);
            step.options.forEach((option, i) => {
                rows.push({
                    kind: "ask", slot, choice: String(option), lines: [ask], pay: null,
                    note: chase && i === 1 ? CHASE_LOST : "spoken; changes nothing",
                });
            });
        });
    }
    return rows;
}

/** One row per hand-in option: the words after it and the whole pay (base reward plus this option's own pay). */
function verdictRows(def) {
    const v = def?.verdict;
    if (!v || !Array.isArray(v.options) || !v.options.length) return [];
    const base = payOf(def.reward);
    const pays = Array.isArray(v.pay) ? v.pay : [];
    const after = Array.isArray(v.after) ? v.after : [];
    return v.options.map((option, i) => {
        const own = payOf(pays[i]);
        const pay = { bits: base.bits + own.bits, items: [...base.items, ...own.items] };
        const lines = Array.isArray(after[i]) ? after[i].map(String) : [];
        const pages = paginate(lines.join("\n\n")).length;
        return {
            kind: "verdict", slot: "verdict", choice: String(option), lines, pay,
            note: lines.length
                ? `${plural(lines.length, "line", "lines")}, ${plural(pages, "page", "pages")} in the box`
                : "no after lines",
        };
    });
}

/** A scene with a chase: kept up, or lost (the rest of the scene does not play). */
function chaseRows(def) {
    const rows = [];
    for (const { slot, steps } of sceneSlots(def)) {
        steps.forEach((step, index) => {
            if (!isChaseStep(step)) return;
            const after = sayLines(steps.slice(index + 1));
            rows.push({ kind: "chase", slot, choice: "kept up", lines: after.length ? after : ["The scene goes on."], pay: null, note: after.length ? "" : "no words follow the chase" });
            rows.push({ kind: "chase", slot, choice: "lost", lines: ["The rest of the scene does not play."], pay: null, note: `${CHASE_LOST}; talk again to retake it` });
        });
    }
    return rows;
}

/** A scene with a battle: a win or a flee go on, a loss ends the scene at the title. */
function battleRows(def) {
    const rows = [];
    for (const { slot, steps } of sceneSlots(def)) {
        steps.forEach((step, index) => {
            if (!isBattleStep(step)) return;
            const after = sayLines(steps.slice(index + 1));
            rows.push({ kind: "battle", slot, choice: "win or flee", lines: after.length ? after : ["The scene goes on."], pay: null, note: "a win and a flee both go on" });
            rows.push({ kind: "battle", slot, choice: "loss", lines: ["The scene ends at the title screen."], pay: null, note: "the scene ends at the title" });
        });
    }
    return rows;
}

/** The warning row the rejected Ending Card owned: a job that has neither a hand-in scene nor hand-in lines. */
function closingRow(def) {
    if (!def) return null;
    if (Array.isArray(def.doneScene) && def.doneScene.length) return null;
    const ref = def.turnIn ?? def.offer ?? null;
    if (Array.isArray(ref?.doneLines) && ref.doneLines.length) return null;
    const note = "no closing words; the hand-in ends on the toast";
    return { kind: "closing", slot: "done", choice: null, lines: [note], pay: null, note };
}

/** A job no character hands out: the quest log (or an acceptAt place) takes it. */
function noGiverRow(def) {
    if (!def || def.offer) return null;
    const places = Array.isArray(def.acceptAt) && def.acceptAt.length ? `taken from ${def.acceptAt.join(", ")}` : "taken from the quest log";
    const note = `no giver; ${places}`;
    return { kind: "nogiver", slot: "offer", choice: null, lines: [note], pay: null, note };
}

/**
 * Every way this quest can go, as rows `{ kind, slot, choice, lines, pay, note }`.
 * kind is one of offer, ask, verdict, chase, battle, closing, nogiver; slot is the scene it lives in
 * (offer, accept, done, turnin, objective-<n>), or "verdict"/"done"/"offer" for the hand-in and its warnings.
 * `lines` are the exact words the player hears on that way (never empty: a branch with no words says so);
 * `pay` is the whole pay of a verdict row, `{ bits, items }`; `note` is the plain fact about the way.
 */
export function endingsOf(def) {
    if (!def || typeof def !== "object") return [];
    const rows = [];
    const noGiver = noGiverRow(def);
    if (noGiver) rows.push(noGiver);
    const offer = offerRows(def);
    rows.push(...offer.rows, ...askRows(def, offer.skipAsk), ...chaseRows(def), ...battleRows(def), ...verdictRows(def));
    const closing = closingRow(def);
    if (closing) rows.push(closing);
    return rows;
}

/**
 * The shape problems tools/check_quests.py does not catch: a verdict whose after list is empty, a pay with no
 * items and no bits, an ask with fewer than 2 options, a verdict option over 28 characters, and a job with no
 * closing words (that last one is informational: the data has twelve, and the tool says so but does not fail).
 * Returns plain strings, like web/quest-readback.js's problems.
 */
export function endingsProblem(def) {
    if (!def || typeof def !== "object") return ["no quest definition"];
    const problems = [];
    const v = def.verdict;
    if (v) {
        const options = Array.isArray(v.options) ? v.options : [];
        const after = Array.isArray(v.after) ? v.after : [];
        const missing = options.map((_, i) => i).filter((i) => !Array.isArray(after[i]) || !after[i].length);
        if (missing.length) {
            problems.push(missing.length === 1
                ? `verdict: option ${missing[0] + 1} has no after lines`
                : `verdict: options ${missing.map((i) => i + 1).join(", ")} have no after lines`);
        }
        const pays = Array.isArray(v.pay) ? v.pay : [];
        options.forEach((_, i) => {
            const p = pays[i];
            if (!p || (!p.bits && !(Array.isArray(p.items) && p.items.length))) problems.push(`verdict: pay ${i + 1} has no bits and no items`);
        });
        options.forEach((o, i) => {
            if (String(o).length > VERDICT_OPTION_MAX) problems.push(`verdict: option ${i + 1} is ${String(o).length} characters (the limit is ${VERDICT_OPTION_MAX})`);
        });
    }
    for (const { slot, steps } of sceneSlots(def)) {
        steps.forEach((s, i) => {
            if (isStep(s) && "ask" in s && (!Array.isArray(s.options) || s.options.length < 2)) problems.push(`${slot}: ask step ${i + 1} has fewer than 2 options`);
        });
    }
    if (closingRow(def)) problems.push("no closing words; the hand-in ends on the toast (informational)");
    return problems;
}

/**
 * Totals over any list of definitions, computed from the definitions themselves (never a constant):
 * `{ quests, offers, askSteps, askRows, verdicts, verdictRows, choicePoints, optionRows, chases, battles, closingless }`.
 * choicePoints counts every question put to the player (an ask step or a verdict); optionRows counts every spoken
 * answer to one (the offer's own yes/no is its two offer rows, but it is still one ask step with two options).
 */
export function endingsTable(defs) {
    const t = { quests: 0, offers: 0, askSteps: 0, askRows: 0, verdicts: 0, verdictRows: 0, choicePoints: 0, optionRows: 0, chases: 0, battles: 0, closingless: 0 };
    for (const def of Array.isArray(defs) ? defs : []) {
        t.quests++;
        if (def?.offer) t.offers++;
        for (const { steps } of sceneSlots(def)) {
            for (const s of steps) {
                if (isAskStep(s)) { t.askSteps++; t.askRows += s.options.length; }
                if (isChaseStep(s)) t.chases++;
                if (isBattleStep(s)) t.battles++;
            }
        }
        if (def?.verdict && Array.isArray(def.verdict.options)) { t.verdicts++; t.verdictRows += def.verdict.options.length; }
        if (closingRow(def)) t.closingless++;
    }
    t.choicePoints = t.askSteps + t.verdicts;
    t.optionRows = t.askRows + t.verdictRows;
    return t;
}

/**
 * One plain page for one quest (or a markdown one with `{ markdown: true }`): a heading, one line per row, and
 * that row's own words under it. This is the same text the CLI prints and the lab shows.
 */
export function endingsBlock(def, opts = {}) {
    const md = opts.markdown === true;
    const rows = endingsOf(def);
    const problems = endingsProblem(def);
    const title = `## ${def?.id ?? "?"}  ${def?.title ?? ""}`.trim();
    const wordsOf = (row) => (row.lines.length === 1 && row.lines[0] === row.note ? [] : row.lines);
    const out = [title];
    if (md) {
        out.push("", "| kind | slot | choice | pay | note |", "| --- | --- | --- | --- | --- |");
        for (const row of rows) {
            out.push(`| ${row.kind} | ${row.slot} | ${row.choice == null ? "-" : row.choice.replace(/\|/g, "\\|")} | ${row.pay ? payText(row.pay) : ""} | ${row.note.replace(/\|/g, "\\|")} |`);
        }
        for (const row of rows) {
            const words = wordsOf(row);
            if (!words.length) continue;
            out.push("", `**${row.kind} · ${row.choice ?? row.slot}**`, "");
            for (const line of words) out.push(`- ${line}`);
        }
    } else {
        const width = Math.max(...rows.map((r) => r.kind.length), 6);
        const slotWidth = Math.max(...rows.map((r) => r.slot.length), 6);
        for (const row of rows) {
            const choice = row.choice == null ? "-" : JSON.stringify(row.choice);
            const pay = row.pay ? `  pay ${payText(row.pay)}` : "";
            const note = row.note ? `  - ${row.note}` : "";
            out.push(`${row.kind.padEnd(width)}  ${row.slot.padEnd(slotWidth)}  ${choice}${pay}${note}`);
            for (const line of wordsOf(row)) out.push(`    ${line}`);
        }
        if (!rows.length) out.push("(no scenes, no choices)");
    }
    if (problems.length && opts.problems !== false) {
        out.push("", "problems:");
        for (const problem of problems) out.push(`- ${problem}`);
    }
    return out.join("\n");
}
