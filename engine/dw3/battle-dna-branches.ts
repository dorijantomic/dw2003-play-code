import { walkerIdOf, type ProfileTableMemory } from "./ui/native/pause-status.ts";
// DNA-Q001 decision census. Original lines and independent table:
// docs/research/battle/dna-path-branches-2026-10-04.md. Partially verified.
export type DnaPathBranchKind = "command" | "forced";
export type DnaAnswerAction = "wait" | "restart" | "switch" | "dna" | "nothing";
export function dnaAnswerAction(kind: DnaPathBranchKind, answer: number): DnaAnswerAction {
  const word = answer | 0;
  // Dispatch branch delay slots load -2 before either poll is entered.
  if (word === -2) return "restart";
  if (word === -1) return "wait";
  if ((word & 0xf) === 0) return "switch";
  return kind === "forced" ? "nothing" : "dna";
}
export function dnaTagBranchKind(forced: boolean): DnaPathBranchKind {
  return forced ? "forced" : "command";
}
export const DNA_PHASE_CODE = Object.freeze({ switch: 5, dna: 6 });
export const DNA_PATH_BRANCHES = [
  {
    "id": "door-no-phase",
    "source": "fightstg.s",
    "address": 2148085164,
    "line": 16513,
    "quote": ".L0x80092dac: beqz $a0, .L0x80092dd4",
    "condition": "no phase object",
    "player": "No command screen opens."
  },
  {
    "id": "door-not-ready",
    "source": "fightstg.s",
    "address": 2148085180,
    "line": 16517,
    "quote": ".L0x80092dbc: bne $v1, $v0, .L0x80092dd4",
    "condition": "phase main state is not 1",
    "player": "No command screen opens; this is not a side test."
  },
  {
    "id": "command-restart",
    "source": "fightstg.s",
    "address": 2148084532,
    "line": 16349,
    "quote": ".L0x80092b34: beq $v1, $v0, .L0x80092cec",
    "condition": "answer == -2 (loaded at 0x80092ab8)",
    "player": "Cancel blip; partner picker reopens; no MP or turn spent."
  },
  {
    "id": "command-wait",
    "source": "fightstg.s",
    "address": 2148084540,
    "line": 16351,
    "quote": ".L0x80092b3c: beq $v1, $v0, .L0x80092d38",
    "condition": "answer == -1",
    "player": "Pane stays open."
  },
  {
    "id": "command-switch",
    "source": "fightstg.s",
    "address": 2148084548,
    "line": 16353,
    "quote": ".L0x80092b44: beqz $v0, .L0x80092d10",
    "condition": "answer low nibble == 0",
    "player": "Switch; selected species copied; no MP debit."
  },
  {
    "id": "command-dna",
    "source": "fightstg.s",
    "address": 2148084564,
    "line": 16357,
    "quote": ".L0x80092b54: li $v0, 0x6",
    "condition": "nonzero nibble after the two sentinel tests",
    "player": "DNA action 6; selected result action is retained."
  },
  {
    "id": "forced-restart",
    "source": "fightstg.s",
    "address": 2148084948,
    "line": 16453,
    "quote": ".L0x80092cd4: beq $v1, $v0, .L0x80092cec",
    "condition": "answer == -2 (loaded at 0x80092c48)",
    "player": "Cancel blip; forced partner picker reopens."
  },
  {
    "id": "forced-wait",
    "source": "fightstg.s",
    "address": 2148084956,
    "line": 16455,
    "quote": ".L0x80092cdc: bne $v1, $v0, .L0x80092d08",
    "condition": "answer == -1",
    "player": "Pane stays open."
  },
  {
    "id": "forced-no-dna-commit",
    "source": "fightstg.s",
    "address": 2148085000,
    "line": 16466,
    "quote": ".L0x80092d08: bnez $v0, .L0x80092d38",
    "condition": "nonzero nibble after sentinels",
    "player": "No phase commit; no substitute Switch. See forced-path limit below."
  },
  {
    "id": "picker-cancel",
    "source": "fightstg.s",
    "address": 2148084452,
    "line": 16329,
    "quote": ".L0x80092ae4: beq $v1, $v0, .L0x80092afc",
    "condition": "picker answer == -2 on command route",
    "player": "Command list returns to Tag."
  },
  {
    "id": "picker-absent",
    "source": "fightstg.s",
    "address": 2148103448,
    "line": 21213,
    "quote": ".L0x80097518: beqz $v0, .L0x8009758c",
    "condition": "party record species == 0",
    "player": "Absent member is not listed."
  },
  {
    "id": "picker-active",
    "source": "fightstg.s",
    "address": 2148103464,
    "line": 21217,
    "quote": ".L0x80097528: beq $s0, $v0, .L0x8009758c",
    "condition": "candidate is current actor",
    "player": "Current actor is not listed."
  },
  {
    "id": "picker-mode-no-badge",
    "source": "fightstg.s",
    "address": 2148103500,
    "line": 21226,
    "quote": ".L0x8009754c: beqz $v0, .L0x8009757c",
    "condition": "picker mode == 0",
    "player": "DNA badge lookup is skipped."
  },
  {
    "id": "picker-blast-no-badge",
    "source": "fightstg.s",
    "address": 2148103508,
    "line": 21228,
    "quote": ".L0x80097554: bnez $s4, .L0x8009757c",
    "condition": "actor Blast byte != 0",
    "player": "DNA badge lookup is skipped."
  },
  {
    "id": "picker-no-reserve",
    "source": "fightstg.s",
    "address": 2148103588,
    "line": 21248,
    "quote": ".L0x800975a4: blez $v1, .L0x800975f8",
    "condition": "candidate count <= 0",
    "player": "No reserve pane; Circle returns; Cross is ignored."
  },
  {
    "id": "picker-no-cross-forced",
    "source": "fightstg.s",
    "address": 2148103780,
    "line": 21296,
    "quote": ".L0x80097664: beqz $v1, .L0x80097678",
    "condition": "picker mode == 0",
    "player": "Cross does nothing; no cancel sound."
  },
  {
    "id": "picker-cross",
    "source": "fightstg.s",
    "address": 2148103792,
    "line": 21299,
    "quote": ".L0x80097670: bnez $v0, .L0x8009788c",
    "condition": "Cross in mode 1",
    "player": "Cancel blip 0x800450BD; answer -2."
  },
  {
    "id": "picker-ko",
    "source": "fightstg.s",
    "address": 2148103884,
    "line": 21322,
    "quote": ".L0x800976cc: beqz $v0, .L0x80097960",
    "condition": "selected member HP == 0",
    "player": "Confirm blip 0x0004001C; picker remains; no refusal line."
  },
  {
    "id": "pane-blast",
    "source": "fightstg.s",
    "address": 2148107080,
    "line": 22139,
    "quote": ".L0x80098348: bnez $v0, .L0x800983c0",
    "condition": "actor Blast byte != 0",
    "player": "Pair offer is not recomputed; fresh pane offers Switch only."
  },
  {
    "id": "pane-unpaired",
    "source": "fightstg.s",
    "address": 2148107156,
    "line": 22158,
    "quote": ".L0x80098394: beqz $v1, .L0x800983b8",
    "condition": "source partner id == 0",
    "player": "Switch only."
  },
  {
    "id": "pane-no-result",
    "source": "fightstg.s",
    "address": 2148107212,
    "line": 22172,
    "quote": ".L0x800983cc: beqz $v1, .L0x800983d8",
    "condition": "result action id == 0",
    "player": "One row: Switch only, including a matched pair with no result."
  },
  {
    "id": "pane-wrong-partner",
    "source": "fightstg.s",
    "address": 2148107172,
    "line": 22162,
    "quote": ".L0x800983a4: bne $v1, $v0, .L0x800983b8",
    "condition": "named partner id differs from selected profile id",
    "player": "Switch only; no DNA price."
  },
  {
    "id": "pane-names-cross",
    "source": "fightstg.s",
    "address": 2148106868,
    "line": 22086,
    "quote": ".L0x80098274: bnez $v0, .L0x8009841c",
    "condition": "Cross on names",
    "player": "Cancel blip 0x800450BD; answer -2; picker reopens."
  },
  {
    "id": "pane-rows-cross",
    "source": "fightstg.s",
    "address": 2148108028,
    "line": 22376,
    "quote": ".L0x800986fc: bnez $v0, .L0x800984a0",
    "condition": "Cross on options",
    "player": "Cancel blip 0x800450BD; names return; no answer written."
  },
  {
    "id": "switch-active-status",
    "source": "fightstg.s",
    "address": 2148107612,
    "line": 22272,
    "quote": ".L0x8009855c: bnez $v0, .L0x80098790",
    "condition": "actor status & 0x10",
    "player": "Confirm blip then no change."
  },
  {
    "id": "switch-partner-status",
    "source": "fightstg.s",
    "address": 2148107632,
    "line": 22277,
    "quote": ".L0x80098570: bnez $v0, .L0x80098790",
    "condition": "partner status & 0x10",
    "player": "Confirm blip then no change."
  },
  {
    "id": "active-mp",
    "source": "fightstg.s",
    "address": 2148107748,
    "line": 22306,
    "quote": ".L0x800985e4: bnez $v1, .L0x80098790",
    "condition": "signed actor MP < price",
    "player": "Grey DNA row; confirm blip 0x0004001C then no change, no refusal message."
  },
  {
    "id": "partner-mp",
    "source": "fightstg.s",
    "address": 2148107768,
    "line": 22311,
    "quote": ".L0x800985f8: bnez $v0, .L0x80098790",
    "condition": "signed partner MP < price",
    "player": "Grey DNA row; confirm blip 0x0004001C then no change, no refusal message."
  },
  {
    "id": "active-status-20",
    "source": "fightstg.s",
    "address": 2148107788,
    "line": 22316,
    "quote": ".L0x8009860c: bnez $v0, .L0x80098790",
    "condition": "actor status & 0x20",
    "player": "Grey DNA row; confirm blip 0x0004001C then no change, no refusal message."
  },
  {
    "id": "partner-status-20",
    "source": "fightstg.s",
    "address": 2148107808,
    "line": 22321,
    "quote": ".L0x80098620: bnez $v0, .L0x80098790",
    "condition": "partner status & 0x20",
    "player": "Grey DNA row; confirm blip 0x0004001C then no change, no refusal message."
  },
  {
    "id": "active-status-08",
    "source": "fightstg.s",
    "address": 2148107816,
    "line": 22323,
    "quote": ".L0x80098628: bnez $v0, .L0x80098790",
    "condition": "actor status & 0x08",
    "player": "Grey DNA row; confirm blip 0x0004001C then no change, no refusal message."
  },
  {
    "id": "active-hp",
    "source": "fightstg.s",
    "address": 2148107832,
    "line": 22327,
    "quote": ".L0x80098638: blez $v0, .L0x80098790",
    "condition": "signed actor HP <= 0",
    "player": "Grey DNA row; confirm blip 0x0004001C then no change, no refusal message."
  },
  {
    "id": "partner-hp",
    "source": "fightstg.s",
    "address": 2148107848,
    "line": 22331,
    "quote": ".L0x80098648: blez $v0, .L0x80098790",
    "condition": "signed partner HP <= 0",
    "player": "Grey DNA row; confirm blip 0x0004001C then no change, no refusal message."
  },
  {
    "id": "turn-frozen",
    "source": "wfightmn.s",
    "address": 5996,
    "line": 1506,
    "quote": ".L0x0000176c: beqz $v0, .L0x000017f8              # .word 0x10400022",
    "condition": "actor status bit 2 set; roll decides whether commands are allowed",
    "player": "On a nonzero roll, frozen announcement and turn ends before Tag opens."
  },
  {
    "id": "turn-frozen-roll",
    "source": "wfightmn.s",
    "address": 6020,
    "line": 1512,
    "quote": ".L0x00001784: beqz $v0, .L0x000017f8              # .word 0x1040001c",
    "condition": "frozen roll returns zero",
    "player": "Zero allows command flow to continue."
  },
  {
    "id": "turn-confused",
    "source": "wfightmn.s",
    "address": 6148,
    "line": 1544,
    "quote": ".L0x00001804: beqz $v0, .L0x00001824              # .word 0x10400007",
    "condition": "actor status bit 4 set",
    "player": "Controller branches to confused-turn step 17, not the command menu."
  },
  {
    "id": "controller-range",
    "source": "wfightmn.s",
    "address": 6236,
    "line": 1566,
    "quote": ".L0x0000185c: beqz $v0, .L0x0000198c              # .word 0x1040004b",
    "condition": "phase result outside unsigned 0..6",
    "player": "Battle-end path; unreachable from valid DNA phase outputs."
  },
  {
    "id": "controller-dna-step",
    "source": "wfightmn.s",
    "address": 6476,
    "line": 1626,
    "quote": ".L0x0000194c: li $a1, 0x6                         # .word 0x24050006",
    "condition": "phase result 6",
    "player": "Controller (not phase) enters its DNA step 6."
  },
  {
    "id": "controller-dna-start",
    "source": "wfightmn.s",
    "address": 7524,
    "line": 1888,
    "quote": ".L0x00001d64: jal 0x80090c44                      # .word 0x0c024311",
    "condition": "DNA step first update",
    "player": "Starts shared technique action with phase result id; no eligibility retest."
  },
  {
    "id": "controller-dna-wait",
    "source": "wfightmn.s",
    "address": 7596,
    "line": 1906,
    "quote": ".L0x00001dac: bnez $v0, .L0x00001e0c              # .word 0x14400017",
    "condition": "action child still alive",
    "player": "Wait for action completion."
  },
  {
    "id": "controller-enemy-absent",
    "source": "wfightmn.s",
    "address": 7620,
    "line": 1912,
    "quote": ".L0x00001dc4: beqz $v0, .L0x00001ddc              # .word 0x10400005",
    "condition": "enemy record species == 0",
    "player": "Skip this enemy in post-action victory scan."
  },
  {
    "id": "controller-enemy-alive",
    "source": "wfightmn.s",
    "address": 7636,
    "line": 1916,
    "quote": ".L0x00001dd4: bnez $v0, .L0x00001d84              # .word 0x1440ffeb",
    "condition": "enemy HP != 0",
    "player": "Continue to shared step 5 after action, not victory."
  },
  {
    "id": "action-dna-clip",
    "source": "fightstg.s",
    "address": 2148071380,
    "line": 13007,
    "quote": ".L0x8008f7d4: bne $v1, $v0, .L0x8008f7f8",
    "condition": "technique clip == 12",
    "player": "DNA announcement page kind 2, term 0x3A; shared action continues."
  },
  {
    "id": "action-opponent-sleep",
    "source": "fightstg.s",
    "address": 2148071532,
    "line": 13045,
    "quote": ".L0x8008f86c: beqz $v0, .L0x8008f878",
    "condition": "opponent status & 8",
    "player": "Sets action targeting flag; not a DNA refusal."
  },
  {
    "id": "action-presentation-wait",
    "source": "fightstg.s",
    "address": 2148071612,
    "line": 13065,
    "quote": ".L0x8008f8bc: bnez $v0, .L0x80090c1c",
    "condition": "announcement child still alive",
    "player": "Wait before resolving action."
  },
  {
    "id": "action-special-mode",
    "source": "fightstg.s",
    "address": 2148071628,
    "line": 13069,
    "quote": ".L0x8008f8cc: bnez $v0, .L0x8008f92c",
    "condition": "battle mode byte 0x800A4436 != 0",
    "player": "Alternate shared technique resolver; not a pane cancellation."
  },
  {
    "id": "action-category",
    "source": "fightstg.s",
    "address": 2148071812,
    "line": 13115,
    "quote": ".L0x8008f984: beqz $v0, .L0x80090c1c",
    "condition": "technique category outside 2..6",
    "player": "Wait; shipped DNA actions use categories 2, 3 and 4 (data census)."
  },
  {
    "id": "action-hit-kind",
    "source": "fightstg.s",
    "address": 2148076232,
    "line": 14220,
    "quote": ".L0x80090ac8: bne $v1, $v0, .L0x80090c14",
    "condition": "category != 2 at damage branch",
    "player": "Skip hit task; category 2 starts shared hit task with DNA flag."
  },
  {
    "id": "grey-switch-active",
    "source": "fightstg.s",
    "address": 2148105712,
    "line": 21794,
    "quote": ".L0x80097df0: bnez $v0, .L0x80097e0c",
    "condition": "actor status & 0x10",
    "player": "Grey Switch label, no sound."
  },
  {
    "id": "grey-switch-partner",
    "source": "fightstg.s",
    "address": 2148105732,
    "line": 21799,
    "quote": ".L0x80097e04: beqz $v0, .L0x80097e20",
    "condition": "partner status bit 0x10 clear",
    "player": "Bypass grey; otherwise palette 7, no sound."
  },
  {
    "id": "grey-active-mp",
    "source": "fightstg.s",
    "address": 2148105972,
    "line": 21859,
    "quote": ".L0x80097ef4: bnez $v1, .L0x80097f10",
    "condition": "actor MP < price",
    "player": "Grey DNA label, no sound."
  },
  {
    "id": "grey-partner-mp",
    "source": "fightstg.s",
    "address": 2148105992,
    "line": 21864,
    "quote": ".L0x80097f08: beqz $v0, .L0x80097f24",
    "condition": "partner MP >= price",
    "player": "Continue status tests; otherwise grey, no sound."
  },
  {
    "id": "grey-active-status-20",
    "source": "fightstg.s",
    "address": 2148106032,
    "line": 21874,
    "quote": ".L0x80097f30: bnez $v0, .L0x80097f54",
    "condition": "actor status & 0x20",
    "player": "Grey DNA label, no sound."
  },
  {
    "id": "grey-partner-status-20",
    "source": "fightstg.s",
    "address": 2148106052,
    "line": 21879,
    "quote": ".L0x80097f44: bnez $v0, .L0x80097f54",
    "condition": "partner status & 0x20",
    "player": "Grey DNA label, no sound."
  },
  {
    "id": "grey-active-status-08",
    "source": "fightstg.s",
    "address": 2148106060,
    "line": 21881,
    "quote": ".L0x80097f4c: beqz $v0, .L0x80097f68",
    "condition": "actor status bit 8 clear",
    "player": "Continue HP tests; otherwise grey, no sound."
  },
  {
    "id": "grey-active-hp",
    "source": "fightstg.s",
    "address": 2148106096,
    "line": 21890,
    "quote": ".L0x80097f70: blez $v0, .L0x80097f88",
    "condition": "actor HP <= 0",
    "player": "Grey DNA label, no sound."
  },
  {
    "id": "grey-partner-hp",
    "source": "fightstg.s",
    "address": 2148106112,
    "line": 21894,
    "quote": ".L0x80097f80: bgtz $v0, .L0x80097f9c",
    "condition": "partner HP > 0",
    "player": "Normal DNA palette; otherwise grey, no sound."
  },
  {
    "id": "list-confirm-freeze",
    "source": "fightstg.s",
    "address": 2148118552,
    "line": 25091,
    "quote": ".L0x8009b018: bnez $v0, .L0x8009b0b4",
    "condition": "shared list model +0x54 != 0",
    "player": "Accepted choice stops list input; no extra sound."
  }
] as const;
export type DnaPathBranch = typeof DNA_PATH_BRANCHES[number];
export const DNA_PATH_BRANCH_IDS = DNA_PATH_BRANCHES.map(row => row.id);

/** Phase +0x64 is the answer's species, not the previously highlighted form. */
export function dnaAnswerForm(mem: ProfileTableMemory, answer: number): number {
  return walkerIdOf(mem, (answer | 0) >> 4);
}
