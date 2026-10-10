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
