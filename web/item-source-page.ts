// web/item-source-page.js — the page half of the Item Source Book. It reads the
// four shipped tables (the obtain index, the shop list, the merchant rows and
// the price table) and draws them, never a hand-written answer.
import { indexRows, sourcesFor, priceWord, nothingLine } from "./item-source.js";

const $ = (id) => document.getElementById(id);
const load = (url) => fetch(url).then((r) => (r.ok ? r.json() : null));
const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const [index, shops, merchants, effects] = await Promise.all([
    load("assets/data/item_obtain_index.json"),
    load("assets/data/shops.json"),
    load("assets/data/merchant_shops.json"),
    load("assets/data/item_effects.json"),
]);

const listEl = $("list");
const detailEl = $("detail");
const queryEl = $("q");
const countEl = $("count");

if (!index || !index.items) {
    countEl.textContent = "the item index did not load";
} else {
    const data = { index, shops, merchants, effects };
    const rows = indexRows(index);
    const sourceLess = rows.filter((r) => r.count === 0).length;
    countEl.textContent = `${rows.length} items — ${sourceLess} with no source anywhere`;
    let shown = rows;
    let cursor = -1;
    let elements = [];

    const GROUPS = [
        ["shops that sell it", "shops"],
        ["people who hand it over", "talks"],
        ["cutscenes that give it", "cutscenes"],
        ["the stage's own code that grants it", "natives"],
        ["enemies that drop it", "drops"],
    ];

    function drawDetail(row) {
        const rec = row ? sourcesFor(row.id, data) : null;
        if (!rec) {
            detailEl.innerHTML = row ? `<div class="empty">item ${row.id} is not in the index</div>` : "";
            return;
        }
        let html = `<h2>${escapeHtml(rec.name)} <span>#${rec.id} · ${escapeHtml(rec.category)}</span></h2>`;
        html += `<div class="price">${escapeHtml(priceWord(rec.id, effects))}</div>`;
        if (rec.nothing) {
            html += `<div class="nothing">${escapeHtml(nothingLine(rec))}</div>`;
        } else {
            for (const [title, key] of GROUPS) {
                const list = rec[key];
                if (!list.length) continue;
                html += `<h3>${title} <b>(${list.length})</b></h3>`;
                for (const r of list) {
                    html += `<div class="src${r.unopened ? " unopened" : ""}">${escapeHtml(r.where)}</div>`;
                }
            }
        }
        detailEl.innerHTML = html;
    }

    function show(index) {
        if (!shown.length) { cursor = -1; drawDetail(null); return; }
        cursor = Math.max(0, Math.min(index, shown.length - 1));
        for (let i = 0; i < elements.length; i++) elements[i].classList.toggle("sel", i === cursor);
        elements[cursor].scrollIntoView({ block: "nearest" });
        drawDetail(shown[cursor]);
    }

    function drawList() {
        listEl.innerHTML = "";
        elements = shown.map((row) => {
            const el = document.createElement("div");
            el.className = "item";
            el.dataset.id = row.id;
            el.innerHTML =
                `<span class="id">#${row.id}</span>` +
                `<span class="name">${escapeHtml(row.name)}</span>` +
                `<span class="cat">${escapeHtml(row.category)}</span>` +
                `<span class="num${row.count ? "" : " none"}">${row.count}</span>`;
            el.addEventListener("click", () => {
                show(elements.indexOf(el));
                listEl.focus();
            });
            listEl.append(el);
            return el;
        });
    }

    function filter() {
        const q = queryEl.value.trim().toLowerCase();
        shown = !q ? rows : rows.filter((row) =>
            row.name.toLowerCase().includes(q) || row.category.toLowerCase().includes(q) || String(row.id) === q);
        cursor = -1;
        drawList();
        if (!shown.length) { detailEl.innerHTML = `<div class="empty">no item matches "${escapeHtml(q)}"</div>`; return; }
        show(0);
    }

    queryEl.addEventListener("input", filter);
    addEventListener("keydown", (e) => {
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            show(cursor < 0 ? 0 : cursor + (e.key === "ArrowDown" ? 1 : -1));
        } else if (e.key === "Home") {
            e.preventDefault();
            show(0);
        } else if (e.key === "End") {
            e.preventDefault();
            show(shown.length - 1);
        } else if (e.key === "Enter" && cursor >= 0) {
            e.preventDefault();
            show(cursor);
            listEl.focus();
        }
    });

    filter();
    queryEl.focus();
}
