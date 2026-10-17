import { useCallback, useEffect, useRef, useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import type { ResolvedScope, rpcContract } from "../server.js";
import type { ScopeRef } from "@/lib/route";
import { sameScope } from "@/lib/route";
import { dirname, type FlatEntry } from "@/lib/tree";

export interface TreeState {
  status: "idle" | "loading" | "ready" | "error";
  scope: ResolvedScope | null;
  entries: FlatEntry[];
  truncated: boolean;
  listing: "local" | "remote";
  excluded: string[];
  error: string | null;
}

interface DirectoryLoad {
  path: string;
  status: "loading" | "error";
  message?: string;
}

const EMPTY_TREE: TreeState = {
  status: "idle",
  scope: null,
  entries: [],
  truncated: false,
  listing: "local",
  excluded: [],
  error: null,
};
const MAX_LOADED_ENTRIES = 40_000;

/** Replace one shallow listing, retaining descendants of directories still present. */
export function replaceDirectoryEntries(
  current: readonly FlatEntry[],
  directory: string,
  children: readonly FlatEntry[],
): FlatEntry[] {
  const next = new Map(children.map((entry) => [entry.path, entry]));
  const removed = new Set(current.filter((entry) =>
    dirname(entry.path) === directory && next.get(entry.path)?.kind !== entry.kind,
  ).map((entry) => entry.path));
  const entries = new Map(current.filter((entry) => {
    for (let path = entry.path; path !== ""; path = dirname(path)) {
      if (removed.has(path)) return false;
    }
    return true;
  }).map((entry) => [entry.path, entry]));
  for (const child of children) entries.set(child.path, child);
  return [...entries.values()];
}

export function useWorkspaceTree(scope: ScopeRef | null, includeHidden: boolean) {
  const rpc = useRpc<typeof rpcContract>();
  const [tree, setTree] = useState<TreeState>(EMPTY_TREE);
  const [directoryLoads, setDirectoryLoads] = useState<DirectoryLoad[]>([]);
  const treeRef = useRef(tree);
  treeRef.current = tree;
  const current = useRef({ scope, includeHidden });
  current.current = { scope, includeHidden };
  const generation = useRef(0);
  const attempted = useRef(new Set<string>());
  const loaded = useRef(new Set<string>());
  const rootQuery = useRef("");

  const loadDirectory = useCallback((path: string, force = false) => {
    const { scope: target, includeHidden: hidden } = current.current;
    if (target?.kind !== "folder" || !sameScope(treeRef.current.scope?.ref ?? null, target)) return;
    if (!treeRef.current.entries.some((entry) => entry.path === path && entry.kind === "directory")) return;
    if (!force && attempted.current.has(path)) return;
    const request = generation.current;
    attempted.current.add(path);
    const isCurrent = () => request === generation.current &&
      sameScope(current.current.scope, target) && current.current.includeHidden === hidden;
    setDirectoryLoads((loads) => [...loads.filter((load) => load.path !== path), { path, status: "loading" }]);
    void rpc.call("directory", { scope: target, path, includeHidden: hidden }).then((result) => {
      if (!isCurrent()) return;
      loaded.current.add(path);
      setTree((previous) => {
        if (!previous.entries.some((entry) => entry.path === path && entry.kind === "directory")) return previous;
        const entries = replaceDirectoryEntries(previous.entries, path, result.entries);
        return {
          ...previous,
          entries: entries.slice(0, MAX_LOADED_ENTRIES),
          truncated: previous.truncated || result.truncated || entries.length > MAX_LOADED_ENTRIES,
        };
      });
      setDirectoryLoads((loads) => loads.filter((load) => load.path !== path));
    }).catch((error: unknown) => {
      if (!isCurrent()) return;
      if (!treeRef.current.entries.some((entry) => entry.path === path && entry.kind === "directory")) {
        setDirectoryLoads((loads) => loads.filter((load) => load.path !== path));
        return;
      }
      setDirectoryLoads((loads) => [
        ...loads.filter((load) => load.path !== path),
        { path, status: "error", message: error instanceof Error ? error.message : "Could not read this folder" },
      ]);
    });
  }, [rpc]);

  const reload = useCallback(() => {
    const { scope: target, includeHidden: hidden } = current.current;
    const request = ++generation.current;
    const query = target === null ? "" : `${target.kind}:${target.id}:${hidden}`;
    const isSameQuery = query === rootQuery.current;
    const refreshDirectories = isSameQuery ? [...loaded.current] : [];
    rootQuery.current = query;
    attempted.current.clear();
    loaded.current.clear();
    setDirectoryLoads([]);
    if (target === null) {
      setTree(EMPTY_TREE);
      return;
    }
    setTree((previous) => ({ ...(isSameQuery ? previous : EMPTY_TREE), status: "loading" }));
    const isCurrent = () => request === generation.current &&
      sameScope(current.current.scope, target) && current.current.includeHidden === hidden;
    void rpc.call("tree", { scope: target, includeHidden: hidden }).then((result) => {
      if (!isCurrent()) return;
      setTree((previous) => {
        const entries = target.kind === "folder" && isSameQuery
          ? replaceDirectoryEntries(previous.entries, "", result.entries)
          : result.entries;
        return {
          status: "ready",
          scope: result.scope,
          entries: entries.slice(0, MAX_LOADED_ENTRIES),
          truncated: result.truncated || entries.length > MAX_LOADED_ENTRIES,
          listing: result.listing,
          excluded: result.excluded,
          error: null,
        };
      });
      const rootDirectories = new Set(result.entries.filter((entry) => entry.kind === "directory").map((entry) => entry.path));
      for (const directory of refreshDirectories) {
        if (rootDirectories.has(directory.split("/")[0]!)) loadDirectory(directory, true);
      }
    }).catch((error: unknown) => {
      if (!isCurrent()) return;
      setTree({ ...EMPTY_TREE, status: "error", error: error instanceof Error ? error.message : "Could not read this workspace" });
    });
  }, [loadDirectory, rpc]);

  useEffect(() => {
    const directories = new Set(tree.entries.filter((entry) => entry.kind === "directory").map((entry) => entry.path));
    for (const path of attempted.current) if (!directories.has(path)) attempted.current.delete(path);
    for (const path of loaded.current) if (!directories.has(path)) loaded.current.delete(path);
    setDirectoryLoads((loads) => {
      const remaining = loads.filter((load) => directories.has(load.path));
      return remaining.length === loads.length ? loads : remaining;
    });
  }, [tree.entries]);

  const scopeKind = scope?.kind ?? null;
  const scopeId = scope?.id ?? null;
  useEffect(() => {
    reload();
    return () => { generation.current += 1; };
  }, [includeHidden, reload, scopeId, scopeKind]);

  return { tree, reload, loadDirectory, directoryLoads };
}
