import { asButton } from "../../input.js";
import { BATTLE_MESSAGE_CLOSE_BIT, dnaRejection, dnaTagBranchKind } from "../../vendor/engine.js";
import { ST } from "../messages.js";
import { commandPhaseWaitsForLine } from "../hud.js";
import { currentMenuItems, COLS, jokeMenuRows } from "../layout.js";
import type { BattleContext } from "../../types/battle.js";

// moved by tools/rewrite/split-closure.mjs
export function makeInput(B: BattleContext) {
function handleKey(rawKey) {
    // Accept either a pad button name from the dispatcher or the raw key it
    // stands for, so a caller (and a test) may use whichever it has.
    const k = asButton(rawKey);
    if (!B.battle) return false;
    const b = B.battle;
    // The pad word FIGHTSTG_F0x80098a84 reads through [0x8004bbc4](0). Its only
    // meaning for the message line is bit 0x2000 (Circle,
    // docs/research/ui/exclamation-indicator-decoded-2026-07-02.md:131): the line
    // waits for the press and has no timeout. Latch it here, before any state branch
    // returns, so every Circle press reaches the line.
    if (k === "circle" && B.msgSession) B.msgPadWords |= BATTLE_MESSAGE_CLOSE_BIT;

    if (b.state === ST.RESULT_MSG && b._resultPages?.length) {
      if (!b._resultReady) return true;
      if (k === "circle") {
        B.sfx?.play("system07");
        const next = (b._resultPageIndex ?? 0) + 1;
        if (next < b._resultPages.length) {
          b._resultPageIndex = next;
          const pageSpec = (b._resultPageSpecs ?? [])[next] ?? null;
          // Each page carries its own `+0xac` arm, so a later page can be the original's
          // own two lines even when the first was the walker's own sentence.
          if (pageSpec) B.sayOriginal(b, pageSpec, b._resultPages[next]);
          else B.sayWalker(b, b._resultPages[next]);
        } else {
          b._resultPages = null;
          b._resultPageSpecs = null;
          b._resultPageIndex = 0;
          b._resultReady = false;
          B.advanceAfterResult(b);
        }
      }
      return true;
    }

    if (b.state === ST.WIN) {
      if (b._victoryPhase === "pose") {
        // Native flow is automatic here: the one confirm closed the preceding
        // "Defeated!" page, then the victory pose/message runs into STFGTREP.
        return true;
      }
      if (b._victoryPhase === "ending") {
        // The finale's ending chain owns the pad while it plays: the movie
        // object reads the raw pad's START itself (the host's movie adapter —
        // dispatchInput routes to the open movie before any battle key), and
        // the battle swallows anything else.
        return true;
      }
      if (b._victoryPhase !== "report") return true;
      // The native results screen owns the pad while it is up; it reads the
      // held-button word each frame, so key events must not advance pages here.
      if (b._reportNative) return true;
      if (k === "circle") {
        if (b.timer < 1.35) return true; // black cut + bottom-message type-in
        B.sfx?.play("system07");
        const lastPage = Math.max(0, (b._winPages?.length ?? 1) - 1);
        if ((b._winPageIndex ?? 0) < lastPage) {
          b._winPageIndex = (b._winPageIndex ?? 0) + 1;
          b.timer = 0;
        } else {
          // TELEPORT: confirmed final report page -> warp-out/return-to-field effect.
          B.sfx?.play("system10");
          B.endBattle("win");
        }
      }
      return true;
    }

    if (b.state === ST.TAG_PRESENT) {
      const tag = b._tagPresentation;
      if (tag?.phase === "prompt" && (k === "circle")) {
        B.sfx?.play("system07");
        tag.phase = "entrance";
        B.clearBattleLine(b);
        // FIGHTSTG_startEntrance(commands->digimon, 0, weak); the message 0x39 line waits for the end of the task.
        B.startEntrance(b, {
          side: 0, name: tag.profile.name,
          endMessage: `${tag.memberName} switches to ${tag.profile.name}!`,
          onSwap: () => B.commitTag(b, tag.action, tag.spd),
          onDone: () => { b._tagPresentation = null; b.state = ST.RESULT_MSG; b.timer = 0; },
        });
        return true;
      }
      return true;
    }

    if (b.state === ST.PLAYER_MENU) {
      // The command phase does not read the pad while a message line is up and unread:
      // the original's controller instruction returns before it arms anything while the
      // line's own slot is occupied, so there is no menu to press and the press belongs to
      // the line alone (commandPhaseWaitsForLine, `wfightmn.s:1494-1496`). This covers the
      // translated list and the walker's own fallback list equally.
      if (commandPhaseWaitsForLine(B.msgSession, b.state)) return true;
      // The Frozen gate owns the turn before the list exists, so a press on this frame
      // reaches nothing at all (F0x800a7418 step 1, `wfightmn.s:1503-1512`). The roll
      // is the same one update() takes and the latch keeps it to one per turn.
      if (B.frozenGateLosesTurn(b)) return true;
      // The shipped pro/fightstg list owns the selection and the confirm for the
      // whole command phase, even on the frame before the adapter has opened:
      // the key event is swallowed here and forwarded as a pad pulse (state.keys
      // also carries held directions), so the walker's own 2-column selection
      // never moves underneath it. update() turns the overlay's chosen row into
      // the same confirmCommand() call the Circle press below makes. If the
      // overlay never loads (10s), the walker's list takes over again.
      if (!B.commandNative.failed()) {
        B.commandNative.press(k);
        return true;
      }
      // battle-menu blips per sfx-triggers.json fightstg cross-check:
      // system07 cursor, system08 confirm, system02 cancel
      if (k === "left" || k === "right") return true;
      const items = currentMenuItems(b);
      if (k === "up")    { B.sfx?.play("system06"); b.menuNotice = null; b.menuSel = (b.menuSel - COLS + items.length) % items.length; return true; }
      if (k === "down")  { B.sfx?.play("system06"); b.menuNotice = null; b.menuSel = (b.menuSel + COLS) % items.length; return true; }
      if (k === "circle") {
        B.sfx?.play("system07");
        b.menuNotice = null;
        // Confused player: F0x800a1910 rolls before reading the selected joke.
        // Failure maps to command 0 (normal Attack); success maps to command -1
        // and only then uses the joke index for flavor presentation.
        if (jokeMenuRows(b)) { B.confirmJokePick(b, b.menuSel); return true; }
        B.confirmCommand(b);
        return true;
      }
      if (k === "cross") return true;
    }
    if (b.state === ST.PLAYER_TECH) {
      const techs = B.playerTechs();
      // The translated list reads the pad itself (the same single-press edge
      // the command list uses), so the walker's own cursor never moves under it.
      if (!B.techNative.failed()) { B.techNative.press(k); return true; }
      // An empty list (a form with no learned technique halfwords) is a real state the
      // disc opens and leaves the player to cancel: `FIGHTSTG_F0x800967A0` builds the
      // widget at `:20577`-`:20591` and arms it with nothing to pick, and only Cross
      // leaves. Guard the walker's own cursor so a modulo-by-zero or an undefined
      // technique cannot fire here.
      if (!techs.length) {
        if (k === "cross") { B.sfx?.play("system01"); b.state = ST.PLAYER_MENU; }
        return true;
      }
      if (k === "up")   { B.sfx?.play("system06"); b.techSel = (b.techSel - 1 + techs.length) % techs.length; return true; }
      if (k === "down") { B.sfx?.play("system06"); b.techSel = (b.techSel + 1) % techs.length; return true; }
      if (k === "circle") {
        const skill = techs[b.techSel];
        b.pendingAction = { type: "tech", skill };
        b.playerFirst = true;
        b.state = ST.PLAYER_ACT;
        b.timer = 0;
        // The original's own words for a technique: the name on line one and the
        // technique alone on line two, out of the technique-name bank (kind 3,
        // `li $a2, 0x9` = esmfight 0x09 "{1}!" with the name in slot 1).
        B.sayOriginal(b, B.techniqueSpec(b, skill), `${b.player.profile.name} uses ${skill.name}!`);
        return true;
      }
      if (k === "cross") { B.sfx?.play("system01"); b.state = ST.PLAYER_MENU; return true; }
    }

    if (b.state === ST.PLAYER_ITEM) {
      const items = B.usableItems();
      // The translated list reads the pad itself (the same single-press edge
      // the command and TECH lists use), so the walker's own cursor never moves
      // under it.
      if (!B.itemNative.failed()) { B.itemNative.press(k); return true; }
      if (k === "up")   { B.sfx?.play("system06"); b.itemSel = (b.itemSel - 1 + items.length) % items.length; return true; }
      if (k === "down") { B.sfx?.play("system06"); b.itemSel = (b.itemSel + 1) % items.length; return true; }
      if (k === "circle") {
        const item = items[b.itemSel];
        b.pendingAction = { type: "item", item };
        b.playerFirst = true;  // items always resolve before enemy (player choosing to heal)
        b.state = ST.PLAYER_ACT;
        b.timer = 0;
        // The item action's own first page is the announcement the disc shows (kind 14,
        // `FIGHTSTG_F0x8008dac0` outer step 0, `fightstg.s:11161`): the acting Digimon's
        // name on line one and the item's own name out of bank 0x6a on line two, so the
        // player presses Circle before the effect runs. The old typed sentence stays
        // only as what `peek()` read.
        B.sayOriginal(b, B.itemAnnouncementSpec(b, item), `Used ${item.name}!`);
        return true;
      }
      if (k === "cross") { b.state = ST.PLAYER_MENU; return true; }
    }

    if (b.state === ST.PLAYER_TAG) {
      // The shipped pro/fightstg list owns the whole TAG phase, exactly as it
      // does the command phase: the key is swallowed here and forwarded as a pad
      // pulse, so the walker's own wrapping cursor never moves underneath it.
      if (!B.tagNative.failed()) {
        B.tagNative.press(k);
        return true;
      }
      const members = B.tagMembers();
      if (k === "up")   { B.sfx?.play("system06"); b.tagSel = (b.tagSel - 1 + members.length) % members.length; return true; }
      if (k === "down") { B.sfx?.play("system06"); b.tagSel = (b.tagSel + 1) % members.length; return true; }
      if (k === "circle") {
        B.sfx?.play("system07");
        const member = members[b.tagSel];
        if (!member) return true;
        // Same route as the translated list: a confirmed position seats the
        // follow-up pane directly, with no hand-drawn form screen between them.
        B.confirmTag(b, member.rosterIndex);
        return true;
      }
      if (k === "cross") {
        if (b._forcedTag) return true;
        B.sfx?.play("system01"); b.state = ST.PLAYER_MENU; return true;
      }
    }

    // The Digivolve list reads the pad itself (the same single-press edge the TECH
    // list uses), so the walker's own cursor never moves under it. The post-Tag
    // form list is a different original screen and keeps the walker's drawing.
    if (b.state === ST.PLAYER_DV && !B.formNative.failed()) {
      B.formNative.press(k);
      return true;
    }

    if (b.state === ST.PLAYER_DV) {
      const rosterIndex = b.activePlayerIndex;
      const forms = B.formOptionsFor(rosterIndex);
      if (k === "up")   { B.sfx?.play("system06"); b.formSel = (b.formSel - 1 + forms.length) % forms.length; return true; }
      if (k === "down") { B.sfx?.play("system06"); b.formSel = (b.formSel + 1) % forms.length; return true; }
      if (k === "circle") {
        const form = forms[b.formSel];
        if (!form) return true;
        if (form.id === b.player.profile.id) {
          b.menuNotice = "Already in that form.";
          b.state = ST.PLAYER_MENU;
          return true;
        }
        B.sfx?.play("system07");
        b.pendingAction = { type: "dv", formId: form.id };
        b.playerFirst = true;
        b.state = ST.PLAYER_ACT;
        b.timer = 0;
        b.message = "";
        return true;
      }
      if (k === "cross") {
        // The original's cancel on the Digivolve form list closes it and the
        // command list comes back.
        B.sfx?.play("system01");
        b.state = ST.PLAYER_MENU;
        return true;
      }
    }

    if (b.state === ST.PLAYER_DNA_CHOICE && !B.dnaNative.failed()) {
      // The translated pane reads the pad itself (the same single-press edge the
      // command, TECH, ITEM and TAG lists use), so the walker's own row toggle
      // never moves under it.
      B.dnaNative.press(k);
      return true;
    }

    if (b.state === ST.PLAYER_DNA_CHOICE) {
      const choice = b._dnaChoice;
      // No choice seated means no pane can run (the partner had no form record).
      // The walker's hand-drawn form screen is gone, so the closest thing to the
      // disc's restart is the partner picker that opened the pane; from there
      // Cross returns to the command list.
      if (!choice) { b.state = ST.PLAYER_TAG; return true; }
      if (k === "up" || k === "down") {
        // One row when there is no DNA pairing: the original's row count is 1
        // (fightstg.s:22168), so there is nothing to move to.
        if (choice.switchOnly) { B.sfx?.play("system06"); return true; }
        B.sfx?.play("system06"); b.dnaSel = b.dnaSel ? 0 : 1; return true;
      }
      if (k === "circle") {
        // The native plays the confirm feedback BEFORE running any eligibility
        // test (0x80098530, ahead of the first branch at 0x800985e0), then every
        // failing test converges on 0x80098790, which only redraws the pane.
        // So an ineligible DNA DV confirm beeps normally and then does nothing:
        // no error line, no second sound, cursor left on DNA DV [DNA-C005/C006].
        B.sfx?.play("system07");
        if (b.dnaSel === 1 && dnaRejection(B.dnaParticipantsFor(b, choice.rosterIndex), choice.cost)) {
          return true;
        }
        b.pendingAction = b.dnaSel === 0
          ? { type: "tag", rosterIndex: choice.rosterIndex, formId: choice.formId }
          : { type: "dna", rosterIndex: choice.rosterIndex, formId: choice.formId };
        b._dnaChoice = null;
        b.playerFirst = true;
        b.state = ST.PLAYER_ACT;
        b.timer = 0;
        b.message = b.pendingAction.type === "dna" ? "DNA DV!" : "Switch!";
        return true;
      }
      if (k === "cross") {
        B.sfx?.play("system01");
        return B.applyDnaAnswer(b, -2, dnaTagBranchKind(!!b._forcedTag));
      }
    }

    return false;
  }
  return { handleKey };
}
