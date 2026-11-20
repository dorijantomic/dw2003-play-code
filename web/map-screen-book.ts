// web/map-screen-book.js -- the NEW map screen (OPTIONS > GAME > Map screen: New): a book (web/book-host.js) drawn in the
// QUESTS page layout like OPTIONS: slanted header bar with the region name, a navy panel with the areas as boxes and the links
// between them as lines, the help band at the bottom with the area under the cursor. Layout and rules: web/map-screen-model.js.
//
// Keys (web/ui-kit-input.js words): arrows move the cursor to the nearest area that way, Q / E (l1 / r1) switch the region,
// Back (cross) leaves. It opens from the pause list's MAP row (web/status-translated.js -> web/game.js openBook).
// Drawn when the book draws (the host draws only while it is open); the layout is worked out once per region, not per frame.
import { WORD } from "./ui-kit-input.js";
import { drawHeader, drawHelpBox, drawPanel, withFold } from "./ui-kit.js";
import { drawCursor, drawText, textWidth } from "./uifont.js";
import { createMapScreenModel } from "./map-screen-model.js";
import { partHook } from "./ui-c/capture.js";

/** The panel (7 columns of 40 px = 280 px, 7 bands) and, inside it, the box the areas are placed in. */
export const MAP_PANEL = Object.freeze({ x: 20, y: 40, cols: 7, bands: 7, pivot: [160, 110] });
export const MAP_BOX = Object.freeze({ x: 34, y: 64, w: 252, h: 94 });
const NODE = 8;
const COL = Object.freeze({ link: "rgb(104, 104, 208)", linkDim: "rgb(52, 52, 112)", seen: "rgb(104, 104, 208)", edge: "rgb(232, 232, 255)", unseen: "rgb(0, 0, 32)", here: "rgb(255, 208, 64)" });

/** `data()` = { maps, scenes, seen(id), currentId } read when the book opens (web/game.js). */
export function createMapScreenBook({ sfx = null, data } = {}) {
    const model = createMapScreenModel({ ...data(), box: { w: MAP_BOX.w, h: MAP_BOX.h } });
    const cue = (result) => { if (result) sfx?.play?.("system02"); };
    const dirs = ["up", "down", "left", "right"];
    return {
        windows: ["title", "list", "help"],
        wall: false,
        // look C (web/ui-c/books.js): the cursor points at an area box, not at a list row
        look: Object.freeze({ rows: false }),
        model,
        act(buttons) {
            if (buttons.has(WORD.back)) return "back";
            if (buttons.has(WORD.prev)) cue(model.switchRegion(-1));
            else if (buttons.has(WORD.next)) cue(model.switchRegion(1));
            else for (const d of dirs) if (buttons.has(d)) { cue(model.move(d)); break; }
            return null;
        },
        draw(ctx, view) {
            const pt = view.progress("title"), pl = view.progress("list"), ph = view.progress("help");
            const title = "MAP", region = model.regionName();
            const tabStart = 44 + textWidth(title) + 16;
            drawHeader(ctx, pt, title, region ? [region] : [], 0, { tabStart, gap: 8 });
            const P = MAP_PANEL;
            withFold(ctx, pl, P.pivot[0], P.pivot[1], "x", () => drawPanel(ctx, P.x, P.y, P.cols, P.bands));
            if (pl >= 1) {
                const at = (id) => { const p = model.position(id); return p ? [MAP_BOX.x + p.x, MAP_BOX.y + p.y] : null; };
                const seenOf = new Map(model.nodes().map((n) => [n.id, n.seen]));
                const here = model.currentId(), cur = model.cursor();
                // [x0, y0, x1, y1, both ends seen] per link; inside a look C scope the links and boxes are handed over as parts
                const segs = [];
                for (const [a, b] of model.edges()) {
                    const pa = at(a), pb = at(b);
                    if (pa && pb) segs.push([pa[0], pa[1], pb[0], pb[1], !!(seenOf.get(a) && seenOf.get(b))]);
                }
                const look = partHook(ctx, { part: "mapLinks", x: MAP_BOX.x - NODE, y: MAP_BOX.y - NODE, w: MAP_BOX.w + 2 * NODE, h: MAP_BOX.h + 2 * NODE, segs });
                ctx.lineWidth = 1;
                if (!look) for (const [x0, y0, x1, y1, seen] of segs) {
                    ctx.strokeStyle = seen ? COL.link : COL.linkDim;
                    ctx.beginPath(); ctx.moveTo(x0 + 0.5, y0 + 0.5); ctx.lineTo(x1 + 0.5, y1 + 0.5); ctx.stroke();
                }
                for (const n of model.nodes()) {
                    const p = at(n.id);
                    if (!p) continue;
                    const x = p[0] - NODE / 2, y = p[1] - NODE / 2;
                    const state = n.seen ? (n.id === here ? "here" : "seen") : "unseen";
                    if (!(look && partHook(ctx, { part: "mapNode", x, y, w: NODE, h: NODE, state }))) {
                        ctx.fillStyle = n.seen ? (n.id === here ? COL.here : COL.seen) : COL.unseen;
                        ctx.fillRect(x, y, NODE, NODE);
                        ctx.strokeStyle = n.seen ? COL.edge : COL.link;
                        ctx.strokeRect(x + 0.5, y + 0.5, NODE - 1, NODE - 1);
                    }
                    if (!n.seen) drawText(ctx, "?", p[0] - 2, p[1] - 6, { kind: 1, clut: 7 });
                }
                const hp = here ? at(here) : null;
                if (hp) drawText(ctx, "▼", hp[0] - 4, hp[1] - NODE / 2 - 14);
                const cp = cur ? at(cur) : null;
                if (cp) drawCursor(ctx, view.ticks * 2, cp[0] - NODE / 2 - 12, cp[1] - 8);
                const prog = model.progress();
                if (prog.total) drawText(ctx, `${prog.visited} / ${prog.total}`, P.x + P.cols * 40 - 22, P.y + 6, { alignRight: true, kind: 3 });
            }
            drawHelpBox(ctx, ph, ph >= 1 ? model.help() : "");
        },
    };
}
