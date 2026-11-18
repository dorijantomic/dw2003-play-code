// web/dri.js — the DRI desk's save write.
//
// The desk itself is web/lab-translated.js (engine LabSession); web/dri-native.js
// uses this one function to write the party back to localStorage.

export function persistDriState(state) {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem("party", JSON.stringify(state.party ?? []));
  localStorage.setItem("partyStats", JSON.stringify(state.partyStats ?? []));
  localStorage.setItem("partnerStats", JSON.stringify(state.partnerStats ?? {}));
  localStorage.setItem("equipment", JSON.stringify(state.equipment ?? []));
  localStorage.setItem("reserveStats", JSON.stringify(state.reserveStats ?? {}));
  localStorage.setItem("reserveEquipment", JSON.stringify(state.reserveEquipment ?? {}));
  if (state.charId) localStorage.setItem("charId", state.charId);
}
