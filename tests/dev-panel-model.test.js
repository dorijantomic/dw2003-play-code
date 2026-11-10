// The F2 page's model (web/dev-panel-model.js): every FX key once, with a plain line; search and filter; counts.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
    DEV_TABS, DEV_ROWS, DEV_OPEN, DEV_FILTERS, rowFor, rowsOfTab, tabCounts, matchesQuery, selectRows, groupRows,
} from "../web/dev-panel-model.js";
import { shipClass, SHIP } from "../web/ship-list.js";

const SRC = readFileSync(new URL("../web/ambience.js", import.meta.url), "utf8");
const BLOCK = SRC.match(/export const FX_GROUPS = \[([\s\S]*?)\n\];/)[1];
const FX_KEYS = [...BLOCK.matchAll(/\["(\w+)", "[^"]*"\]/g)].map((m) => m[1]);

test("all 100 FX_DEFS keys are present exactly once", () => {
    assert.equal(FX_KEYS.length, 100);
    assert.equal(new Set(FX_KEYS).size, 100);
    const keys = DEV_ROWS.map((r) => r.key);
    assert.equal(keys.length, 100);
    assert.deepEqual([...keys].sort(), [...FX_KEYS].sort());
});

test("every row has a name, a sub-heading, a known tab and a plain non-empty line", () => {
    const tabs = new Set(DEV_TABS.map((t) => t.id));
    for (const r of DEV_ROWS) {
        assert.ok(tabs.has(r.tab), r.key + " tab");
        assert.ok(r.name.trim().length > 1, r.key + " name");
        assert.ok(r.sub.trim().length > 1, r.key + " sub");
        assert.ok(r.why.trim().length > 8, r.key + " explanation");
        assert.ok(!/0x[0-9a-f]+/i.test(r.why), r.key + " no hex");
    }
});

test("the tabs and sub-headings are the agreed ones", () => {
    assert.deepEqual(DEV_TABS.map((t) => t.name), ["World", "Quests", "Battle", "Online", "Info pages", "Test tools", "Controls"]);
    const subs = (tab) => [...new Set(rowsOfTab(tab).map((r) => r.sub))];
    assert.deepEqual(subs("world"), ["Terrain", "Weather", "Atmosphere", "Life", "Ground", "Sound", "Screen", "Menus"]);
    assert.deepEqual(subs("battle"), ["Bosses", "Ideas", "Pace", "Motion", "Look"]);
    const keysOf = (tab, sub) => rowsOfTab(tab).filter((r) => r.sub === sub).map((r) => r.key);
    assert.deepEqual(keysOf("world", "Screen"), ["widefield", "uisharp"]);
    assert.deepEqual(keysOf("world", "Menus"), ["glossary", "options"]);
    assert.deepEqual(rowsOfTab("quests").map((r) => r.key), ["quests", "questtriggers", "questemotes", "questplacecard", "questsecondjob", "mount", "mountseat"]);
    assert.deepEqual(keysOf("battle", "Bosses"), ["fusionbosses", "bossphases", "bossmusic", "bossgrows"]);
    assert.deepEqual(keysOf("battle", "Ideas"), ["giantmode", "fieldwar", "omen", "practice2v2", "enemytells", "aishift"]);
    assert.deepEqual(keysOf("battle", "Pace"), ["battlespeed", "encounterdial"]);
    assert.deepEqual(keysOf("battle", "Motion"), ["ownclips", "dw2motion", "smoothanim"]);
    assert.deepEqual(keysOf("battle", "Look"), ["battlewide", "smartcam", "battleatmos", "battlepano", "toonoutline", "toonshade", "softalpha", "hd2d"]);
    assert.deepEqual(rowsOfTab("online").map((r) => r.key), ["mpbubbles", "mpcredit", "serverchamp", "chatqueue"]);
    assert.equal(rowsOfTab("info").length, 10);
    assert.equal(rowsOfTab("test").length, 13);
    assert.equal(rowsOfTab("controls").length, 0);
});

test("the confirmed explanations say what the owner confirmed", () => {
    assert.match(rowFor("aishift").why, /one turn early/);
    assert.match(rowFor("enemytells").why, /countdown/);
    assert.match(rowFor("omen").why, /wild fight is close/);
    assert.match(rowFor("questplacecard").why, /blue place-name card/);
    assert.match(rowFor("seam").why, /effects meet the map picture/);
    assert.match(rowFor("chatqueue").why, /before joining a room/);
});

test("DEV_OPEN: only keys that exist, extra or a page; the six in-game screens use __openExtra", () => {
    for (const [k, o] of Object.entries(DEV_OPEN)) {
        assert.ok(rowFor(k), k);
        assert.ok(o.extra === true || /\.html$/.test(o.href), k);
    }
    assert.deepEqual(Object.keys(DEV_OPEN).filter((k) => DEV_OPEN[k].extra).sort(), ["blastladder", "cutcontent", "damagelab", "planner", "replay", "soundtest"]);
    assert.equal(Object.keys(DEV_OPEN).length, 20);
});

test("tabCounts counts switches that are on", () => {
    const none = tabCounts({});
    assert.equal(none.online.on, 0); assert.equal(none.online.total, 4); assert.equal(none.world.total, 43);
    const all = Object.fromEntries(DEV_ROWS.map((r) => [r.key, true]));
    const c = tabCounts(all);
    for (const t of DEV_TABS) assert.equal(c[t.id].on, c[t.id].total);
    assert.equal(tabCounts({ mpbubbles: true, chatqueue: true, rain: 0 }).online.on, 2);
    assert.equal(tabCounts({ rain: false }).world.on, 0);
    assert.equal(tabCounts(null).world.on, 0);
});

test("search: every word must match the name or the explanation, any case; no words = all", () => {
    const r = rowFor("rain");
    assert.ok(matchesQuery(r, ""));
    assert.ok(matchesQuery(r, "  RAIN "));
    assert.ok(matchesQuery(r, "falls maps"));
    assert.ok(!matchesQuery(r, "rain banana"));
    const hits = selectRows({ tab: "world", query: "wild fight" }).map((x) => x.key);
    assert.ok(hits.includes("omen") && hits.includes("practice2v2"), "search crosses tabs");
    assert.ok(!selectRows({ query: "zzzzqq" }).length);
    assert.ok(!selectRows({ query: "mpbubbles" }).length, "the key itself is not searched, only name and explanation");
});

test("tab view lists only that tab, in file order", () => {
    assert.deepEqual(selectRows({ tab: "online" }).map((r) => r.key), ["mpbubbles", "mpcredit", "serverchamp", "chatqueue"]);
    assert.equal(selectRows({ tab: "controls" }).length, 0);
    assert.equal(selectRows({ tab: "world" }).length, 43);
});

test("filter All / In / Auto / Out follows ship-list.js", () => {
    assert.deepEqual(DEV_FILTERS.map((f) => f.id), ["all", "in", "auto", "out"]);
    assert.equal(selectRows({ tab: "world", filter: "all" }).length, 43);
    for (const f of ["in", "auto", "out"]) {
        const rows = selectRows({ tab: "world", filter: f });
        assert.ok(rows.every((r) => SHIP[r.key] === f), f);
    }
    let total = 0;
    for (const f of ["in", "auto", "out"]) total += DEV_ROWS.filter((r) => shipClass(r.key) === f).length;
    assert.equal(total, 100, "every key has a ship class");
    assert.deepEqual(selectRows({ tab: "online", filter: "auto" }).map((r) => r.key), ["mpbubbles", "mpcredit"]);
    assert.deepEqual(selectRows({ tab: "online", filter: "in" }), []);
    const shipOf = (k) => (k === "rain" ? "out" : "in");
    assert.deepEqual(selectRows({ query: "rain", filter: "out" }, shipOf).map((r) => r.key), ["rain"]);
});

test("search and filter combine across tabs", () => {
    const rows = selectRows({ tab: "world", query: "page", filter: "out" });
    assert.ok(rows.length > 3);
    assert.ok(rows.every((r) => shipClass(r.key) === "out" && /page/i.test(r.name + r.why)));
    assert.ok(rows.some((r) => r.tab === "info"));
});

test("groupRows keeps sub-heading order and splits by tab when searching", () => {
    const g = groupRows(selectRows({ tab: "battle" }));
    assert.deepEqual(g.map((x) => x.sub), ["Bosses", "Ideas", "Pace", "Motion", "Look"]);
    assert.equal(g.reduce((n, x) => n + x.rows.length, 0), 23);
    const s = groupRows(selectRows({ query: "page" }));
    assert.ok(new Set(s.map((x) => x.tab)).size > 1);
});

test("the model is pure: no DOM words in the source", () => {
    const src = readFileSync(new URL("../web/dev-panel-model.js", import.meta.url), "utf8");
    assert.ok(!/document\.|window\.|createElement|innerHTML/.test(src));
});
