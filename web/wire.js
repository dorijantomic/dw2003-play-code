// Door wiring tool. Data sources:
//  - assets/extracted_entities.json : per-stage doors/npcs from the game data
//  - assets/thumbs/index.json + thumbs/sNNN.png : previews of every stage
//  - assets/maps/sNNN.png : full-res image for stages built into the walker
// Wiring lives in localStorage ("doorWiring") until exported.

const $ = (id) => document.getElementById(id);

const state = {
  data: {},     // extracted entities
  thumbs: {},   // sid -> {w, h}
  maps: {},     // walker manifest maps by id (full png + name)
  wiring: JSON.parse(localStorage.getItem("doorWiring") ?? "{}"),
  src: null,    // current source stage id
  door: null,   // selected door idx
  scale: 1,     // displayed px per map px for source image
  spawn: null,  // {x, y} pending spawn in dest map coords
};

function wiringFor(sid, idx) {
  return state.wiring[sid]?.[idx] ?? null;
}

function stageName(sid) {
  return state.maps[sid] ? `${sid} — ${state.maps[sid].name}` : sid;
}

async function init() {
  state.data = await (await fetch("assets/extracted_entities.json")).json();
  state.thumbs = await (await fetch("assets/thumbs/index.json")).json();
  try {
    const manifest = await (await fetch("assets/manifest.json")).json();
    for (const m of manifest.maps) state.maps[m.id] = m;
  } catch { /* manifest optional for this tool */ }

  const withDoors = Object.keys(state.data)
    .filter((sid) => state.data[sid].doors.length > 0)
    .sort();
  $("srcsel").innerHTML = withDoors
    .map((sid) => `<option value="${sid}">${stageName(sid)}</option>`).join("");
  $("srcsel").onchange = () => loadStage($("srcsel").value);

  const destOptions = Object.keys(state.thumbs).sort()
    .map((sid) => `<option value="${sid}">${stageName(sid)}</option>`).join("");
  $("destsel").innerHTML = destOptions;
  $("destsel").onchange = () => showDest($("destsel").value);

  $("destprev").onclick = (e) => {
    const sid = $("destsel").value;
    const img = $("destimg");
    const r = img.getBoundingClientRect();
    const dims = state.thumbs[sid];
    state.spawn = {
      x: Math.round((e.clientX - r.left) / r.width * dims.w),
      y: Math.round((e.clientY - r.top) / r.height * dims.h),
    };
    placeSpawnMark();
  };

  $("save").onclick = saveDoor;
  $("unwire").onclick = removeDoor;
  $("export").onclick = exportWiring;
  $("importbtn").onclick = () => $("importfile").click();
  $("importfile").onchange = importWiring;

  loadStage(withDoors[0]);
}

function loadStage(sid) {
  state.src = sid;
  state.door = null;
  $("editor").style.display = "none";
  $("doorinfo").textContent = "Click a blue door box on the map.";
  const img = $("srcimg");
  const dims = state.thumbs[sid];
  const full = !!state.maps[sid];
  img.src = full ? `assets/maps/${sid}.png` : `assets/thumbs/${sid}.png`;
  img.onload = () => {
    // display width: full maps at 1x, thumbs scaled up to ~640 for clicking
    const dispW = full ? img.naturalWidth : Math.min(640, dims.w);
    img.style.width = dispW + "px";
    state.scale = dispW / dims.w;
    drawOverlay();
  };
  $("srcinfo").textContent =
    ` ${dims.w}×${dims.h}px, ${state.data[sid].doors.length} doors, ` +
    `${state.data[sid].npcs.length} npcs` + (full ? "" : " (thumb preview)");
  renderWiredList();
}

function drawOverlay() {
  const ov = $("overlay");
  ov.innerHTML = "";
  const s = state.scale;
  for (const npc of state.data[state.src].npcs) {
    const d = document.createElement("div");
    d.className = "npcdot";
    d.style.left = npc.x * s + "px";
    d.style.top = npc.y * s + "px";
    d.title = `npc slot ${npc.spriteSlot}` + (npc.talk ? ` talk ${npc.talk}` : "");
    ov.appendChild(d);
  }
  for (const door of state.data[state.src].doors) {
    const b = document.createElement("div");
    const wired = wiringFor(state.src, door.idx);
    b.className = "doorbox" + (wired ? " wired" : "") +
                  (state.door === door.idx ? " sel" : "");
    b.style.left = (door.x - 8) * s + "px";
    b.style.top = door.y1 * s + "px";
    b.style.width = Math.max(10, 16 * s) + "px";
    b.style.height = Math.max(10, (door.y2 - door.y1) * s) + "px";
    const label = document.createElement("span");
    label.textContent = `D${door.idx}` + (wired ? ` → ${wired.to}` : "");
    b.appendChild(label);
    b.onclick = () => selectDoor(door.idx);
    ov.appendChild(b);
  }
}

function selectDoor(idx) {
  state.door = idx;
  const door = state.data[state.src].doors.find((d) => d.idx === idx);
  $("doorinfo").textContent =
    `${state.src} door D${idx} at x=${door.x}, y ${door.y1}–${door.y2}`;
  $("editor").style.display = "";
  $("savemsg").textContent = "";
  const wired = wiringFor(state.src, idx);
  if (wired) {
    $("destsel").value = wired.to;
    state.spawn = { x: wired.spawnX, y: wired.spawnY };
    $("dirsel").value = wired.dir;
  } else {
    state.spawn = null;
  }
  showDest($("destsel").value);
  drawOverlay();
}

function showDest(sid) {
  $("destimg").src = `assets/thumbs/${sid}.png`;
  $("destimg").onload = placeSpawnMark;
  placeSpawnMark();
}

function placeSpawnMark() {
  const mark = $("spawnmark");
  if (!state.spawn) { mark.style.display = "none"; return; }
  const sid = $("destsel").value;
  const img = $("destimg");
  const dims = state.thumbs[sid];
  if (!dims || !img.clientWidth) { mark.style.display = "none"; return; }
  mark.style.display = "";
  mark.style.left = state.spawn.x / dims.w * img.clientWidth + "px";
  mark.style.top = state.spawn.y / dims.h * img.clientHeight + "px";
}

function saveDoor() {
  if (state.door === null) return;
  if (!state.spawn) { $("savemsg").textContent = "Click the preview to set a spawn point first."; return; }
  state.wiring[state.src] ??= {};
  state.wiring[state.src][state.door] = {
    to: $("destsel").value,
    spawnX: state.spawn.x,
    spawnY: state.spawn.y,
    dir: $("dirsel").value,
  };
  persist();
  $("savemsg").textContent = `Saved: D${state.door} → ${$("destsel").value}`;
  drawOverlay();
  renderWiredList();
}

function removeDoor() {
  if (state.door === null) return;
  delete state.wiring[state.src]?.[state.door];
  if (state.wiring[state.src] && !Object.keys(state.wiring[state.src]).length)
    delete state.wiring[state.src];
  persist();
  $("savemsg").textContent = "Wiring removed.";
  drawOverlay();
  renderWiredList();
}

function persist() {
  localStorage.setItem("doorWiring", JSON.stringify(state.wiring));
}

function renderWiredList() {
  const rows = [];
  for (const [sid, doors] of Object.entries(state.wiring).sort())
    for (const [idx, w] of Object.entries(doors))
      rows.push(`<div>${sid} D${idx} → ${w.to} @(${w.spawnX},${w.spawnY}) ${w.dir}</div>`);
  $("wiredlist").innerHTML = rows.join("") || '<div class="muted">none yet</div>';
  $("wiredcount").textContent = rows.length;
}

function exportWiring() {
  const blob = new Blob([JSON.stringify(state.wiring, null, 1)],
                        { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "door_wiring.json";
  a.click();
  URL.revokeObjectURL(a.href);
}

async function importWiring(e) {
  const file = e.target.files[0];
  if (!file) return;
  state.wiring = JSON.parse(await file.text());
  persist();
  drawOverlay();
  renderWiredList();
}

window.__wire = state; // test hook
init();
