export const S = {
  data: null as any,
  overlayShapeData: null as any,
  padData: null as any,
  // The master story ordinal, handed over by the game loop.  See
  // `setPointRecordOrdinal` for why it is not read out of the story engine here.
  readOrdinal: () => 0,
  // The flag reader, handed over by the game loop beside the ordinal (the same
  // store `setPointRecordFlag` forwards to the engine's scroll layers).  The
  // stage-entry mode gates (s421's windmill actor) read it.
  readFlag: null as any,
};
