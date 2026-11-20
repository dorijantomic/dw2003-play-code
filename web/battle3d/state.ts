export const S = {
  // ─── Opt-in quaternion rotation interpolation (?slerp=1) ──────────────────────────────────────
  // The default rotation sampler lerps a ch2 triple COMPONENT BY COMPONENT and turns the triple into
  // a matrix with ps1AnglesToMat3 (Rz(c2)*Ry(c1)*Rx(c0)). That takes the long way round whenever a
  // component crosses a half turn, and on a near-180 deg change it walks through an orientation
  // neither key has (measured over every battle model and the DW2 fills: up to 179 deg off at
  // mid-span, 824 long-way key spans in the models' own clips — ~/scratch-research/anim-smooth/
  // SCAN.md). With this switch on, the two surrounding keys become quaternions of the SAME rotation
  // and are slerped along the shortest path, so the bone turns the short way and the key-to-key angle
  // is split evenly. Translation (ch1) and scale (ch3) stay linear; the flag-off path is the original
  // arithmetic, unchanged.
  //
  // OFF BY DEFAULT. Scope comes from the URL flag `?slerp=1` (the same shape as ?dw2motion=1) or
  // setSlerpRotation(); Node tools/tests use ANIM_SLERP=1.
  _slerpRot: false,
  // ─── The arena's own back-face cull (FIGHTSTG_F0x80085110's mesh arm) ──────────
  //
  // DECODED 2026-10-07 from the original's own display-list path, not guessed:
  //
  //   * The arena meshes are the SAME `0x18` battle bodies the character and effect
  //     meshes are, walked by the SAME interpreter FIGHTSTG_F0x80085110 (wfightmn
  //     builds the arena object from the arena id and the display-list loop emits
  //     each mesh's primitives). So the arena uses the character meshes' view
  //     space: the GTE's COP2 projection into screen space, Y increasing DOWNWARD.
  //
  //   * The mesh arm (0x8008555c..0x80085640, ported in
  //     engine/dw3/battle-displaylist.ts buildMeshFields) runs ONE NCLIP on the
  //     primitive's first three projected SXY and DROPS it when MAC0 <= 0 (or when
  //     two SXY are equal). MAC0 = SX0*(SY1-SY2) + SX1*(SY2-SY0) + SX2*(SY0-SY1),
  //     the signed area in that Y-down screen space.
  //
  //   * SIGN CONVENTION, pinned empirically from the ground truth: the arena's
  //     POLY_FT4 packets in the live battle RAM are the POST-CULL set (the original
  //     only packs what survived). Decoded with `.dw3-research/playtest-arena-palette-rig-2026-10-07/tools/
  //     scan_packets.py`: on all four captured battles (arena ids 1, 5, 13, 20),
  //     every arena packet (tpage 0x000a/0x000b) has NCLIP MAC0 > 0 on its first
  //     three SXY — 196/196, 414/414, 487/487, 531/531 — none <= 0. So surviving =
  //     MAC0 > 0 in PS1 screen space (Y down). The browser projects in NDC (Y up),
  //     so the screen-Y is negated below; a NDC-Y-up cross product carries the
  //     opposite sign, which is why the negation is there and not a sign flip on
  //     the comparison.
  //
  //   * A quad is culled as ONE primitive: both split triangles share the first
  //     triangle's sign (`cullRef`, emitted by tools/extract_arenas.py).
  arenaCullSign: 1,
};
