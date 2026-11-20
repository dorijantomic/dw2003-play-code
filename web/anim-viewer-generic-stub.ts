// PLACEHOLDER generator with the same shape as web/fight/generic-motion.js (the real one is written by
// another worker). It exists only so the viewer's Generic section, the ratings and the deep links can
// be built and tested before the real generator lands. The viewer prefers the real file whenever it
// exists and labels this one "STUB" so nobody rates a placeholder by mistake.
//
// These "motions" are NOT generated: each one replays frames the model already owns (a different
// own timeline table per motion, some reversed) so that the pose visibly changes over ticks. Ids are
// guesses; the real generator's ids will differ, and ratings are keyed by id.

export const GENERIC_MOTIONS = [
  { id: "stub_a", name: "Stub A (own table)", description: "placeholder: replays one of the body's own tables", needs: [], bodyPlans: "any" },
  { id: "stub_b", name: "Stub B (own table)", description: "placeholder: replays another own table", needs: [], bodyPlans: "any" },
  { id: "stub_c", name: "Stub C (reversed)", description: "placeholder: an own table played backwards", needs: [], bodyPlans: "any" },
  { id: "stub_d", name: "Stub D (own table)", description: "placeholder", needs: [], bodyPlans: "any" },
  { id: "stub_e", name: "Stub E (reversed)", description: "placeholder", needs: [], bodyPlans: "any" },
  { id: "stub_f", name: "Stub F (own table)", description: "placeholder", needs: [], bodyPlans: "any" },
  { id: "stub_g", name: "Stub G (needs arms)", description: "placeholder: pretends to need arms, so it is greyed on arm-less bodies", needs: ["arm"], bodyPlans: ["biped-upright", "biped-hunched", "winged-biped", "multi-armed", "humanoid-torso-only"] },
  { id: "stub_h", name: "Stub H (needs legs)", description: "placeholder: pretends to need legs", needs: ["leg"], bodyPlans: ["biped-upright", "biped-hunched", "winged-biped", "quadruped", "winged-quadruped", "insectoid", "multi-armed"] },
  { id: "stub_i", name: "Stub I (own table)", description: "placeholder", needs: [], bodyPlans: "any" },
  { id: "stub_j", name: "Stub J (reversed)", description: "placeholder", needs: [], bodyPlans: "any" },
];

let planOf = null;
/** The viewer hands the anatomy lookup in, so the stub does not import the big data file itself. */
export function setStubBodyPlanResolver(fn) { planOf = fn; }

export function listGenericMotions(model) {
  const plan = planOf ? planOf(model?.folder) : null;
  return GENERIC_MOTIONS.map((m) => {
    const ok = m.bodyPlans === "any" || !plan || m.bodyPlans.includes(plan);
    return { id: m.id, name: m.name, applicable: ok, ...(ok ? {} : { reason: `stub: needs ${m.needs.join(", ")} (body plan ${plan})` }) };
  });
}

const plainFrames = (t) => (t?.table || []).filter((e) => e && e.value !== 0xFFFF && !(e.value & 0x8000)).map((e) => e.value);

export function bakeGenericMotion(model, id, { offset = 8000 } = {}) {
  const idx = GENERIC_MOTIONS.findIndex((m) => m.id === id);
  if (idx < 0) return { ok: false, reason: `unknown motion ${id}` };
  const listed = listGenericMotions(model).find((m) => m.id === id);
  if (!listed.applicable) return { ok: false, reason: listed.reason };
  const tl = model?.timeline || [];
  const pool = tl.map((t, i) => ({ i, frames: plainFrames(t) })).filter((x) => x.i !== 0 && x.frames.length >= 8);
  if (!pool.length) return { ok: false, reason: "stub: this body has no own table to replay" };
  const src = pool[(idx * 3 + 1) % pool.length];
  let frames = src.frames;
  if (/reversed/.test(GENERIC_MOTIONS[idx].name)) frames = [...frames].reverse();
  const out = JSON.parse(JSON.stringify(model));
  const table = out.timeline.length;
  out.timeline.push({ table: [...frames.map((value) => ({ value, loop_target: 0, aux: null })), { value: 0xFFFF, loop_target: 0, aux: null }] });
  return { ok: true, model: out, table, ticks: Math.ceil(frames.length / 2), report: { stub: true, sourceTable: src.i, frames: frames.length, offsetIgnored: offset } };
}
