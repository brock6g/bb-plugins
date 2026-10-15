import { FileTree } from "@pierre/trees";
import { afterEach, describe, expect, it } from "vitest";
import { pathsForPierreTree, resetTreePaths, revealTreePath } from "./pierre-tree";

const models: FileTree[] = [];
function tree(paths: string[]): FileTree {
  const model = new FileTree({ paths, initialExpansion: "closed" });
  models.push(model);
  return model;
}

afterEach(() => {
  for (const model of models.splice(0)) model.cleanUp();
});

describe("Pierre tree workspace paths", () => {
  it("preserves empty directories and POSIX filenames containing backslashes", () => {
    const paths = pathsForPierreTree([
      { path: "./empty/", kind: "directory" },
      { path: "empty", kind: "directory" },
      { path: "src/index.ts", kind: "file" },
      { path: "name\\with\\slashes.ts", kind: "file" },
      { path: "./", kind: "directory" },
    ]);
    expect(paths).toEqual(["empty/", "src/index.ts", "name\\with\\slashes.ts"]);
    const model = tree(paths);
    expect(model.getItem("empty")?.isDirectory()).toBe(true);
    expect(model.getItem("name\\with\\slashes.ts")?.isDirectory()).toBe(false);
  });

  it("reveals a selected file beyond the former 600-row cap without moving focus", () => {
    const model = tree(Array.from({ length: 1_000 }, (_, index) => `src/file-${index}.ts`));
    const focusedBefore = model.getFocusedPath();
    revealTreePath(model, "src/file-999.ts");

    expect(model.getSelectedPaths()).toEqual(["src/file-999.ts"]);
    expect(model.getVisibleCount()).toBe(1_001);
    expect(model.getVisibleRows(0, model.getVisibleCount() - 1)
      .some((row) => row.path === "src/file-999.ts")).toBe(true);
    expect(model.getFocusedPath()).toBe(focusedBefore);

    revealTreePath(model, "src/file-123.ts");
    expect(model.getSelectedPaths()).toEqual(["src/file-123.ts"]);
    revealTreePath(model, null);
    expect(model.getSelectedPaths()).toEqual([]);
  });

  it("retains nested expansion state across refresh, including collapsed ancestors", () => {
    const paths = ["src/nested/index.ts", "other/"];
    const model = tree(paths);
    revealTreePath(model, "src/nested/index.ts");
    const parent = model.getItem("src");
    if (parent !== null && "collapse" in parent) parent.collapse();

    resetTreePaths(model, [...paths, "new.ts"], paths);
    const nested = model.getItem("src/nested");
    expect(nested !== null && "isExpanded" in nested && nested.isExpanded()).toBe(true);
    const root = model.getItem("src");
    expect(root !== null && "isExpanded" in root && root.isExpanded()).toBe(false);
  });
});
