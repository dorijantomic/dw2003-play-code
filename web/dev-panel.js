// web/dev-panel.js — the F2 page: seven tabs on the left (World, Quests, Battle, Online, Info pages, Test tools,
// Controls), that tab's rows on the right, a search across all tabs and an In / Auto / Out filter.
//
// DOM over the game, like the panel it replaces. It costs nothing while closed: web/ambience.js makes an empty
// hidden <div>, and this module builds the page on the FIRST open; a closed page is never refreshed.
// No drawing surface, no GPU work, no timers. The rows come from web/dev-panel-model.js (pure, tested); the In / Auto / Out
// badge from web/ship-list.js. The switches, selects, sliders and [data-act] / [data-all] buttons keep the same
// data attributes they always had, so web/ambience.js still owns every handler that changes a setting.
import { DEV_TABS, DEV_FILTERS, DEV_OPEN, tabCounts, selectRows, groupRows } from "./dev-panel-model.js";
import { shipClass } from "./ship-list.js";

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[c]));
const BADGE = {
    in: ["In", "In the game: on at the start, and the player may switch it in OPTIONS."],
    auto: ["Auto", "In the game: always on, there is no switch."],
    out: ["Out", "Not for players: hidden, and always off in the installed copy."],
};

export const DEV_PANEL_CSS = `
      #fx-panel { position:absolute; top:44px; right:8px; z-index:40; width:min(760px, calc(100% - 16px)); height:calc(100% - 56px);
        display:flex; flex-direction:column; padding:0; overflow:hidden; border:2px solid #5a5a8a; border-radius:10px;
        background:#161622f7; color:#f0f0f8; font:14px/1.4 "Segoe UI",system-ui,sans-serif; box-shadow:0 8px 30px #000; }
      #fx-panel[hidden] { display:none; }
      #fx-panel h3 { margin:0; font-size:14px; color:#ffd34d; letter-spacing:1px; white-space:nowrap; }
      #fx-panel h4 { margin:14px 0 4px; font-size:12px; color:#b4b4d8; letter-spacing:1.5px; text-transform:uppercase; }
      #fx-panel .dp-head { display:flex; flex-wrap:wrap; gap:8px; align-items:center; padding:8px 10px; border-bottom:1px solid #45456a; }
      #fx-panel .dp-head input[type=search] { flex:1 1 140px; min-width:0; background:#0e0e18; color:#f0f0f8; border:1px solid #6a6a98;
        border-radius:6px; padding:6px 8px; font:inherit; }
      #fx-panel .dp-filter { display:flex; }
      #fx-panel .dp-filter button { border-radius:0; margin-left:-1px; }
      #fx-panel .dp-filter button:first-child { border-radius:6px 0 0 6px; margin-left:0; }
      #fx-panel .dp-filter button:last-child { border-radius:0 6px 6px 0; }
      #fx-panel button, #fx-panel select { background:#2a2a44; color:#f0f0f8; border:1px solid #6a6a98; border-radius:6px; padding:5px 10px; font:inherit; cursor:pointer; min-height:30px; }
      #fx-panel button[aria-pressed=true], #fx-panel button[aria-selected=true] { background:#4a4a82; border-color:#ffd34d; color:#fff; }
      #fx-panel button:disabled { opacity:.45; cursor:default; }
      #fx-panel button:focus-visible, #fx-panel select:focus-visible, #fx-panel input:focus-visible { outline:2px solid #ffd34d; outline-offset:1px; }
      #fx-panel .dp-body { flex:1 1 auto; min-height:0; display:flex; }
      #fx-panel .dp-tabs { flex:0 0 150px; display:flex; flex-direction:column; gap:4px; padding:8px; overflow-y:auto; border-right:1px solid #45456a; }
      #fx-panel .dp-tabs button { display:flex; justify-content:space-between; gap:6px; text-align:left; }
      #fx-panel .dp-tabs.dim button[aria-selected=true] { background:#2a2a44; border-color:#6a6a98; }
      #fx-panel .dp-n { color:#c4c4e4; font-size:12px; white-space:nowrap; }
      #fx-panel .dp-main { flex:1 1 auto; min-width:0; overflow-y:auto; padding:4px 12px 14px; }
      #fx-panel .dr { display:flex; flex-wrap:wrap; gap:4px 10px; align-items:center; padding:7px 0; border-bottom:1px solid #2c2c44; }
      #fx-panel .dr label { display:flex; gap:10px; align-items:flex-start; flex:1 1 240px; min-width:0; cursor:pointer; }
      #fx-panel .dr input[type=checkbox] { flex:0 0 auto; width:18px; height:18px; margin:2px 0 0; }
      #fx-panel .dr-name { display:block; font-weight:600; color:#fff; }
      #fx-panel .dr-why { display:block; color:#c4c4dc; font-size:13px; }
      #fx-panel .dr-b { flex:0 0 auto; font-size:11px; font-weight:700; padding:1px 7px; border-radius:9px; border:1px solid; }
      #fx-panel .dr-b-in { color:#8ff0b0; border-color:#3e9b62; }
      #fx-panel .dr-b-auto { color:#9ccfff; border-color:#4a7fb8; }
      #fx-panel .dr-b-out { color:#ffc27a; border-color:#b8782e; }
      #fx-panel .dr-x { flex:1 1 100%; padding-left:28px; }
      #fx-panel .dr-x[hidden], #fx-panel .row[hidden], #fx-panel [data-show-when][hidden] { display:none; }
      #fx-panel .dr.na { opacity:.6; }
      #fx-panel .dr.na .dr-name::after { content:" (not on this map)"; font-weight:400; font-size:12px; color:#c4c4dc; }
      #fx-panel .dp-sub { margin:0; padding:12px 0 2px; font-size:12px; color:#ffd34d; letter-spacing:1.5px; text-transform:uppercase; }
      #fx-panel .dp-sub small { color:#b4b4d8; letter-spacing:0; text-transform:none; }
      #fx-panel .row { display:flex; flex-wrap:wrap; gap:6px; margin-top:8px; }
      #fx-panel .ctl { display:flex; flex-wrap:wrap; gap:8px; align-items:center; margin-top:8px; }
      #fx-panel .ctl > span:first-child { flex:0 0 130px; }
      #fx-panel input[type=range] { width:140px; }
      #fx-panel span[data-val] { min-width:34px; color:#c4c4dc; }
      #fx-panel .hint { color:#b4b4d0; font-size:12px; line-height:1.4; margin-top:8px; }
      #fx-panel .hint a { color:#f5a524; }
      #fx-panel .dp-empty { padding:18px 0; color:#c4c4dc; }
      @media (max-width:640px) {
        #fx-panel { top:40px; left:6px; right:6px; width:auto; height:calc(100% - 48px); }
        #fx-panel .dp-body { flex-direction:column; }
        #fx-panel .dp-tabs { flex:0 0 auto; flex-direction:row; overflow-x:auto; overflow-y:hidden; border-right:0; border-bottom:1px solid #45456a; }
        #fx-panel .dp-tabs button { flex:0 0 auto; }
        #fx-panel .dr-x { padding-left:0; }
        #fx-panel .ctl > span:first-child { flex:1 1 100%; }
      }`;

const CONTROLS_HTML = (spriteFilters) => `
    <h4>Mood</h4>
    <div class="ctl"><span>Preset</span><select data-preset><option value="">choose...</option><option value="cinematic">Cinematic</option><option value="clear">Clear day</option><option value="cozyrain">Cozy rain</option><option value="storm">Storm</option><option value="night">Night</option></select></div>
    <div class="row"><button type="button" data-act="save:1">Save 1</button><button type="button" data-act="save:2">Save 2</button><button type="button" data-act="save:3">Save 3</button></div>
    <div class="row"><button type="button" data-act="load:1">Load 1</button><button type="button" data-act="load:2">Load 2</button><button type="button" data-act="load:3">Load 3</button></div>
    <h4>Weather and time</h4>
    <div class="ctl"><span>Weather</span><select data-mode><option value="auto">random</option><option value="always">always on</option><option value="storm">stormy</option><option value="clear">clear skies</option></select></div>
    <div class="ctl"><span>Time</span><select data-tod><option value="auto">auto cycle</option><option value="day">day</option><option value="golden">golden hour</option><option value="dusk">dusk</option><option value="night">night</option></select></div>
    <h4>Sliders</h4>
    <div class="ctl"><span>Light strength</span><input type="range" min="0" max="2" step="0.05" data-slider="lightGain" aria-label="Light strength"> <span data-val="lightGain"></span></div>
    <div class="ctl"><span>HD-2D strength</span><input type="range" min="0" max="2" step="0.05" data-slider="hd2dStrength" aria-label="HD-2D strength"> <span data-val="hd2dStrength"></span></div>
    <div class="ctl" data-show-when="battlespeed" hidden><span>Faster battles speed</span><input type="range" min="1" max="3" step="0.5" data-slider="battleSpeed" aria-label="Faster battles speed"> <span data-val="battleSpeed"></span></div>
    <h4>Picture</h4>
    <div class="ctl"><span>Quality</span><select data-quality><option value="low">low</option><option value="medium">medium</option><option value="high">high</option></select></div>
    <div class="ctl"><span>Pixel filter (GPU)</span><select data-spritefilter>${spriteFilters.map(([k, t]) => `<option value="${esc(k)}">${esc(t)}</option>`).join("")}</select></div>
    <h4>Photo and recording</h4>
    <div class="row"><button type="button" data-act="photo">Photo mode F8</button><button type="button" data-act="shot">Shot F9</button><button type="button" data-act="rec">Rec F10</button></div>
    <h4>All switches</h4>
    <div class="row"><button type="button" data-all="1">All on</button><button type="button" data-all="0">All off</button></div>
    <div class="hint" data-dp-total></div>
    <div class="hint">F2 or Escape closes this page. Choices are remembered.</div>`;

/**
 * panel: the (empty, hidden) #fx-panel element. api: { fx, spriteFilters: [[id, label]...], dialMode(), onFirstOpen(view), shipOf }.
 * Returns { show(), sync(), setNa(Set), setNote(html), isBuilt() }.
 */
export function createDevView(panel, api) {
    const shipOf = api.shipOf || shipClass;
    const st = { tab: "world", query: "", filter: "all", na: new Set(), note: "" };
    let built = false, main = null, tabsEl = null, searchEl = null, counts = null;

    function rowHtml(r) {
        const cls = shipOf(r.key), b = BADGE[cls] || ["?", ""];
        const open = DEV_OPEN[r.key];
        const dial = r.key === "encounterdial"
            ? `<div class="dr-x" data-show-when="encounterdial" hidden><select data-dial aria-label="Encounter dial" title="How often random fights come"><option value="none">none (no random fights)</option><option value="rare">rare (fewer)</option><option value="normal" selected>normal (the game's own rate)</option><option value="lure">lure (more)</option></select></div>`
            : "";
        return `<div class="dr${st.na.has(r.key) ? " na" : ""}" data-key="${r.key}"${st.na.has(r.key) ? ` title="This effect does not apply on this map"` : ""}>
          <label><input type="checkbox" data-fx="${r.key}"><span><span class="dr-name">${esc(r.name)}</span><span class="dr-why">${esc(r.why)}</span></span></label>
          <span class="dr-b dr-b-${cls}" title="${esc(b[1])}">${b[0]}</span>
          ${open ? `<button type="button" data-act="open:${r.key}" title="Switch it on first, then open it here">Open</button>` : ""}${dial}</div>`;
    }
    function render() {
        const searching = st.query.trim() !== "";
        if (!searching && st.tab === "controls") {
            main.innerHTML = CONTROLS_HTML(api.spriteFilters);
        } else {
            const rows = selectRows({ tab: st.tab, query: st.query, filter: st.filter }, shipOf);
            const tabName = (id) => DEV_TABS.find((t) => t.id === id).name;
            let html = searching ? `<div class="hint">${rows.length} found across all tabs.</div>` : "";
            if (!searching && st.tab === "quests" && st.note) html += `<div class="hint">${st.note}</div>`;
            for (const g of groupRows(rows)) {
                html += `<h4 class="dp-sub">${searching ? `<small>${esc(tabName(g.tab))} / </small>` : ""}${esc(g.sub)}</h4>` + g.rows.map(rowHtml).join("");
            }
            if (!rows.length) html += `<div class="dp-empty">${searching ? "No switch matches that." : "No switch in this tab matches the filter."}</div>`;
            main.innerHTML = html;
        }
        main.scrollTop = 0;
        tabsEl.classList.toggle("dim", searching);
        for (const b of tabsEl.querySelectorAll("[data-dp-tab]")) b.setAttribute("aria-selected", String(b.dataset.dpTab === st.tab));
        for (const b of panel.querySelectorAll("[data-dp-filter]")) b.setAttribute("aria-pressed", String(b.dataset.dpFilter === st.filter));
        sync();
    }
    function sync() {
        if (!built) return;
        const fx = api.fx;
        for (const el of main.querySelectorAll("[data-fx]")) el.checked = !!fx[el.dataset.fx];
        for (const b of main.querySelectorAll("[data-act^='open:']")) b.disabled = !fx[b.dataset.act.slice(5)];
        const c = tabCounts(fx);
        let total = 0, on = 0;
        for (const t of DEV_TABS) {
            const el = tabsEl.querySelector(`[data-dp-count="${t.id}"]`);
            if (el && c[t.id].total) el.textContent = `${c[t.id].on}/${c[t.id].total}`;
            total += c[t.id].total; on += c[t.id].on;
        }
        const set = (sel, fn) => { const el = main.querySelector(sel); if (el) fn(el); };
        set("[data-mode]", (e) => { e.value = fx.weatherMode; });
        set("[data-quality]", (e) => { e.value = fx.quality; });
        set("[data-tod]", (e) => { e.value = fx.todMode; });
        set("[data-spritefilter]", (e) => { e.value = fx.spriteFilter; });
        set("[data-dial]", (e) => { e.value = api.dialMode(); });
        set("[data-dp-total]", (e) => { e.textContent = `${on} of ${total} switches are on.`; });
        for (const k of ["lightGain", "hd2dStrength", "battleSpeed"]) {
            const r = main.querySelector(`[data-slider="${k}"]`), v = main.querySelector(`[data-val="${k}"]`);
            if (r) r.value = fx[k]; if (v) v.textContent = (+fx[k]).toFixed(2);
        }
        for (const row of main.querySelectorAll("[data-show-when]")) row.hidden = !fx[row.dataset.showWhen];
    }
    function build() {
        built = true;
        panel.innerHTML = `<div class="dp-head"><h3>EFFECTS (F2)</h3>
            <input type="search" data-dp-search placeholder="Search name or explanation" aria-label="Search all tabs" autocomplete="off" spellcheck="false">
            <div class="dp-filter" role="group" aria-label="Filter by ship class">${DEV_FILTERS.map((f) => `<button type="button" data-dp-filter="${f.id}" aria-pressed="${f.id === st.filter}">${f.name}</button>`).join("")}</div>
            <button type="button" data-dp-close aria-label="Close">Close</button></div>
          <div class="dp-body"><nav class="dp-tabs" role="tablist" aria-label="Tabs">${DEV_TABS.map((t) => `<button type="button" role="tab" data-dp-tab="${t.id}" aria-selected="${t.id === st.tab}">${t.name}<span class="dp-n" data-dp-count="${t.id}"></span></button>`).join("")}</nav>
          <div class="dp-main"></div></div>`;
        main = panel.querySelector(".dp-main"); tabsEl = panel.querySelector(".dp-tabs"); searchEl = panel.querySelector("[data-dp-search]");
        panel.addEventListener("click", (e) => {
            const t = e.target.closest("[data-dp-tab]");
            if (t) { st.tab = t.dataset.dpTab; st.query = ""; searchEl.value = ""; render(); t.blur(); return; }
            const f = e.target.closest("[data-dp-filter]");
            if (f) { st.filter = f.dataset.dpFilter; render(); f.blur(); return; }
            if (e.target.closest("[data-dp-close]") && api.close) api.close();
        });
        searchEl.addEventListener("input", () => { st.query = searchEl.value; render(); });
        api.onFirstOpen && api.onFirstOpen(view);
    }
    const view = {
        show() { if (!built) build(); render(); },
        sync,
        isBuilt: () => built,
        setNa(set) { st.na = set; if (built) for (const r of main.querySelectorAll("[data-key]")) { const na = set.has(r.dataset.key); r.classList.toggle("na", na); r.title = na ? "This effect does not apply on this map" : ""; } },
        setNote(html) { st.note = html; if (built && st.tab === "quests" && !st.query.trim()) render(); },
        state: st,
    };
    return view;
}
