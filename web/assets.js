// Runtime asset-density selection.
//
// Authentic files live under assets/ and retain the PS1's native dimensions.
// The optional assets-hd/ pack mirrors those paths at 4x resolution.  HD images
// are tagged with their density so Canvas source rectangles stay in native
// coordinates and whole-image draws keep their original logical size.

export const ASSET_MODE_KEY = "assetMode";
export const ASSET_MODE_AUTHENTIC = "authentic";
export const ASSET_MODE_HD = "hd";
export const HD_SCALE = 4;

const imageScales = new WeakMap();
const PATCHED = Symbol.for("ddw3.assetDrawPatched");

function storage() {
  return typeof localStorage === "undefined" ? null : localStorage;
}

export function savedAssetMode() {
  const mode = storage()?.getItem(ASSET_MODE_KEY);
  return mode === ASSET_MODE_AUTHENTIC || mode === ASSET_MODE_HD ? mode : null;
}

export function assetMode() {
  return savedAssetMode() ?? ASSET_MODE_AUTHENTIC;
}

export function setAssetMode(mode) {
  if (mode !== ASSET_MODE_AUTHENTIC && mode !== ASSET_MODE_HD) {
    throw new TypeError(`invalid asset mode: ${mode}`);
  }
  storage()?.setItem(ASSET_MODE_KEY, mode);
}

export function hdAssetUrl(url) {
  const text = String(url);
  const match = text.match(/^(?:\.\/)?assets\/(.+)$/);
  return match ? `assets-hd/${match[1]}` : text;
}

export function assetRequest(url, mode = assetMode()) {
  return mode === ASSET_MODE_HD
    ? { primary: hdAssetUrl(url), fallback: String(url), scale: HD_SCALE }
    : { primary: String(url), fallback: null, scale: 1 };
}

function tagLoadedImage(img, scale) {
  imageScales.set(img, scale);
  if (scale > 1) {
    // HTMLImageElement.width/height are logical presentation dimensions;
    // naturalWidth/naturalHeight remain the true 4x texture dimensions.
    img.width = Math.round(img.naturalWidth / scale);
    img.height = Math.round(img.naturalHeight / scale);
  }
}

/** Assign an asset URL to an existing Image, with transparent HD→native fallback. */
export function assignAssetImage(img, url) {
  const request = assetRequest(url);
  const onload = img.onload;
  const onerror = img.onerror;
  let usingHd = request.scale > 1 && request.primary !== request.fallback;

  img.onload = (event) => {
    tagLoadedImage(img, usingHd ? request.scale : 1);
    onload?.call(img, event);
  };
  img.onerror = (event) => {
    if (usingHd && request.fallback) {
      usingHd = false;
      img.src = request.fallback;
      return;
    }
    onerror?.call(img, event);
  };
  img.src = request.primary;
  return img;
}

export function loadAssetImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`failed to load ${url}`));
    assignAssetImage(img, url);
  });
}

export function assetImageScale(img) {
  return imageScales.get(img) ?? 1;
}

/**
 * True only for an image that actually finished loading.
 *
 * The stage loaders keep "loading" / "failed" strings in the same slots they store
 * a loaded Image in, and both are truthy. Readiness must test THIS predicate, not
 * truthiness, or a failed required asset would report the stage ready (the
 * engine-resource acceptance: a failed required load cannot report a ready screen).
 */
export function isLoadedAsset(value) {
  return typeof value === "object" && value !== null && value.naturalWidth > 0;
}

/** Tag a derived canvas that retains the pixel density of its source image. */
export function tagAssetSource(source, scale) {
  if (source && scale > 1) imageScales.set(source, scale);
  return source;
}

/** Transform Canvas drawImage arguments for a density-tagged source. */
export function scaledDrawArguments(scale, image, args) {
  if (scale <= 1) return args;
  if (args.length === 2) {
    return [
      0, 0, image.naturalWidth, image.naturalHeight,
      args[0], args[1], image.naturalWidth / scale, image.naturalHeight / scale,
    ];
  }
  if (args.length === 8) {
    return [
      args[0] * scale, args[1] * scale, args[2] * scale, args[3] * scale,
      args[4], args[5], args[6], args[7],
    ];
  }
  // Four-argument draws already provide explicit destination geometry and use
  // the complete source, so the browser can sample the HD texture directly.
  return args;
}

/** Install one scale-aware drawImage wrapper for all real game renderers. */
export function installAssetCanvasDrawing() {
  if (typeof CanvasRenderingContext2D === "undefined") return;
  const proto = CanvasRenderingContext2D.prototype;
  if (proto[PATCHED]) return;
  const nativeDrawImage = proto.drawImage;
  Object.defineProperty(proto, PATCHED, { value: true });
  proto.drawImage = function drawDensityAware(image, ...args) {
    const scale = assetImageScale(image);
    if (scale <= 1) return nativeDrawImage.call(this, image, ...args);
    const smoothing = this.imageSmoothingEnabled;
    this.imageSmoothingEnabled = true;
    try {
      return nativeDrawImage.call(
        this, image, ...scaledDrawArguments(scale, image, args)
      );
    } finally {
      this.imageSmoothingEnabled = smoothing;
    }
  };
}

/** Fetch an HD raster for WebGL, falling back to its authentic counterpart. */
export async function fetchAsset(url) {
  const request = assetRequest(url);
  if (request.fallback) {
    try {
      const response = await fetch(request.primary);
      if (response.ok) return response;
    } catch {
      // Normal when an authentic-only build has no assets-hd directory.
    }
  }
  return fetch(request.fallback ?? request.primary);
}

export async function hdPackAvailable() {
  try {
    const response = await fetch("assets-hd/manifest.json", { cache: "no-store" });
    if (!response.ok) return false;
    const manifest = await response.json();
    return manifest?.scale === HD_SCALE && Array.isArray(manifest.assets);
  } catch {
    return false;
  }
}

export function hideAssetModeChooser() {
  document.getElementById("asset-mode-screen")?.setAttribute("hidden", "");
}

export async function showAssetModeChooser({ allowClose = false } = {}) {
  const screen = document.getElementById("asset-mode-screen");
  if (!screen) return;
  screen.hidden = false;
  screen.querySelector(".asset-mode-close")?.toggleAttribute("hidden", !allowClose);

  const hdButton = document.getElementById("asset-mode-hd");
  const hdNote = document.getElementById("asset-mode-hd-note");
  if (hdButton) hdButton.disabled = true;
  if (hdNote) hdNote.textContent = "Checking whether the HD pack is installed…";
  const available = await hdPackAvailable();
  if (hdButton) hdButton.disabled = !available;
  if (hdNote) {
    hdNote.textContent = available
      ? "AI-upscaled artwork with authentic layout and geometry."
      : "HD pack not installed. Build the upscale_assets stage first.";
  }
}

/** Wire the first-launch chooser and persistent header setting. */
export async function initializeAssetModeUi() {
  document.documentElement.dataset.assetMode = assetMode();
  const select = document.getElementById("assetModeSelect");
  const selected = savedAssetMode();
  if (select) {
    select.value = assetMode();
    select.addEventListener("change", () => {
      setAssetMode(select.value);
      location.reload();
    });
    hdPackAvailable().then((available) => {
      const option = select.querySelector('option[value="hd"]');
      if (option) {
        option.disabled = !available && assetMode() !== ASSET_MODE_HD;
        option.textContent = available ? "HD Remaster" : "HD Remaster (not installed)";
      }
    });
  }

  const authentic = document.getElementById("asset-mode-authentic");
  const hd = document.getElementById("asset-mode-hd");
  const close = document.querySelector(".asset-mode-close");
  authentic?.addEventListener("click", () => {
    setAssetMode(ASSET_MODE_AUTHENTIC);
    location.reload();
  });
  hd?.addEventListener("click", () => {
    setAssetMode(ASSET_MODE_HD);
    location.reload();
  });
  close?.addEventListener("click", hideAssetModeChooser);

  if (!selected) await showAssetModeChooser();
}
