import * as uiC from "../../ui-c/index.js";
import { ST } from "../messages.js";
import { takeBackdropBlends, layerFrameOk, showBattleLayer, noteBackdropBlend } from "../../battle-layer.js";
import { effectsBlendBackdrop, drawEffects } from "../../fight/effect-player.js";
import { drawBlastCurtain, drawBlastFlash } from "../../blast-presentation.js";
import { battleMsgPaint } from "../../battlemsg-translated.js";
import { packReady } from "../../screenpack.js";
import { composeBattle } from "../../ui-c/battlehud.js";
import { openingPhaseFor, OPENING_PHASE_COUNT, scriptedScreenId } from "../../vendor/engine.js";
import { currentMenuItems } from "../layout.js";
import { commandPhaseWaitsForLine } from "../hud.js";
import { BATTLE_UI_LAYOUT, pgfgc00, cmfont } from "../../battle.js";
import type { BattleContext } from "../../types/battle.js";

// moved by tools/rewrite/split-closure.mjs
export function makeDraw(B: BattleContext) {
function draw() {
    if (!B.battle) return;
    const b  = B.battle;
    // The native results screen owns the whole framebuffer while it is up; the
    // battle must not paint over it (web/game.js draws the report afterwards).
    if (b._reportNative) { uiC.hide("ui-battle"); return; }
    // The finale's ending chain owns the whole framebuffer the same way: the
    // host's movie adapter draws it over the battle's last pose frame.
    if (b._endingHosted) { uiC.hide("ui-battle"); return; }
    const cw = B.canvas!.width, ch = B.canvas!.height;  // real device px (fullscreen)
    const W  = B.BATTLE_REF_W;   // 640 — logical UI layout space (scaled to fill below)
    const H  = B.BATTLE_REF_H;   // 480

    B.ctx!.save();

    // STFGTREP replaces the battle framebuffer completely. Scale its native
    // 320x240 image uniformly so fullscreen keeps the original 4:3 framing.
    if (b.state === ST.WIN && b._victoryPhase === "report" && !b._reportNative) {
      // The 3D compositor and battle helpers may leave a device transform on
      // the shared context between frames; a takeover screen starts at the
      // framebuffer origin just like the PSX display environment switch.
      B.ctx!.setTransform(1, 0, 0, 1, 0, 0);
      B.ctx!.globalAlpha = 1;
      B.ctx!.globalCompositeOperation = "source-over";
      B.ctx!.fillStyle = "#000";
      B.ctx!.fillRect(0, 0, cw, ch);
      const scale = Math.min(cw / 320, ch / 240);
      B.ctx!.translate((cw - 320 * scale) / 2, (ch - 240 * scale) / 2);
      B.ctx!.scale(scale, scale);
      B.ctx!.imageSmoothingEnabled = false;
      B.drawFightReport(b);
      B.ctx!.restore();
      uiC.hide("ui-battle");   // look C: the report owns the screen, the HUD layer goes with the HUD
      return;
    }

    // 3D scene fills the whole canvas (identity transform, full device resolution).
    if (B.renderer3d && B.offscreen3d) {
      // The 3D picture is its own canvas under this one (web/battle-layer.js): clear here so it shows
      // through, nothing is copied. A frame whose draws mix with the pixels under them (additive and
      // subtractive PSX sprites, the defeat fade, a screen dim) is drawn the old way, 3D copied in.
      const fx = B.renderer3d.getEffectDraw?.();
      const mixes = takeBackdropBlends() > 0;
      const certain = (b.state === ST.LOSE && b._loseFade > 0) || (!!fx && effectsBlendBackdrop(fx.list, fx.manifest));
      if (layerFrameOk(mixes, certain) && showBattleLayer(true)) {
        B.ctx!.clearRect(0, 0, cw, ch);
      } else {
        showBattleLayer(false);
        B.ctx!.drawImage(B.offscreen3d, 0, 0, cw, ch);
      }
      // ORDER MATTERS during a form change: the transformation controller's
      // curtain blacks the arena out FIRST and the E000EVOL sprites play over
      // that black, so the curtain has to go UNDER the effect pass. Drawing it
      // after would hide the very art this is here to show.
      if (b.blastShow?.state) drawBlastCurtain(B.ctx, b.blastShow.state, cw, ch);
      // op3 tech visual effects (decoded eNNN sprites) composite over the 3D frame; the view
      // maps PSX screen/world coords to the offscreen's px which we scale to the canvas here.
      // The transformation's own effects (types 1000-1003/1007/1008, file
      // E000EVOL) come through this same pass.
      if (fx) {
        B.ctx!.save();
        B.ctx!.scale(cw / B.offscreen3d.width, ch / B.offscreen3d.height);
        drawEffects(B.ctx, fx.list, fx.manifest, fx.images, fx.view);
        B.ctx!.restore();
      }
      // The flash washes those sprites, so it sits on top of them — and still
      // UNDER the battle chrome, which the capture keeps visible throughout.
      if (b.blastShow?.state) drawBlastFlash(B.ctx, b.blastShow.state, cw, ch);
      const overlay = B.renderer3d.getScreenOverlay?.();
      if (overlay) {
        B.ctx!.save();
        B.ctx!.globalAlpha = overlay.alpha;
        B.ctx!.fillStyle = "#fff";
        B.ctx!.fillRect(0, 0, cw, ch);
        B.ctx!.restore();
      }
    } else {
      showBattleLayer(false);
      B.ctx!.fillStyle = "rgba(0,0,8,0.92)";
      B.ctx!.fillRect(0, 0, cw, ch);
    }

    // All player-facing battle chrome is laid out in the original 320x240
    // coordinate space, then scaled once to the fullscreen canvas.
    B.ctx!.save();
    const nativeScale = Math.min(
      cw / BATTLE_UI_LAYOUT.nativeW,
      ch / BATTLE_UI_LAYOUT.nativeH,
    );
    const nativeX = (cw - BATTLE_UI_LAYOUT.nativeW * nativeScale) / 2;
    const nativeY = (ch - BATTLE_UI_LAYOUT.nativeH * nativeScale) / 2;
    B.ctx!.translate(nativeX, nativeY);
    B.ctx!.scale(nativeScale, nativeScale);
    B.ctx!.imageSmoothingEnabled = false;
    // Look C (web/ui-c/battlehud.js): the whole 2D chrome below is one capture scope. The clips, the HUD's text and the bar / notice
    // parts become the C overlay; nothing about the battle changes (same calls, same order, same state). The 3D close-up stays under
    // the overlay and the bezel ring leaves its window open. The lose fade dims the overlay the way it darkens the canvas.
    const chrome = () => {
      // Jogress is staged behind the normal battle plates; the dense state-8
      // replay keeps both HP plates, party pips, and DV gauge visible through
      // the entire parent-orb flight and only the op7 white-out washes them out.
      B.drawBattleHud(b);

      // The Blast transformation keeps BOTH HP plates and drops every menu: the
      // capture shows the command list gone from the first frame of the effect
      // (the "... Blasted!" line is dismissed and no input is accepted for ~14 s).
      // The entrance's own page (the next one is made on f301, ENTRANCE_TASK_END_FRAME) is drawn over the camera glide.
      if (b.blastShow) {
        if (b.blastShow.entrance && B.msgSession?.active && !B.msgSession.finished) {
          battleMsgPaint(B.ctx, B.msgSession.frame(), B.nativeText, { pgfgc00, cmfont });
        }
        return;
      }

      if (b.state === ST.PLAYER_MENU) {
        // The shipped pro/fightstg overlay draws the six-row list with its own
        // chrome and sliding highlight; the walker's drawn list is the rollback
        // and the confused-gag case. The menu notice ("No techs!") rides on top.
        if (B.commandNative.active()) {
          B.commandNative.draw(B.ctx, BATTLE_UI_LAYOUT.nativeW, BATTLE_UI_LAYOUT.nativeH);
          B.drawMenuNotice(b);
        } else {
          B.drawCommandMenu(b);
        }
      } else if (b.state === ST.PLAYER_TECH) {
        if (B.techNative.active()) B.techNative.draw(B.ctx, BATTLE_UI_LAYOUT.nativeW, BATTLE_UI_LAYOUT.nativeH);
        else B.drawTechMenu(b);
      } else if (b.state === ST.PLAYER_ITEM) {
        if (B.itemNative.active()) B.itemNative.draw(B.ctx, BATTLE_UI_LAYOUT.nativeW, BATTLE_UI_LAYOUT.nativeH);
        else B.drawItemMenu(b);
      } else if (b.state === ST.PLAYER_TAG) {
        if (B.tagNative.active()) B.tagNative.draw(B.ctx, BATTLE_UI_LAYOUT.nativeW);
        else B.drawTagMenu(b);
      } else if (b.state === ST.PLAYER_DNA_CHOICE) {
        if (B.dnaNative.active()) B.dnaNative.draw(B.ctx, BATTLE_UI_LAYOUT.nativeW);
        else B.drawDnaChoice(b);
      } else if (b.state === ST.PLAYER_DV) {
        if (B.formNative.active()) B.formNative.draw(B.ctx, BATTLE_UI_LAYOUT.nativeW, BATTLE_UI_LAYOUT.nativeH);
        else B.drawFormMenu(b, b.activePlayerIndex, "Digivolve");
      } else if ((b.state !== ST.WIN || b._victoryPhase === "pose") &&
                 b.state !== ST.DNA_PRESENT &&
                 !(b.state === ST.TAG_PRESENT && b._tagPresentation?.phase !== "prompt")) {
        // The original's own window picture, lines and blinking prompt. With no message
        // up there is no object and no panel (F0x80098924 is only reached while the
        // controller is in its state 1), so nothing is painted.
        if (B.msgSession.active && !B.msgSession.finished) {
          battleMsgPaint(B.ctx, B.msgSession.frame(), B.nativeText, { pgfgc00, cmfont });
        }
      }
    };
    uiC.scope("ui-battle", B.ctx, {
      enable: packReady(pgfgc00), texts: true, top: true,
      dim: b.state === ST.LOSE && b._loseFade > 0 ? Math.min(1, b._loseFade) : 0,
      compose: (sc) => composeBattle(sc, { view: BATTLE_UI_LAYOUT.portraitView, stage: sc.stage }),
    }, chrome);
    B.ctx!.restore();
    // The Blast transformation returns before the lose fade, as it always has.
    if (b.blastShow) { B.ctx!.restore(); return; }

    if (b.state === ST.LOSE && b._loseFade > 0) drawSubtractiveFade(B.ctx!, cw, ch, b._loseFade);

    B.ctx!.restore();
  }
// True only when this frame's draw() paints or clears EVERY pixel of the shared canvas, so the field drawn under it is never
  // seen (web/game.js render() then skips the field's pure pixel work). Mirrors draw()'s own branches and has no side effects:
  //  - no battle, the native results screen and the hosted ending (draw() returns, the field shows): false
  //  - the STFGTREP report: opaque black fillRect over the whole canvas: true
  //  - 3D path: clearRect of the whole canvas (the opaque battle layer is under it) or drawImage of the opaque
  //    (alpha:false WebGL) 3D frame over the whole canvas: true
  //  - the 2D fallback (0.92 alpha fill, no 3D renderer): false
  function coversField() {
    const b = B.battle;
    if (!b) return false;
    if (b._reportNative || b._endingHosted) return false;
    if (b.state === ST.WIN && b._victoryPhase === "report") return true;
    return !!(B.renderer3d && B.offscreen3d);
  }
// PSX ABR 2 (B - F) with a grey F: each channel becomes max(0, c - level).
  // Canvas has no subtract mode, so: invert, add the level, invert again.
  function drawSubtractiveFade(ctx: CanvasRenderingContext2D, cw: number, ch: number, amount: number) {
    const level = Math.round(amount * 255);
    noteBackdropBlend();
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "difference";
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, cw, ch);
    ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = `rgb(${level},${level},${level})`;
    ctx.fillRect(0, 0, cw, ch);
    ctx.globalCompositeOperation = "difference";
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, cw, ch);
    ctx.restore();
  }
// Read-only live-battle peek for headless verification (the lab handles
  // expose state everywhere else; field battles had no reader at all).
  function peek() {
    if (!B.battle) return null;
    const b = B.battle;
    return {
      state: b.state,
      // The battle's OPENING PHASE MACHINE as the walker runs it: which of the original's
      // seven phases (engine/dw3/battle-opening-machine.ts), whether the opening line is
      // armed, and the intro variant the disc's own rule selected. A headless check reads
      // this to see the machine advance and to watch a slow load hold phase 3.
      opening: b._opening ? {
        top: b._opening.top, sub: b._opening.sub, phase: b._opening.phase,
        phaseName: openingPhaseFor(b._opening.phase)!.name, of: OPENING_PHASE_COUNT,
        linePending: b._opening.linePending, exited: b._opening.exited,
        introVariant: b._opening.introVariant, specialMode4: b._opening.specialMode4,
        openCameraArmed: b._opening.openCameraArmed,
        lineArmed: b._introLineArmed === true,
      } : null,
      message: String(b.message ?? "").slice(0, 160),
      // The translated message line, as the session currently has it: the window
      // picture's own box, where each line sits, and whether the "press Circle"
      // glyph is up. tools/verify_first_story_battle.mjs reads this to check the
      // line appears where pro/fightstg puts it.
      messageLine: B.msgSession ? {
        active: B.msgSession.active,
        finished: B.msgSession.finished,
        holdsTurn: B.msgHoldsTurn(b),
        frame: B.msgSession.frame(),
        promptVisible: B.msgSession.promptVisible,
        tick: B.msgSession.clock,
      } : null,
      menu: b.state === ST.PLAYER_MENU ? currentMenuItems(b).slice() : null,
      // Is the command phase still waiting for the line to be read? While this is true
      // the original has not armed the menu at all (`wfightmn.s:1494-1496`), so the list
      // must not be open and nothing may read the pad.
      waitsForLine: commandPhaseWaitsForLine(B.msgSession, b.state),
      // Is the shipped command list reading the pad yet? pro/wfightmn's boot loader
      // owns the input until it retires, and the list ignores presses until its first
      // tick has built it, so a check that wants the list to answer has to wait for
      // `active`. tools/verify_first_story_battle.mjs reads this.
      commandList: {
        open: B.commandNative.isOpen(),
        active: B.commandNative.active(),
        pending: B.commandNative.isPending(),
        failed: B.commandNative.failed(),
      },
      loaderOpen: B.wfightNative.isOpen(),
      // The command phase's Frozen gate (F0x800a7418 step 1): which turn it rolled on
      // and whether it lost that turn. A lost turn never opens the list.
      frozenGate: {
        seq: b._turnSeq ?? 0,
        rolledOn: b._frozenGateTurn ?? null,
        lost: b._frozenGateLost === true,
      },
      // The loss sequence as the original's own objects report it: the exit's mode
      // word (0 wait for phase 2, 1 wait for the ramp, 2 launch), the fade's level and
      // the grey its quad is drawn with, and the launch code the exit asked for.
      loss: b._lossSession ? {
        ...b._lossSession.state(),
        fade: b._loseFade ?? 0,
        launchCode: b._lossSession.launchCode(),
        messageId: b._lossSession.messageId,
      } : null,
      menuSel: b.menuSel ?? null,
      player: b.player ? { name: b.player.profile?.name, hp: b.player.hp, maxHp: b.player.maxHp } : null,
      enemy: b.enemy ? { name: b.enemy.profile?.name ?? b.enemy.name, hp: b.enemy.hp, maxHp: b.enemy.maxHp } : null,
    };
  }
async function scriptedScreen(mapId: number | string, index: number) {
    await B.loadData();
    const stage = B.stageEncDB?.stages?.[String(mapId).replace(/^s/, "")];
    return scriptedScreenId(stage, index, B.storyOrdinal(), B.entryKey());
  }
  return { draw, coversField, drawSubtractiveFade, peek, scriptedScreen };
}
