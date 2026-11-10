// web/glossary-fallback.js -- the picture GLOSSARY > DIGIMON draws when a species has no 3D model: the new partner's own picture
// (web/partner-pictures.js, painted from its field sprite). A species with no such picture draws nothing here, and the book then
// writes "No picture". The disc's eight partners have models, and their pictures live in the status pack, not here.
import { newPartnerList } from "./vendor/engine.js";
import { drawPartnerPicture } from "./partner-pictures.js";

const BASE = 0x400;
const STEPS = [0, 1, 2, 1];          // the engine's frame order for a new partner's picture
const STEP_MS = 200;

/** `(ctx, { partnerId }, x, y, w, h) -> boolean`; the 32 x 32 picture is drawn at 2x, centred in the rectangle. */
export function createPartnerFallback({ partners = newPartnerList, draw = drawPartnerPicture, now = () => Date.now() } = {}) {
    return (ctx, who, x, y, w, h) => {
        if (who?.partnerId == null) return false;
        const p = partners().find((q) => q && q.id === who.partnerId);
        if (!p) return false;
        const frame = STEPS[Math.floor(now() / STEP_MS) % STEPS.length];
        const id = BASE + (p.slot - 8) * 0x10 + frame;
        const k = 2, px = Math.round(x + (w - 32 * k) / 2), py = Math.round(y + (h - 32 * k) / 2);
        ctx.save();
        ctx.translate(px, py); ctx.scale(k, k);
        const ok = draw(ctx, id, 0, 0);
        ctx.restore();
        return !!ok;
    };
}
