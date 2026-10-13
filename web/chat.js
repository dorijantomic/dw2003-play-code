// EXPERIMENT: type-to-chat. Press T, type a line, press Enter: the game's own speech balloon
// (its balloon chrome, tail and bitmap font) shows it over your character for a few seconds.
// Esc cancels. Purely visual: it never touches the story, dialogue or save state.
const MAX_CHARS = 72;
let box = null, input = null, hooks = null;

export function chatOpen() { return !!box && box.style.display !== "none"; }

function openBox() {
    hooks.releaseKeys?.();
    box.style.display = "block";
    input.value = "";
    input.focus();
}
function closeBox() {
    box.style.display = "none";
    input.blur();
    hooks.releaseKeys?.();
}
function send() {
    const text = input.value.replace(/\s+/g, " ").trim().slice(0, MAX_CHARS);
    closeBox();
    if (!text) return;
    hooks.onSend?.(text);
}

// hooks: { stage, canOpen(), releaseKeys(), onSend(text) }
export function installChat(h) {
    hooks = h;
    box = document.createElement("div");
    box.id = "chat-box";
    box.style.cssText = "display:none;position:absolute;left:50%;bottom:14px;transform:translateX(-50%);width:min(80%,520px);z-index:60;";
    input = document.createElement("input");
    input.type = "text"; input.maxLength = MAX_CHARS; input.placeholder = "Say something… (Enter = send, Esc = cancel)";
    input.autocomplete = "off"; input.spellcheck = false;
    input.style.cssText = "width:100%;box-sizing:border-box;padding:8px 12px;font:bold 16px monospace;color:#1a3a8a;background:#fff;border:3px solid #3868d8;border-radius:10px;outline:none;";
    box.appendChild(input);
    h.stage.appendChild(box);
    input.addEventListener("keydown", (e) => {
        e.stopPropagation();   // the game must not see these keys
        if (e.key === "Enter") { e.preventDefault(); send(); }
        else if (e.key === "Escape") { e.preventDefault(); closeBox(); }
    });
    input.addEventListener("keyup", (e) => e.stopPropagation());
    // Capture phase, so the game's own key handler never sees the T that opens the box.
    window.addEventListener("keydown", (e) => {
        if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
        if (e.target && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA")) return;
        if (e.key !== "t" && e.key !== "T") return;
        if (!hooks.canOpen()) return;
        e.preventDefault(); e.stopImmediatePropagation();
        openBox();
    }, true);
}

// The game's text banks are { u32 line count, u32 offset per line + end, line bytes }, in its own
// code page: digits 0x04.., A-Z 0x0e.., a-z 0x28.., 01 01 = space, 01 04 , 01 05 . 01 13 ' 01 1a -,
// e6 ? e7 !, 02 01 = new line, 02 02 = pause, 02 00 = end (read off estalk00.bin).
const WRAP = 22;
function encode(ch) {
    if (ch >= "0" && ch <= "9") return [0x04 + ch.charCodeAt(0) - 48];
    if (ch >= "A" && ch <= "Z") return [0x0e + ch.charCodeAt(0) - 65];
    if (ch >= "a" && ch <= "z") return [0x28 + ch.charCodeAt(0) - 97];
    return { ",": [1, 4], ".": [1, 5], "'": [1, 0x13], "-": [1, 0x1a], "?": [0xe6], "!": [0xe7] }[ch] ?? [1, 1];
}
export function buildChatPack(text, name = "") {
    const words = text.split(" "), lines = [];
    let cur = "";
    for (let w of words) {
        while (w.length > WRAP) { if (cur) { lines.push(cur); cur = ""; } lines.push(w.slice(0, WRAP)); w = w.slice(WRAP); }
        if (!cur) cur = w;
        else if ((cur + " " + w).length <= WRAP) cur += " " + w;
        else { lines.push(cur); cur = w; }
    }
    if (cur) lines.push(cur);
    const body = [];
    if (name) { body.push(2, 7); for (const ch of name.slice(0, 12)) body.push(...encode(ch)); body.push(2, 7); }
    lines.slice(0, 4).forEach((l, i) => {
        if (i) body.push(2, 1);
        for (const ch of l) body.push(...encode(ch));
    });
    body.push(2, 2, 2, 0, 0, 0, 0, 0);
    while ((12 + body.length) % 4) body.push(0);
    const out = new Uint8Array(12 + body.length), dv = new DataView(out.buffer);
    dv.setUint32(0, 1, true); dv.setUint32(4, 12, true); dv.setUint32(8, out.length, true);
    out.set(body, 12);
    return out;
}
