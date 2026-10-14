// The marks over a character's head for the extra quests: a red "?" over someone who has a job for you, a red "!" over
// someone you can hand a finished job to.
//
// The "!" is the game's own: FIELDCOM directory 0 id 0 (the red exclamation the field-trigger indicator uses), drawn with
// the same helper at the same anchor. FIELDCOM has no question mark, so the "?" is drawn here pixel by pixel in the same
// colours as that "!" (red 200,0,0 body, grey 168/208 shading) and the same 24x24 cell and offset (-12, -32).
import { drawFieldcomIcon } from "./fieldcom.js";

const RED = "rgb(200,0,0)", GREY_A = "rgb(168,168,168)", GREY_B = "rgb(208,208,208)";
// a = red, b = grey, c = light grey. Columns are relative to the cell's x 8, rows to its y 4 (the "!" sits at x 9..13, y 4..18).
const QUESTION = [
    "..aaaaa..",
    ".aaaaaaa.",
    "aaa...aaa",
    "aaa...aaa",
    "......aaa",
    ".....aaa.",
    "....aaa..",
    "...aaa...",
    "...aaa...",
    ".........",
    "..aaac...",
    "..aaab...",
    "...cbc...",
];
let questionCanvas = null;
function questionSprite() {
    if (questionCanvas) return questionCanvas;
    const c = document.createElement("canvas");
    c.width = 24; c.height = 24;
    const g = c.getContext("2d");
    const cols = { a: RED, b: GREY_A, c: GREY_B };
    QUESTION.forEach((row, y) => [...row].forEach((ch, x) => {
        if (ch === ".") return;
        g.fillStyle = cols[ch]; g.fillRect(7 + x, 4 + y, 1, 1);
    }));
    questionCanvas = c;
    return c;
}

/** kind: "offer" (a job to give: "?") or "turnin" (a finished job to take: "!"). (x, y) is the balloon anchor above the character. */
export function drawQuestMark(ctx, kind, x, y, tick = 0) {
    const bob = Math.round(Math.sin(tick / 9) * 1.5);       // a gentle hover so it reads as a marker
    if (kind === "turnin") drawFieldcomIcon(ctx, 0, 0, x, y + bob);
    else if (kind === "offer") {
        ctx.save();
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(questionSprite(), x - 12, y - 32 + bob);
        ctx.restore();
    }
}
