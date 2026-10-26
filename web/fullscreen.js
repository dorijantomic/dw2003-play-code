// Browser-fullscreen toggle shared by the title gesture and the in-game F key.
// Keep the API wrapper DOM-light so its enter/exit behavior is unit-testable.
export async function toggleGameFullscreen(doc, stage) {
  if (!doc || !stage) return false;
  try {
    if (doc.fullscreenElement) {
      if (!doc.exitFullscreen) return false;
      await doc.exitFullscreen();
      return false;
    }
    if (!stage.requestFullscreen) return false;
    await stage.requestFullscreen();
    return true;
  } catch {
    // Permission denial or an unsupported browser leaves the current layout intact.
    return !!doc.fullscreenElement;
  }
}

// Window fill: the stage covers the whole browser window (header hidden) without
// browser fullscreen. Remembered across reloads.
const FILL_KEY = "dw2003.windowFill";

export function setWindowFill(doc, on) {
  doc?.documentElement?.classList.toggle("window-fill", !!on);
  try { localStorage.setItem(FILL_KEY, on ? "1" : "0"); } catch { }
  // The battle canvas and the backing-size code resize on window resize.
  doc?.defaultView?.dispatchEvent?.(new Event("resize"));
}

export function restoreWindowFill(doc) {
  let on = false;
  try { on = localStorage.getItem(FILL_KEY) === "1"; } catch { }
  if (on) setWindowFill(doc, true);
}

// The F key: normal -> fill window -> browser fullscreen -> normal.
export async function cycleGameScreen(doc, stage) {
  if (!doc || !stage) return;
  const fill = doc.documentElement.classList.contains("window-fill");
  if (doc.fullscreenElement) {
    await toggleGameFullscreen(doc, stage);
    setWindowFill(doc, false);
  } else if (fill) {
    // Browser fullscreen refused: stay filling the window.
    await toggleGameFullscreen(doc, stage);
  } else {
    setWindowFill(doc, true);
  }
}
