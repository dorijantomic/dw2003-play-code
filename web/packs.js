// Starter Packs as offered by the Account Clerk (esdmg700[1] string 6).
// charIds are manifest character ids (sprite folder names).
export const PACKS = [
  { id: "A", name: "Balanced Pack", members: [
    { name: "Kotemon", charId: "p003pken" },
    { name: "Renamon", charId: "p009rena" },
    { name: "Patamon", charId: "p010pata" },
  ]},
  { id: "B", name: "Powerful Pack", members: [
    { name: "Monmon", charId: "p005koet" },
    { name: "Agumon", charId: "p006agum" },
    { name: "Renamon", charId: "p009rena" },
  ]},
  { id: "C", name: "Maniac Pack", members: [
    { name: "Kumamon", charId: "p004kogu" },
    { name: "Guilmon", charId: "p008giru" },
    { name: "Patamon", charId: "p010pata" },
  ]},
];

export function packOptions() {
  return PACKS.map(p => `${p.id} — ${p.name}: ${p.members.map(m => m.name).join(", ")}`);
}

export function leadOptions(packIdx) {
  return PACKS[packIdx].members.map(m => m.name);
}
