// Shared driver for the translated Digimon lab (web/lab-translated.js, the
// original pro/stgdglab port). The screen reads HELD pad buttons once per frame
// out of `state.keys`, so every button here is held across a display frame
// instead of being dispatched as one keydown/keyup pair.
//
// The lab's own route, in the order the player meets it:
//   open -> Select Action rows (the pane's machine word 3)
//        -> Enter on the Switch row -> the pedestal picker (word 15); the
//           pedestal under the cursor is the lab ROOT's +0x64 and it wraps over
//           the root's +0x5C (=3, the three pedestals, free ones included)
//        -> Enter -> the Switch screen ("lab switch") at word 4; its cursor
//           +0x60 walks the waiting partners at +0xE4 and Enter puts the one
//           under the cursor into that pedestal
//        -> Enter/back out of every level.
export const LAB_PEDESTAL_COUNT_OFFSET = 0x5c;  // lab root +0x5C: how many pedestals
export const LAB_PEDESTAL_CURSOR_OFFSET = 0x64; // lab root +0x64: the pedestal under the cursor
export const LAB_SWITCH_ROWS_OFFSET = 0x104;    // lab switch +0x104: rows in the candidate list
export const LAB_SWITCH_CANDIDATES_OFFSET = 0xe4; // lab switch +0xE4: the waiting partners, in rows
export const LAB_SWITCH_CURSOR_OFFSET = 0x60;   // lab switch +0x60: the row under the cursor

/** Hold one button across a display frame, as a player does. */
export const press = async (page, key, wait = 320) => {
  await page.keyboard.down(key);
  await page.waitForTimeout(110);
  await page.keyboard.up(key);
  await page.waitForTimeout(wait);
};

/** Open the lab through the walker's own launcher (bank 0x7C index 0). */
export const openLab = (page) => page.evaluate(() => window.__dri.open(window.__state, null));

/** The lab's diagnostics plus the live words the checks read. */
export const labScreen = (page) => page.evaluate((o) => {
  const d = window.__dri?.diagnostics?.() ?? {};
  const g = window.__dri?._session;
  const find = (name) => (g ? [...g.tree.tasks.values()].find((t) => g.tree.classes.get(t.classId).name === name) : undefined);
  const root = find("lab root");
  const sw = find("lab switch");
  const word = (task, at) => (task ? (g.mem.read32(task.address + at) | 0) : null);
  const s = d.screen ?? null;
  return {
    execution: d.execution ?? null,
    open: !!window.__dri?.isOpen?.(),
    screen: s,
    pedestals: root ? word(root, o.pedestalCount) : null,
    pedestal: root ? word(root, o.pedestalCursor) : null,
    rows: sw ? word(sw, o.switchRows) : null,
    cursor: sw ? word(sw, o.switchCursor) : null,
    candidates: sw ? Array.from({ length: 10 }, (_, i) => g.mem.read32(sw.address + o.switchCandidates + i * 4) | 0) : null,
  };
}, {
  pedestalCount: LAB_PEDESTAL_COUNT_OFFSET,
  pedestalCursor: LAB_PEDESTAL_CURSOR_OFFSET,
  switchRows: LAB_SWITCH_ROWS_OFFSET,
  switchCandidates: LAB_SWITCH_CANDIDATES_OFFSET,
  switchCursor: LAB_SWITCH_CURSOR_OFFSET,
});

/** Wait until the lab's own diagnostics satisfy `predicate` (run in the page). */
export const waitLab = (page, predicate, what, timeout = 40_000) =>
  page.waitForFunction(predicate, null, { timeout, polling: 120 })
    .then(() => labScreen(page))
    .catch(async (error) => {
      const screen = await labScreen(page);
      throw new Error(`the lab never reached ${what}: ${JSON.stringify(screen)} (${error.message})`);
    });

/** The Select Action rows, idle and ready for a button. */
export const selectAction = (page) =>
  waitLab(page, () => {
    const s = window.__dri?.diagnostics?.().screen;
    return !!s && s.root === 1 && s.pane === 3 && !s.child;
  }, "the Select Action rows");

/** The pedestal picker: which of the three pedestals the switch applies to. */
export const pedestals = (page) =>
  waitLab(page, () => {
    const s = window.__dri?.diagnostics?.().screen;
    return !!s && s.pane === 15 && !s.child;
  }, "the pedestal picker");

/** The Switch screen itself, at its input word. */
export const switchScreen = (page) =>
  waitLab(page, () => {
    const s = window.__dri?.diagnostics?.().screen;
    return !!s && s.child === "lab switch" && s.childPhase === 4 && s.childLifecycle === 1;
  }, "the Switch screen");

/** Back out of every level until the lab closes. */
export const closeLab = async (page, levels = 8) => {
  for (let i = 0; i < levels && await page.evaluate(() => window.__dri?.isOpen?.()); i++) {
    await press(page, "Escape", 700);
  }
  await page.waitForFunction(() => !window.__dri?.isOpen?.(), null, { timeout: 40_000, polling: 120 });
};

/** The walker's party, blocks, gear and reserve, as JSON. */
export const labState = (page) => page.evaluate(() => {
  const s = window.__state;
  return {
    party: [...(s.party ?? [])],
    stats: JSON.parse(JSON.stringify(s.partyStats ?? [])),
    partner: JSON.parse(JSON.stringify(s.partnerStats ?? null)),
    equipment: JSON.parse(JSON.stringify(s.equipment ?? [])),
    reserveStats: Object.keys(s.reserveStats ?? {}).sort(),
    reserveEquipment: Object.keys(s.reserveEquipment ?? {}).sort(),
    owned: s.rosterOwned,
    storedParty: JSON.parse(localStorage.getItem("party") ?? "[]"),
  };
});