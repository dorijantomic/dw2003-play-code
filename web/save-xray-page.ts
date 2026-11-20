// web/save-xray-page.js — the page half of the Save X-ray. It reads the three
// card slots the game's own save screen wrote, hands them to the pure model
// (web/save-xray.js) and draws the model's own sections. No number here is
// hand-written; no slot without a card image is ever decoded.
import { SECTION_TABLE, SLOT_COUNT, slotKey, decodeSlots, diffSlots } from "./save-xray.js";

const $ = (id) => document.getElementById(id);
const slotsEl = $("slots");
const viewEl = $("view");
const metaEl = $("meta");
const diffSel = $("diffSlot");
const diffRowsEl = $("diffRows");

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const hex4 = (n) => "0x" + Number(n).toString(16).padStart(4, "0");
const hexBytes = (bytes) => Array.from(bytes, (b) => Number(b).toString(16).padStart(2, "0")).join(" ");
const playTime = (seconds) => {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  return `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};
const num = (n) => Number(n).toLocaleString("en-US");
const showValue = (v) => (Array.isArray(v) ? hexBytes(v) : String(v ?? ""));
const chips = (rows) => `<div class="chips">${rows.map(([k, v]) => `<span class="chip">${esc(k)} <b>${esc(v)}</b></span>`).join("")}</div>`;

// The one store read: the three slot entries the memory-card screen / card driver
// wrote (web/save.js SLOT_KEY). An entry with no image is a summary only.
const raw = [];
for (let i = 0; i < SLOT_COUNT; i++) raw.push(localStorage.getItem(slotKey(i)));
const slots = decodeSlots(raw);
const ready = slots.filter((slot) => slot.hasImage);
let selected = ready.length ? ready[0].slot : null;

function bag(counts) {
  const rows = counts.map((n, id) => [id, n]).filter(([id, n]) => id >= 1 && n > 0);
  return `${rows.length} item ids with a count ${chips(rows.map(([id, n]) => [`#${id}`, `×${n}`]))}`;
}

function rosterBody(roster) {
  return roster.map((rec) => {
    const head = `slot ${rec.slot} · owned ${rec.owned} · current form ${rec.currentForm} · Lv ${rec.level} · ` +
      `HP ${rec.hp}/${rec.maxHp} · MP ${rec.mp}/${rec.maxMp} · TP ${rec.tp} · EXP ${rec.xp}`;
    const forms = rec.forms.map((cell) =>
      `<tr><td class="num">${cell.index}</td><td class="num">${cell.id}</td><td class="num">${cell.level}</td>` +
      `<td class="num">${cell.preserved}</td><td class="num">${cell.dvexp}</td>` +
      `<td>${cell.tech.map((t) => t.toString(16).padStart(4, "0")).join(" ")}</td></tr>`).join("");
    const retained = rec.retained.map((gap) =>
      `<div class="none">retained +${hex4(gap.offset)} (${gap.length} bytes): ${esc(hexBytes(gap.bytes))}</div>`).join("");
    return `<details><summary>${esc(head)}</summary>` +
      `<div class="val">core ${rec.core.join(" / ")} · elements ${rec.elements.join(" / ")} · ` +
      `equipped forms ${rec.equippedForms.join(" / ")} · ` +
      `equipment ${Object.entries(rec.equipment).map(([k, v]) => `${k} ${v}`).join(" · ")} · ` +
      `ultra drill ${rec.lastUltraDrill}${rec.storyOrdinal === null ? "" : ` · story ordinal ${rec.storyOrdinal}`}</div>` +
      retained +
      `<table><thead><tr><th>#</th><th>form id</th><th>lv</th><th>+3</th><th>DVEXP</th><th>six technique words</th></tr></thead>` +
      `<tbody>${forms}</tbody></table></details>`;
  }).join("");
}

function sectionValue(name, x) {
  switch (name) {
    case "header checksum": return `checksum byte <b>${x.header.checksum}</b>`;
    case "header format": return `format byte <b>${x.header.format}</b>`;
    case "clock": return `<b>${playTime(x.clock.totalSeconds)}</b> · ${x.clock.hours} h ${x.clock.minutes} m ${x.clock.seconds} s`;
    case "name": return `<b>${esc(x.name.text || "(empty)")}</b> · ${hexBytes(x.name.bytes)}`;
    case "bits": return `<b>${num(x.bits)}</b> BIT`;
    case "party": return chips(x.party.map((slot, i) => [`party ${i}`, slot < 0 ? "empty (-1)" : slot]));
    case "held": return bag(x.items.held);
    case "worn": return bag(x.items.worn);
    case "card counts":
      return `${x.cards.owned.length} owned card ids · ${x.cards.seen.length} seen ${chips(x.cards.owned.slice(0, 40).map(([id, n]) => [`#${id}`, `×${n}`]))}` +
        (x.cards.owned.length > 40 ? ` <span class="none">+${x.cards.owned.length - 40} more</span>` : "");
    case "album":
      return chips(x.cards.seen.slice(0, 60).map((id) => [`#${id}`, "seen"])) +
        (x.cards.seen.length > 60 ? ` <span class="none">+${x.cards.seen.length - 60} more</span>` : "");
    case "folders":
      return x.folders.map((f) =>
        `<div>folder ${f.index + 1} “${esc(f.name.text || "")}” · ${f.cards.filter((n) => n).length} cards</div>` +
        chips(f.cards.map((n, i) => [`card ${i + 1}`, n ? `#${n}` : "—"]))).join("");
    case "roster": return rosterBody(x.roster);
    case "pack": return `<b>${["A", "B", "C"][x.packId] ?? x.packId}</b> (raw ${x.packId})`;
    case "flags":
      return Object.values(x.flags).map((row) =>
        `<div>bank ${row.bank} <code>+${hex4(row.offset)}</code> · ${row.length} bytes · ${esc(hexBytes(row.bytes))}</div>`).join("");
    default: return "";
  }
}

function renderSlots() {
  slotsEl.innerHTML = slots.map((slot) => {
    const name = slot.record?.name ? esc(slot.record.name) : (slot.empty ? "empty" : "no card image");
    const line = slot.xray
      ? `${num(slot.xray.bits)} BIT · ${playTime(slot.xray.clock.totalSeconds)}`
      : (slot.empty ? "nothing saved here" : "saved before the card driver kept the block");
    return `<button type="button" data-slot="${slot.slot}" ${slot.hasImage ? "" : "disabled"} class="${slot.slot === selected ? "on" : ""}">` +
      `<b>Slot ${slot.slot + 1}</b><span>${name}</span><small>${esc(line)}</small></button>`;
  }).join("");
}

function renderView() {
  const slot = selected === null ? null : slots[selected];
  if (!slot || !slot.xray) {
    metaEl.textContent = "no card image in any slot";
    viewEl.innerHTML = `<p class="none">No slot carries a card image yet. Save a game from the memory-card ` +
      `screen first; a slot saved before the card driver kept the block is left alone rather than guessed at.</p>`;
    return;
  }
  const x = slot.xray;
  metaEl.textContent = `slot ${slot.slot + 1} · ${x.size} bytes · named ${x.retained.namedBytes} · ` +
    `retained ${x.retained.unexplainedBytes}` + (slot.record?.name ? ` · ${slot.record.name}` : "");
  viewEl.innerHTML = SECTION_TABLE.map((section) => {
    const ret = section.name === "retained";
    return `<div class="sec${ret ? " ret" : ""}"><h3>${esc(section.name)} <code>+${hex4(section.offset)}</code>` +
      `<span>${section.length} bytes</span></h3><p class="note">${esc(section.note)}</p>` +
      (ret ? "" : `<div class="val">${sectionValue(section.name, x)}</div>`) + `</div>`;
  }).join("");
}

function renderDiff() {
  const a = selected === null ? null : slots[selected];
  const other = diffSel.value === "" ? null : slots[Number(diffSel.value)];
  if (!a || !a.xray || !other || !other.xray) {
    diffRowsEl.innerHTML = `<tbody><tr><td class="none" colspan="3">Pick two slots that both carry a card image.</td></tr></tbody>`;
    return;
  }
  const rows = diffSlots(a.image, other.image);
  if (!rows.length) {
    diffRowsEl.innerHTML = `<tbody><tr><td class="none" colspan="3">These two card images are identical, byte for byte.</td></tr></tbody>`;
    return;
  }
  diffRowsEl.innerHTML = `<thead><tr><th>Field</th><th>Slot ${a.slot + 1}</th><th>Slot ${other.slot + 1}</th></tr></thead>` +
    `<tbody>${rows.map((row) =>
      `<tr><td>${esc(row.field)}</td><td class="a">${esc(showValue(row.a))}</td><td class="b">${esc(showValue(row.b))}</td></tr>`).join("")}</tbody>`;
}

function renderPicker() {
  const others = ready.filter((slot) => slot.slot !== selected);
  diffSel.innerHTML = `<option value="">choose a slot…</option>` +
    others.map((slot) => `<option value="${slot.slot}">Slot ${slot.slot + 1}${slot.record?.name ? " — " + esc(slot.record.name) : ""}</option>`).join("");
  diffSel.disabled = others.length === 0;
  if (others.length) diffSel.value = String(others[0].slot);
  renderDiff();
}

slotsEl.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-slot]");
  if (!button || button.disabled) return;
  selected = Number(button.dataset.slot);
  renderSlots();
  renderView();
  renderPicker();
});
diffSel.addEventListener("change", renderDiff);

renderSlots();
renderView();
renderPicker();
