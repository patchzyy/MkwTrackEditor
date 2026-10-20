/**
 * Id generation for design entities. Random by default (ids must be unique across sessions
 * because they are stored in saved designs); tests switch to a deterministic counter.
 */

let generator: ((prefix: string) => string) | null = null;
let counter = 0;

function randomSuffix(): string {
  let out = '';
  for (let i = 0; i < 7; i++) out += Math.floor(Math.random() * 36).toString(36);
  return out;
}

export function createId(prefix: string): string {
  if (generator) return generator(prefix);
  return `${prefix}_${randomSuffix()}`;
}

/** Replace the id generator (null = random). Returns nothing; call `useDeterministicIds()` in tests. */
export function setIdGenerator(next: ((prefix: string) => string) | null): void {
  generator = next;
}

/** Counter-based ids (`road_1`, `pt_2`, ...) for tests. */
export function useDeterministicIds(start = 1): void {
  counter = start;
  generator = (prefix) => `${prefix}_${counter++}`;
}

export function useRandomIds(): void {
  generator = null;
}
