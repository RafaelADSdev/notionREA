export function reorderIntent(
  ids: readonly string[],
  activeId: string,
  overId: string,
): { beforeId: string | null } | null {
  if (activeId === overId || new Set(ids).size !== ids.length) return null;
  const from = ids.indexOf(activeId);
  const to = ids.indexOf(overId);
  if (from < 0 || to < 0) return null;
  const reordered = [...ids];
  reordered.splice(from, 1);
  reordered.splice(to, 0, activeId);
  return { beforeId: reordered[reordered.indexOf(activeId) + 1] ?? null };
}
