// Media adapter for the translated title's two opening-movie launch codes.
// The streams are data-only derivatives of the complete raw disc sectors;
// game routing stays in the translated title and language screen controllers.
//
// The player owns the movie's end, as the original's movie object does
// (F0x80083944 case 1, stdwtitl.s:933-949): the frame fetch raises the end
// flag when the stream's counter reaches the count the movie row carried
// (stdwtitl.s:610-618; F0x800835d4, exe-decomp/stdwtitl_c/F0x800835d4.c:20-22),
// and the raw pad's START bit ends it early (stdwtitl.s:938-942,
// [0x8004BBC4] = F0x80018854). So the pictures shown are counted here and the
// stream's last one ends the movie; the container's own `ended` event is the
// same statement from the other side and is kept as its confirmation.
import { titleViewTransform } from "./titlescreen.js";

const LAYOUT_URL = "assets/data/stdwtitl_ui.json";
const MOVIE_DIR = "assets/movie/";

export function createTitleMoviePlayer(onEnd, onError = console.error, createVideo = null) {
  const video = createVideo ? createVideo() : document.createElement("video");
  video.playsInline = true;
  video.preload = "auto";
  video.volume = 0.6;
  let layoutPromise = null;
  const loadLayout = () => layoutPromise ??= fetch(LAYOUT_URL).then(async (response) => {
    if (!response.ok) throw new Error(`Title movie layout: ${response.status}`);
    const loaded = (await response.json()).title_menu?.movie_display;
    if (!loaded?.logical || !loaded?.launch) throw new Error("Title movie layout is missing");
    return loaded;
  });
  let active = false, code = 0, layout = null, generation = 0, blocked = false;
  let frames = 0, fps = 0, endedBy = "", endedPictures = 0;

  /** How many pictures of the stream have been shown so far. The original's
   *  counter runs over the stream's own frames, not over a container event. */
  const picturesShown = () => {
    if (!(fps > 0) || !Number.isFinite(video.currentTime)) return 0;
    return Math.floor(video.currentTime * fps + 1e-6);
  };
  const lastPictureShown = () => frames > 0 && picturesShown() >= frames;

  const finish = (why) => {
    if (!active) return;
    const finishedCode = code;
    endedBy = why;
    endedPictures = picturesShown();
    active = false;
    generation++;
    video.pause();
    video.removeAttribute("src");
    video.load();
    onEnd(finishedCode);
  };
  video.addEventListener("ended", () => finish("ended"));
  video.addEventListener("timeupdate", () => { if (lastPictureShown()) finish("last-picture"); });
  video.addEventListener("error", () => {
    if (!active) return;
    onError(new Error(`Opening movie could not load: ${video.currentSrc}`));
    finish("error");
  });

  const player = {
    async open(launchCode) {
      const token = ++generation;
      video.pause();
      active = true;
      code = launchCode;
      blocked = false;
      endedBy = "";
      endedPictures = 0;
      frames = 0;
      try {
        layout = await loadLayout();
        if (!active || token !== generation) return;
        const file = layout.launch[`0x${launchCode.toString(16)}`];
        if (!file) throw new Error(`Unknown title movie launch code ${launchCode}`);
        fps = layout.fps ?? 0;
        frames = layout.frames ?? 0;
        video.src = MOVIE_DIR + file;
        video.load();
        await video.play();
      } catch (error) {
        if (!active || token !== generation) return;
        if (error?.name === "NotAllowedError") blocked = true;
        else { onError(error); finish("error"); }
      }
    },
    isOpen: () => active,
    skip: () => finish("start"),
    retry() {
      if (active && blocked) video.play().then(() => { blocked = false; }).catch(() => {});
    },
    draw(ctx, viewW, viewH, muted = false) {
      if (!active) return false;
      if (lastPictureShown()) finish("last-picture");
      video.muted = muted;
      ctx.save();
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, viewW, viewH);
      if (layout && video.readyState >= 2 && video.videoWidth) {
        const t = titleViewTransform(viewW, viewH);
        const [x, y, w, h] = layout.logical;
        ctx.translate(t.offsetX, t.offsetY);
        ctx.scale(t.scale, t.scale);
        ctx.drawImage(video, x, y, w, h);
      }
      ctx.restore();
      return true;
    },
    diagnostics: () => ({ open: active, code, currentTime: video.currentTime,
      duration: video.duration, readyState: video.readyState, blocked,
      width: video.videoWidth, height: video.videoHeight, file: video.currentSrc,
      fps, frames, pictures: active ? picturesShown() : endedPictures, endedBy }),
  };
  return player;
}