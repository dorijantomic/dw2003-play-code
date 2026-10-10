// The field-reachable movie in the browser: MOVIED08_STR, the clip the field's
// battle handoff shows at story ordinal 43.
//
// The original's movie object is ported once in
// engine/systems/field-movie-player.ts (blank cadence, the row's own picture
// count, the pad's START skip, the row's return selector). This file is the
// media adapter only:
//
//   * The pictures and the sound are the stream derivative
//     web/assets/movie/movied08.mp4 — the same raw Mode 2 sector -> mp4 pipeline
//     the two opening movies already ship through
//     (tools/extract_opening_movies.py; manifest.json carries each movie's disc
//     file index so the row resolves to its asset).
//   * The count and the end are the engine player's, as they are the original's
//     (the stream's frame number against the row's count — stdwtitl.s
//     .L0x00000960-.L0x00000988). The mp4's own `ended` event is not the end:
//     the disc stops 16 pictures early (434 of the stream's 450), so the movie
//     is cut there and the container event never arrives.
//   * The draw uses the movie object's own display rect: a 320x480 interlaced
//     display whose 320x416 picture is uploaded from Y=0x24 (stdwtitl.s
//     L0x00000b38; tools/extract_stdwtitl_ui.py), i.e. [0, 18, 320, 208] in the
//     320x240 logical screen. The fit into the view is the same one the title's
//     movie uses (web/titlescreen.js titleViewTransform), not a second table.
import {
  FieldMoviePlayer, MOVIE_DISPLAY_RECT, consumeFieldTicks,
} from "./vendor/engine.js";
import { titleViewTransform } from "./titlescreen.js";

const MANIFEST_URL = "assets/movie/manifest.json";
const MOVIE_DIR = "assets/movie/";

/** The shipped asset for a movie row, by the disc's own file index (the one
 *  identifier the row and the manifest share); the filename is the fallback. */
function movieRecordFor(manifest, row) {
  const movies = manifest?.movies ?? {};
  const byIndex = Object.values(movies).find((m) => m.index === row.fileIndex);
  if (byIndex) return byIndex;
  return movies[row.file.replace(/_STR$/, "").toLowerCase()] ?? null;
}

export function createFieldMoviePlayer(onEnd, onError = console.error, createVideo = null) {
  const video = createVideo ? createVideo() : document.createElement("video");
  video.playsInline = true;
  video.preload = "auto";
  video.volume = 0.6;
  const player = new FieldMoviePlayer();
  let manifestPromise = null;
  let active = false, code = 0, file = "", blocked = false, generation = 0;
  let accumulator = 0;

  const loadManifest = () => manifestPromise ??= fetch(MANIFEST_URL).then(async (response) => {
    if (!response.ok) throw new Error(`Movie manifest: ${response.status}`);
    return response.json();
  });

  const finish = (why) => {
    if (!active) return;
    active = false;
    generation++;
    video.pause();
    video.removeAttribute("src");
    video.load();
    onEnd(code, why);
  };

  video.addEventListener("error", () => {
    if (!active) return;
    onError(new Error(`Field movie could not load: ${video.currentSrc || file}`));
    player.abort();
    finish("error");
  });

  const adapter = {
    /** `F0x80083f48`/`F0x80083cc0`: the launch code names the movie row, the row
     *  names the asset. The engine player opens synchronously (so START can end
     *  the movie even while the stream is still loading); the media load is
     *  async and hands back through `onEnd` either way. */
    async open(launchCode) {
      const token = ++generation;
      const row = player.open(launchCode);
      active = row !== null;
      code = launchCode;
      blocked = false;
      accumulator = 0;
      file = "";
      if (!row) {
        onError(new Error(`Unknown field movie launch code 0x${launchCode.toString(16)}`));
        active = false;
        return null;
      }
      try {
        const manifest = await loadManifest();
        if (!active || token !== generation) return row;
        const record = movieRecordFor(manifest, row);
        if (!record) throw new Error(`No shipped asset for ${row.file} (disc file ${row.fileIndex})`);
        file = record.file;
        video.src = MOVIE_DIR + file;
        video.load();
        await video.play();
      } catch (error) {
        if (!active || token !== generation) return row;
        if (error?.name === "NotAllowedError") {
          // Autoplay refused: retry muted, which every policy allows, so the
          // pictures still play. The sound is the only loss.
          blocked = true;
          video.muted = true;
          try { await video.play(); } catch { onError(error); player.abort(); finish("error"); }
          return row;
        }
        onError(error);
        player.abort();
        finish("error");
      }
      return row;
    },
    /** The console's blanks the browser time is worth, shared with the field's
     *  own conversion (`consumeFieldTicks`): the movie runs on the same cadence
     *  every other screen of ours runs on. */
    update(dt) {
      if (!active) return;
      const due = consumeFieldTicks(accumulator, dt);
      accumulator = due.accumulator;
      if (due.ticks > 0) player.advanceBlanks(due.ticks);
      if (!player.isOpen()) finish(player.endReason());
    },
    /** The pad's START bit (stdwtitl.s .L0x00000e88-.L0x00000e9c). */
    skip() {
      if (!active) return;
      player.skip();
      finish("start");
    },
    isOpen: () => active,
    /** The movie takes the whole screen, as the original's movie screen does: a
     *  black framebuffer with the picture at its own rect. */
    draw(ctx, viewW, viewH) {
      if (!active) return false;
      ctx.save();
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, viewW, viewH);
      if (video.readyState >= 2 && video.videoWidth) {
        const t = titleViewTransform(viewW, viewH);
        ctx.translate(t.offsetX, t.offsetY);
        ctx.scale(t.scale, t.scale);
        ctx.drawImage(video, MOVIE_DISPLAY_RECT.x, MOVIE_DISPLAY_RECT.y,
          MOVIE_DISPLAY_RECT.width, MOVIE_DISPLAY_RECT.height);
      }
      ctx.restore();
      return true;
    },
    diagnostics: () => ({
      open: active, code, file, blocked,
      pictures: player.pictures(), frames: player.frames(),
      blanks: player.blanksElapsed(), endReason: player.endReason(),
      destination: player.destination() == null ? null : `0x${player.destination().toString(16)}`,
      currentTime: video.currentTime, readyState: video.readyState,
      width: video.videoWidth, height: video.videoHeight,
      muted: video.muted, paused: video.paused,
    }),
  };
  return adapter;
}
