export type Random = () => number;

/** Mischt `items` in place (Fisher-Yates) und gibt es zurück. */
export function shuffle<T>(items: T[], random: Random = Math.random): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}
