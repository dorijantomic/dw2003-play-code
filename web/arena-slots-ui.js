// Arena Viewer (look=built): the "Slots" panel and the asset gallery popup. Every slot of the current arena is listed (what the
// arena module places: a tree ring, rocks, ground cover, sky, water ...); "Replace..." opens a gallery of EVERY registry asset
// (web/built/registry.js: our built pieces, the biome gallery's Quaternius / Poly Haven / KayKit / OGA / anime / procedural
// sets, plain surfaces, "nothing"); a click swaps it live (no reload; camera and settings stay). "reset" puts the slot back to the
// module's own mesh. The choices go to the viewer state (arena-viewer.html syncState), so they are remembered per arena and the
// page's Reset button clears them too. Text only: name, source, licence, kind tags.
import { listAllAssets, listAssets } from "./built/registry.js";

const CSS = `
#slotGal{position:fixed;inset:4% 6%;background:#10151c;border:1px solid #456;border-radius:6px;z-index:50;display:none;flex-direction:column;font:12px system-ui,sans-serif;color:#cde}
#slotGal header{display:flex;gap:8px;align-items:center;padding:8px;border-bottom:1px solid #345}
#slotGal header input,#slotGal header select{background:#1b232d;color:#cde;border:1px solid #456;padding:3px 5px}
#slotGal .grid{overflow:auto;padding:8px;display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:6px;align-content:start}
#slotGal .card{border:1px solid #345;border-radius:4px;padding:6px;cursor:pointer;background:#161d26}
#slotGal .card:hover{border-color:#8bd;background:#1c2733}
#slotGal .card b{display:block;color:#eef;margin-bottom:2px}
#slotGal .card i{color:#89a;font-style:normal}
#slotsList .slotRow{display:flex;gap:6px;align-items:center;margin:2px 0;font-size:11px}
#slotsList .slotRow span.n{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#slotsList .slotRow button{font-size:11px;padding:1px 5px}
#slotsList .slotRow .cur{color:#8bd}
#slotsList .slotRow .err{color:#e88}
`;

export function createSlotsUI({ getBuilt, container }) {
  const st = document.createElement("style"); st.textContent = CSS; document.head.appendChild(st);
  container.innerHTML = `<details id="slotsPanel"><summary>Slots (swap what stands where)</summary><div id="slotsList"></div></details>`;
  const list = container.querySelector("#slotsList");
  const gal = document.createElement("div"); gal.id = "slotGal";
  gal.innerHTML = `<header><b id="galTitle">Replace</b><input id="galSearch" placeholder="search name / source / licence" size="28">
    <select id="galKind"><option value="">all kinds</option></select><select id="galSrc"><option value="">all sources</option></select>
    <span id="galCount"></span><span style="flex:1"></span><button id="galClose">close</button></header><div class="grid" id="galGrid">loading ...</div>`;
  document.body.appendChild(gal);
  const $ = (id) => gal.querySelector("#" + id);
  let assets = null, curSlot = null, status = "";
  const label = (id) => (id === "default" || !id ? "default (module's own)" : (assets || listAssets()).find((a) => a.id === id)?.name || id);

  function renderList() {
    const b = getBuilt(); list.innerHTML = "";
    if (!b?.slots) { list.textContent = "no built arena"; return; }
    for (const s of b.slots.list()) {
      const row = document.createElement("div"); row.className = "slotRow"; row.dataset.slot = s.id;
      row.innerHTML = `<span class="n" title="${s.id}">${s.label} <small>(${s.count})</small></span><span class="cur ${s.error ? "err" : ""}">${s.error ? "error" : s.bound ? label(s.bound) : "default"}</span>
        <button class="replace">Replace...</button><button class="reset">reset</button>`;
      row.querySelector(".replace").onclick = () => open(s.id);
      row.querySelector(".reset").onclick = () => { b.slots.reset(s.id); renderList(); };
      list.appendChild(row);
    }
  }
  async function open(slotId) {
    curSlot = slotId; gal.style.display = "flex";
    $("galTitle").textContent = `Replace: ${getBuilt().slots.get(slotId)?.label || slotId}`;
    $("galGrid").textContent = "loading assets ...";
    assets ||= await listAllAssets();
    if (!$("galKind").dataset.done) {
      const kinds = [...new Set(assets.flatMap((a) => a.kinds))].sort(), srcs = [...new Set(assets.map((a) => a.sourceGroup || a.source))].sort();
      for (const k of kinds) $("galKind").add(new Option(k, k));
      for (const s of srcs) $("galSrc").add(new Option(s, s));
      $("galKind").dataset.done = "1";
    }
    draw();
  }
  function draw() {
    const q = $("galSearch").value.toLowerCase().trim(), kind = $("galKind").value, src = $("galSrc").value;
    const hit = [{ id: "default", name: "Default (the module's own)", kinds: ["default"], source: "Built", licence: "-" }, ...assets]
      .filter((a) => (!kind || a.kinds.includes(kind) || a.id === "default") && (!src || (a.sourceGroup || a.source) === src || a.id === "default")
        && (!q || `${a.name} ${a.source} ${a.licence} ${a.kinds.join(" ")} ${a.id}`.toLowerCase().includes(q)));
    $("galCount").textContent = `${hit.length} of ${assets.length}`;
    const g = $("galGrid"); g.innerHTML = "";
    for (const a of hit.slice(0, 500)) {
      const c = document.createElement("div"); c.className = "card"; c.dataset.asset = a.id;
      c.innerHTML = `<b></b><i></i><br><i></i>`;
      c.children[0].textContent = a.name; c.children[1].textContent = `${a.sourceGroup || a.source}, ${a.licence}`; c.children[3].textContent = a.kinds.join(", ");
      c.onclick = () => choose(curSlot, a.id);
      g.appendChild(c);
    }
    if (hit.length > 500) { const m = document.createElement("div"); m.textContent = `... ${hit.length - 500} more: narrow the search`; g.appendChild(m); }
  }
  async function choose(slotId, assetId) {
    const b = getBuilt(); if (!b?.slots) return false;
    gal.style.display = "none";
    try {
      if (assetId === "default") b.slots.reset(slotId); else await b.slots.bind(slotId, assetId);
      status = "";
    } catch (e) { status = `${slotId}: ${e.message || e}`; }
    renderList();
    return !status;
  }
  for (const id of ["galSearch", "galKind", "galSrc"]) $(id).oninput = () => assets && draw();
  $("galClose").onclick = () => { gal.style.display = "none"; };
  addEventListener("keydown", (e) => { if (e.key === "Escape") gal.style.display = "none"; });
  return { renderList, open, choose, resetSlot: (id) => { getBuilt()?.slots.reset(id); renderList(); }, resetAll: () => { getBuilt()?.slots.resetAll(); renderList(); },
    get status() { return status; }, get galleryOpen() { return gal.style.display !== "none"; } };
}
