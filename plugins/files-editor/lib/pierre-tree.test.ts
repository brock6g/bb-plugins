import { FileTree } from "@pierre/trees";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  observeTreeDirectoryExpansions,
  pathsForPierreTree,
  resetTreePaths,
  revealTreePath,
} from "./pierre-tree";

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

  it("reports expansion of genuine empty directories without eagerly loading closed ones", () => {
    const model = tree(["empty/", "closed/nested/", "file.ts"]);
    const onExpandDirectory = vi.fn();
    const observer = observeTreeDirectoryExpansions(model, onExpandDirectory);
    expect(onExpandDirectory).not.toHaveBeenCalled();

    const directory = model.getItem("empty");
    if (directory !== null && "expand" in directory) directory.expand();
    expect(onExpandDirectory.mock.calls).toEqual([["empty"]]);

    model.getItem("file.ts")?.select();
    model.focusPath("file.ts");
    if (directory !== null && "expand" in directory) directory.expand();
    expect(onExpandDirectory.mock.calls).toEqual([["empty"]]);

    if (directory !== null && "expand" in directory) {
      directory.collapse();
      directory.expand();
    }
    expect(onExpandDirectory.mock.calls).toEqual([["empty"], ["empty"]]);
    observer.unsubscribe();
  });

  it("progressively reports known ancestors while revealing an unloaded active path", () => {
    const model = tree(["src/", "closed/"]);
    const onExpandDirectory = vi.fn();
    const observer = observeTreeDirectoryExpansions(model, onExpandDirectory);
    revealTreePath(model, "src/nested/index.ts");
    expect(onExpandDirectory.mock.calls).toEqual([["src"]]);

    resetTreePaths(model, ["src/", "src/nested/", "closed/"], ["src/", "closed/"]);
    revealTreePath(model, "src/nested/index.ts");
    expect(onExpandDirectory.mock.calls).toEqual([["src"], ["src/nested"]]);
    observer.unsubscribe();
  });

  it("rechecks expanded directories for an invalidated listing and unsubscribes cleanly", () => {
    const model = tree(["src/", "other/"]);
    revealTreePath(model, "src/index.ts");
    const onExpandDirectory = vi.fn();
    const observer = observeTreeDirectoryExpansions(model, onExpandDirectory);
    expect(onExpandDirectory.mock.calls).toEqual([["src"]]);
    observer.recheck();
    expect(onExpandDirectory.mock.calls).toEqual([["src"], ["src"]]);
    observer.unsubscribe();

    const other = model.getItem("other");
    if (other !== null && "expand" in other) other.expand();
    expect(onExpandDirectory).toHaveBeenCalledTimes(2);
  });
});
