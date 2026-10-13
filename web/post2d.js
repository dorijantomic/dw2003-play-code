// EXPERIMENT: "HD-2D look" -- a final-frame post-process over the field canvas.
//
// The field is a fixed-pitch top-down picture, so screen Y is a fair stand-in for depth: the
// middle of the screen is in focus and the top and bottom soften, like a tilt-shift lens. On top
// of that a soft bloom from the bright areas (the lamps) and a gentle colour grade.
//
// How: each frame the finished game canvas is copied into a WebGL2 texture, one shader draws it
// back with the effect, and the result sits on a canvas laid exactly over the game canvas's
// content box. The overlay never takes pointer events and is hidden whenever the game canvas is
// (title, battle, menus), so it cannot touch input or any other screen. Off by default (F2).
//
// Tune live from the console: __hd2d = { blur, focus, bloom, thr, sat, con, vig }.
import { fx } from "./ambience.js";

const DEFAULTS = { blur: 3.2, focus: 0.24, bloom: 0.38, thr: 0.52, sat: 1.1, con: 1.05, vig: 0.22 };

const VS = `#version 300 es
in vec2 aPos; out vec2 vUv;
void main() { vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }`;

const FS = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 o;
uniform sampler2D uTex;
uniform vec2 uSize;
uniform float uBlur, uFocus, uBloom, uThr, uSat, uCon, uVig;
void main() {
    vec2 uv = vUv;
    float d = abs(uv.y - 0.5);
    float band = smoothstep(uFocus, 0.5, d);            // 0 in the focus band, 1 at the very top and bottom
    float rad = band * uBlur * (uSize.y / 480.0);        // blur radius in pixels, scaled to the backing size
    vec3 c;
    if (rad < 0.15) {
        c = texture(uTex, uv).rgb;
    } else {
        float lod = clamp(log2(rad) - 0.6, 0.0, 4.0);
        c = vec3(0.0);
        for (int i = 0; i < 12; i++) {
            float a = float(i) * 2.39996;
            float r = sqrt((float(i) + 0.5) / 12.0) * rad;
            c += textureLod(uTex, uv + vec2(cos(a), sin(a)) * r / uSize, lod).rgb;
        }
        c /= 12.0;
    }
    // bloom: what is still bright after a heavy blur spills back over the picture
    vec3 b = (textureLod(uTex, uv, 2.5).rgb + textureLod(uTex, uv, 3.5).rgb + textureLod(uTex, uv, 4.5).rgb) / 3.0;
    c += max(b - vec3(uThr), 0.0) * uBloom * 2.2;
    float l = dot(c, vec3(0.299, 0.587, 0.114));
    c = mix(vec3(l), c, uSat);
    c = (c - 0.5) * uCon + 0.5;
    float v = length((uv - 0.5) * vec2(1.0, 1.15)) * 1.2;
    c *= 1.0 - uVig * smoothstep(0.35, 1.0, v);
    o = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;

export function installPost2d(stageEl, gameCanvas) {
    if (!stageEl || !gameCanvas) return;
    const ov = document.createElement("canvas");
    ov.id = "post2d";
    ov.style.cssText = "position:absolute;pointer-events:none;display:none;image-rendering:pixelated;border:none;border-radius:0;background:transparent;max-width:none;max-height:none;z-index:2";
    stageEl.appendChild(ov);
    let gl = null, prog = null, tex = null, loc = null, failed = false;

    function init() {
        gl = ov.getContext("webgl2", { alpha: false, antialias: false, premultipliedAlpha: false });
        if (!gl) { failed = true; return false; }
        const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
        try {
            prog = gl.createProgram();
            gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
            gl.linkProgram(prog);
            if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
        } catch (e) { console.warn("[hd2d] shader failed:", e.message); failed = true; return false; }
        gl.useProgram(prog);
        const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
        const a = gl.getAttribLocation(prog, "aPos"); gl.enableVertexAttribArray(a); gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);
        tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        loc = {};
        for (const n of ["uTex", "uSize", "uBlur", "uFocus", "uBloom", "uThr", "uSat", "uCon", "uVig"]) loc[n] = gl.getUniformLocation(prog, n);
        return true;
    }

    function frame() {
        requestAnimationFrame(frame);
        const on = fx.hd2d && !failed && !gameCanvas.hidden && gameCanvas.width > 0;
        if (!on) { if (ov.style.display !== "none") ov.style.display = "none"; return; }
        if (!gl && !init()) { ov.style.display = "none"; return; }
        // sit exactly on the game canvas's content box (inside its border), whatever the page does to it
        const s = stageEl.getBoundingClientRect(), r = gameCanvas.getBoundingClientRect();
        ov.style.left = (r.left - s.left + gameCanvas.clientLeft) + "px"; ov.style.top = (r.top - s.top + gameCanvas.clientTop) + "px";
        ov.style.width = gameCanvas.clientWidth + "px"; ov.style.height = gameCanvas.clientHeight + "px";
        if (ov.width !== gameCanvas.width || ov.height !== gameCanvas.height) { ov.width = gameCanvas.width; ov.height = gameCanvas.height; }
        ov.style.display = "block";
        const t = Object.assign({}, DEFAULTS, window.__hd2d || {});
        gl.viewport(0, 0, ov.width, ov.height);
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, gameCanvas);
        gl.generateMipmap(gl.TEXTURE_2D);
        gl.uniform1i(loc.uTex, 0); gl.uniform2f(loc.uSize, ov.width, ov.height);
        gl.uniform1f(loc.uBlur, t.blur); gl.uniform1f(loc.uFocus, t.focus); gl.uniform1f(loc.uBloom, t.bloom);
        gl.uniform1f(loc.uThr, t.thr); gl.uniform1f(loc.uSat, t.sat); gl.uniform1f(loc.uCon, t.con); gl.uniform1f(loc.uVig, t.vig);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
    requestAnimationFrame(frame);
}
