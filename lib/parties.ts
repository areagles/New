/**
 * Deleting a client or supplier deactivates the row rather than removing it — the party stays
 * attached to every document it ever appeared on. `GET /clients` and `GET /suppliers` return
 * those rows too, so a picker fed straight from the list offers parties that were deleted.
 *
 * Filtering them out is not quite enough: an invoice raised for a party that has since been
 * deleted still names it, and dropping that option would leave the select rendering blank and
 * silently clear the field on the next save. So the selected party is always kept, deleted or
 * not — the list offers what may be chosen, plus what already was.
 */
export function selectableParties<T extends { id: string; isActive?: boolean }>(
  rows: T[],
  selectedId?: string | null,
): T[] {
  return rows.filter((r) => r.isActive !== false || r.id === selectedId);
}
