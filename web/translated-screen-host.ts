// One open/close host for the translated screens (web/*-translated.js).
//
// Every translated screen repeated the same lifecycle by hand (reports/card-3.md #1): the
// screen is up from the moment it is asked for, one `_request` token discards a bank load
// that lands after the caller left, one `_onClose` continuation is held, `_closes` counts
// it, and `close()` decides whether that continuation still runs. The copies had drifted on
// teardown: web/save-translated.js disposes on every finish, web/gym-translated.js,
// web/lab-translated.js and web/fightreport-translated.js dispose only a session that never
// finished, and web/inn-translated.js and web/dialogue-translated.js dispose only when the
// caller takes the screen away (a session that ended by itself already tore itself down).
// Those are real rules, not accidents, so each screen names them in the options below
// instead of re-deriving them.

/** `close()` runs the held onClose, the same way a finish the screen reached does. */
export const CLOSE_NOTIFY = "notify";
/** `close()` abandons the screen: the held onClose is dropped and no close is counted. */
export const CLOSE_SILENT = "silent";

/** The session is torn down on this path, finished or not. */
export const DISPOSE_ALWAYS = "always";
/** The session is left as it is on this path. */
export const DISPOSE_NEVER = "never";
/** Only a session that has not finished is torn down; one that finished tore itself down. */
export const DISPOSE_UNLESS_FINISHED = "unless-finished";

/**
 * Bind one screen object to the shared lifecycle. `owner` keeps the field names the copies
 * already used (`_open`, `_pending`, `_request`, `_onClose`, `_closes`), so diagnostics and
 * callers read the same things as before.
 *
 * options:
 *   closeMode      CLOSE_NOTIFY | CLOSE_SILENT — what `close()` does (default CLOSE_SILENT).
 *   closeDispose   DISPOSE_* — teardown when the caller closes the screen (default NEVER).
 *   finishDispose  DISPOSE_* — teardown when the screen finished on its own (default NEVER).
 *   countsCloses   true to bump `_closes` on every finish (default false: the screen has none).
 *   tracksPending  false for a screen with no `_pending` flag (default true).
 *   clearSession   false to leave `_session` pointing at the closed session (default true).
 *   release(session)  runs once, while the session is still alive: read the summary, commit.
 */
export function createTranslatedScreenHost(owner, options = {}) {
    const closeMode = options.closeMode === CLOSE_NOTIFY ? CLOSE_NOTIFY : CLOSE_SILENT;
    const closeDispose = options.closeDispose ?? DISPOSE_NEVER;
    const finishDispose = options.finishDispose ?? DISPOSE_NEVER;
    const countsCloses = options.countsCloses === true;
    const tracksPending = options.tracksPending !== false;
    const clearSession = options.clearSession !== false;
    const release = options.release ?? null;

    function teardown(session, policy) {
        if (!session || policy === DISPOSE_NEVER) return;
        if (policy === DISPOSE_UNLESS_FINISHED) {
            if (!session.finished()) session.dispose();
            return;
        }
        session.dispose();
    }

    function end(policy, notify) {
        if (!owner._open) return false;
        owner._open = false;
        if (tracksPending) owner._pending = false;
        if (countsCloses) owner._closes++;
        ++owner._request;
        const session = owner._session;
        try {
            release?.(session);
        } finally {
            teardown(session, policy);
        }
        if (clearSession) owner._session = null;
        const cb = owner._onClose;
        owner._onClose = null;
        if (notify) cb?.();
        return true;
    }

    const host = {
        /** Raise the screen. Returns the request token the load checks with `host.current`. */
        begin({ onClose = null } = {}) {
            owner._open = true;
            if (tracksPending) owner._pending = true;
            owner._onClose = onClose;
            return ++owner._request;
        },

        /** Hold the continuation later than `begin` (a screen that only takes one once loaded). */
        attach(onClose) {
            owner._onClose = onClose ?? null;
        },

        /** True while the load that captured `token` is still the newest one. */
        current(token) {
            return token === owner._request;
        },

        /** The screen gives up without a continuation and without a teardown: a load failed
         *  and the caller's own path takes over (web/dialogue-translated.js's `onFail`).
         *  No close is counted, exactly as the hand-written copies did. */
        abandon() {
            if (!owner._open) return false;
            owner._open = false;
            if (tracksPending) owner._pending = false;
            ++owner._request;
            owner._onClose = null;
            return true;
        },

        /** The screen finished on its own (or was dismissed through the same path). */
        finish() {
            return end(finishDispose, true);
        },

        /** The caller takes the screen away: CLOSE_NOTIFY finishes, CLOSE_SILENT abandons. */
        close() {
            if (closeMode === CLOSE_NOTIFY) return end(closeDispose, true);
            if (!owner._open) return false;
            owner._open = false;
            if (tracksPending) owner._pending = false;
            ++owner._request;
            const session = owner._session;
            teardown(session, closeDispose);
            if (clearSession) owner._session = null;
            owner._onClose = null;
            return true;
        },
    };

    return host;
}
