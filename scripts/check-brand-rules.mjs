function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function containsGuardedName(source, guardedNames) {
  return guardedNames.some((name) => {
    const pattern = new RegExp(
      `(?<![\\p{L}\\p{N}_])${escapeRegExp(name)}(?![\\p{L}\\p{N}_])`,
      "iu",
    );
    return pattern.test(source);
  });
}
