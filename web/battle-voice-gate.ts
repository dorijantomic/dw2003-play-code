// Per-side single-slot gate for battle op10 sounds — the fightstg context+0xc
// rule (op10 handler F0x8008c454 lines 9706-9712): a new op10 effect (and its
// sound) is dropped while that script's one effect slot is still occupied. Here
// the slot is one voice per side, freed when the voice ends (the observable
// proxy for the original effect object's lifetime). Pure/DOM-free for testing.
export function battleVoiceGate() {
  const busy = { player: false, enemy: false };
  return {
    /** true if the caller may start a voice on `side` (and claims the slot). */
    acquire(side) {
      if (busy[side]) return false;
      busy[side] = true;
      return true;
    },
    /** the voice on `side` ended — free the slot. */
    release(side) { busy[side] = false; },
  };
}
