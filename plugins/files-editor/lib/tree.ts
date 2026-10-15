export type EntryKind = "file" | "directory";

export interface FlatEntry {
  path: string;
  kind: EntryKind;
}

/**
 * Both listings hand us forward slashes already — the local walk joins prefixes
 * with "/" on every platform, and BB's daemon runs its own separator
 * normalizer over `host.list_paths`. So a backslash that survives to here is
 * part of a POSIX file's NAME, and collapsing it would build a phantom
 * directory whose rows open a path that does not exist. `resolveWithinRoot`
 * makes the same distinction server-side.
 */
export function normalizeRelative(path: string): string {
  return path.replace(/^\.?\//, "").replace(/\/+$/, "");
}

export function basename(path: string): string {
  const normalized = normalizeRelative(path);
  return normalized.slice(normalized.lastIndexOf("/") + 1);
}

export function dirname(path: string): string {
  const normalized = normalizeRelative(path);
  const separator = normalized.lastIndexOf("/");
  return separator === -1 ? "" : normalized.slice(0, separator);
}

/** Every directory between the root and `path`, outermost first. */
export function ancestorsOf(path: string): string[] {
  const segments = normalizeRelative(path).split("/");
  segments.pop();
  const ancestors: string[] = [];
  let current = "";
  for (const segment of segments) {
    current = current === "" ? segment : `${current}/${segment}`;
    ancestors.push(current);
  }
  return ancestors;
}

export interface FuzzyMatch {
  score: number;
  positions: number[];
}

/**
 * Subsequence match with the weighting an editor's quick-open uses: matches
 * that start a path segment or a camel/snake word beat matches in the middle of
 * one, and consecutive characters beat scattered ones. Returns null when the
 * query is not a subsequence of the text at all.
 */
export function fuzzyMatch(text: string, query: string): FuzzyMatch | null {
  if (query === "") return { score: 0, positions: [] };

  const haystack = text.toLowerCase();
  const needle = query.toLowerCase();
  const positions: number[] = [];
  let score = 0;
  let cursor = 0;
  let previousIndex = -1;

  for (const character of needle) {
    if (character === " ") continue;
    const index = haystack.indexOf(character, cursor);
    if (index === -1) return null;

    let characterScore = 1;
    if (index === previousIndex + 1) characterScore += 8;
    if (isBoundary(text, index)) characterScore += 12;
    if (index === 0) characterScore += 4;
    score += characterScore;

    positions.push(index);
    previousIndex = index;
    cursor = index + 1;
  }

  // Prefer matches inside the file name over matches in the directory prefix,
  // and shorter paths over longer ones when everything else ties.
  const nameStart = text.lastIndexOf("/") + 1;
  if (positions.length > 0 && positions[0]! >= nameStart) score += 15;
  score -= Math.min(text.length, 120) / 12;

  return { score, positions };
}

function isBoundary(text: string, index: number): boolean {
  if (index === 0) return true;
  const previous = text[index - 1]!;
  if (previous === "/" || previous === "_" || previous === "-" || previous === ".") {
    return true;
  }
  const current = text[index]!;
  return previous === previous.toLowerCase() && current !== current.toLowerCase();
}

export interface RankedEntry extends FlatEntry {
  score: number;
  positions: number[];
}

/** Rank a flat listing against a quick-open query, best first. */
export function rankEntries(
  entries: readonly FlatEntry[],
  query: string,
  limit: number,
): { matches: RankedEntry[]; truncated: boolean } {
  const trimmed = query.trim();
  if (trimmed === "") return { matches: [], truncated: false };

  const matches: RankedEntry[] = [];
  for (const entry of entries) {
    const match = fuzzyMatch(entry.path, trimmed);
    if (match === null) continue;
    matches.push({ ...entry, score: match.score, positions: match.positions });
  }

  matches.sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    return left.path.localeCompare(right.path, undefined, { numeric: true });
  });

  return {
    matches: matches.slice(0, limit),
    truncated: matches.length > limit,
  };
}
