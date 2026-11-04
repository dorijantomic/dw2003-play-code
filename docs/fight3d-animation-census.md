# Fight-3D animation census: the bodies that cannot move

Counted on 2026-11-04 from `web/assets/battle/models/index.json` (249 entries, all 249 folders present) and the
`anim.json` inside each folder. A clip slot is present when `clips[N].present` is true (the extractor marks
zero-offset entries absent); a timeline table is authored when any pack's `timeline[N].table` is non-empty.

- 249 battle model packs ship in `web/assets/battle/models`.
- 23 packs carry all 18 action clips.
- 111 packs carry exactly 6 - slots 0-5: idle, the four reactions and the basic attack.
- 3 packs carry no clip array at all: `m468agnm`, `m469garm` and `m470agry`, the three newest DNA fused forms
  (`fusedModel` 468, 469 and 470 in `web/assets/data/jogress_scripts.json`). They have 0 clips, 0 action scripts
  and 3, 3 and 5 non-empty timeline tables; `web/fight/anim-donor-map.js` plays their clips 5, 9 and 10 through
  donor rows keyed to table 56 or 58.
- m466rgn2: total_frames 0. Every real keyframe sits at frame 0 (36 keys at 0, plus 36 end markers at 30000),
  so all 12 of its non-empty timeline tables play a still.
- 13 of the 62 timeline tables are authored by no pack: 7, 8, 9, 41, 42, 43, 46, 47, 48, 49, 59, 60 and 61.

These packs shipped; none of this is cut content. The bodies render and the fights run - they have no motion
to play.
