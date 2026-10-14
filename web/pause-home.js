// THE pause home. One function, so there is one list.
//
// Until 2026-10-04 the pause home was reachable three ways and two of them were
// a second, hand-written copy of the same list: web/menu.js carried its own row
// names, its own order and its own cursor, sound and gate rules. The UI lab
// (`__labOpen("menu")`) opened THAT copy too, and so did `?legacyPause=1` (a switch now gone, which used to be the field's other way in).
// Both routes now come through the translated page. The rows, the order, the
// gate and every button on them are one system of the original — the resident
// list F0x8001270c and its builder 0x8001345C — and the one table of it is
// docs/research/ui/pause-home-button-table-2026-10-04.md.
//
// So both callers come through here: the field's START (web/game.js) and the UI
// lab's Status Menu button (the same `__labOpen("menu")`), plus the Digivolve
// Demo lab screen's Back, which must land on the same list. The translated page
// is engine/dw3/ui/pause-root-session.ts behind web/status-translated.js.
//
// `status` is null only under `?legacyStatus=1`, which is the hand-authored
// rollback as a whole: with no translated adapter there is no translated list to
// open, so that route keeps web/menu.js. No production route and no lab route
// reaches it.
export function openPauseHome({ state, status, menu, row = 0 }) {
  if (typeof status?.openHome === "function") {
    state.menuOpen = true;
    status.openHome(state, () => { state.menuOpen = false; menu.reset(); }, row);
    return "translated";
  }
  state.menuOpen = true;
  if (typeof menu?.openAt === "function") menu.openAt("home");
  else menu?.reset?.();
  return "rollback";
}

// Where the disc puts the player when the Card Album or the folder editor
// closes — the way back IN, so it belongs beside the way in.
//
// On the disc those two are separate SCREENS, not pause pages. The CARD FOLDERS
// page reads its own choice at `this+0x14` and calls the screen launcher with
// `0x1200` (Card Album) or `0x400` (folder editor), argument 0 — and then simply
// returns, naming no page of its own (F0x80084A34, pro/ststatus.s:1896-1911;
// the only store on the way out is `sw $v0, 0xc($s2)` on the "neither choice"
// path, `:1911`). The launcher is `[0x8004B440]` = F0x80016B88, whose whole body
// is `ctx+0x26C8 = code; ctx+0x26D0 = arg` (exe/fns.s:7366-7372), and a pending
// request becomes the current screen (F0x80016B28, exe/fns.s:7326-7351).
//
// The way back is the pause root's own next step, and that is the load-bearing
// evidence: F0x800132E0 re-attaches to the resident STATUS screen (`0x1000`) or
// asks for it, then writes ITS OWN cursor row (`+0x58`) into the page cell
// `D0x8005CCF0` (exe/fns.s:3838-3868 — `li $a0, 0x1000` at `:3857`, the row store
// at `:3862-3864`). The STATUS screen's host then builds the page that cell
// names: F0x800996EC reads `D0x8005CCF0` and the variant cell beside it and
// indexes the factory table at `0x8009A988` (pro/ststatus.s:23202-23215).
// `D0x8005CCF0` has exactly two writers in the whole disassembly, both in that
// root (exe/fns.s:3404 and `:3864`), and neither card overlay touches it, so it
// still says 5 = CARD FOLDERS when the pause comes back.
//
// So the player lands on the pause's OWN CARD FOLDERS page, rebuilt from
// scratch — its two choices start on "Card Album", because the page's own
// `+0x70` is written only by Up (`= 0`) and Down (`= 1`) and confirm turns that
// into `+0x14 = 1 / 2` (pro/ststatus.s:1616, 1645, 1691-1699) — and Backing out
// of it returns to the home list on the CARD FOLDERS row. That is what
// `status.reopenPage` opens. Only under `?legacyStatus=1`, where there is no
// translated page to reopen, does the copy in web/menu.js answer — one
// rollback, not a second copy in ordinary play.
export function returnToPauseCardFolders({ state, status, menu }) {
  if (typeof status?.reopenPage === "function" && status.reopenPage("cardfolders", 5)) {
    state.menuOpen = true;
    return "translated";
  }
  state.menuOpen = true;
  if (typeof menu?.openAt === "function") menu.openAt("cardfolder");
  else menu.screen = "cardfolder";
  return "rollback";
}
