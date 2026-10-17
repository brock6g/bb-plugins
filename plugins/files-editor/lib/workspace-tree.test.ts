// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { replaceDirectoryEntries, useWorkspaceTree } from "../components/use-workspace-tree";
import { encodeFolderScope } from "./folder-scope";
import type { ScopeRef } from "./route";
import type { FlatEntry } from "./tree";

const rpc = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock("@get-bb/plugin-sdk/app", () => ({ useRpc: () => rpc }));
beforeEach(() => { rpc.call.mockReset(); });
afterEach(cleanup);
const scope = encodeFolderScope("host-a", "/");
const directory = (path: string): FlatEntry => ({ path, kind: "directory" });
const file = (path: string): FlatEntry => ({ path, kind: "file" });
const result = (ref: ScopeRef, entries: FlatEntry[]) => ({
  scope: { root: "/", hostId: "host-a", hostName: "Server", isLocal: true, label: "Server", sublabel: "/", projectId: null, environmentId: null, ref },
  entries, truncated: false, listing: "local", excluded: [],
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function mount() {
  rpc.call.mockResolvedValueOnce(result(scope, [directory("etc"), directory("opt")]));
  const hook = renderHook(({ target, hidden }: { target: ScopeRef | null; hidden: boolean }) => useWorkspaceTree(target, hidden), { initialProps: { target: scope as ScopeRef | null, hidden: false } });
  await act(async () => {});
  return hook;
}

describe("shallow directory merging", () => {
  it("retains loaded descendants while refreshing siblings", () => {
    expect(replaceDirectoryEntries([directory("etc"), file("etc/hosts"), file("old")], "", [directory("etc"), file("new")]))
      .toEqual([directory("etc"), file("etc/hosts"), file("new")]);
  });
  it("removes vanished subtrees and descendants of a directory replaced by a file", () => {
    const initial = [directory("etc"), file("etc/hosts"), directory("opt"), file("opt/config")];
    expect(replaceDirectoryEntries(initial, "", [file("etc")])).toEqual([file("etc")]);
  });
  it("replaces only the chosen directory's immediate children", () => {
    expect(replaceDirectoryEntries([directory("etc"), file("etc/old"), directory("opt"), file("opt/keep")], "etc", [file("etc/new")]))
      .toEqual([directory("etc"), directory("opt"), file("opt/keep"), file("etc/new")]);
  });
});

describe("folder tree loading", () => {
  it("loads only the root until expansion, then deduplicates pending and loaded directories", async () => {
    const { result: state } = await mount();
    expect(rpc.call.mock.calls.map(([method]) => method)).toEqual(["tree"]);
    const pending = deferred<{ entries: FlatEntry[]; truncated: boolean }>();
    rpc.call.mockReturnValueOnce(pending.promise);
    act(() => { state.current.loadDirectory("etc"); state.current.loadDirectory("etc"); });
    expect(rpc.call).toHaveBeenCalledTimes(2);
    expect(state.current.directoryLoads).toEqual([{ path: "etc", status: "loading" }]);
    await act(async () => pending.resolve({ entries: [file("etc/hosts")], truncated: false }));
    act(() => state.current.loadDirectory("etc"));
    expect(rpc.call).toHaveBeenCalledTimes(2);
    expect(state.current.tree.entries).toContainEqual(file("etc/hosts"));
    expect(state.current.directoryLoads).toEqual([]);
  });
  it("keeps an unreadable directory retryable without repeatedly requesting it", async () => {
    const { result: state } = await mount();
    rpc.call.mockRejectedValueOnce(new Error("Permission denied"));
    await act(async () => state.current.loadDirectory("etc"));
    expect(state.current.directoryLoads).toEqual([{ path: "etc", status: "error", message: "Permission denied" }]);
    act(() => state.current.loadDirectory("etc"));
    expect(rpc.call).toHaveBeenCalledTimes(2);
    rpc.call.mockResolvedValueOnce({ entries: [file("etc/hosts")], truncated: false });
    await act(async () => state.current.loadDirectory("etc", true));
    expect(state.current.directoryLoads).toEqual([]);
    expect(state.current.tree.entries).toContainEqual(file("etc/hosts"));
  });
  it("drops an old directory reply when another machine or root is selected", async () => {
    const { result: state, rerender } = await mount();
    const old = deferred<{ entries: FlatEntry[]; truncated: boolean }>();
    rpc.call.mockReturnValueOnce(old.promise);
    act(() => state.current.loadDirectory("etc"));
    const next = encodeFolderScope("host-b", "/other");
    rpc.call.mockResolvedValueOnce(result(next, [file("new") ]));
    await act(async () => rerender({ target: next, hidden: false }));
    await act(async () => old.resolve({ entries: [file("etc/stale")], truncated: false }));
    expect(state.current.tree.scope?.ref).toEqual(next);
    expect(state.current.tree.entries).toEqual([file("new")]);
  });
  it("invalidates directory replies and hidden children when dotfile visibility changes", async () => {
    const { result: state, rerender } = await mount();
    const old = deferred<{ entries: FlatEntry[]; truncated: boolean }>();
    rpc.call.mockReturnValueOnce(old.promise);
    act(() => state.current.loadDirectory("etc"));
    rpc.call.mockResolvedValueOnce(result(scope, [directory("etc"), file(".visible") ]));
    await act(async () => rerender({ target: scope, hidden: true }));
    await act(async () => old.resolve({ entries: [file("etc/stale")], truncated: false }));
    expect(state.current.tree.entries).toEqual([directory("etc"), file(".visible")]);
  });
  it("refreshes previously loaded directories while preserving their rows until the response", async () => {
    const { result: state } = await mount();
    rpc.call.mockResolvedValueOnce({ entries: [file("etc/old")], truncated: false });
    await act(async () => state.current.loadDirectory("etc"));
    const childRefresh = deferred<{ entries: FlatEntry[]; truncated: boolean }>();
    rpc.call.mockResolvedValueOnce(result(scope, [directory("etc"), directory("opt")]));
    rpc.call.mockReturnValueOnce(childRefresh.promise);
    await act(async () => state.current.reload());
    expect(state.current.tree.entries).toContainEqual(file("etc/old"));
    await act(async () => childRefresh.resolve({ entries: [file("etc/new")], truncated: false }));
    expect(state.current.tree.entries).toContainEqual(file("etc/new"));
    expect(state.current.tree.entries).not.toContainEqual(file("etc/old"));
  });
  it("does not refresh a directory removed from the new root listing", async () => {
    const { result: state } = await mount();
    rpc.call.mockResolvedValueOnce({ entries: [file("etc/old")], truncated: false });
    await act(async () => state.current.loadDirectory("etc"));
    rpc.call.mockResolvedValueOnce(result(scope, [directory("opt")]));
    rpc.call.mockRejectedValueOnce(new Error("No such directory"));
    await act(async () => state.current.reload());
    expect(rpc.call.mock.calls.map(([method]) => method)).toEqual(["tree", "directory", "tree"]);
    expect(state.current.directoryLoads).toEqual([]);
    expect(state.current.tree.entries).toEqual([directory("opt")]);
  });
  it("keeps the loaded-entry bound when a refreshed root grows", async () => {
    const { result: state } = await mount();
    const files = Array.from({ length: 39_980 }, (_, index) => file(`root-${index}`));
    rpc.call.mockResolvedValueOnce(result(scope, [...files, directory("etc")]));
    await act(async () => state.current.reload());
    const children = Array.from({ length: 19 }, (_, index) => file(`etc/file-${index}`));
    rpc.call.mockResolvedValueOnce({ entries: children, truncated: false });
    await act(async () => state.current.loadDirectory("etc"));
    expect(state.current.tree.entries).toHaveLength(40_000);
    rpc.call.mockResolvedValueOnce(result(scope, [...files, directory("etc"), ...Array.from({ length: 5 }, (_, index) => file(`new-${index}`))]));
    const refresh = deferred<{ entries: FlatEntry[]; truncated: boolean }>();
    rpc.call.mockReturnValueOnce(refresh.promise);
    await act(async () => state.current.reload());
    expect(state.current.tree.entries).toHaveLength(40_000);
    expect(state.current.tree.truncated).toBe(true);
    await act(async () => refresh.resolve({ entries: children, truncated: false }));
  });

});
