// check_sound_coverage.mjs — the Silence Report's numbers, printed from the shipped tables.
//
// The page (web/silence-report.html) tells a player what this build cannot sound;
// this printer says the same nine numbers in one line each, so a person or a
// script can read the jaw without a browser. It reads only web/assets/*, prints,
// and writes nothing:
//
//   node tools/check_sound_coverage.mjs          one labelled line per number
//   node tools/check_sound_coverage.mjs --json   the whole report as JSON
//
// exit 0 on today's tree. The numbers are computed by web/silence-report.js — the
// same code the page draws from — never typed in here.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
    altGaps, bankGaps, coverage, movieGaps, themeGaps,
    MOVIE_GAP_ROWS, START_WORDS,
} from "../web/silence-report.js";

const ROOT = path.resolve(import.meta.dirname, "..");
const readJSON = (file) => JSON.parse(fs.readFileSync(file, "utf8"));

/** The seven shipped tables the report is computed from. */
export function loadShipped(root = ROOT) {
    const assets = (...p) => path.join(root, "web/assets", ...p);
    const catalogue = readJSON(assets("data/soundtst_catalogue.json"));
    const common = readJSON(assets("sfx/manifest.json"));
    const area = readJSON(assets("sfx/area_manifest.json"));
    const stems = readJSON(assets("music/index.json"));
    const archives = readJSON(assets("data/map_sound_archives.json"));
    const movies = readJSON(assets("movie/manifest.json")).movies;
    const manifest = readJSON(assets("manifest.json"));
    return { catalogue, common, area, stems, archives, movies, maps: manifest.maps ?? manifest };
}

/** The whole report: the counts, the lists behind them, and the lines to print. */
export function soundCoverageReport({ catalogue, common, area, stems, archives, movies, maps }) {
    const cov = coverage({ catalogue, common, area, stems, startWords: START_WORDS });
    const banks = bankGaps(archives, area, catalogue);
    const themes = themeGaps(archives, maps);
    const film = movieGaps(MOVIE_GAP_ROWS, movies);
    const alts = altGaps(archives, catalogue, stems);
    const report = {
        rows: cov.rows,
        sample: cov.sample,
        stem: cov.stem,
        bankTheme: cov.bankTheme,
        silent: cov.silent.length,
        silentRows: cov.silent.map((row) => ({ category: row.category, name: row.name, id: row.id, fires: row.fires })),
        themeRows: cov.themes.map((row) => ({ category: row.category, name: row.name, id: row.id, stem: row.stem })),
        noBankCategories: banks.count,
        noBankNames: banks.missing,
        stageBanks: banks.stageCount,
        stageBankNames: banks.stageBanks,
        noThemeMaps: themes.length,
        noThemeNames: themes,
        missingMovieRows: film.missing.length,
        missingMovies: film.missing,
        movieVariants: film.variants,
        alternatePlays: alts.count,
        alternateStems: alts.byStem,
        lines: [
            `rows ${cov.rows}`,
            `sample ${cov.sample}`,
            `stem ${cov.stem}`,
            `bank-theme ${cov.bankTheme}`,
            `silent ${cov.silent.length}`,
            `no-bank categories ${banks.count}`,
            `unbuilt stage banks ${banks.stageCount}`,
            `no-theme maps ${themes.length}`,
            `missing movie rows ${film.missing.length}`,
        ],
    };
    return report;
}

function main() {
    const report = soundCoverageReport(loadShipped());
    if (process.argv.includes("--json")) {
        console.log(JSON.stringify(report, null, 1));
        return;
    }
    for (const line of report.lines) console.log(line);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
