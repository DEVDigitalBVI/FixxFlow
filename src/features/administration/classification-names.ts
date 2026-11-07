type ClassificationName = { name: string; is_active: boolean };

export function hasOverlappingActiveNames(rows: readonly ClassificationName[]): boolean {
  const names = rows
    .filter((row) => row.is_active)
    .map((row) =>
      row.name
        .toLocaleLowerCase()
        .split(/[^\p{L}\p{N}]+/u)
        .filter(Boolean),
    );
  return names.some((words, i) =>
    names.some(
      (other, j) => i < j && words.some((word) => word.length > 3 && other.includes(word)),
    ),
  );
}
