// Compare every pre-existing SQL column and row, while allowing additive columns.
export function existingRowColumns(current, previous) {
  const columns = Object.keys(previous[0] ?? {});
  return current
    .map((row) => Object.fromEntries(columns.map((key) => [key, row[key]])))
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}
export function existingTableColumns(current, previous) {
  return Object.fromEntries(
    Object.entries(previous).map(([table, rows]) => [
      table,
      existingRowColumns(current[table], rows),
    ]),
  );
}
