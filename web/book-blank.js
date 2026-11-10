// web/book-blank.js -- a book with nothing on it: the wall, a header plate, one empty window and the footer.
// It is what GLOSSARY opens in build step 1 (the window kit shown without content) and stays the fallback for a book whose
// pages are not built yet.
import { WORD } from "./ui-kit-input.js";
import { drawFooter, drawHeader, drawPanel, withFold } from "./ui-kit.js";

export function createBlankBook({ title = "GLOSSARY" } = {}) {
    return {
        windows: ["title", "body", "footer"],
        wall: true,
        act(buttons) { return buttons.has(WORD.back) ? "back" : null; },
        draw(ctx, view) {
            drawHeader(ctx, view.progress("title"), title);
            // eight 40 px columns = the full 320 px, seven bands = 140 px tall, between the header and the footer
            withFold(ctx, view.progress("body"), 160, 118, "x", () => drawPanel(ctx, 0, 48, 8, 7));
            drawFooter(ctx, view.progress("footer"), "[triangle] Button: Back");
        },
    };
}
