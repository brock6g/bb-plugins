import type {
  FileTree,
  FileTreeDirectoryHandle,
  FileTreeItemHandle,
} from "@pierre/trees";
import { ancestorsOf, normalizeRelative, type FlatEntry } from "./tree";

function isDirectory(
  item: FileTreeItemHandle | null,
): item is FileTreeDirectoryHandle {
  return item?.isDirectory() === true;
}

/** Pierre distinguishes a directory, including an empty one, by its final slash. */
export function pathsForPierreTree(entries: readonly FlatEntry[]): string[] {
  const paths = new Set<string>();
  for (const entry of entries) {
    const path = normalizeRelative(entry.path);
    if (path !== "") paths.add(entry.kind === "directory" ? `${path}/` : path);
  }
  return [...paths];
}

/** Observe model changes from pointer, keyboard, and programmatic expansion. */
export function observeTreeDirectoryExpansions(
  model: FileTree,
  onExpandDirectory: (path: string) => void,
): { recheck: () => void; unsubscribe: () => void } {
  let expanded = new Set<string>();
  const check = (recheck = false) => {
    const next = new Set(
      model.getVisibleRows(0, model.getVisibleCount() - 1)
        .filter((row) => row.kind === "directory" && row.isExpanded)
        .map((row) => normalizeRelative(row.path)),
    );
    const newlyExpanded = [...next].filter((path) => recheck || !expanded.has(path));
    // Callers may update the model while handling a notification.
    expanded = next;
    for (const path of newlyExpanded) onExpandDirectory(path);
  };
  const unsubscribe = model.subscribe(() => check());
  check();
  return { recheck: () => check(true), unsubscribe };
}

/** Preserve expanded descendants too, even while their parent is collapsed. */
export function resetTreePaths(
  model: FileTree,
  paths: readonly string[],
  previousPaths: readonly string[],
): void {
  const directories = new Set<string>();
  for (const path of previousPaths) {
    for (const ancestor of ancestorsOf(path)) directories.add(ancestor);
    if (path.endsWith("/")) directories.add(normalizeRelative(path));
  }
  const expanded: string[] = [];
  const collapsed: string[] = [];
  for (const path of directories) {
    const item = model.getItem(path);
    if (isDirectory(item))
      (item.isExpanded() ? expanded : collapsed).push(path);
  }
  model.resetPaths(paths, { initialExpandedPaths: expanded });
  // Pierre opens the ancestors of initialExpandedPaths too. Restore explicit
  // collapsed parents after the reset so their children's state is retained.
  for (const path of collapsed) {
    const item = model.getItem(path);
    if (isDirectory(item)) item.collapse();
  }
}

/** Follow editor tabs without transferring keyboard focus away from the editor. */
export function revealTreePath(
  model: FileTree,
  activePath: string | null,
): void {
  for (const selected of model.getSelectedPaths()) {
    if (selected !== activePath) model.getItem(selected)?.deselect();
  }
  if (activePath === null) return;
  for (const ancestor of ancestorsOf(activePath)) {
    const item = model.getItem(ancestor);
    if (isDirectory(item)) item.expand();
  }
  model.getItem(activePath)?.select();
  model.scrollToPath(activePath, { focus: false, offset: "nearest" });
}
