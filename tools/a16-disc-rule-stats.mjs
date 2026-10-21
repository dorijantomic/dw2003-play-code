// A16 step 1b: statistics of the disc's own launch->strike gap against each pack's timing.
import fs from "node:fs";
const data = JSON.parse(fs.readFileSync("/home/dorij/scratch-research/a16-disc-rule.json", "utf8"));
const rows = data.rows.filter((r) => r.gap != null && r.pack);
const med = (a) => { const b = a.slice().sort((x, y) => x - y); return b.length ? b[b.length >> 1] : null; };
const q = (a, p) => { const b = a.slice().sort((x, y) => x - y); return b[Math.min(b.length - 1, Math.floor(p * (b.length - 1)))]; };
const stats = (name, f) => {
  const v = rows.map(f).filter((x) => x != null);
  console.log(name.padEnd(26), "n", String(v.length).padStart(3), "median", String(med(v)).padStart(5),
    "p10", String(q(v, 0.1)).padStart(5), "p90", String(q(v, 0.9)).padStart(5),
    "mean", (v.reduce((s, x) => s + x, 0) / v.length).toFixed(1),
    "|err|<=4", String(v.filter((x) => Math.abs(x) <= 4).length).padStart(3),
    "|err|<=12", String(v.filter((x) => Math.abs(x) <= 12).length).padStart(3));
};
stats("gap - arrive", (r) => r.gap - r.pack.arrive);
stats("gap - pack.ticks", (r) => r.gap - r.pack.ticks);
stats("gap - (park+travel)", (r) => r.gap - (r.pack.park + r.pack.travel));
stats("gap - (arrive+8)", (r) => r.gap - (r.pack.arrive + 8));
stats("gap - (arrive*?)", (r) => r.gap - r.pack.arrive);
// by clip
for (const clip of [9, 11, 13]) {
  const sub = rows.filter((r) => r.clip === clip);
  console.log("clip", clip, "n", sub.length, "median gap-arrive", med(sub.map((r) => r.gap - r.pack.arrive)),
    "median gap", med(sub.map((r) => r.gap)), "median arrive", med(sub.map((r) => r.pack.arrive)));
}
// travel==0 packs
const still = rows.filter((r) => r.pack.travel === 0);
console.log("still packs", still.length, "median gap", med(still.map((r) => r.gap)), JSON.stringify(still.slice(0, 12).map((r) => [r.model, r.clip, r.gap, r.pack.ticks])));
// the best-fit linear model gap = a + b*arrive
const xs = rows.map((r) => r.pack.arrive), ys = rows.map((r) => r.gap);
const mx = xs.reduce((s, x) => s + x, 0) / xs.length, my = ys.reduce((s, x) => s + x, 0) / ys.length;
const bxy = xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0) / xs.reduce((s, x) => s + (x - mx) ** 2, 0);
const a = my - bxy * mx;
console.log("fit gap =", a.toFixed(2), "+", bxy.toFixed(3), "* arrive; residual sd",
  Math.sqrt(xs.reduce((s, x, i) => s + (ys[i] - (a + bxy * x)) ** 2, 0) / xs.length).toFixed(2));
// residual table for the worst fits
const worst = rows.map((r) => ({ ...r, err: r.gap - r.pack.arrive })).sort((p, q2) => Math.abs(q2.err) - Math.abs(p.err)).slice(0, 15);
console.log("worst by |gap-arrive|:");
for (const w of worst) console.log(" ", w.model, w.clip, "gap", w.gap, "arrive", w.pack.arrive, "ticks", w.pack.ticks, "park", w.pack.park, "travel", w.pack.travel, "err", w.err);
