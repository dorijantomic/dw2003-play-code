// web/sceneEditor.js
// Scene placement tool, active only while the collision editor (E) is enabled:
//   N = place NPC at next click (prompts: sprite id, estalk00 dialogue index)
//   G = drag an exit rect (prompts: target map, spawn x,y,dir)
//   Delete = remove nearest npc/exit/zone to last mouse position
//   Shift+X = download the scene JSON
import { canvasEventToLogical } from "./canvas-resolution.js";

export function createSceneEditor(canvas, getCtx) {
  // getCtx: () => ({ scene, mapId, camX, camY, zoom })
  const ed = { armed: null, dragStart: null, lastMouse: null };

  const toMap = (e) => {
    const { camX, camY, zoom } = getCtx();
    const logical = canvasEventToLogical(canvas, e);
    return {
      x: logical.x / zoom + camX,
      y: logical.y / zoom + camY,
    };
  };

  ed.arm = (mode) => { ed.armed = mode; };  // "npc" | "exit" | null

  canvas.addEventListener("mousedown", (e) => {
    if (!ed.armed) return;
    e.preventDefault();
    e.stopImmediatePropagation(); // don't let the collision painter see this
    if (ed.armed === "npc") { placeNpc(e); ed.armed = null; }
    else ed.dragStart = toMap(e);
  }, true); // capture phase, runs before collision editor's bubble-phase handler

  canvas.addEventListener("mousemove", (e) => { ed.lastMouse = toMap(e); });

  window.addEventListener("mouseup", (e) => {
    if (!ed.armed || !ed.dragStart) return;
    const kind = ed.armed;
    ed.armed = null;
    finishRect(e, kind);
  });

  function placeNpc(e) {
    const { scene } = getCtx();
    const p = toMap(e);
    const sprite = window.prompt("sprite id (e.g. p020rdsz):");
    if (!sprite) return;
    const index = window.prompt("estalk00 dialogue index:");
    if (index === null) return;
    if (!index.trim() || isNaN(Number(index))) return;
    scene.npcs.push({
      id: sprite + "_" + scene.npcs.length, sprite,
      x: Math.round(p.x), y: Math.round(p.y), dir: "down",
      dialogue: { file: "estalk00", index: Number(index) },
    });
  }

  function finishRect(e, kind) {
    const a = ed.dragStart, b = toMap(e);
    ed.dragStart = null;
    const rect = {
      x: Math.round(Math.min(a.x, b.x)), y: Math.round(Math.min(a.y, b.y)),
      w: Math.round(Math.abs(b.x - a.x)), h: Math.round(Math.abs(b.y - a.y)),
    };
    if (rect.w < 4 || rect.h < 4) return; // accidental click
    const { scene } = getCtx();
    if (kind === "exit") {
      const to = window.prompt("target map id (e.g. s202):");
      if (!to) return;
      const spawn = window.prompt("spawn x,y,dir in target (e.g. 80,400,right):") ?? "";
      const [sx, sy, dir] = spawn.split(",");
      if (!sx?.trim() || !sy?.trim()) return;
      if (!Number.isFinite(Number(sx)) || !Number.isFinite(Number(sy))) return;
      scene.exits.push({ ...rect, to, spawnX: Number(sx), spawnY: Number(sy),
                         dir: (dir ?? "down").trim() });
    }
  }

  ed.removeNearest = () => {
    if (!ed.lastMouse) return;
    const { scene } = getCtx();
    const p = ed.lastMouse;
    const all = [
      ...scene.npcs.map(o => ({ arr: scene.npcs, o, d: Math.hypot(o.x - p.x, o.y - p.y) })),
      ...scene.exits.map(o => ({ arr: scene.exits, o, d: Math.hypot(o.x + o.w / 2 - p.x, o.y + o.h / 2 - p.y) })),
      ...scene.zones.map(o => ({ arr: scene.zones, o, d: Math.hypot(o.x + o.w / 2 - p.x, o.y + o.h / 2 - p.y) })),
    ].sort((a, b) => a.d - b.d);
    if (all[0] && all[0].d < 80) all[0].arr.splice(all[0].arr.indexOf(all[0].o), 1);
  };

  ed.download = () => {
    const { scene, mapId } = getCtx();
    const blob = new Blob([JSON.stringify(scene, null, 1)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = mapId + ".json";
    a.click();
    URL.revokeObjectURL(a.href);
  };

  // exits blue, zones green (npcs drawn by the game); map-space ctx
  ed.drawOverlay = (ctx2d) => {
    const { scene, camX, camY } = getCtx();
    ctx2d.lineWidth = 2;
    ctx2d.strokeStyle = "rgba(80,160,255,0.9)";
    for (const r of scene.exits) ctx2d.strokeRect(r.x - camX, r.y - camY, r.w, r.h);
    ctx2d.strokeStyle = "rgba(80,255,120,0.9)";
    for (const r of scene.zones) ctx2d.strokeRect(r.x - camX, r.y - camY, r.w, r.h);
  };

  return ed;
}
