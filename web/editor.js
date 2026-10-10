// web/editor.js
import { CELL, setBlocked, toJSON } from "./vendor/engine.js";
import { canvasEventToLogical } from "./canvas-resolution.js";

export function createEditor(canvas, getCtx) {
  // getCtx: () => ({ grid, mapId, camX, camY, zoom })
  const ed = { enabled: false, painting: 0 };

  function cellAt(e) {
    const { grid, camX, camY, zoom } = getCtx();
    const cell = grid.cell ?? CELL;
    const logical = canvasEventToLogical(canvas, e);
    const px = logical.x / zoom + camX;
    const py = logical.y / zoom + camY;
    return { cx: Math.floor(px / cell), cy: Math.floor(py / cell) };
  }

  function paint(e) {
    const { grid, mapId } = getCtx();
    const { cx, cy } = cellAt(e);
    setBlocked(grid, cx, cy, ed.painting === 1);
    localStorage.setItem("collision/" + mapId, JSON.stringify(toJSON(grid)));
  }

  canvas.addEventListener("mousedown", e => {
    if (!ed.enabled) return;
    e.preventDefault();
    ed.painting = e.button === 2 ? 2 : 1; // LMB=block, RMB=clear
    paint(e);
  });
  canvas.addEventListener("mousemove", e => { if (ed.enabled && ed.painting) paint(e); });
  window.addEventListener("mouseup", () => { ed.painting = 0; });
  canvas.addEventListener("contextmenu", e => { if (ed.enabled) e.preventDefault(); });

  ed.toggle = () => { ed.enabled = !ed.enabled; };

  ed.download = () => {
    const { grid, mapId } = getCtx();
    const blob = new Blob([JSON.stringify(toJSON(grid))], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = mapId + ".json";
    a.click();
    URL.revokeObjectURL(a.href);
  };

  // Draw blocked cells as translucent red; call from the game's render loop
  // with ctx already scaled+translated to map space.
  ed.drawOverlay = (ctx2d) => {
    if (!ed.enabled) return;
    const { grid, camX, camY } = getCtx();
    ctx2d.fillStyle = "rgba(255,40,40,0.35)";
    const cell = grid.cell ?? CELL;
    const c0 = Math.floor(camX / cell), r0 = Math.floor(camY / cell);
    const vis = Math.ceil(800 / cell);
    for (let r = r0; r < Math.min(grid.rows, r0 + vis); r++)
      for (let c = c0; c < Math.min(grid.cols, c0 + vis); c++)
        if (grid.cells[r * grid.cols + c])
          ctx2d.fillRect(c * cell - camX, r * cell - camY, cell, cell);
  };

  return ed;
}
