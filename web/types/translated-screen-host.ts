// What a translated screen tells web/translated-screen-host.ts when it is created.

/** `close()` runs the held onClose, the same way a finish the screen reached does. */
export type CloseMode = "notify" | "silent";
/** The session is torn down on this path, finished or not. */
export type DisposePolicy = "always" | "never" | "unless-finished";

/** createTranslatedScreenHost()'s options (the CLOSE_* / DISPOSE_* constants are the only values that mean anything). */
export interface TranslatedScreenHostOptions {
  /** CLOSE_NOTIFY | CLOSE_SILENT: what close() does */
  closeMode?: CloseMode;
  /** DISPOSE_*: teardown when the caller closes the screen */
  closeDispose?: DisposePolicy;
  /** DISPOSE_*: teardown when the screen finished on its own */
  finishDispose?: DisposePolicy;
  /** bump _closes on every finish */
  countsCloses?: boolean;
  /** false for a screen with no _pending flag */
  tracksPending?: boolean;
  /** false to leave _session pointing at the closed session */
  clearSession?: boolean;
  /** runs once, while the session is still alive: read the summary, commit. The session is
   *  whichever engine UI session the screen opened (GymSession, InnSession, AlbumSession...),
   *  and each release reads fields only its own session has, so it stays untyped here. */
  release?: ((session: any) => void) | null;
}
