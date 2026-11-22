
import type { DigimonRecord, RosterMember, PlayerRecord } from "../types/battle.js";
import type { FormLedgerEntry, PartnerStats } from "../game/types.js";
/** What the report pages read off one partner's payout (a ParticipantProgress carries all of it; a duel's summary only some). */
export interface FightReportEvent {
  index?: number;
  xp?: number;
  oldXp?: number;
  name?: string;
  oldLevel?: number;
  newLevel?: number;
  formLevels?: { name: string; level: number; }[];
  learnedTechs?: string[];
  loadableTechs?: string[];
  unlocked?: { name: string; slotFull?: boolean | undefined; }[];
}

/** One equipped form on a report row. */
export interface FightReportForm {
  id: number;
  name: string;
  level: number;
}

/** One partner's row on the fight report. */
export interface FightReportRow {
  index: number;
  rookieId: number;
  name: string;
  level: number;
  xp: number;
  forms: FightReportForm[];
}

/** One page of the report: what the box says and the row/form it is about. */
export interface FightReportPage {
  kind: string;
  index?: number | undefined;
  value: string | number;
  startXp?: number;
  targetXp?: number;
  /** the form the page marks, when it marks one */
  form?: string;
  message: string;
  jingle?: string;
}
interface FightReportGeomPoint {
  x: number;
  yOff: number;
}


interface FightReportGeomClip extends FightReportGeomPoint {
  clip: string;
}


interface FightReportGeomPortrait extends FightReportGeomPoint {
  /** per rookie id (a string key), the clip ids the portrait cycles through */
  frames: Record<string, (string | number)[]>;
  stepVsync: number;
}


interface FightReportGeomLabel extends FightReportGeomPoint {
  str: string;
}


interface FightReportGeomHighlight extends FightReportGeomClip {
  frames: number;
  stepVsync: number;
}


interface FightReportGeomLevelArrow extends FightReportGeomClip {
  /** the page kinds the arrow shows on */
  pages: string[];
  rampSteps: number;
  stepVsync: number;
}


interface FightReportGeomMarker extends FightReportGeomClip {
  rampSteps: number;
  stepVsync: number;
}


interface FightReportFormSlotLayout {
  count: number;
  stepY: number;
  bar: FightReportGeomClip;
  highlight?: FightReportGeomClip | null;
  marker?: FightReportGeomMarker | null;
  name: FightReportGeomPoint;
  value: FightReportGeomPoint;
}


interface FightReportGroupLayout {
  /** how many partner groups the page can show */
  count?: number;
  stepY: number;
  plate: FightReportGeomClip;
  portrait: FightReportGeomPortrait;
  name: FightReportGeomPoint;
  level_label: FightReportGeomLabel;
  level_value: FightReportGeomPoint;
  xp_value: FightReportGeomPoint;
  xp_label: FightReportGeomLabel;
  highlight?: FightReportGeomHighlight | null;
  level_arrow?: FightReportGeomLevelArrow | null;
}


interface FightReportMessageLayout {
  x: number;
  y: number;
  kind: number;
}


/** assets/data/stfgtrep_ui.json: the fight report's own layout */
export interface FightReportLayout {
  group?: FightReportGroupLayout | null;
  form_slot?: FightReportFormSlotLayout | null;
  message: FightReportMessageLayout;
  ambient_bg: { clip: string; animated: { stepMs: number; max: number; }; };
  corner_badge: {
    clip: string; x: number; y: number;
    /** the page kinds the badge shows on */
    pages?: string[];
    value: { x: number; y: number; kind: number; };
    label: { str: string; x: number; y: number; kind: number; };
  };
  message_bar: { clip: string; x: number; y: number; };
  blink_cursor: { pack: string; clip: string; x: number; y: number; };
}


export interface FightReportSlotGeom {
  barClip: string;
  barX: number;
  barY: number;
  highlightClip: string | null;
  highlightX: number | null;
  highlightY: number | null;
  markerClip: string | null;
  markerX: number | null;
  markerY: number | null;
  markerRamp: { rampSteps: number; stepVsync: number } | null;
  nameX: number;
  nameY: number;
  valueX: number;
  valueY: number;
}


export interface FightReportPortraitGeom {
  x: number;
  y: number;
  frames: Record<string, (string | number)[]>;
  stepVsync: number;
}


export interface FightReportHighlightGeom {
  clip: string;
  frames: number;
  stepVsync: number;
  x: number;
  y: number;
}


export interface FightReportLevelArrowGeom {
  clip: string;
  pages: string[];
  rampSteps: number;
  stepVsync: number;
  x: number;
  y: number;
}


export interface FightReportGroupGeom {
  base: number;
  plate: { clip: string; x: number; y: number };
  portrait: FightReportPortraitGeom;
  name: { x: number; y: number };
  levelLabel: { str: string; x: number; y: number };
  levelValue: { x: number; y: number };
  xpValue: { x: number; y: number };
  xpLabel: { str: string; x: number; y: number };
  highlight: FightReportHighlightGeom | null;
  levelArrow: FightReportLevelArrowGeom | null;
  slots: FightReportSlotGeom[];
  message: FightReportMessageLayout;
}
// Materialize the persistent three-row fight report. The native screen shows
// the whole pack (not only Digimon that were tagged into the fight), while EXP
// is added only to the participants selected by the reward resolver.
export function buildFightReportRows(roster: readonly RosterMember[] | null | undefined, records: readonly PlayerRecord[] | null | undefined, profiles: { [k: string]: DigimonRecord; }, rewardXpByIndex: Record<number, number> = {}): FightReportRow[] {
  return (roster ?? []).slice(0, 3).map((member, index: number) => {
    const stats: Partial<PartnerStats> = member?.stats ?? records?.[index]?.statsRecord ?? {};
    const rookieId = Number(member?.rookieId ?? records?.[index]?.rookieId ?? 0);
    const rewardXp = Number(rewardXpByIndex[index] ?? 0);
    const ledger = stats.formLedger ?? [];
    // The three bars are the partner's DIGIVOLUTIONS. Its own base form owns
    // the plate, the picture and the name strip above them, and it also holds
    // a form-ledger record of its own (the rookie banks DV exp against itself),
    // so it has to be dropped here or it takes a bar as well.
    const formIds = (stats.equippedForms?.length
      ? stats.equippedForms
      : ledger.map((entry: FormLedgerEntry) => entry.id))
      .filter((id: number) => Number(id) !== rookieId)
      .slice(0, 3);
    return {
      index,
      rookieId,
      name: member?.name ?? records?.[index]?.profile?.name ?? "",
      level: Number(stats.level ?? records?.[index]?.level ?? 1),
      xp: Math.min(999999, Number(stats.xp ?? 0) + rewardXp),
      forms: formIds.map((id: number) => {
        const record = ledger.find((entry: FormLedgerEntry) => Number(entry.id) === Number(id));
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

export function expCountDisplayed(start: number | null | undefined, target: number | null | undefined, frames: number) {
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
}: { xp?: number; bits?: number; droppedItem?: string | null; events?: FightReportEvent[]; } = {}) {
  const pages: FightReportPage[] = [];
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
export function fightReportGroupGeom(layout: FightReportLayout | null | undefined, groupIndex = 0): FightReportGroupGeom | null {
  const g = layout?.group;
  const f = layout?.form_slot;
  if (!g || !f) return null;
  const base = groupIndex * g.stepY;
  const at = (e: FightReportGeomPoint) => ({ x: e.x, y: base + e.yOff });
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
export function fightReportPortraitClip(portrait: Pick<FightReportPortraitGeom, "frames"> & { stepVsync?: number | undefined; } | null | undefined, rookieId: number, seconds: number) {
  const seq = portrait?.frames?.[String(rookieId)];
  if (!seq?.length) return null;
  const step = (portrait!.stepVsync ?? 13) / 50;
  return seq[Math.floor(Math.max(0, seconds) / step) % seq.length];
}

// The mark over the partner the page is about: four colours, one step every
// five vsyncs, looping. PAL runs at 50 Hz.
export function fightReportCycleRow(entry: { frames?: number; stepVsync?: number; } | null | undefined, seconds: number) {
  const n = entry?.frames ?? 4;
  const step = (entry?.stepVsync ?? 5) / 50;
  return Math.floor(Math.max(0, seconds) / step) % n;
}

// The level arrow, and the plate under it: the colour RAMPS and then STOPS.
// It does not loop back to the start.
export function fightReportRampRow(entry: { rampSteps?: number; stepVsync?: number; } | null | undefined, seconds: number) {
  const n = entry?.rampSteps ?? 11;
  const step = (entry?.stepVsync ?? 3) / 50;
  return Math.min(n - 1, Math.floor(Math.max(0, seconds) / step));
}

// The pages that are about one digivolution bar rather than the partner.
export const FORM_PAGE_KINDS = new Set(["form-level", "digivolve", "slot-full"]);

// Which of a partner's three bars a page is about, or null when the page is
// about the partner itself.
export function fightReportMarkedSlot(page: FightReportPage | null | undefined, row: FightReportRow | null | undefined) {
  if (!page || !row || !FORM_PAGE_KINDS.has(page.kind)) return null;
  const want = page.form ?? page.value;
  const j = (row.forms ?? []).findIndex((f: FightReportForm) => f?.name && f.name === want);
  return j >= 0 ? j : null;
}

// How many groups the page holds -- three party slots.
export function fightReportGroupCount(layout: FightReportLayout | null | undefined) {
  return layout?.group?.count ?? 0;
}
