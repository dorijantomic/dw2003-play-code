// Materialize the persistent three-row fight report. The native screen shows
// the whole pack (not only Digimon that were tagged into the fight), while EXP
// is added only to the participants selected by the reward resolver.
export function buildFightReportRows(roster, records, profiles, rewardXpByIndex = {}) {
  return (roster ?? []).slice(0, 3).map((member, index: string | number) => {
    const stats = member?.stats ?? records?.[index]?.statsRecord ?? {};
    const rookieId = Number(member?.rookieId ?? records?.[index]?.rookieId ?? 0);
    const rewardXp = Number(rewardXpByIndex[index] ?? 0);
    const ledger = stats.formLedger ?? [];
    // The three bars are the partner's DIGIVOLUTIONS. Its own base form owns
    // the plate, the picture and the name strip above them, and it also holds
    // a form-ledger record of its own (the rookie banks DV exp against itself),
    // so it has to be dropped here or it takes a bar as well.
    const formIds = (stats.equippedForms?.length
      ? stats.equippedForms
      : ledger.map((entry) => entry.id))
      .filter((id) => Number(id) !== rookieId)
      .slice(0, 3);
    return {
      index,
      rookieId,
      name: member?.name ?? records?.[index]?.profile?.name ?? "",
      level: Number(stats.level ?? records?.[index]?.level ?? 1),
      xp: Math.min(999999, Number(stats.xp ?? 0) + rewardXp),
      forms: formIds.map((id) => {
        const record = ledger.find((entry) => Number(entry.id) === Number(id));
        return {
          id: Number(id),
          name: profiles?.[Number(id)]?.name ?? "",
          level: Number(record?.formLevel ?? 1),
        };
      }),
    };
  });
}

// One vsync of the EXP odometer (F0x80083d9c). After 10 vsyncs the original
// snaps to the target instead of crawling.
export function expCountStep(displayed: number, target: number) {
  let digits = 0;
  let rest = target;
  let place = 10;
  if (rest !== 0) {
    do {
      digits += 1;
      rest -= rest % place;
      place *= 10;
    } while (rest !== 0);
  }
  let ones = 1;
  for (let n = digits - 1; n > 0; n--) ones = ones * 10 + 1;
  let next = displayed + ones;
  if (ones * 9 < next) next = next - 1 - ones * 9;
  return next;
}

export function expCountDisplayed(start, target, frames: number) {
  const from = Number(start) || 0;
  const to = Number(target) || 0;
  if (frames >= 10 || from === to) return to;
  let shown = from;
  for (let i = 0; i < frames; i++) shown = expCountStep(shown, to);
  return shown;
}

// Per-partner nested sequence from F0x80084ec4 + F0x80083e74, then Bits / Item.
// "Level gained!" is a form-level jingle; "{name}\nLevel {n}!" is the partner.
export function buildFightReportPages({
  xp = 0,
  bits = 0,
  droppedItem = null,
  events = [],
} = {}) {
  const pages = [];
  for (const ev of events) {
    const share = Number(ev.xp) || 0;
    if (share > 0) {
      const oldXp = Number(ev.oldXp) || 0;
      pages.push({
        kind: "exp",
        index: ev.index,
        value: share,
        startXp: oldXp,
        targetXp: oldXp + share,
        message: `EXP gained:\n${share} EXP`,
      });
    }
    for (const fl of ev.formLevels ?? [])
      pages.push({
        kind: "form-level", index: ev.index, value: fl.level, form: fl.name,
        message: "Level gained!", jingle: "jingle03",
      });
    for (const tech of ev.learnedTechs ?? [])
      pages.push({ kind: "tech", index: ev.index, value: tech, message: `Learned Tech:\n${tech}` });
    for (const tech of ev.loadableTechs ?? [])
      pages.push({ kind: "load", index: ev.index, value: tech, message: `Can load Tech:\n${tech}` });
    if ((ev.newLevel ?? 0) > (ev.oldLevel ?? 0))
      pages.push({
        kind: "partner-level", index: ev.index, value: ev.newLevel,
        message: `${ev.name}\nLevel ${ev.newLevel}!`, jingle: "jingle02",
      });
    for (const u of ev.unlocked ?? []) {
      if (u.slotFull) {
        pages.push({
          kind: "slot-full", index: ev.index, value: u.name, form: u.name,
          message: "Digivolve Slot full.\nStoring to Digimon Lab.",
        });
      } else {
        pages.push({
          kind: "digivolve", index: ev.index, value: u.name, form: u.name,
          message: `Digivolve learned:\n${u.name}`,
        });
      }
    }
  }
  if (bits > 0)
    pages.push({ kind: "bit", value: bits, message: `BIT gained:\n${bits} BIT` });
  if (droppedItem)
    pages.push({ kind: "item", value: droppedItem, message: `Item gained:\n${droppedItem}` });
  if (!pages.length) {
    pages.push({ kind: "exp", value: xp, startXp: 0, targetXp: xp, message: `EXP gained:\n${xp} EXP` });
  }
  return pages;
}

// F0x80083260: base = pageIndex * header.rowStepY (50), then 3 party rows at
// party_row.stepY (15). Walker shows one page at a time, so draw with pageIndex 0.
// One partner's group on the fight report. F0x80083260 and F0x80083744 both
// key off arg0->unk5C, the PARTY SLOT: the group sits at slot * 50 down the
// page, and F0x80083744 hands the same field to the portrait chooser. The three
// rows inside a group are that Digimon's digivolve bars, not the three
// partners. Until 2026-09-04 this returned one group and the walker drew the
// three partners into its bars.
export function fightReportGroupGeom(layout, groupIndex = 0) {
  const g = layout?.group;
  const f = layout?.form_slot;
  if (!g || !f) return null;
  const base = groupIndex * g.stepY;
  const at = (e) => ({ x: e.x, y: base + e.yOff });
  const slots = [];
  for (let j = 0; j < f.count; j++) {
    const dy = base + f.stepY * j;
    slots.push({
      barClip: f.bar.clip,
      barX: f.bar.x,
      barY: dy + f.bar.yOff,
      highlightClip: f.highlight?.clip ?? null,
      highlightX: f.highlight?.x ?? null,
      highlightY: f.highlight == null ? null : dy + f.highlight.yOff,
      markerClip: f.marker?.clip ?? null,
      markerX: f.marker?.x ?? null,
      markerY: f.marker == null ? null : dy + f.marker.yOff,
      markerRamp: f.marker
        ? { rampSteps: f.marker.rampSteps, stepVsync: f.marker.stepVsync }
        : null,
      nameX: f.name.x,
      nameY: dy + f.name.yOff,
      valueX: f.value.x,
      valueY: dy + f.value.yOff,
    });
  }
  return {
    base,
    plate: { clip: g.plate.clip, ...at(g.plate) },
    portrait: { ...at(g.portrait), frames: g.portrait.frames,
                stepVsync: g.portrait.stepVsync },
    name: at(g.name),
    levelLabel: { str: g.level_label.str, ...at(g.level_label) },
    levelValue: at(g.level_value),
    xpValue: at(g.xp_value),
    xpLabel: { str: g.xp_label.str, ...at(g.xp_label) },
    highlight: g.highlight
      ? { clip: g.highlight.clip, frames: g.highlight.frames,
          stepVsync: g.highlight.stepVsync, ...at(g.highlight) }
      : null,
    levelArrow: g.level_arrow
      ? { clip: g.level_arrow.clip, pages: g.level_arrow.pages,
          rampSteps: g.level_arrow.rampSteps, stepVsync: g.level_arrow.stepVsync,
          ...at(g.level_arrow) }
      : null,
    slots,
    message: {
      x: layout.message.x,
      y: layout.message.y,
      kind: layout.message.kind,
    },
  };
}

// The portrait's frame. One step every 13 vsyncs, then back to the start --
// the table's own -1 marks where each rookie's loop ends, and the sequences are
// already trimmed to it. PAL runs at 50 Hz.
export function fightReportPortraitClip(portrait, rookieId, seconds: number) {
  const seq = portrait?.frames?.[String(rookieId)];
  if (!seq?.length) return null;
  const step = (portrait.stepVsync ?? 13) / 50;
  return seq[Math.floor(Math.max(0, seconds) / step) % seq.length];
}

// The mark over the partner the page is about: four colours, one step every
// five vsyncs, looping. PAL runs at 50 Hz.
export function fightReportCycleRow(entry, seconds: number) {
  const n = entry?.frames ?? 4;
  const step = (entry?.stepVsync ?? 5) / 50;
  return Math.floor(Math.max(0, seconds) / step) % n;
}

// The level arrow, and the plate under it: the colour RAMPS and then STOPS.
// It does not loop back to the start.
export function fightReportRampRow(entry, seconds: number) {
  const n = entry?.rampSteps ?? 11;
  const step = (entry?.stepVsync ?? 3) / 50;
  return Math.min(n - 1, Math.floor(Math.max(0, seconds) / step));
}

// The pages that are about one digivolution bar rather than the partner.
export const FORM_PAGE_KINDS = new Set(["form-level", "digivolve", "slot-full"]);

// Which of a partner's three bars a page is about, or null when the page is
// about the partner itself.
export function fightReportMarkedSlot(page, row) {
  if (!page || !row || !FORM_PAGE_KINDS.has(page.kind)) return null;
  const want = page.form ?? page.value;
  const j = (row.forms ?? []).findIndex((f) => f?.name && f.name === want);
  return j >= 0 ? j : null;
}

// How many groups the page holds -- three party slots.
export function fightReportGroupCount(layout) {
  return layout?.group?.count ?? 0;
}
