// Look C kit hygiene (web/ui-c): only our own CSS, JS and OFL fonts live there (the repo is public), nothing big, nothing from the network,
// and the overlay never imports a session, input or state module.
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join } from "node:path";

const DIR = new URL("../web/ui-c/", import.meta.url).pathname;
const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));
const files = walk(DIR);

test("ui-c holds only .css .js .ts .woff2 .txt files, none over 200 KB", () => {
    assert.ok(files.length >= 14, `${files.length} files`);
    for (const f of files) {
        assert.ok([".css", ".js", ".ts", ".woff2", ".txt"].includes(extname(f)), `${f} has a type that is not allowed`);
        assert.ok(statSync(f).size <= 200 * 1024, `${f} is over 200 KB`);
    }
});

test("no data URL, no image file, no network URL in the css", () => {
    for (const f of files.filter((x) => extname(x) === ".css")) {
        const s = readFileSync(f, "utf8");
        assert.doesNotMatch(s, /data:image/, f);
        assert.doesNotMatch(s, /https?:\/\//, f);
        for (const m of s.matchAll(/url\(\s*["']?([^"')]+)/g)) assert.doesNotMatch(m[1], /^(https?:|\/\/|data:)/, `${f}: ${m[1]}`);
    }
    for (const f of files.filter((x) => extname(x) === ".js")) assert.doesNotMatch(readFileSync(f, "utf8"), /data:image/, f);
});

test("the overlay imports only itself: no session, input, state or game module", () => {
    for (const f of files.filter((x) => extname(x) === ".js")) {
        const s = readFileSync(f, "utf8");
        for (const m of s.matchAll(/^\s*import\s[^;]*?from\s+["']([^"']+)["']/gm)) {
            assert.match(m[1], /^\.\/[a-z-]+\.js$/, `${f} imports ${m[1]}`);
        }
    }
});

test("both fonts are here with their OFL texts", () => {
    const names = readdirSync(join(DIR, "fonts"));
    for (const n of ["RussoOne-Regular.woff2", "ChakraPetch-Medium.woff2", "ChakraPetch-SemiBold.woff2", "ChakraPetch-Bold.woff2", "OFL-RussoOne.txt", "OFL-ChakraPetch.txt"]) {
        assert.ok(names.includes(n), n);
    }
    for (const n of ["OFL-RussoOne.txt", "OFL-ChakraPetch.txt"]) assert.match(readFileSync(join(DIR, "fonts", n), "utf8"), /SIL OPEN FONT LICENSE Version 1\.1/, n);
    for (const n of names.filter((x) => x.endsWith(".woff2"))) assert.equal(readFileSync(join(DIR, "fonts", n)).subarray(0, 4).toString("latin1"), "wOF2", `${n} is a woff2`);
});

test("the css loads the fonts from local relative files and is linked from index.html", () => {
    const t = readFileSync(join(DIR, "text.css"), "utf8");
    assert.equal([...t.matchAll(/@font-face/g)].length, 4);
    assert.equal([...t.matchAll(/font-display:\s*block/g)].length, 4);
    for (const m of t.matchAll(/url\("([^"]+)"\)/g)) assert.match(m[1], /^fonts\/[A-Za-z-]+\.woff2$/, m[1]);
    assert.match(readFileSync(new URL("../web/index.html", import.meta.url), "utf8"), /<link rel="stylesheet" href="ui-c\/ui-c\.css">/);
});
