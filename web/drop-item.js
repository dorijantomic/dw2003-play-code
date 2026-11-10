// Enemy drop_item names (enemies.json) are compact ("ArmorChip"); the engine item tables are
// keyed by display name ("Armor Chip"). This finds the item for either spelling. The compact
// name is the display name without spaces/punctuation (checked against items.json catalog for
// all 78 drops in tests/drop-item-resolver.test.js). "Null" and unknown names give null.
const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, "");
const cache = new WeakMap();

export function itemForDropName(name, byName = window.__ITEM_BY_NAME, byId = window.__ITEM_BY_ID) {
  if (!name || name === "Null") return null;
  const exact = byName?.[name];
  if (exact) return exact;
  if (!byId) return null;
  let index = cache.get(byId);
  if (!index) {
    index = new Map();
    for (const item of Object.values(byId)) {
      const key = norm(item?.name ?? "");
      if (key && !index.has(key)) index.set(key, item);
    }
    cache.set(byId, index);
  }
  return index.get(norm(name)) ?? null;
}
