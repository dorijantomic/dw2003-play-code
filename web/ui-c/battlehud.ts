// web/ui-c/battlehud.js -- look C kit: the battle HUD and the battle menus (design C8 + C9 parts). One scope ("ui-battle", web/battle.js)
// takes the whole 2D chrome of a battle frame: the enemy's HP plate, the player's partner rings (HP, MP, DV arcs and core text, from the owner's read-only "battleData" part; the party markers are the small rings), the close-up bezel, and whichever of
// the six translated menus is up (commands, techniques, items, Tag, Digivolve, DNA) or the message window. Pure: the claimed draw-call
// parts (claims.js pgfgc00) and the text runs in, part descriptors in native units out. Every string is the game's own run, every
// position the game's own draw position; the focused row is the row the game's own marker copy lands in (part "focus", web/battle-
// menu-adapter.js), so the overlay never keeps a cursor of its own.
import { applyRel, dx, dy } from "./geometry.js";
import { clipRect, runText, restOfRuns } from "./generic.js";
import type { UiPart, UiRect, UiRingOpts, UiStage, UiTextOpts } from "./types.js";
import { N, ID, textPart, plate, rowPlate, chip, corners, messageBand, bandLine, HUD, keyBox, rowChevron, ringFrame, hudBar, PAGE_KEY, ringPart, ringTexts, dockPart, popPart, turnNode, triangle } from "./base.js";
import type { UiRun } from "./types.js";


/**
 * C8 sizes (native). Plates: the name slab 7 / 11 in and 5 down (132 / 196 dp wide, 13 tall), the bar track 21 down (132 / 133 x 8).
 * Command rows: 17 tall (51 dp), key box 40 dp wide, the row plate 16 right of the key box start (24 with focus), the label 8 into the
 * plate (50 dp with focus, after the chevron 4 in and 16 dp down). Labels Russo 28 / 51, plate names Russo 26 / 39, HP Chakra 28 / 42.
 */
export const BATTLE = Object.freeze({
    slabIn: { enemy: 7, player: 11 }, slabDown: 5, slabW: { enemy: 132, player: N(196) }, slabH: 13, nameIn: N(19),
    barDown: 21, barW: { enemy: 132, player: 133 }, barH: 8,
    rowH: N(51), keyW: N(40), plateIn: 16, plateOn: 8, labelIn: 8, labelOn: N(50), chevIn: 4, chevDown: N(16),
    labelDp: 28, labelLineDp: 51, nameDp: 26, nameLineDp: 39, hpDp: 28, hpLineDp: 42,
});
const PIP = ["", "var(--c-pip-hurt)", "var(--c-pip-down)", "var(--c-pip-sick)"];
/**
 * Where the rings sit. ONE number sets the player's ring: `main.frac`, its share of the stage's height (capped at `main.maxW` of the stage's width on
 * a tall stage); the dock's slots, dock point and arc (base.dockArc) and the two small rings all follow from the ring's size. The main ring hugs the
 * stage's real left and bottom edge (`margin` native in); the two partners' small rings (a fraction of the main side each) stand on the main ring's top
 * edge, left-aligned with it, so they never reach into the arc's column or the 3D scene. A tall (phone) stage gets bigger small rings. `stage` = the
 * visible native rect { x0, y0, x1, y1 } (index.js visibleNative). Pure.
 */
export const DOCK = Object.freeze({
    main: { frac: 0.30, maxW: 0.36, margin: 8 },
    mini: { fracs: [0.6, 0.5], tallFracs: [0.58, 0.46], gap: 4 },
});
export function dockLayout(stage: { x0: number; y0: number; x1: number; y1: number; }) {
    const S = stage ?? { x0: 0, y0: 0, x1: 320, y1: 240 }, pad = 1, { main: m, mini: o } = DOCK, W = S.x1 - S.x0, H = S.y1 - S.y0;
    const box = (x: number, y: number, side: number) => ({ x, y, w: side, h: side, cx: x + side / 2, cy: y + side / 2, R: side / 2 });
    const side = Math.max(8, Math.min(m.frac * H, m.maxW * W, W - 2 * pad, H - 2 * pad));
    const main = box(S.x0 + m.margin, S.y1 - m.margin - side, side);
    if (main.x < S.x0 + pad) main.x = S.x0 + pad;
    main.cx = main.x + side / 2; main.cy = main.y + side / 2;
    const tall = H > 300, fr = tall ? o.tallFracs : o.fracs, ringTop = main.cy - main.R * 0.98;
    const s2 = side * fr[0]!, s3 = side * fr[1]!;
    const second = box(main.x, ringTop - o.gap - s2, s2), third = box(second.x + s2 + o.gap, ringTop - o.gap - s3, s3);
    return { main, others: [second, third] };
}

/** The enemy block (name + thin HP bar) and the list caption share the stage's top margin (the dev label and the stage edge stay clear). */
const CAP = Object.freeze({ top: 15, inX: 8, gap: 8, sizeDp: 26, lineDp: 34, perLine: 50 });
/**
 * The enemy HP block, Time Stranger style: the name over a thin bar at the TOP CENTRE, about 38 % of the stage's width (2 bars side by side: 46 % in all), no number.
 * ONE data shape, N bars: `foes` = [{ name, level, hp, maxHp }]. A narrow (phone) stage uses the width left of the turn arc instead. Native units, pure.
 */
export const FOE = Object.freeze({ wFrac: 0.38, wFrac2: 0.46, gap: 4, nameH: 9, barDy: 10, barH: 1.6, pipDy: 13.6, pipH: 3, blockH: 18, arcW: 34, narrowW: 220 });
export function foeLayout(S: { x1: number; x0: number; y0: number; }, n = 1) {
    const W = S.x1 - S.x0, narrow = W < FOE.narrowW, cnt = Math.max(1, n | 0);
    const total = narrow ? W - 2 * CAP.inX - FOE.arcW : (cnt > 1 ? FOE.wFrac2 : FOE.wFrac) * W, gap = cnt > 1 ? FOE.gap : 0;
    const w = (total - gap * (cnt - 1)) / cnt, x0 = narrow ? S.x0 + CAP.inX : S.x0 + (W - total) / 2;
    return Array.from({ length: cnt }, (_, i) => ({ x: x0 + i * (w + gap), y: S.y0 + CAP.top, w }));
}
/** The bar's colour state: green, yellow below 50 %, red below 25 %. */
export const foeState = (ratio: number) => (ratio < 0.25 ? "low" : ratio < 0.5 ? "mid" : "ok");
const FOE_GRAD = { ok: "linear-gradient(90deg, var(--c-hp-a), var(--c-hp-b))", mid: "linear-gradient(90deg, var(--c-foe-mid-a), var(--c-foe-mid-b))", low: "linear-gradient(90deg, var(--c-foe-low-a), var(--c-foe-low-b))" };

/** The turn arc (top right): who acts now (biggest, the bottom of the arc), then who follows. `now` = "player" | "enemy"; three nodes: now, the other, and the next round's first. Pure. */
export function turnArc(S: { x1: number; x0: number; y0: number; }, now: string, pName, eName: string) {
    const W = S.x1 - S.x0, k = Math.max(0.6, Math.min(1, W / 240)), other = now === "enemy" ? "player" : "enemy";
    const seq = [now, other, now], turns = ["now", "next", "later"], rad = [6.4, 4.6, 3.5].map((r) => r * k);
    const yBase = S.y0 + CAP.top + 5 + rad[0]! * 2 * 0 + 28 * k, cx = S.x1 - 4 - 8.2 * k;
    return seq.map((side, i) => {
        const r = rad[i], y = yBase - [0, 12.5, 21.5][i]! * k, x = cx - [0, 1.8, -0.4][i]! * k;
        const name = side === "enemy" ? eName : pName;
        return { side, turn: turns[i], letter: String(name ?? "?").trim().charAt(0).toUpperCase() || "?", rect: { x: x - r!, y: y - r!, w: 2 * r!, h: 2 * r! } };
    });
}
/** A counter blow named in the full message line ("<Name> countered for N damage!"): the pop lands on the side opposite the one that countered. */
export function classifyCounter(line, who: { player: string; enemy: string; actor: string; }, note) {
    const t = String(line ?? "").replace(/\s+/g, " ").trim(), m = t.match(/countered for (\d+) damage/i);
    if (!m) return null;
    const by = [who.player, who.enemy].filter(Boolean).find((nm) => t.includes(nm + " countered")) ?? null;
    if (!by) return null;
    return { kind: "counter", side: by === who.player ? "enemy" : "player", n: +m[1]!, tag: "COUNTER", evt: `c${note?.seq ?? 0}:${t}` };
}
const POP_STATUS: [string, RegExp, string][] = [["poison", /poison/i, "POISON"], ["frozen", /frozen|paraly[sz]/i, "FROZEN"], ["confuse", /confus/i, "CONFUSED"], ["sleep", /asleep|sleep/i, "SLEEP"]];
const statusOf = (t: string) => { for (const [k, re, tag] of POP_STATUS) if (re.test(t)) return { status: k, tag }; return null; };
/**
 * What the pop is, from the game's own line and the read-only hit note (battle.js noteHit): { kind: dmg | heal | miss | counter | status, side (who it lands on), n, tone, tag, status, evt } or null.
 * A flag (crit / weak / resist) is used only when the note is the blow that line names (the note's damage equals the line's figure); every case shows only when the game really made it.
 */
export function classifyPop(line, who, note) {
    const t = String(line ?? "").replace(/\s+/g, " ").trim();
    if (!t) return null;
    const sideOf = (nm: string) => (nm && nm === who.enemy ? "enemy" : nm && nm === who.player ? "player" : null);
    const named = [who.player, who.enemy].filter(Boolean).find((nm) => t.startsWith(nm + " ")) ?? null;
    let m;
    if ((m = t.match(/(\d+)\s*damage/i))) {
        const n = +m[1]!, st = statusOf(t.replace(/\d+\s*damage.*$/i, ""));
        const action = t.match(/^(.+?) (attacks|uses) ?(.*?)!\s*(.*)$/i);
        const victim = action ? (sideOf(action[1]!.trim()) === "enemy" ? "player" : "enemy") : named ? sideOf(named) : (who.enemy && t.indexOf(who.enemy) >= 0 ? "enemy" : "player");
        const fresh = !st && note && note.kind === "hit" && note.hit && note.dmg === n;
        const eff = fresh ? note.eff : 1;
        const tone = fresh && note.crit ? "crit" : eff >= 1.5 ? "weak" : eff <= 0.75 && fresh ? "resist" : "";
        const tag = tone === "crit" ? "CRITICAL" : tone === "weak" ? "WEAK" : tone === "resist" ? "RESIST" : st ? st.tag : "";
        return { kind: "dmg", side: victim ?? "enemy", n, tone, tag, status: st?.status ?? "", evt: fresh ? `n${note.seq}:${n}` : `d:${victim}:${t}` };
    }
    if ((m = t.match(/(?:(?:recovers?|restores?|restored|healed|drained)\s+(\d+)\s*HP|(\d+)\s*HP\s+(?:healed|restored|recovered))/i))) {
        const s = sideOf(named) ?? who.actor ?? null;          // "<N>HP healed!" names nobody: it lands on the one who acts (the partner's item)
        if (s) return { kind: "heal", side: s, n: +(m[1] ?? m[2])!, evt: `h:${s}:${t}` };
    }
    if (/\bevad(?:e|ed)\b/i.test(t)) {
        const s = sideOf(named);
        if (s) return { kind: "miss", side: s, n: 0, evt: `m:${s}:${t}` };
    }
    const st = /recover|cured|wore off/i.test(t) ? null : statusOf(t);
    if (st && t.length <= 72) {
        const s = sideOf(named) ?? (who.player && t.includes(who.player) ? "player" : "enemy");
        return { kind: "status", side: s, n: 0, tag: st.tag, status: st.status, evt: `s:${s}:${t}` };
    }
    return null;
}
/** A slim caption: the text wrapped to the width (at most 3 lines, the size steps down for long text), a thin cyan tick at the left. Native units. */
function captionLines(text: string, x: number, y: number, w: number) {
    if (!text) return [];
    const wrap = (size: number) => {
        const per = Math.max(8, Math.floor(w / (size / 3 * 0.5))), words = text.split(" "), lines = [];
        let cur = "";
        for (const wd of words) { if (cur && (cur + " " + wd).length > per) { lines.push(cur); cur = wd; } else cur = cur ? cur + " " + wd : wd; }
        if (cur) lines.push(cur);
        return lines;
    };
    let size = CAP.sizeDp, lines = wrap(size);
    while (lines.length > 3 && size > 17) { size -= 3; lines = wrap(size); }
    const line = Math.round(size * CAP.lineDp / CAP.sizeDp), h = N(line), out: UiPart[] = [plate("cap.tick", "capTick", { x: x - 4, y: y + 0.5, w: 1.4, h: h * lines.length - 1 }, ID, { shape: "key", edge: "var(--c-cyan)", body: null, shadow: 0, layer: "over" })];
    lines.forEach((t, i) => out.push(textPart(`cap.l${i}`, "body", t, { x, y: y + i * h, w, h }, size, line, { color: "#eef4ff", maxDp: Math.round(w * 3), spacing: 0, cls: "uic-cap" })));
    return out;
}
const inside = (r, x: number, y: number) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
/** The centre of a run's glyph row (native text rows are 9 high). */
const runAt = (m) => ({ x: (m.right != null ? m.right - (m.w ?? 0) / 2 : m.x + (m.w ?? 0) / 2), y: m.y + 4.5 });
/** Raw native rect of a part (its draw position + the clip's pixel bounds), before its matrix. */
const raw = (p) => ({ x: p.x + (p.bx ?? 0), y: p.y + (p.by ?? 0), w: p.w ?? 0, h: p.h ?? 0 });

/** The free runs whose centre lies in `r` (raw native), taken out of the pool. */
function take(runs, used: Set<unknown>, r: UiRect) {
    const got = [];
    for (const m of runs) {
        if (used.has(m) || m.text === "") continue;
        const c = runAt(m);
        if (inside(r, c.x, c.y)) { used.add(m); got.push(m); }
    }
    return got;
}

/** A row label (Russo 28 / 51, or the given sizes) at native x, filling the row's height. */
const rowLabel = (key: string, m, x: number, row, right: number, rel: Readonly<{ a: 1; d: 1; e: 0; f: 0; }> | undefined, on: boolean, o: UiTextOpts = {}) => textPart(key, "label", m.text,
    applyRel({ x, y: row.y + row.h / 2 - N(o.lineDp ?? BATTLE.labelLineDp) / 2, w: Math.max(8, right - x), h: N(o.lineDp ?? BATTLE.labelLineDp) }, rel!),
    o.sizeDp ?? BATTLE.labelDp, o.lineDp ?? BATTLE.labelLineDp, { color: on ? "var(--c-orange-ink)" : (m.face ?? null), rel, maxDp: Math.max(24, Math.round((right - x) * 3)) });

const isNumRun = (m) => /^[0-9/]+$/.test(String(m.text).trim());
/**
 * The game writes "value / maximum" as three runs (the value right-anchored, the slash, the maximum right-anchored); with a smooth font
 * they drift apart, so a number-slash-number group on one line becomes one right-anchored run on the maximum's edge.
 */
export function joinNumbers(list) {
    const out = [], rest = [...list].sort((a, b) => a.y - b.y || runAt(a).x - runAt(b).x);
    for (let i = 0; i < rest.length; i++) {
        const a = rest[i], s = rest[i + 1], b = rest[i + 2];
        if (b && isNumRun(a) && String(s.text).trim() === "/" && isNumRun(b) && Math.abs(a.y - s.y) < 2 && Math.abs(a.y - b.y) < 2) {
            const right = b.right ?? (b.x + (b.w ?? 0)), x = a.right != null ? a.right - (a.w ?? 0) : a.x;
            out.push({ ...b, text: `${String(a.text).trim()}/${String(b.text).trim()}`, x, right, w: right - x, kind: 3 });
            i += 2;
        } else out.push(a);
    }
    return out;
}
/** Runs inside a box that are not row labels: numbers stay numbers (amber), small labels dim, as generic.runText does. */
const boxRuns = (key: string, list: UiRun[], rel: Readonly<{ a: 1; d: 1; e: 0; f: 0; }>, out: UiPart[], on = false) => joinNumbers(list).forEach((m, i) => out.push(runText(m, `${key}.t${i}`, rel, on ? { color: "var(--c-orange-ink)" } : {})));

/**
 * The battle screen. `cfg.view` = the close-up's window (native, BATTLE_UI_LAYOUT.portraitView): the bezel leaves it open.
 */
export function composeBattle({ parts, runs, stage }, cfg: { stage?: UiStage; view?: UiRect; } = {}) {
    const out: UiPart[] = [], used = new Set();
    const S = stage ?? cfg.stage ?? { x0: 0, y0: 0, x1: 320, y1: 240 };
    const data = parts.find((p: { part: string; }) => p.part === "battleData") ?? null;     // the owner's read-only "battleData" part (battle.js drawBattleHud): the numbers the rings show
    const fullScreen = !!data && (data.st === 13 || data.st === 15);       // the DV / DNA pickers are whole screens of their own: no rings over them
    const lay = data ? dockLayout(S) : null;
    const ringRight = lay ? lay.main.x + lay.main.w + 4 : 0;
    const arcList = !!data && !fullScreen && parts.some((p: { part: string; }) => p.part === "listWin" || p.part === "tagRow");
    const listRows = [];
    const pager = runs.some((m) => PAGE_KEY.test(String(m.text).trim()));
    const foeList = !data ? [] : (data.foes ?? (data.enemy ? [data.enemy] : []));        // ONE data shape, N bars
    const foeBox = foeLayout(S, foeList.length || 1);
    const narrowS = S.x1 - S.x0 < FOE.narrowW;
    // the caption / hit-banner box: top left, up to the enemy block (a narrow stage puts it under the block)
    const callout = data ? (narrowS ? { x: S.x0 + CAP.inX, y: S.y0 + CAP.top + FOE.blockH, w: S.x1 - S.x0 - 2 * CAP.inX - FOE.arcW } : { x: S.x0 + CAP.inX, y: S.y0 + CAP.top, w: foeBox[0]!.x - CAP.gap - (S.x0 + CAP.inX) }) : null;
    const enemyPips = [];
    const actor = !data ? null : (data.st === 6 ? "enemy" : [2, 3, 4, 5, 11, 13, 15].includes(data.st) ? "player" : null);
    // keep clear of the ring: a plate that would start inside it starts right of it
    const clear = (r: UiRect): UiRect => (lay && r.x < ringRight ? { ...r, x: ringRight, w: Math.max(8, r.w - (ringRight - r.x)) } : r);
    const focus = parts.filter((p: { part: string; }) => p.part === "focus").map((p: { x: number; w: number; y: number; h: number; }) => ({ p, at: { x: p.x + p.w / 2, y: p.y + p.h / 2 }, hit: false }));
    const isOn = (r) => { let on = false; for (const f of focus) if (inside(r, f.at.x, f.at.y)) { f.hit = true; on = true; } return on; };
    const tracks = {};
    let heldBar = null, banner: string | null = null, counterLine: string | null = null;

    // the page keys (L1 / R1 under a list or a stat panel) are chips wherever they are drawn
    runs.forEach((m, i) => {
        if (!PAGE_KEY.test(String(m.text).trim())) return;
        used.add(m);
        if (arcList) return;                 // the arc list shows the two keys beside its title
        const w = Math.max(10, (m.w ?? 10) + 4);
        out.push(chip(`page${i}`, { x: m.x - 2, y: m.y - 1, w, h: 11 }, ID, { edge: "var(--c-under)", body: null }));
        out.push(textPart(`page${i}.t`, "label", m.text, { x: m.x - 2, y: m.y - 1, w, h: 11 }, 16, 33, { align: "center", spacing: 0 }));
    });

    const cmds = [];
    const oldRow = (p, r, on: boolean, k: string, rel: Readonly<{ a: 1; d: 1; e: 0; f: 0; }> | undefined) => {
        const R = (q: UiRect) => applyRel(q, rel!);
        const row = { x: r.x, y: r.y, w: r.w, h: BATTLE.rowH };
        keyBox(`${k}.key`, R({ x: r.x, y: r.y, w: BATTLE.keyW, h: BATTLE.rowH }), on, rel, out);
        const px = r.x + BATTLE.plateIn + (on ? BATTLE.plateOn : 0), pw = r.w - 18;
        out.push(plate(`${k}.plate`, "cmdRow", R({ x: px, y: r.y, w: pw, h: BATTLE.rowH }), rel, { shape: on ? "rowSrSolid" : "rowSr", edge: on ? "var(--c-orange)" : HUD.edge, body: on ? null : HUD.body, shadow: 6 }));
        if (on) out.push(rowChevron(`${k}.chev`, px + BATTLE.chevIn, r.y + BATTLE.chevDown, rel));
        take(runs, used, r).forEach((m, j) => out.push(rowLabel(`${k}.l${j}`, m, px + (on ? BATTLE.labelOn : BATTLE.labelIn), row, px + pw - N(20), rel, on)));
    };
    parts.forEach((p, i) => {
        const rel = p.rel ?? ID, R = (r: UiRect) => applyRel(r, rel), k = `b${i}`;
        switch (p.part) {
        case "battleData": break;
        case "hudPlate": {
            const side = p.side === "enemy" ? "enemy" : "player", r = raw(p);
            if (side === "player") {
                // the player's plate is the ring now: its own name and HP runs are taken so they are not written twice
                take(runs, used, { x: r.x, y: r.y, w: r.w, h: r.h });
                break;
            }
            if (callout) {                      // the enemy is a thin callout (name, LV, HP line), never a plate or a ring
                take(runs, used, { x: r.x, y: r.y, w: r.w, h: r.h });
                break;
            }
            out.push(plate(`hud.${side}`, "hudPlate", R(r), rel, { edge: HUD.edge, body: HUD.body, shadow: 6 }));
            const slab = { x: r.x + BATTLE.slabIn[side], y: r.y + BATTLE.slabDown, w: BATTLE.slabW[side], h: BATTLE.slabH };
            out.push(plate(`hud.${side}.slab`, "nameSlab", R(slab), rel, { shape: "srs", edge: HUD.slab, body: null, shadow: 0 }));
            tracks[side] = { x: slab.x, y: r.y + BATTLE.barDown, w: BATTLE.barW[side], h: BATTLE.barH };
            // the name: the kind 1 run on the plate's top row
            const name = take(runs, used, { x: r.x, y: r.y, w: r.w, h: 14 });
            name.forEach((m, j) => out.push(rowLabel(`hud.${side}.name${j || ""}`, m, slab.x + BATTLE.nameIn, slab, slab.x + slab.w - 6, rel, false, { sizeDp: BATTLE.nameDp, lineDp: BATTLE.nameLineDp })));
            // the HP numbers (shown, slash, maximum: three runs of the game) as one amber run on the maximum's right edge
            const nums = take(runs, used, { x: r.x, y: slab.y - 2, w: r.w, h: slab.h + 4 }).sort((a, b) => runAt(a).x - runAt(b).x);
            if (nums.length) {
                const last = nums[nums.length - 1], right = last.right ?? (last.x + (last.w ?? 0));
                const lineN = N(BATTLE.hpLineDp), w = 72;
                out.push(textPart(`hud.${side}.hp`, "number", nums.map((m) => m.text).join(""), R({ x: right - w, y: slab.y + slab.h / 2 - lineN / 2, w, h: lineN }),
                    BATTLE.hpDp, BATTLE.hpLineDp, { align: "right", color: "var(--c-num)", rel }));
            }
            break;
        }
        case "hpBar": {
            const side = p.side === "enemy" ? "enemy" : "player";
            if (side === "player") break;          // the ring's HP arc
            if (callout) { heldBar = p; break; }
            const t = tracks[side] ?? raw(p);
            const ratio = p.full > 0 ? p.w / p.full : 1;
            const [a, b] = p.colors ?? ["var(--c-hp)", "var(--c-hp)"];
            out.push(hudBar(`hud.${side}.bar`, t, ratio, `linear-gradient(90deg, ${a}, ${b})`, rel, side === "enemy" ? "rtl" : "ltr"));
            break;
        }
        case "pip": {
            if (raw(p).x > 160) break;             // the player's party markers are the small rings
            if (callout) { enemyPips.push(p); break; }
            const r = raw(p), state = p.base & 3, active = p.base < 0x3c;
            const base = active ? HUD.edge : "var(--c-pip-off)";
            const c = state ? (active ? PIP[state] : `color-mix(in srgb, ${PIP[state]} 60%, var(--c-hud-body))`) : base;
            out.push(plate(`pip${i}`, "pip", R({ x: r.x + 1, y: r.y + r.h / 2 - 4, w: r.w - 2, h: 8 }), rel, { shape: "key", edge: c, body: null, shadow: 0, layer: "over" }));
            break;
        }
        case "dvFrame": case "dvInner": case "dvFill": break;          // the ring's DV arc is the whole gauge
        case "bezel": {
            if (data && data.face === false) break;          // no picture in the close-up this frame: no empty frame
            const r = raw(p);
            const v = cfg.view ?? { x: r.x + 2, y: r.y + 2, w: r.w - 4, h: r.h - 4 };
            ringFrame("bezel", r, v, rel, out);
            break;
        }
        case "cmdRow": {
            const r = raw(p), on = isOn(r);
            if (p.base === 34) { cmds.push({ p, r, on, k, rel }); break; }       // the six commands: the dock, once the ring is known (below)
            oldRow(p, r, on, k, rel);
            break;
        }
        case "tagRow": {
            // key box, the name plate (16 .. 84) and the HP / MP box (86 .. 186) of one Tag partner
            const r = raw(p), on = isOn(r);
            const row = { x: r.x, y: r.y, w: r.w, h: BATTLE.rowH };
            if (arcList) {
                const nm = take(runs, used, { x: r.x, y: r.y, w: 86, h: BATTLE.rowH }).map((m) => m.text).join(" ").trim();
                const nums = joinNumbers(take(runs, used, { x: r.x + 86, y: r.y, w: Math.max(8, r.w - 86), h: r.h })).map((m) => String(m.text).trim().replace(/^[A-Z]+/, ""));
                if (nm) listRows.push({ t: nm, chip: nums[1] ?? "", r: nums[0] ?? "", on });
                break;
            }
            keyBox(`${k}.key`, R({ x: r.x, y: r.y, w: BATTLE.keyW, h: BATTLE.rowH }), on, rel, out);
            const px = r.x + BATTLE.plateIn, pw = 68;
            out.push(plate(`${k}.plate`, "tagRow", R({ x: px, y: r.y, w: pw, h: BATTLE.rowH }), rel, { shape: on ? "rowSrSolid" : "rowSr", edge: on ? "var(--c-orange)" : HUD.edge, body: on ? null : HUD.body, shadow: 6 }));
            if (on) out.push(rowChevron(`${k}.chev`, px + BATTLE.chevIn, r.y + BATTLE.chevDown, rel));
            take(runs, used, { x: r.x, y: r.y, w: 86, h: BATTLE.rowH }).forEach((m, j) => out.push(rowLabel(`${k}.l${j}`, m, px + (on ? BATTLE.labelOn : BATTLE.labelIn), row, px + pw - N(24), rel, on)));
            const box = { x: r.x + 86, y: r.y, w: Math.max(8, r.w - 86), h: r.h };
            out.push(plate(`${k}.box`, "tagStats", R(box), rel, { shape: "chip", edge: on ? "var(--c-orange)" : HUD.edge, body: HUD.body, shadow: 4 }));
            boxRuns(`${k}.box`, take(runs, used, box), rel, out);
            break;
        }
        case "listWin": {
            // the technique / item window: one row per 12 x 12 selector box of the sheet, the row line (132 x 1) gives the row's width
            const r = raw(p);
            if (!arcList) out.push(plate(`${k}.win`, "listWindow", R(r), rel, { edge: HUD.edge, body: HUD.body, shadow: 6 }));
            const boxes = (p.layers ?? []).filter((l: { w: number; h: number; }) => l.w === 12 && l.h === 12).sort((a: { y: number; }, b: { y: number; }) => a.y - b.y);
            const line = (p.layers ?? []).find((l: { h: number; w: number; }) => l.h === 1 && l.w >= 60);
            const lineEnd = line ? p.x + line.x + line.w : r.x + r.w - 6;
            if (arcList) {                     // the rows go to the arc: the game's own runs, plus the tech cost and element from battleData
                boxes.forEach((b, j) => {
                    const bx = p.x + b.x, row = { x: bx, y: p.y + b.y - 1, w: lineEnd - bx, h: 13 };
                    const got = take(runs, used, { x: bx, y: row.y, w: r.x + r.w - bx, h: row.h });
                    const on = isOn(row), name = got.filter((m) => m.right == null && m.kind !== 3).map((m) => m.text).join(" ").trim();
                    const tech = data.techs?.[(data.techTop ?? 0) + j], item = data.items?.[(data.itemTop ?? 0) + j];
                    if (tech) listRows.push({ t: tech.name, chip: String(tech.element ?? "").toUpperCase(), el: String(tech.element ?? ""), r: String(tech.cost), dis: !data.free && tech.cost > data.mp, on, cost: data.free ? 0 : tech.cost });
                    else if (name) listRows.push({ t: name, r: item ? `x${item.qty}` : "", on });
                });
                break;
            }
            boxes.forEach((b, j) => {
                const bx = p.x + b.x, row = { x: bx, y: p.y + b.y - 1, w: lineEnd - bx, h: 13 };
                const on = isOn(row);
                keyBox(`${k}.r${j}.key`, R({ x: bx, y: row.y, w: 12, h: row.h }), on, rel, out);
                const plateR = { x: bx + 14, y: row.y, w: Math.max(8, lineEnd - bx - 14), h: row.h };
                out.push(rowPlate(`${k}.r${j}`, R(plateR), on, rel, "listRow", HUD.edge));
                take(runs, used, { x: bx, y: row.y, w: r.x + r.w - bx, h: row.h }).forEach((m, q) => out.push(m.right != null || m.kind === 3
                    ? runText(m, `${k}.r${j}.t${q}`, rel, on ? { color: "var(--c-orange-ink)" } : {})
                    : rowLabel(`${k}.r${j}.t${q}`, m, m.x, row, plateR.x + plateR.w - 2, rel, on, { sizeDp: 24, lineDp: 36 })));
            });
            break;
        }
        case "mpPlate": {
            // the MP plate: its sheet pieces below y 18 are the plate, the 8 px strip at x 0 is the connector up to the HP plate
            const ls = p.layers ?? [];
            const body = ls.filter((l: { y: number; }) => l.y >= 18);
            if (!body.length) break;
            const x0 = Math.min(...body.map((l) => l.x)), y0 = Math.min(...body.map((l) => l.y));
            const x1 = Math.max(...body.map((l) => l.x + l.w)), y1 = Math.max(...body.map((l) => l.y + l.h));
            const box = { x: p.x + x0, y: p.y + y0, w: x1 - x0, h: y1 - y0 };
            if (arcList) { take(runs, used, { x: box.x, y: box.y - 2, w: box.w + 4, h: box.h + 2 }); break; }      // the MP lives on the ring now (the list rows show the cost)
            out.push(plate(`${k}.plate`, "mpPlate", R(box), rel, { shape: "chip", edge: HUD.edge, body: HUD.body, shadow: 4 }));
            boxRuns(k, take(runs, used, { x: box.x, y: box.y - 2, w: box.w + 4, h: box.h + 2 }), rel, out);
            break;
        }
        case "qtyPlate": case "statPanel": case "notice": {
            const r = clear(raw(p));
            if (arcList && p.part === "qtyPlate") { take(runs, used, r); break; }      // the quantity is on the item's row
            out.push(plate(`${k}.plate`, p.part, R(r), rel, { shape: r.h < 30 ? "chip" : "ch", edge: HUD.edge, body: HUD.body, shadow: r.h < 30 ? 4 : 6 }));
            const got = take(runs, used, r);
            if (p.part === "notice") got.forEach((m, j) => out.push(bandLine(`${k}.l${j}`, m, r.x + r.w - 4, rel)));
            else boxRuns(k, got, rel, out);
            break;
        }
        case "strip": {
            // the DNA species strip: a row plate with the species name
            const r = raw(p), on = isOn(r), row = { x: r.x, y: r.y, w: r.w, h: BATTLE.rowH };
            out.push(plate(`${k}.plate`, "strip", R({ x: r.x, y: r.y, w: r.w, h: BATTLE.rowH }), rel, { shape: on ? "rowSrSolid" : "rowSr", edge: on ? "var(--c-orange)" : HUD.edge, body: on ? null : HUD.body, shadow: 6 }));
            take(runs, used, r).forEach((m, j) => out.push(rowLabel(`${k}.l${j}`, m, r.x + BATTLE.labelIn, row, r.x + r.w - N(24), rel, on)));
            break;
        }
        case "msgPane": {
            // the message window / the list's description pane: the C9 9 band, its lines in the band face, numbers amber
            const r0 = raw(p);
            const got = take(runs, used, r0);
            const text = got.slice().sort((a, b) => a.y - b.y || a.x - b.x).map((m) => String(m.text)).join(" ").replace(/\s+/g, " ").trim();
            if (data && ![2, 3, 4, 11, 13, 15].includes(data.st) && /countered for/i.test(text)) counterLine = text;
            const shown = counterLine ? text.replace(/\s*[^!]*countered[^!]*!\s*$/i, "").trim() || text : text;      // the counter sentence is its own pop: the banner keeps the blow only
            if (data && ![2, 3, 4, 11, 13, 15].includes(data.st) && text && text.length <= 72) { banner = shown; break; }      // an action line = the hit banner
            if (arcList && callout) {
                // the list's description is a slim caption at the top of the stage, left of the enemy callout (no box, no MP plate: the cost is on the row)
                const full = got.filter((m) => m.kind === 1 && m.right == null && String(m.text).trim() !== "MP").sort((a, b) => a.y - b.y || a.x - b.x).map((m) => String(m.text).trim()).filter(Boolean).join(" ").replace(/\s+/g, " ");
                captionLines(full, callout.x, callout.y, callout.w).forEach((c) => out.push(c));
                break;
            }
            const r = clear(r0);
            messageBand(`${k}.band`, R(r), rel, out);
            got.forEach((m, j) => out.push(m.kind === 1 && m.right == null ? bandLine(`${k}.l${j}`, { ...m, x: Math.max(m.x, r.x + 6) }, r.x + r.w - 4, rel) : runText(m, `${k}.n${j}`, rel)));
            break;
        }
        default: break;
        }
    });

    // the command menu: with the ring present the six words ride the arc around it and the focused one docks beside it (parts.js fillDock);
    // without a ring (no battleData) or with a seventh row it stays the game's list of plates
    cmds.sort((a, b) => a.r.y - b.r.y);                   // the game may draw them in any order: slot i = the i-th row from the top
    const dockOn = !!data && !fullScreen && cmds.length > 0 && cmds.length <= 6;
    const TITLE: Record<string, string> = { 3: "TECH", 4: "ITEM", 11: "TAG", 13: "DV", 15: "DNA" };
    let spend = null;
    if (dockOn) {
        const words = cmds.map((c) => take(runs, used, c.r).map((m) => m.text).join(" "));
        const at = cmds.findIndex((c) => c.on);
        out.push(dockPart("dock.cmd", S, { cx: lay!.main.cx, cy: lay!.main.cy, R: lay!.main.R }, words, at));
    } else if (arcList && listRows.length) {
        const rows = listRows.slice(0, 6), at = rows.findIndex((c) => c.on);
        out.push(dockPart("dock.list", S, { cx: lay!.main.cx, cy: lay!.main.cy, R: lay!.main.R }, rows.map((c) => c.t), at, { rows, title: TITLE[data.st] ?? "", pager }));
        if (at >= 0 && rows[at].cost > 0) spend = rows[at].cost;
    } else cmds.forEach((c) => oldRow(c.p, c.r, c.on, c.k, c.rel));
    if (data) {
        const one = (key: string, variant: string, rect: { x: number; y: number; w: number; h: number; cx: number; cy: number; R: number; } | undefined, v, menu: boolean | undefined, o: UiRingOpts = {}) => { out.push(ringPart(key, rect, variant, v, menu, o), ...ringTexts(key, rect!, variant, v, o)); };
        if (!fullScreen) {
            one("ring.main", "main", lay!.main, data, dockOn || (arcList && listRows.length > 0), { act: actor === "player", mpPrev: spend, real: data.hpReal, eReal: data.eHpReal });
            (data.others ?? []).slice(0, 2).forEach((o, i: number) => one(`ring.o${i + 1}`, "mini", lay!.others[i], o, false));
        }
        if (actor === "player" && !fullScreen) out.push({ ...triangle("act.player", lay!.main.cx, lay!.main.y + lay!.main.h + 3, "up", ID, "var(--c-cyan)"), nb: true });      // nb: a marker in the side area never bleeds to the screen edge
        // the enemy block at the top centre: the name with a small LV over a thin HP bar (green, yellow below 50 %, red below 25 %), no number; the team's pips under it. N foes = N bars side by side.
        const hot = actor === "enemy", eN = String(foeList[0]?.name ?? "");
        foeList.forEach((f, i: string | number) => {
            const B = foeBox[i];
            out.push(textPart(`foe${i}.name`, "label", String(f.name ?? ""), { x: B.x, y: B.y, w: Math.max(8, B.w - 26), h: FOE.nameH }, 21, 27, { color: hot ? "var(--c-hot-ink)" : "#fff", maxDp: Math.round((B.w - 26) * 3), spacing: 0 }));
            out.push(textPart(`foe${i}.lv`, "number", `LV ${f.level ?? ""}`, { x: B.x + B.w - 24, y: B.y + 1.5, w: 24, h: 7 }, 15, 21, { color: "var(--c-num)", align: "right", maxDp: 72 }));
            if (f.maxHp > 0) {
                const ratio = Math.max(0, Math.min(1, f.hp / f.maxHp)), st = foeState(ratio);
                out.push({ ...hudBar(`foe${i}.bar`, { x: B.x, y: B.y + FOE.barDy, w: B.w, h: FOE.barH }, ratio, FOE_GRAD[st], ID, "ltr"), state: st });
            }
        });
        enemyPips.sort((a, b) => raw(a).x - raw(b).x).forEach((p, i) => {
            const state = p.base & 3, active = p.base < 0x3c, c = state ? (active ? PIP[state] : `color-mix(in srgb, ${PIP[state]} 60%, var(--c-hud-body))`) : (active ? HUD.edge : "var(--c-pip-off)");
            out.push(plate(`foe0.pip${i}`, "pip", { x: foeBox[0]!.x + i * 8, y: foeBox[0]!.y + FOE.pipDy, w: 6, h: FOE.pipH }, ID, { shape: "key", edge: c, body: null, shadow: 0, layer: "over" }));
        });
        // who acts: the turn arc at the top right (read-only: the game's state and the side it opens with)
        const bannerNow = banner && eN && banner.startsWith(eN + " ") ? "enemy" : null;
        turnArc(S, actor ?? bannerNow ?? (data.pFirst === false ? "enemy" : "player"), data.name, eN).forEach((n, i) => out.push(turnNode(`turn${i}`, n.rect, n)));
        // the hit banner: who acts (small), the move (big, slanted), then the damage line; the number pops at the target
        if (banner) {
            const x0 = callout!.x, y0 = callout!.y, w = Math.max(24, callout!.w - 6);
            // "<Name> uses <Move> [element]! N damage!" | "<Name> attacks! N damage!" | "<Name> <Move>!" | "<Name> N damage!" | any other line
            const m = banner.match(/^(.+?) (attacks|uses) ?(.*?)!\s*(.*)$/i);
            const named = [data.name, eN].filter(Boolean).find((nm) => banner!.startsWith(nm + " "));
            const who = m ? `${m[1]} ${m[2]}`.toUpperCase() : named ? named.toUpperCase() : "";
            const title = m ? (m[2].toLowerCase() === "uses" ? m[3].replace(/\s*[\[(].*$/, "") : "Fight") : named ? banner.slice(named.length + 1) : banner, rest = m ? m[4] : "";
            const big0 = title.length <= 18 ? 40 : title.length <= 30 ? 32 : 26, big = Math.max(18, Math.min(big0, Math.floor(w * 3 / (Math.max(1, title.length) * 0.58)))), bh = N(big * 1.25);       // never wider than the box
            if (who) out.push(textPart("hit.who", "label", who, { x: x0, y: y0, w, h: 7 }, 16, 21, { color: "var(--c-cyan)", spacing: 6, maxDp: w * 3, cls: "uic-hit-who" }));
            const dmgOnly = /^\d+\s*damage/i.test(title.trim());          // the number is the pop's: the banner keeps only who + what
            if (!dmgOnly) out.push(textPart("hit.title", "label", title, { x: x0, y: y0 + 7, w, h: bh }, big, Math.round(big * 1.25), { color: "#fff", spacing: 0, maxDp: w * 3, cls: "uic-hit-title" }));
            if (!dmgOnly) out.push(plate("hit.line", "hitLine", { x: x0, y: y0 + 7 + bh + 0.5, w: Math.min(w, 120), h: 0.8 }, ID, { shape: "key", edge: "var(--c-orange)", body: null, shadow: 0, layer: "over" }));
            if (rest && !/damage/i.test(rest)) out.push(textPart("hit.rest", "number", rest, { x: x0, y: y0 + 7 + bh + 2, w, h: 10 }, 24, 30, { color: "var(--c-num)", maxDp: w * 3, align: "left" }));
        }
        // the damage pop: ONE per hit event, typed from the game's own line and the read-only hit note
        const names = { player: String(data.name ?? ""), enemy: eN, actor: actor ?? bannerNow ?? "player" };
        const popRect = (side: string) => {
            if (side === "player") return { x: lay!.main.x + lay!.main.w + 4, y: lay!.main.cy - 26, w: 70, h: 44 };
            const sw = S.x1 - S.x0, pw = 76, ph = 56, sc = data.eScr, floor = S.y0 + CAP.top + FOE.blockH + 1;
            let pr = { x: S.x0 + (sw - pw) / 2, y: floor + 2, w: pw, h: ph };       // without the renderer's projection: under the enemy block
            if (sc && Number.isFinite(sc.x) && Number.isFinite(sc.topY)) {
                const cx = S.x0 + sc.x * sw, cy = S.y0 + (sc.topY + (sc.footY - sc.topY) * 0.25) * (S.y1 - S.y0);
                const ringsRight = lay!.main.x + lay!.main.w + 2;
                pr = { x: Math.min(Math.max(cx - pw / 2, S.x0 + 2, cy + 28 > lay!.others[0]!.y ? ringsRight : S.x0 + 2), S.x1 - pw - 2), y: Math.min(Math.max(cy - 28, floor), S.y1 - 58), w: pw, h: ph };
            }
            return pr;
        };
        const pops = [];
        if (banner) { const c = classifyPop(banner, names, data.hitNote); if (c) pops.push(["pop", c]); }
        if (counterLine) { const c = classifyCounter(counterLine, names, data.hitNote); if (c) pops.push(["pop.c", c]); }
        pops.forEach(([key, c]) => out.push(popPart(key, popRect(c!.side), c!.n, c!.side, { kind: c!.kind, tone: c!.tone, tag: c!.tag, status: c!.status, evt: c!.evt })));
    }
    // a marker the game drew where no row is (should not happen): show it as focus corners, so focus is never lost
    focus.forEach((f, j) => { if (!f.hit) out.push(corners(`focus${j}`, applyRel({ x: f.p.x, y: f.p.y, w: f.p.w, h: f.p.h }, f.p.rel ?? ID))); });
    restOfRuns(runs, used, ID, out, "bt");
    return out;
}
