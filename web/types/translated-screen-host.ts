// What a translated screen tells web/translated-screen-host.ts when it is created.

/** `close()` runs the held onClose, the same way a finish the screen reached does. */
export type CloseMode = "notify" | "silent";
/** The session is torn down on this path, finished or not. */
export type DisposePolicy = "always" | "never" | "unless-finished";

/** What the host asks of whichever engine UI session the screen opened (GymSession, InnSession, AlbumSession...). */
export interface TranslatedScreenSession {
  /** absent on a session the screen always disposes (the help menu), present on one the host asks about */
  finished?(): boolean;
  dispose(): void;
}

/** The screen object the host drives: it keeps the field names the hand-written copies used. */
export interface TranslatedScreenOwner<S extends TranslatedScreenSession = TranslatedScreenSession> {
  _open: boolean;
  _pending?: boolean;
  _closes?: number;
  _request: number;
  _session?: S | null;
  _onClose?: (() => void) | null;
}

export interface TranslatedScreenBeginOptions {
  onClose?: (() => void) | null;
}

export interface TranslatedScreenHost {
  begin(options?: TranslatedScreenBeginOptions): number;
  attach(onClose: (() => void) | null | undefined): void;
  current(token: number): boolean;
  abandon(): boolean;
  finish(): boolean;
  close(): boolean;
}

/** createTranslatedScreenHost()'s options (the CLOSE_* / DISPOSE_* constants are the only values that mean anything). */
export interface TranslatedScreenHostOptions<S extends TranslatedScreenSession = TranslatedScreenSession> {
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
  /** runs once, while the session is still alive: read the summary, commit. Each screen's release reads
   *  fields only its own session has, so the session type is the screen's own (null when none was started). */
  release?: ((session: S | null | undefined) => void) | null;
}
