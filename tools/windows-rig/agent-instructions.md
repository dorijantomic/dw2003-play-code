# Live game capability for the implementation lead

Cua Driver is the Windows interaction layer, not a reasoning model. When a
specific uncertainty concerns observable runtime behavior, the real game is an
available experimental system. Read `docs/workflow/game-computer-use.md` and the
shared gameplay playbook. Prefer static evidence, memory, function traces and
the existing emulator RPC when they answer the question directly.

Use `python3 tools/windows-rig/game_driver.py status` to check the configured
window and fresh bridge. `observe` saves a window capture; `observe
--structured-only` omits the image. Read the saved image only when needed.
`launch` reuses the pinned launcher if the game is absent. `doctor` checks CUA.
`start` starts only the dedicated bounded driver, not the game.
After a disconnected or expired private CUA session, `start --restart` renews
only that bounded daemon; retry observation once, never blindly retry input.

For an authorized, idle rig, perform one reversible, short experiment:
`python3 tools/windows-rig/game_driver.py experiment menu-probe --control
--buttons menu --transport rpc`. Use `--transport cua` specifically to test
physical keyboard delivery. Button names are confirm, cancel, menu, directions,
start, select, square, cross, circle and triangle. Confirm/cancel aliases are
context-dependent: use explicit pad names where the playbook differs. RPC is
frame-timed; CUA is a key tap, not a frame hold. Start with background CUA input;
use `--foreground-after-noop` only after examining an ineffective background
action or a driver refusal. Do not blindly replay an input after a timeout.

The command preserves the starting state and restores it at the end. Group at
most eight buttons into one experiment; for adaptive multi-step work import
GameComputerUse and keep one experiment context open while observing. Respect
the human-control flag, active user play, and the shared exclusive rig lock.
The wrapper cannot infer whether a human intends to play; --control is your
attestation that this particular bounded action is authorized and idle.

Each result links `.dw3-research/game-use/<run>/experiment.json` and deduplicated
PNG captures. A successful input call or changed pixels do not prove a game
transition. Inspect the result, correlate it with existing trace/memory artifacts,
record interpretation/confidence/unresolved questions, and register actual
findings through dw3-research and the normal review/ledger workflow. Save playing
lessons immediately. No raw desktop, shell, browser or arbitrary typing tools
are exposed through this capability. Researchers and lane B request live
experiments from the lead; they do not drive the emulator.
