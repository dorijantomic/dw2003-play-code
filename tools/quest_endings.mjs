#!/usr/bin/env node
// Every Ending: print one page per job, every way it can go -- the offers, the other questions' answers, the
// hand-in choices with their pay and after lines, a lost chase, a lost fight, a job with no closing words.
// Reads web/quests.json (and data/authored/quests/shipped.txt for --shipped); prints text and writes nothing.
//
//   node tools/quest_endings.mjs --quest <id> | --all | --shipped [--json] [--markdown] [--root <dir>]
//
// Exits 1 when a printed definition has a real shape problem (an empty after list, a pay with nothing in it, an ask
// with one option, a verdict option over 28 characters); the "no closing words" warning is informational and does
// not fail. The blocks are printed before the exit code, so a failing run can still be read.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { endingsOf, endingsProblem, endingsTable, endingsBlock } from "../web/quest-endings.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const opt = (name, fallback = null) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 && argv[i + 1] != null && !argv[i + 1].startsWith("--") ? argv[i + 1] : fallback;
};
const flag = (name) => argv.includes(`--${name}`);

/** A message for the person, not a stack trace. */
class CliError extends Error {}
const fail = (message) => { throw new CliError(message); };

const root = path.resolve(opt("root", path.join(HERE, "..")));
const readJSON = (rel) => JSON.parse(fs.readFileSync(path.join(root, rel), "utf8"));
const isInfo = (problem) => /\(informational\)/.test(problem);

/** The one-line header over every page: the same totals web/quest-endings.js computes. */
function summary(t) {
    const one = (n, singular, plural) => `${n} ${n === 1 ? singular : plural}`;
    return `${one(t.quests, "quest", "quests")}: ${one(t.offers, "offer", "offers")}, `
        + `${one(t.askSteps, "ask step", "ask steps")} (${one(t.askRows, "option", "options")}), `
        + `${one(t.verdicts, "verdict", "verdicts")} (${one(t.verdictRows, "option", "options")}), `
        + `${one(t.choicePoints, "choice point", "choice points")}, ${one(t.optionRows, "option row", "option rows")}, `
        + `${one(t.chases, "chase", "chases")}, ${one(t.battles, "battle", "battles")}, ${t.closingless} with no closing words`;
}

function pick(defs) {
    const id = opt("quest");
    if (id) {
        const one = defs.find((d) => d.id === id);
        if (!one) fail(`unknown quest "${id}"`);
        return [one];
    }
    if (flag("shipped")) {
        const file = path.join(root, "data/authored/quests/shipped.txt");
        let text;
        try { text = fs.readFileSync(file, "utf8"); } catch (e) { fail(`cannot read ${file}: ${e.message}`); }
        const ids = new Set(text.split("\n").map((s) => s.trim()).filter((s) => s && !s.startsWith("#")));
        return defs.filter((d) => ids.has(d.id));
    }
    return defs;
}

function main() {
    if (!opt("quest") && !flag("all") && !flag("shipped")) {
        fail("usage: quest_endings.mjs --quest <id> | --all | --shipped [--json] [--markdown] [--root <dir>]");
    }
    const data = readJSON("web/quests.json");
    const defs = Array.isArray(data.quests) ? data.quests : [];
    const picked = pick(defs);
    const problems = picked.flatMap((d) => endingsProblem(d).map((p) => `${d.id}: ${p}`));
    const md = flag("markdown");

    if (flag("json")) {
        console.log(JSON.stringify({
            totals: endingsTable(picked),
            quests: picked.map((d) => ({ id: d.id, title: d.title ?? "", rows: endingsOf(d), problems: endingsProblem(d) })),
            problems,
        }, null, 2));
    } else {
        const totals = endingsTable(picked);
        console.log(`# Every Ending - ${summary(totals)}`);
        const noGiver = picked.filter((d) => !d.offer).map((d) => d.id);
        if (noGiver.length) console.log(`\nno giver: ${noGiver.join(", ")}`);
        for (const d of picked) console.log(`\n${endingsBlock(d, { markdown: md, problems: false })}`);
        if (problems.length) {
            console.log("\nproblems:");
            for (const problem of problems) console.log(`- ${problem}`);
        }
    }
    return problems.some((p) => !isInfo(p)) ? 1 : 0;
}

try {
    process.exitCode = main();
} catch (e) {
    if (!(e instanceof CliError)) throw e;
    console.error(e.message);
    process.exitCode = 1;
}
