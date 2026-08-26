// Dependency-free (see lib/priceDisplay.js / lib/unitGroupRestriction.js for
// why) — pure comparator for the guest-facing extras sort order. `sortOrder`
// is an optional numeric field on each curated catalog item (see Admin >
// Catalog's "Reihenfolge" field). Ascending by sortOrder; items without an
// explicit sortOrder sort after every item that has one. Array.prototype.sort
// is a stable sort in Node (guaranteed since V8/Node 12), so a plain
// ascending comparator already preserves the original relative order for
// ties — including the "no sortOrder at all" group — without any extra
// tie-breaking logic here.
export function compareBySortOrder(a, b) {
  const aOrder = Number.isFinite(a?.sortOrder) ? a.sortOrder : Infinity;
  const bOrder = Number.isFinite(b?.sortOrder) ? b.sortOrder : Infinity;
  return aOrder - bOrder;
}
