export function containsGuardedName(source, guardedNames) {
  const normalizedSource = source.toLocaleLowerCase();
  return guardedNames.some((name) => normalizedSource.includes(name.toLocaleLowerCase()));
}
