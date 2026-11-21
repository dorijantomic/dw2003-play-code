import { packReady, drawClip } from "../../screenpack.js";
import {
  partyPipCels,
  battleHudPlateLabelsFor,
  hpPlateShown,
  hpBarFillRect,
  HUD_CLOCK_HZ,
  dvGaugeLength,
} from "../hud.js";
import {
  battleHudPartyPips,
  battleHudPlayerRecords,
  battleHudEnemyRecords,
  battleHudDvFrame,
  battleHudDvPaint,
} from "../../battlehud-translated.js";
import { battleKindOf } from "../form-blast.js";
import { nearestTell, tellText } from "../../enemy-tells.js";
import * as uiC from "../../ui-c/index.js";
import { partHook as uiCPart } from "../../ui-c/capture.js";
import { normalizeDvGauge, DV_GAUGE_MAX, currentMenuItems } from "../layout.js";
import { S } from "../state.js";
import { ST } from "../messages.js";
import { techniqueMpCost, faceBezelCelDraw } from "../../vendor/engine.js";
import { drawIconGlyph } from "../../uifont.js";
import { drawItemIcon } from "../../itemicons.js";
import { BATTLE_UI_LAYOUT, pgfgc00, TECH_PAGE_HINT, ITEM_PAGE_HINT, FORM_PAGE_HINT } from "../../battle.js";
import type { BattleContext } from "../../types/battle.js";

import type { BattleState } from "../../types/battle.js";
// moved by tools/rewrite/split-closure.mjs
export function makeHud(B: BattleContext) {
function drawBattleHud(b: BattleState) {
    B.hudCels = [];
    const L = BATTLE_UI_LAYOUT;
    const enemy = L.enemyPlate;
    const player = L.playerPlate;
    const plates = packReady(pgfgc00);
    const originalChrome = B.chromeReady();
    if (plates) {
      B.hudClip(0, enemy.x, enemy.y);
      B.hudClip(1, player.x, player.y);
    } else if (originalChrome) {
      for (const plate of [enemy, player]) {
        B.drawChrome("angledFrame", plate.x, plate.y, plate.w, 17);
        B.drawChrome("hpFrame", plate.x, plate.barY - 2, plate.w, 16);
      }
    } else {
      B.drawNativePanel(enemy.x, enemy.y, enemy.w, enemy.h, "rgba(2,9,45,0.90)");
      B.drawNativePanel(player.x, player.y, player.w, player.h, "rgba(2,9,45,0.90)");
    }
    // Party icons (FIGHTSTG_F0x800934f0): the pip picture IS the member's state
    // (full / damaged / KO / afflicted), not a fixed marker. The pgfgc00 pack
    // carries the four states as cels 0xC-0xF (active slot) and 0x3C-0x3F.
    const pips = partyPipCels(b);
    // The translated marker loop draws the members the original would draw, at the
    // original's own x table and y, and picks the cel from the member's own state.
    const hudTeam = B.enemyTeamActive(b) ? B.enemyTeamRecords(b) : null;
    const translatedPips = battleHudPartyPips(
      battleHudPlayerRecords(b), battleHudEnemyRecords(b, hudTeam),
      { activePlayerIndex: b.activePlayerIndex ?? 0, activeEnemyIndex: hudTeam ? (b.partyIndex ?? 0) : 0,
        mode: battleKindOf(b) });
    const pipReady = packReady(pgfgc00);
    const drawPip = (cel: number | null | undefined, x: number, y: number) => {
      if (pipReady && cel != null) { B.hudClip(cel, x, y); return; }
      if (originalChrome) { B.drawChrome("square", x, y, 12, 9); return; }
      B.ctx.fillStyle = "#061139";
      B.ctx.fillRect(x, y, 12, 9);
      B.ctx.strokeStyle = "#9dfcff";
      B.ctx.strokeRect(x + 0.5, y + 0.5, 11, 8);
    };
    if (translatedPips) {
      for (const pip of translatedPips) drawPip(pip.cel, pip.x, pip.y);
    } else if (originalChrome || pipReady) {
      drawPip(pips.enemy, L.enemyPips.x, L.enemyPips.y);
      for (let i = 0; i < L.playerPips.count; i++)
        drawPip(pips.player[i], L.playerPips.x + i * L.playerPips.step, L.playerPips.y);
    }
    if (!pipReady && !translatedPips) {
      B.ctx.fillStyle = "#15e0d5";
      B.ctx.fillRect(L.enemyPips.x + 3, L.enemyPips.y + 3, 6, 3);
      for (let i = 0; i < L.playerPips.count; i++) {
        B.ctx.fillStyle = i === (b.activePlayerIndex ?? 0) ? "#15e0d5" : "#f1f4f2";
        B.ctx.fillRect(L.playerPips.x + i * L.playerPips.step + 3, L.playerPips.y + 3, 6, 3);
      }
    }
    // The gauge's own frames are the chrome pack's cels 0x1e and 0x0b, which the
    // translated gauge block draws itself (see the DV block below).

    // FIGHTSTG_F0x80093364 (through the ported plate build) draws the enemy's name at
    // (17, 21) and the player's at (174, 21) as kind 1 elements, and the build arm's
    // third element is the slash between the two HP numbers. The player's name is the
    // active roster member's own stored name, so it follows a rename and survives the
    // digivolved form the 3D actor is showing.
    const plateLabels = battleHudPlateLabelsFor(b);
    if (plateLabels) {
      B.nativeText(plateLabels.enemy.text, plateLabels.enemy.x, plateLabels.enemy.y,
        { kind: plateLabels.enemy.kind });
      B.nativeText(plateLabels.player.text, plateLabels.player.x, plateLabels.player.y,
        { kind: plateLabels.player.kind });
    } else {
      B.nativeText(b.enemy.eStats?.digimon_id ?? b.enemy.profile?.name ?? "Enemy",
        enemy.nameX, enemy.nameY, { kind: 1 });
      // The native HUD keeps the roster partner's name while its live battle
      // profile/model is temporarily digivolved.  State-8 Jogress shows
      // "Renamon" here while the presentation actor is Stingmon.
      B.nativeText(b.playerRoster?.[b.activePlayerIndex]?.name ?? b.player.profile?.name ?? "Partner",
        player.nameX, player.nameY, { kind: 1 });
    }
    // F2 -> Battle -> "Enemy tells" (new, off by default; web/enemy-tells.js): one line
    // under the enemy plate counting down to its nearest every-Nth row (comparator 18),
    // read from the same ai_moves rows and the live +0x04 counter the AI selection uses.
    if (window.__fx?.enemytells) {
      const tell = nearestTell(b.enemy.eStats?.ai_moves, b.enemy.turnCounter ?? 0);
      if (tell) B.nativeText(tellText(tell), enemy.nameX, enemy.y + enemy.h + 2, { kind: 1 });
    }
    {
      // F0x800935cc / F0x80093628: two number elements at (0x10b, 0x1a) and
      // (0x12e, 0x1a), the eased HP the bar is showing and the roster maximum.
      // The elements are right-anchored on their own x: the shown HP ends at 0x10b
      // and the maximum at 0x12e, the bar's right edge.
      //
      // No `color`: these three are the original's kind-3 number elements and
      // the original never sets a colour on one (web/uifont.js has the decode).
      // Their amber is CLUT row 0 of the number face, baked into uifont.png.
      B.nativeText(String(B.pDispShown(b)), L.hpNumbers.shownX, L.hpNumbers.shownY,
        { kind: 3, alignRight: true });
      // The plate's third element, built once by the same build arm at (0x10c, 0x1a):
      // bank 0x7f line 0x10, the single glyph "/". It sits one pixel right of the
      // shown HP's anchor, so the number row reads current, slash, maximum.
      if (plateLabels?.separator.text) {
        B.nativeText(plateLabels.separator.text, plateLabels.separator.x, plateLabels.separator.y,
          { kind: plateLabels.separator.kind });
      }
      B.nativeText(String(b.player.maxHp), L.hpNumbers.maxX, L.hpNumbers.maxY,
        { kind: 3, alignRight: true });
    }
    const eDisp = b._hpPlate ? hpPlateShown(b._hpPlate, 1) : b.enemy.hp;
    const pDisp = B.pDispShown(b);
    // Look C (web/ui-c/battlehud.js): the numbers the player's rings show, as ONE read-only part (nothing outside a capture). The HP is the
    // value the game's own plate is easing (the bar and the number read the same word); MP, the DV gauge and the other partners are read raw.
    if (uiC.capturing()) {
      const act = b.activePlayerIndex ?? 0;
      const roster = b.playerRoster ?? [];
      const nameOf = (i: string | number) => roster[i]?.name ?? b.playerRecords?.[i]?.profile?.name ?? "";
      const others = [];
      (b.playerRecords ?? []).slice(0, 3).forEach((rec, i: string | number) => {
        if (i !== act && rec) others.push({ name: nameOf(i), hp: rec.hp, maxHp: rec.maxHp, mp: rec.mp, maxMp: rec.maxMp });
      });
      uiCPart(B.ctx, { part: "battleData", x: 0, y: 0, w: 0, h: 0,
        name: plateLabels?.player?.text || nameOf(act) || (b.player.profile?.name ?? ""), level: b.player.level ?? 1,
        hp: pDisp, maxHp: b.player.maxHp, mp: b.player.mp, maxMp: b.player.maxMp,
        gauge: normalizeDvGauge(b.player.gauge), maxGauge: DV_GAUGE_MAX, others,
        // read-only looks for the arc lists, the enemy callout and the who-acts marker (nothing here feeds back into the game)
        hpReal: b.player.hp, eHpReal: b.enemy.hp, hitNote: S.hitNote, pFirst: b.playerFirst !== false, eScr: B.renderer3d?.getEnemyScreen?.() ?? null, face: B.renderer3d?.getFaceBoxShown ? !!B.renderer3d.getFaceBoxShown() : true,
        st: b.state, enemy: { name: plateLabels?.enemy?.text || b.enemy.displayName || b.enemy.profile?.name || "", level: b.enemy.level ?? 1, hp: eDisp, maxHp: b.enemy.maxHp },
        ...(b.state === ST.PLAYER_TECH ? (() => {
          const ts = B.playerTechs(), top = visibleList(ts, b.techSel).top, mpDown = b.player.mpCostDown ?? 0;
          return { techTop: top, techs: ts.map((sk) => ({ name: sk.name, element: sk.element ?? "", cost: techniqueMpCost(sk.mp_cost ?? 20, sk.techWord ?? 0, { mpCostDown: mpDown }) })), free: !!b.blast?.active };
        })() : {}),
        ...(b.state === ST.PLAYER_ITEM ? (() => { const its = B.usableItems(); return { itemTop: visibleList(its, b.itemSel).top, items: its.map((it) => ({ name: it.name, qty: it.qty ?? 0 })) }; })() : {}) });
    }
    if (plates) {
      const eBar = hpBarFillRect("enemy", eDisp, b.enemy.maxHp);
      const pBar = hpBarFillRect("player", pDisp, b.player.maxHp);
      B.paintHpBar(eBar.x, eBar.y, eBar.w, eBar.h, eDisp, b.enemy.maxHp, 1);
      B.paintHpBar(pBar.x, pBar.y, pBar.w, pBar.h, pDisp, b.player.maxHp, 0);
    } else if (originalChrome) {
      // Colour and length read the *displayed* HP (HUD +0x60), so a hit that
      // crosses the quarter slumps the fighter immediately while the bar is
      // still sliding through green.
      for (const [plate, cur, max] of [[enemy, eDisp, b.enemy.maxHp], [player, pDisp, b.player.maxHp]]) {
        B.ctx.fillStyle = "#05060a";
        B.ctx.fillRect(plate.barX + 3, plate.barY + 3, plate.barW - 6, plate.barH - 6);
        B.fillHpBar(plate.barX + 3, plate.barY + 3, plate.barW - 6, plate.barH - 6, cur, max);
      }
    } else {
      B.drawNativeBar(enemy.barX, enemy.barY, enemy.barW, enemy.barH, eDisp, b.enemy.maxHp);
      B.drawNativeBar(player.barX, player.barY, player.barW, player.barH, pDisp, b.player.maxHp);
      B.drawPips(L.enemyPips, 0);
      B.drawPips(L.playerPips, b.activePlayerIndex ?? 0);
    }

    // The DV/Blast gauge. The translated block (FIGHTSTG_F0x800934f0
    // .L0x80093820-.L0x8009392c) draws it as the original does: the outer frame cel
    // 0x1e at (260,61), a black trough over the unfilled remainder from
    // 265+gauge/25 to 305 while the gauge is below 1000, the fill cel 0x33+phase (or
    // 0x37+phase at full) at (265,62), then the inner frame cel 0x0b over the fill.
    // The phase is (tick >> 2) & 3, so it steps once every four frames.
    const dv = L.dv;
    {
      const frame = battleHudDvFrame({
        gauge: b.player.gauge, tick: Math.trunc((b._hudClock || 0) * HUD_CLOCK_HZ),
        slot: b.activePlayerIndex ?? 0,
      });
      if (battleHudDvPaint(B.ctx, frame, { pgfgc00 })) {
        // The chrome pack drew all four pieces.
      } else {
        B.ctx.fillStyle = "#05060a";
        B.ctx.fillRect(frame.trough.x, frame.trough.y, frame.trough.w, frame.trough.h);
        const level = dvGaugeLength(b.player.gauge);
        const dvFills = level >= 10
          ? ["#ffd56a", "#ffe08a", "#ffc83c", "#ffb52c"]
          : ["#ffb52c", "#ffa018", "#ffb52c", "#e09a20"];
        B.ctx.fillStyle = dvFills[frame.phase];
        B.ctx.fillRect(dv.x + 3, dv.y + 3, Math.round((dv.w - 6) * level / 10), Math.max(1, dv.h - 6));
      }
    }

    const pr = L.portrait;
    const pv = L.portraitView;
    // Clip-12 / Blast omit the 3D face and the PGFGTC00 bezel (cel 0xA).
    if (b.state === ST.DNA_PRESENT || b.blastShow) {
      return;
    }
    // Cel 0xA is a filled 104×64 plate; clip the inner 100×60 so the 3D face shows.
    B.ctx.save();
    B.ctx.beginPath();
    B.ctx.rect(pr.x, pr.y, pr.w, pr.h);
    B.ctx.rect(pv.x, pv.y, pv.w, pv.h);
    B.ctx.clip("evenodd");
    // The draw the original builds in FIGHTSTG_F0x80093fec: layer 0x1005, origin 0x200,
    // pack PGFGTC00, cel 0xA at (246, 74). `faceBezelCelDraw()` is the port of that
    // draw request — the cel and its place come from it, not from a literal here.
    const bezelDraw = faceBezelCelDraw();
    const bezel = packReady(pgfgc00)
      ? B.hudClip(bezelDraw.cel, bezelDraw.x, bezelDraw.y)
      : B.drawChrome("portraitFrame", pr.x, pr.y);
    B.ctx.restore();
    if (!bezel) {
      B.ctx.strokeStyle = "#20283d";
      B.ctx.lineWidth = 4;
      B.ctx.strokeRect(pr.x, pr.y, pr.w, pr.h);
      B.ctx.strokeStyle = "#aeb7c9";
      B.ctx.lineWidth = 1;
      B.ctx.strokeRect(pr.x + 1.5, pr.y + 1.5, pr.w - 3, pr.h - 3);
    }
  }
/** The "No techs!" / "Cannot digivolve." notice over whichever list is up. */
  function drawMenuNotice(b: BattleState) {
    if (!b.menuNotice) return;
    if (!uiCPart(B.ctx, { part: "notice", x: 118, y: 194, w: 186, h: 25 })) B.drawNativePanel(118, 194, 186, 25, "rgba(0,4,45,0.94)");
    B.nativeText(b.menuNotice, 125, 201, { kind: 1 });
  }
function drawCommandMenu(b: BattleState) {
    const C = BATTLE_UI_LAYOUT.commands;
    const items = currentMenuItems(b);
    for (let i = 0; i < items.length; i++) {
      const y = C.y + i * C.rowH;
      const selected = i === b.menuSel;
      if (packReady(pgfgc00)) {
        // Selected row's +0x80 vsync counter >> 2 cycles CLUT 0..4 (F0x8009add4).
        const k = selected ? ((Math.trunc((b._hudClock || 0) * 50) >> 2) % 5) : 0;
        const rowId = k === 0 ? "34" : `34#${k}`;
        drawClip(B.ctx, pgfgc00, rowId, C.iconX, y);
        if (selected) uiCPart(B.ctx, { part: "focus", x: C.iconX + 1, y: y + 1, w: 12, h: 12 });   // look C: the focused row
        B.nativeText(items[i], C.boxX, y, { kind: 1 });
      } else if (B.chromeReady()) {
        B.drawChrome("commandIcon", C.iconX, y);
        B.drawChrome("commandPlate", C.plateX, y + C.plateYOff);
        B.nativeText(items[i], C.boxX, y, { kind: 1 });
        if (selected) {
          B.ctx.strokeStyle = "#eaffff";
          B.ctx.lineWidth = 1;
          B.ctx.beginPath();
          B.ctx.arc(C.iconX + C.iconSize / 2, y + C.iconSize / 2, 3, 0, Math.PI * 2);
          B.ctx.stroke();
        }
      } else {
        B.ctx.fillStyle = "rgba(0,5,48,0.94)";
        B.ctx.fillRect(C.iconX, y + 1, C.iconSize, C.iconSize);
        B.ctx.strokeStyle = selected ? "#a8ffff" : "#00a8ff";
        B.ctx.lineWidth = 1;
        B.ctx.strokeRect(C.iconX + 0.5, y + 1.5, C.iconSize - 1, C.iconSize - 1);
        if (selected) {
          B.ctx.strokeStyle = "#ecffff";
          B.ctx.beginPath();
          B.ctx.arc(C.iconX + C.iconSize / 2, y + 1 + C.iconSize / 2, 3, 0, Math.PI * 2);
          B.ctx.stroke();
        }
        B.drawNativePanel(C.boxX, y, C.boxW, C.boxH, "rgba(0,8,69,0.94)");
        B.nativeText(items[i], C.boxX, y, { kind: 1 });
      }
    }
    drawMenuNotice(b);
  }
function drawListSelector(x: number, y: number, selected: boolean) {
    if (!B.drawChrome("square", x, y, 13, 13)) {
      B.ctx.fillStyle = "#050638";
      B.ctx.fillRect(x, y, 13, 13);
      B.ctx.strokeStyle = "#00c0f8";
      B.ctx.strokeRect(x + 0.5, y + 0.5, 12, 12);
    }
    if (selected) {
      B.ctx.strokeStyle = "#efffff";
      B.ctx.lineWidth = 1;
      B.ctx.beginPath();
      B.ctx.arc(x + 6.5, y + 6.5, 3, 0, Math.PI * 2);
      B.ctx.stroke();
    }
  }
// The one list chrome every in-battle list draws: the window plus its two
  // page hints. The hints' kind and colour row are the shared decoded pair (see
  // listPageHint); only their anchor comes from the caller, because the
  // original's F0x8001ae38 takes x and y per screen.
  function drawListChrome(hint = BATTLE_UI_LAYOUT.list.pageHint) {
    const L = BATTLE_UI_LAYOUT.list;
    B.drawFightPane(L.x, L.y, L.w, L.h, true);
    B.nativeText("L1", hint.l1.x, hint.l1.y, { kind: hint.kind, clut: hint.clut });
    B.nativeText("R1", hint.r1.x, hint.r1.y, { kind: hint.kind, clut: hint.clut });
  }
function drawDescription(text: string, mp: number = null) {
    const D = BATTLE_UI_LAYOUT.description;
    B.drawFightPane(D.x, D.y, D.w, D.h);
    B.nativeText(text ?? "", D.x + 5, D.y + 7, { kind: 1 });
    if (mp != null) {
      B.nativeText("MP", 256, 211, { kind: 3 });
      B.nativeText(String(mp), 300, 211, { kind: 3, alignRight: true });
    }
  }
function visibleList(rows, selected: number) {
    const visible = 6;
    const top = Math.max(0, Math.min(selected - visible + 1, rows.length - visible));
    return { visible, top };
  }
function drawTechMenu(b: BattleState) {
    const L = BATTLE_UI_LAYOUT.list;
    const techs = B.playerTechs();
    const { visible, top } = visibleList(techs, b.techSel);
    drawListChrome(TECH_PAGE_HINT);
    for (let i = 0; i < visible; i++) {
      const index = top + i;
      const y = L.rowY + i * L.rowH;
      const skill = techs[index];
      drawListSelector(L.iconX, y, index === b.techSel);
      if (!skill) continue;
      if (!uiC.capturing()) drawIconGlyph(B.ctx, skill.element ?? "thunder", L.glyphX, y, 1);
      B.nativeText(skill.name, L.labelX, y, { kind: 1 });
    }
    const selected = techs[b.techSel];
    const M = BATTLE_UI_LAYOUT.listMp;
    B.drawChrome("angledFrame", M.x, M.y, M.w, M.h);
    B.nativeText(`MP${b.player.mp}/${b.player.maxMp}`, M.x + M.w - 5, M.y + 4, {
      kind: 3, alignRight: true,
    });
    drawDescription(
      selected?.desc,
      selected
        ? techniqueMpCost(selected.mp_cost ?? 20, selected.techWord ?? 0, {
            mpCostDown: b.player.mpCostDown ?? 0,
          })
        : 0,
    );
  }
function drawItemMenu(b: { itemSel: number; }) {
    const L = BATTLE_UI_LAYOUT.list;
    const items = B.usableItems();
    const { visible, top } = visibleList(items, b.itemSel);
    drawListChrome(ITEM_PAGE_HINT);
    for (let i = 0; i < visible; i++) {
      const index = top + i;
      const y = L.rowY + i * L.rowH;
      const item = items[index];
      drawListSelector(L.iconX, y, index === b.itemSel);
      if (!item) continue;
      if (!uiC.capturing()) drawItemIcon(B.ctx, item.id, L.glyphX, y, 1);
      B.nativeText(item.name, L.labelX, y, { kind: 1 });
    }
    const selected = items[b.itemSel];
    const Q = BATTLE_UI_LAYOUT.itemQty;
    B.drawFightPane(Q.x, Q.y, Q.w, Q.h, true);
    B.nativeText(`X ${selected?.qty ?? 0}`, Q.x + 5, Q.y + 5, { kind: 1 });
    drawDescription(selected?.desc ?? selected?.description ?? "");
  }
function drawTagMenu(b: { tagSel: number; }) {
    const T = BATTLE_UI_LAYOUT.tag;
    const members = B.tagMembers();
    for (let i = 0; i < members.length; i++) {
      const member = members[i];
      const y = T.y + i * T.rowH;
      drawListSelector(16, y + 2, i === b.tagSel);
      B.drawChrome("angledFrame", T.nameX, y, T.nameW, 16);
      B.nativeText(member.name, T.nameX + 3, y + 2, { kind: 1 });
      B.drawFightPane(T.statsX, y - 1, T.statsW, 29);
      B.nativeText(`HP${member.stats.hp}/${member.stats.maxHp}`, T.statsX + T.statsW - 4, y + 1, {
        kind: 3, alignRight: true,
      });
      B.nativeText(`MP${member.stats.mp}/${member.stats.maxMp}`, T.statsX + T.statsW - 4, y + 15, {
        kind: 3, alignRight: true,
      });
    }
  }
function drawFormMenu(b: BattleState, rosterIndex: number, title: string) {
    const forms = B.formOptionsFor(rosterIndex);
    const member = b.playerRoster[rosterIndex];
    const L = BATTLE_UI_LAYOUT.list;
    drawListChrome(FORM_PAGE_HINT);
    const { visible, top } = visibleList(forms, b.formSel);
    for (let i = 0; i < visible; i++) {
      const index = top + i;
      const y = L.rowY + i * L.rowH;
      const form = forms[index];
      drawListSelector(L.iconX, y, index === b.formSel);
      if (form) B.nativeText(form.name, L.labelX, y, { kind: 1 });
    }
    const selected = forms[b.formSel];
    if (!selected || !member) return;
    const projected = B.buildPlayerRecord(member, selected.id);
    B.drawFightPane(164, 73, 142, 100, true);
    B.nativeText(title, 170, 79, { kind: 1 });
    B.nativeText(`Lv ${projected.level}`, 298, 79, { kind: 3, alignRight: true });
    B.nativeText(`HP ${projected.hp}/${projected.maxHp}`, 170, 96, { kind: 3 });
    B.nativeText(`MP ${projected.mp}/${projected.maxMp}`, 170, 110, { kind: 3 });
    B.nativeText(`STR ${projected.str}`, 170, 126, { kind: 3 });
    B.nativeText(`DEF ${projected.def}`, 238, 126, { kind: 3 });
    B.nativeText(`SPT ${projected.spt}`, 170, 140, { kind: 3 });
    B.nativeText(`WIS ${projected.wis}`, 238, 140, { kind: 3 });
    B.nativeText(`SPD ${projected.spd}`, 170, 154, { kind: 3 });
  }
function drawDnaChoice(b: BattleState) {
    const choice = b._dnaChoice;
    if (!choice) return;
    // Savestate-8 native geometry: selected partner form above two authentic
    // fight-atlas command frames; DNA DV carries the result-tech MP pane.
    B.drawChrome("angledFrame", 164, 158, 142, 16);
    B.nativeText(B.digimonDB[choice.formId]?.name ?? "", 169, 160, { kind: 1 });
    drawListSelector(164, 182, b.dnaSel === 0);
    B.drawChrome("angledFrame", 182, 180, 92, 16);
    B.nativeText("Switch", 188, 182, { kind: 1 });
    // No DNA pairing: the original's list is one row long, so the "DNA DV"
    // row and its MP plate are not built at all (fightstg.s:22168-:22177).
    if (choice.switchOnly) { drawMenuNotice(b); return; }
    drawListSelector(164, 204, b.dnaSel === 1);
    B.drawChrome("angledFrame", 182, 202, 92, 16);
    B.nativeText("DNA DV", 188, 204, { kind: 1 });
    B.drawChrome("angledFrame", 266, 202, 42, 16);
    B.nativeText(`MP ${choice.cost}`, 304, 204, { kind: 3, alignRight: true });
  }
  return { drawBattleHud, drawMenuNotice, drawCommandMenu, drawListSelector, drawListChrome, drawDescription, visibleList, drawTechMenu, drawItemMenu, drawTagMenu, drawFormMenu, drawDnaChoice };
}
