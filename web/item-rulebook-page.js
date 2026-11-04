// web/item-rulebook-page.js — the page half of the Item Rulebook. It reads the one
// shipped effect table and draws the rulebook module's own groups; no number here is
// hand-written.
import { ruleRows, capWords, sellSheet, battleOnly, CAPS } from "./item-rulebook.js";

const $ = (id) => document.getElementById(id);
const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const GROUPS = [
    ["hp", "HP charges", "a flat restore, clipped at max HP"],
    ["tp", "TP chips", "trainer points: a flat grant, stopped at 99"],
    ["stat", "Stat chips", "1 to the record's amount a use (a roll), clipped at the cap"],
    ["elem", "Elemental disks", "the seven tolerances: 1 to 10 a use"],
    ["battle", "Fight-only items", "never offered on the field; they only work in a fight"],
];

const countEl = $("count");
const capsEl = $("caps");
const bookEl = $("rulebook");
const sheetEl = $("sheet");
const noteEl = $("sheetnote");
const queryEl = $("q");

capsEl.innerHTML =
    `<div class="cap"><b>${CAPS.hpMp}</b><span>HP and MP stop here</span></div>` +
    `<div class="cap"><b>${CAPS.stat}</b><span>a stat or a tolerance stops here</span></div>` +
    `<div class="cap"><b>${CAPS.tp}</b><span>TP stops here</span></div>`;

const res = await fetch("assets/data/item_effects.json");
const effects = res.ok ? await res.json() : null;
if (!effects || !Array.isArray(effects.items)) {
    countEl.textContent = "the effect table did not load";
    bookEl.innerHTML = `<div class="none">web/assets/data/item_effects.json was not found — run the launcher's data step, then reload.</div>`;
} else {
    const rules = ruleRows(effects);
    const rows = Object.values(rules).flat();
    const fight = battleOnly(effects);
    const sheet = sellSheet(effects);
    const neverIds = new Set(sheet.neverSold.map((r) => r.id));
    const oddIds = new Set(sheet.notHalf.map((r) => r.id));
    const consumables = effects.items.filter((r) => r.category === "consumable").length;

    countEl.textContent =
        `${effects.items.length} items · ${consumables} tagged consumable · ${rows.length - fight.length} with a field effect · ${fight.length} fight-only`;

    const sellTags = (r) => {
        let out = "";
        if (neverIds.has(r.id)) out += `<span class="tag never">no shop sells it</span>`;
        if (oddIds.has(r.id)) out += `<span class="tag odd">not half</span>`;
        return out;
    };

    const rowHtml = (r) => `<tr data-id="${r.id}" data-name="${escapeHtml(r.name.toLowerCase())}">` +
        `<td class="id">#${r.id}</td>` +
        `<td class="name">${escapeHtml(r.name)}</td>` +
        `<td class="what">${escapeHtml(capWords(r.effect, r.value))}</td>` +
        `<td class="num buy">${r.buy}</td>` +
        `<td class="num">${r.sell}${sellTags(r)}</td>` +
        `</tr>`;

    bookEl.innerHTML = `<table>` +
        `<thead><tr><th>#</th><th>Item</th><th>One use</th><th style="text-align:right">Buy</th><th style="text-align:right">Sell</th></tr></thead>` +
        GROUPS.map(([key, title, note]) => {
            const group = rules[key];
            return `<tbody class="group" data-group="${key}">` +
                `<tr class="grouphead"><th colspan="5">${title} <span>(${group.length}) — ${note}</span></th></tr>` +
                group.map(rowHtml).join("") +
                `</tbody>`;
        }).join("") +
        `</table>`;

    const sheetRow = (r) => `<div class="sell">` +
        `<span class="id">#${r.id}</span>` +
        `<span class="nm">${escapeHtml(r.name)}</span>` +
        `<span class="pr">${r.buy} → ${r.sell} BIT</span>` +
        `</div>`;

    sheetEl.innerHTML =
        `<div class="sheet"><h3>No shop sells it, a shop pays for it <span>(${sheet.neverSold.length})</span></h3>` +
        (sheet.neverSold.length ? sheet.neverSold.map(sheetRow).join("") : `<div class="none">none</div>`) + `</div>` +
        `<div class="sheet"><h3>A price that is not half <span>(${sheet.notHalf.length})</span></h3>` +
        (sheet.notHalf.length ? sheet.notHalf.map(sheetRow).join("") : `<div class="none">none</div>`) + `</div>`;
    noteEl.textContent =
        "Both lists are computed from the shipped prices: a 0 BIT buy price with a real sell price is the " +
        "never-sold row, and any price where sell × 2 does not equal buy is the not-half row. Those rows carry " +
        "equipment and accessories too, because the shop rule applies to every one of the " +
        `${effects.items.length} items.`;

    // Filter: names and numbers only, the section header disappears with its rows.
    queryEl.addEventListener("input", () => {
        const q = queryEl.value.trim().toLowerCase();
        let shown = 0;
        for (const body of bookEl.querySelectorAll("tbody.group")) {
            let any = false;
            for (const tr of body.querySelectorAll("tr[data-id]")) {
                const hit = !q || tr.dataset.name.includes(q) || tr.dataset.id === q || tr.dataset.id === q.replace(/^#/, "");
                tr.hidden = !hit;
                if (hit) any = true;
            }
            body.hidden = !any;
            if (any) shown += body.querySelectorAll("tr[data-id]:not([hidden])").length;
        }
        countEl.textContent = q ? `${shown} matching items` : countEl.dataset.plain;
    });
    countEl.dataset.plain = countEl.textContent;
    queryEl.focus();
}
