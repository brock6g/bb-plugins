import { describe, expect, it } from "vitest";
import {
  ancestorsOf,
  basename,
  fuzzyMatch,
  normalizeRelative,
  rankEntries,
  type FlatEntry,
} from "./tree.js";

const ENTRIES: FlatEntry[] = [
  { path: "config", kind: "directory" },
  { path: "config/auth.php", kind: "file" },
  { path: "config/app.php", kind: "file" },
  { path: "app/Http/Controllers/AuthController.php", kind: "file" },
  { path: "README.md", kind: "file" },
  { path: "storage/logs", kind: "directory" },
];

describe("ancestorsOf", () => {
  it("lists every directory above a path, outermost first", () => {
    expect(ancestorsOf("app/Http/Controllers/AuthController.php")).toEqual([
      "app",
      "app/Http",
      "app/Http/Controllers",
    ]);
  });

  it("returns nothing for a root-level file", () => {
    expect(ancestorsOf("README.md")).toEqual([]);
  });
});

describe("fuzzyMatch", () => {
  it("matches a scattered subsequence", () => {
    expect(fuzzyMatch("config/auth.php", "cauth")).not.toBeNull();
  });

  it("rejects characters that are out of order", () => {
    expect(fuzzyMatch("config/auth.php", "htua")).toBeNull();
  });

  it("scores a segment-boundary match above a mid-word one", () => {
    const boundary = fuzzyMatch("src/auth.ts", "auth");
    const middle = fuzzyMatch("src/reauthorize.ts", "auth");
    expect(boundary?.score).toBeGreaterThan(middle?.score ?? 0);
  });

  it("reports the index of every matched character", () => {
    expect(fuzzyMatch("abc", "ac")?.positions).toEqual([0, 2]);
  });
});

describe("rankEntries", () => {
  it("puts a filename match above a directory-only match", () => {
    const ranked = rankEntries(
      [
        { path: "auth/service/user.ts", kind: "file" },
        { path: "src/auth.ts", kind: "file" },
      ],
      "auth",
      10,
    );
    expect(ranked.matches[0]?.path).toBe("src/auth.ts");
  });

  it("returns nothing for an empty query", () => {
    expect(rankEntries(ENTRIES, "   ", 10).matches).toEqual([]);
  });

  it("flags truncation past the limit", () => {
    const entries: FlatEntry[] = Array.from({ length: 5 }, (_, index) => ({
      path: `src/file${index}.ts`,
      kind: "file",
    }));
    const ranked = rankEntries(entries, "ts", 2);
    expect(ranked.matches).toHaveLength(2);
    expect(ranked.truncated).toBe(true);
  });
});

describe("a POSIX name containing a backslash", () => {
  it("is not treated as a path separator by basename or ancestorsOf", () => {
    expect(basename("src/odd\\name.txt")).toBe("odd\\name.txt");
    expect(ancestorsOf("src/odd\\name.txt")).toEqual(["src"]);
  });
});

describe("normalizeRelative", () => {
  it("normalizes leading ./ and trailing slashes", () => {
    expect(normalizeRelative("./src/")).toBe("src");
    expect(normalizeRelative("./")).toBe("");
  });
});
