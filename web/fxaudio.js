// EXPERIMENT: weather and ambience sound, synthesised with WebAudio (no files):
// rain, wind, blizzard howl, sandstorm hiss, night crickets and thunder.
// One AudioContext of its own, created on the first key press or click (browsers
// block sound before a gesture) and driven every frame by the ambience layer.
let ac = null, master = null, rain = null, wind = null, sand = null, crickets = null, gust = null;
let armed = false;

function noiseBuffer(ctx, seconds = 2) {
    const buf = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < d.length; i++) { const w = Math.random() * 2 - 1; last = (last + 0.02 * w) / 1.02; d[i] = (w * 0.6 + last * 6) * 0.5; }
    return buf;
}
function loopNoise(ctx, buf, type, freq, q) {
    const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain(); g.gain.value = 0;
    src.connect(f); f.connect(g); g.connect(master); src.start();
    return { g, f };
}
function build() {
    if (ac) return true;
    try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch { return false; }
    master = ac.createGain(); master.gain.value = 0.55; master.connect(ac.destination);
    const buf = noiseBuffer(ac, 3);
    rain = loopNoise(ac, buf, "bandpass", 3200, 0.5);
    wind = loopNoise(ac, buf, "lowpass", 480, 0.7);
    sand = loopNoise(ac, buf, "bandpass", 1500, 0.4);
    // slow gusts modulate the wind
    gust = ac.createOscillator(); gust.frequency.value = 0.17;
    const gd = ac.createGain(); gd.gain.value = 180; gust.connect(gd); gd.connect(wind.f.frequency); gust.start();
    // crickets: a high tone chopped by two fast tremolos
    const osc = ac.createOscillator(); osc.type = "sine"; osc.frequency.value = 4300;
    const cg = ac.createGain(); cg.gain.value = 0;
    const trem = ac.createOscillator(); trem.type = "square"; trem.frequency.value = 17;
    const tg = ac.createGain(); tg.gain.value = 0.5; trem.connect(tg); tg.connect(cg.gain);
    const gate = ac.createOscillator(); gate.type = "square"; gate.frequency.value = 2.6;
    const gg = ac.createGain(); gg.gain.value = 0.5; gate.connect(gg); gg.connect(cg.gain);
    const out = ac.createGain(); out.gain.value = 0; osc.connect(cg); cg.connect(out); out.connect(master);
    osc.start(); trem.start(); gate.start();
    crickets = { out };
    return true;
}
function arm() {
    if (armed) return;
    armed = true;
    const wake = () => { if (build() && ac.state === "suspended") ac.resume(); };
    for (const ev of ["keydown", "mousedown", "pointerdown", "touchstart"]) window.addEventListener(ev, wake, { passive: true });
}
arm();

const ease = (param, v, ctx, tc = 0.4) => param.setTargetAtTime(v, ctx.currentTime, tc);

// levels: { rain, wind (0..1), sand, night } ; on = the Sound switch
export function setSound(on, lv) {
    if (!ac) return;
    ease(master.gain, on ? 0.55 : 0, ac, 0.2);
    ease(rain.g.gain, on ? lv.rain * 0.16 : 0, ac);
    ease(wind.g.gain, on ? lv.wind * 0.20 : 0, ac, 0.8);
    ease(sand.g.gain, on ? lv.sand * 0.14 : 0, ac);
    ease(crickets.out.gain, on ? lv.night * 0.07 : 0, ac, 1.2);
}
export function thunder(on, delayMs, pan = 0) {
    if (!ac || !on || ac.state !== "running") return;
    setTimeout(() => {
        if (!ac) return;
        const src = ac.createBufferSource(); src.buffer = noiseBuffer(ac, 4);
        const f = ac.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 220;
        const g = ac.createGain(); const t0 = ac.currentTime;
        g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(0.9, t0 + 0.12);
        g.gain.setTargetAtTime(0, t0 + 0.2, 0.9);
        src.connect(f); f.connect(g);
        if (ac.createStereoPanner) { const pn = ac.createStereoPanner(); pn.pan.value = pan; g.connect(pn); pn.connect(master); } else g.connect(master);
        src.start(t0); src.stop(t0 + 4);
    }, delayMs);
}

// Footsteps by ground type: grass, sand, snow, stone, puddle, water. Short filtered noise
// bursts (plus a low thump on stone); `vol` lets background bodies step quietly.
export function footstep(on, type, vol = 1) {
    if (!on || !ac || ac.state !== "running") return;
    const t0 = ac.currentTime, buf = noiseBuffer(ac, 1);
    const burst = (kind, freq, q, peak, dur, delay = 0) => {
        const src = ac.createBufferSource(); src.buffer = buf;
        const f = ac.createBiquadFilter(); f.type = kind; f.frequency.value = freq; f.Q.value = q;
        const g = ac.createGain(); const a = t0 + delay;
        g.gain.setValueAtTime(0, a); g.gain.linearRampToValueAtTime(peak * vol, a + 0.008);
        g.gain.exponentialRampToValueAtTime(0.0005, a + dur);
        src.connect(f); f.connect(g); g.connect(master); src.start(a, Math.random() * 0.5); src.stop(a + dur + 0.02);
    };
    if (type === "wood") {
        burst("bandpass", 700 + Math.random() * 120, 1.4, 0.22, 0.09);
        const o = ac.createOscillator(); o.type = "triangle"; o.frequency.setValueAtTime(210, t0); o.frequency.exponentialRampToValueAtTime(120, t0 + 0.08);
        const g = ac.createGain(); g.gain.setValueAtTime(0.2 * vol, t0); g.gain.exponentialRampToValueAtTime(0.0005, t0 + 0.11);
        o.connect(g); g.connect(master); o.start(t0); o.stop(t0 + 0.12);
    } else if (type === "metal") {
        burst("highpass", 3400, 0.8, 0.1, 0.04);
        for (const [fq, pk] of [[820, 0.12], [1330, 0.08]]) {
            const o = ac.createOscillator(); o.type = "sine"; o.frequency.value = fq * (0.98 + Math.random() * 0.04);
            const g = ac.createGain(); g.gain.setValueAtTime(pk * vol, t0); g.gain.exponentialRampToValueAtTime(0.0005, t0 + 0.22);
            o.connect(g); g.connect(master); o.start(t0); o.stop(t0 + 0.24);
        }
    } else if (type === "grass") burst("bandpass", 2400 + Math.random() * 500, 0.7, 0.14, 0.09);
    else if (type === "sand") burst("bandpass", 1150 + Math.random() * 250, 0.5, 0.16, 0.12);
    else if (type === "snow") { burst("lowpass", 1700, 0.6, 0.2, 0.07); burst("lowpass", 1300, 0.6, 0.16, 0.09, 0.05); }
    else if (type === "puddle" || type === "water") { burst("bandpass", 900 + Math.random() * 300, 1.1, 0.24, 0.2); burst("highpass", 3200, 0.7, 0.1, 0.1, 0.04); }
    else {
        burst("highpass", 2600, 0.7, 0.1, 0.03);
        const o = ac.createOscillator(); o.frequency.setValueAtTime(150, t0); o.frequency.exponentialRampToValueAtTime(70, t0 + 0.05);
        const g = ac.createGain(); g.gain.setValueAtTime(0.18 * vol, t0); g.gain.exponentialRampToValueAtTime(0.0005, t0 + 0.07);
        o.connect(g); g.connect(master); o.start(t0); o.stop(t0 + 0.08);
    }
}

// ---------------------------------------------------------- place ambience
// Water lapping, forest rustle, city hum and daytime birdsong, each eased in and out by
// how much of it the current map has (levels 0..1). Built lazily on first use.
let pa = null, birdTimer = 0, birdLevel = 0, birdPan = 0;
function buildPlace() {
    if (pa || !ac) return !!pa;
    const buf = noiseBuffer(ac, 3);
    const lap = loopNoise(ac, buf, "lowpass", 760, 0.6);
    const lfo = ac.createOscillator(); lfo.frequency.value = 0.27;
    const ld = ac.createGain(); ld.gain.value = 0.5; lfo.connect(ld); ld.connect(lap.g.gain); lfo.start();
    const rustle = loopNoise(ac, buf, "bandpass", 1100, 0.9);
    const rl = ac.createOscillator(); rl.frequency.value = 0.13;
    const rd = ac.createGain(); rd.gain.value = 420; rl.connect(rd); rd.connect(rustle.f.frequency); rl.start();
    const hum = loopNoise(ac, buf, "lowpass", 240, 1.2);
    const h1 = ac.createOscillator(); h1.type = "sawtooth"; h1.frequency.value = 58;
    const hf = ac.createBiquadFilter(); hf.type = "lowpass"; hf.frequency.value = 180;
    const hg = ac.createGain(); hg.gain.value = 0; h1.connect(hf); hf.connect(hg); hg.connect(master); h1.start();
    pa = { lap, rustle, hum, hg };
    return true;
}
function chirp() {
    if (!ac || ac.state !== "running" || birdLevel < 0.05) return;
    const notes = 2 + ((Math.random() * 4) | 0), base = 2300 + Math.random() * 1800, pan = (Math.random() * 2 - 1) * 0.9;
    const t0 = ac.currentTime;
    for (let i = 0; i < notes; i++) {
        const a = t0 + i * (0.09 + Math.random() * 0.04);
        const o = ac.createOscillator(); o.type = "sine";
        o.frequency.setValueAtTime(base, a); o.frequency.exponentialRampToValueAtTime(base * (1.25 + Math.random() * 0.5), a + 0.07);
        const g = ac.createGain(); g.gain.setValueAtTime(0, a); g.gain.linearRampToValueAtTime(0.05 * birdLevel, a + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0003, a + 0.08);
        o.connect(g);
        if (ac.createStereoPanner) { const pn = ac.createStereoPanner(); pn.pan.value = pan; g.connect(pn); pn.connect(master); } else g.connect(master);
        o.start(a); o.stop(a + 0.1);
    }
}
function birdLoop() {
    chirp();
    birdTimer = setTimeout(birdLoop, 900 + Math.random() * 3200);
}
// lv = { water, forest, city, birds }
export function setAmbience(on, lv) {
    if (!ac || !buildPlace()) return;
    ease(pa.lap.g.gain, on ? (lv.water || 0) * 0.17 : 0, ac, 1.2);
    ease(pa.rustle.g.gain, on ? (lv.forest || 0) * 0.07 : 0, ac, 1.5);
    ease(pa.hum.g.gain, on ? (lv.city || 0) * 0.09 : 0, ac, 1.5);
    ease(pa.hg.gain, on ? (lv.city || 0) * 0.035 : 0, ac, 1.5);
    birdLevel = on ? lv.birds || 0 : 0;
    if (birdLevel > 0.05 && !birdTimer) birdLoop();
    if (birdLevel <= 0.05 && birdTimer) { clearTimeout(birdTimer); birdTimer = 0; }
}

// ------------------------------------------------------------------- music
// The game's own music element is routed through a low-pass filter and a gain, so weather can
// duck it and muffle it. Connected only the first time it is wanted (and only once the
// AudioContext is running, so it can never silence the music).
let mus = null;
export function setMusic(el, on, duck, muffle) {
    if (!ac || ac.state !== "running" || !el) return;
    if (!mus) {
        if (!on) return;
        try {
            const src = ac.createMediaElementSource(el);
            const f = ac.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 22000;
            const g = ac.createGain();
            src.connect(f); f.connect(g); g.connect(ac.destination);
            mus = { f, g };
        } catch { return; }
    }
    ease(mus.g.gain, on ? 1 - 0.42 * duck : 1, ac, 0.9);
    ease(mus.f.frequency, on ? 22000 - 20200 * muffle : 22000, ac, 0.9);
}
