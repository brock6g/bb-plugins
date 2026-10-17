import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakePluginHost, makeHostResponse, type FakePluginHarness, type FakeSdkOverrides } from "@get-bb/plugin-sdk/testing";
import plugin from "../server.js";
import { decodeFolderScope, encodeFolderScope } from "./folder-scope.js";

type DirectoryListing = {
  directory: string;
  parent: string | null;
  entries: Array<{ name: string; path: string; kind: "file" | "directory" }>;
};

let temporary: string;
const harnesses: FakePluginHarness[] = [];

beforeEach(async () => { temporary = await mkdtemp(path.join(os.tmpdir(), "files-folders-")); });
afterEach(async () => {
  for (const harness of harnesses.splice(0)) await harness.lifecycle.dispose();
  await rm(temporary, { recursive: true, force: true });
});

function setup(options: { directory?: (requested: string) => DirectoryListing | Promise<DirectoryListing>; sdk?: FakeSdkOverrides } = {}) {
  const directory = vi.fn(async ({ path: requested, hostId }: { path?: string; hostId: string }) => {
    if (hostId !== "remote" && hostId !== "local") throw new Error("Unknown host");
    if (requested === undefined) throw new Error("Missing path");
    return options.directory?.(requested) ?? { directory: requested, parent: null, entries: [] };
  });
  const host = createFakePluginHost({
    pluginId: "files-editor",
    sdk: {
      system: { config: () => ({ dataDir: temporary, primaryHostId: "remote" }) },
      hosts: {
        get: ({ hostId }) => ({ ...makeHostResponse({ id: hostId, name: `Machine ${hostId}` }), connectMachineId: null, threadStorageRootPath: null }),
        list: () => [makeHostResponse({ id: "remote", name: "Remote" }), makeHostResponse({ id: "local", name: "Server" })],
        directory,
      },
      ...options.sdk,
    },
  });
  plugin(host.bb);
  harnesses.push(host.harness);
  return { ...host, directory };
}

const folder = (root = "/chosen", hostId = "remote") => encodeFolderScope(hostId, root);
const search = { query: "needle", matchCase: false, wholeWord: false, regex: false, includeHidden: true };

describe("folder RPCs", () => {
  it("identifies this daemon by its host-id file and defaults to the connected local machine", async () => {
    await writeFile(path.join(temporary, "host-id"), "local\n");
    const { harness } = setup();
    await expect(harness.behavior.callRpc("machines", null)).resolves.toEqual({
      machines: [
        { id: "remote", name: "Remote", isLocal: false, connected: true },
        { id: "local", name: "Server", isLocal: true, connected: true },
      ],
      defaultHostId: "local",
    });
  });

  it("does not mistake primaryHostId for this machine and handles offline hosts", async () => {
    const { harness } = setup({ sdk: { hosts: { list: () => [makeHostResponse({ id: "remote", name: "Laptop", status: "disconnected" })] } } });
    await expect(harness.behavior.callRpc("machines", null)).resolves.toEqual({
      machines: [{ id: "remote", name: "Laptop", isLocal: false, connected: false }],
      defaultHostId: null,
    });
  });

  it("uses the selected host's shallow listing even when that absolute root also exists on this server", async () => {
    await writeFile(path.join(temporary, "server-only.txt"), "local data");
    const { harness } = setup({ directory: (requested) => ({
      directory: requested,
      parent: null,
      entries: [{ name: "remote-only.txt", path: path.join(requested, "remote-only.txt"), kind: "file" }],
    }) });
    await expect(harness.behavior.callRpc("tree", { scope: folder(temporary), includeHidden: true })).resolves.toMatchObject({
      scope: { isLocal: false },
      entries: [{ path: "remote-only.txt", kind: "file" }],
    });
  });

  it("opens and resolves a canonical folder on the selected host", async () => {
    const { harness } = setup({ directory: (requested) => ({ directory: requested === "/alias" ? "/chosen" : requested, parent: "/", entries: [] }) });
    const result = await harness.behavior.callRpc("openFolder", { hostId: "remote", path: "/alias" }) as { scope: { ref: { kind: "folder"; id: string } } };
    expect(result).toMatchObject({ scope: {
      root: "/chosen", hostId: "remote", hostName: "Machine remote", isLocal: false,
      label: "Machine remote", sublabel: "/chosen", projectId: null, environmentId: null,
    } });
    expect(decodeFolderScope(result.scope.ref.id)).toEqual({ hostId: "remote", root: "/chosen" });
    await expect(harness.behavior.callRpc("resolve", { scope: result.scope.ref })).resolves.toMatchObject({ ok: true, scope: { root: "/chosen" } });
    expect(harness.inspection.sdk.callsTo("hosts.directory")).toEqual([[{ hostId: "remote", path: "/alias" }], [{ hostId: "remote", path: "/chosen" }]]);
  });

  it.each(["relative/path", "~/Documents", "C:relative", "/nul\0path"])("rejects a non-absolute folder before calling a host: %s", async (requested) => {
    const { harness, directory } = setup();
    await expect(harness.behavior.callRpc("openFolder", { hostId: "remote", path: requested })).rejects.toThrow(/absolute/);
    expect(directory).not.toHaveBeenCalled();
  });

  it.each(["ENOENT: no such directory", "EACCES: permission denied", "Path is not a directory"])("preserves directory errors: %s", async (message) => {
    const { harness } = setup({ directory: () => { throw new Error(message); } });
    await expect(harness.behavior.callRpc("openFolder", { hostId: "remote", path: "/missing" })).rejects.toThrow(message);
    await expect(harness.behavior.callRpc("resolve", { scope: folder("/missing") })).resolves.toEqual({ ok: false, reason: message });
    await expect(harness.behavior.callRpc("tree", { scope: folder("/missing"), includeHidden: false })).rejects.toThrow(message);
  });

  it("rejects malformed references and a root replaced by a symlink", async () => {
    const { harness } = setup({ directory: () => ({ directory: "/elsewhere", parent: "/", entries: [] }) });
    await expect(harness.behavior.callRpc("resolve", { scope: { kind: "folder", id: "invalid" } })).resolves.toEqual({ ok: false, reason: "Invalid folder reference." });
    await expect(harness.behavior.callRpc("resolve", { scope: folder() })).resolves.toMatchObject({ ok: false, reason: expect.stringMatching(/root has changed/) });
  });

  it("lists direct children and nested children relative to the root without a recursive file API", async () => {
    const { harness } = setup({ directory: (requested) => ({ directory: requested, parent: "/", entries: requested === "/chosen" ? [
      { name: "src", path: "/chosen/src", kind: "directory" },
      { name: "read me.txt", path: "/chosen/read me.txt", kind: "file" },
      { name: ".hidden", path: "/chosen/.hidden", kind: "file" },
      { name: "vendor", path: "/chosen/vendor", kind: "directory" },
      { name: "escape", path: "/outside/escape", kind: "file" },
      { name: "nested/no.txt", path: "/chosen/nested/no.txt", kind: "file" },
    ] : [{ name: "a.ts", path: "/chosen/src/a.ts", kind: "file" }] }) });
    await expect(harness.behavior.callRpc("tree", { scope: folder(), includeHidden: false })).resolves.toMatchObject({
      entries: [{ path: "src", kind: "directory" }, { path: "read me.txt", kind: "file" }], listing: "remote", truncated: false,
    });
    await expect(harness.behavior.callRpc("directory", { scope: folder(), path: "src", includeHidden: true })).resolves.toEqual({ entries: [{ path: "src/a.ts", kind: "file" }], truncated: false });
    expect(harness.inspection.sdk.callsTo("files.listPaths")).toHaveLength(0);
    expect(harness.inspection.sdk.callsTo("files.list")).toHaveLength(0);
    expect(harness.inspection.sdk.callsTo("hosts.directory").at(-1)).toEqual([{ hostId: "remote", path: "/chosen/src" }]);
  });

  it.each(["../escape", "src/../../escape", "/absolute", "nul\0path"])("rejects directory traversal before fetching a child: %s", async (relative) => {
    const { harness, directory } = setup();
    await expect(harness.behavior.callRpc("directory", { scope: folder(), path: relative, includeHidden: true })).rejects.toThrow(/escapes|relative/);
    expect(directory).toHaveBeenCalledTimes(1);
  });

  it.each(["/outside", "/chosen/other"])("rejects a directory whose canonical target changed to %s", async (canonical) => {
    const { harness } = setup({ directory: (requested) => ({ directory: requested === "/chosen/link" ? canonical : requested, parent: "/", entries: [] }) });
    await expect(harness.behavior.callRpc("directory", { scope: folder(), path: "link", includeHidden: true })).rejects.toThrow(/escapes|Symbolic-link/);
  });

  it("requires a folder scope for shallow directory browsing", async () => {
    const { harness } = setup();
    await expect(harness.behavior.callRpc("directory", { scope: { kind: "project", id: "project" }, path: "", includeHidden: true })).rejects.toThrow(/requires a folder/);
  });

  it("uses the Windows host path flavor and rejects drive, UNC, and backslash traversal", async () => {
    const root = "C:\\Team Files";
    const { harness } = setup({ directory: (requested) => ({ directory: requested, parent: null, entries: requested.endsWith("src") ? [{ name: "文書.txt", path: `${requested}\\文書.txt`, kind: "file" }] : [] }) });
    await expect(harness.behavior.callRpc("directory", { scope: folder(root), path: "src", includeHidden: true })).resolves.toEqual({ entries: [{ path: "src/文書.txt", kind: "file" }], truncated: false });
    for (const relative of ["..\\escape", "D:\\outside", "C:relative", "\\\\other\\share"]) {
      await expect(harness.behavior.callRpc("directory", { scope: folder(root), path: relative, includeHidden: true })).rejects.toThrow(/escapes|relative/);
    }
  });

  it("bounds a large shallow listing", async () => {
    const { harness } = setup({ directory: (requested) => ({ directory: requested, parent: null, entries: Array.from({ length: 10_001 }, (_, index) => ({ name: `${index}.txt`, path: `${requested}/${index}.txt`, kind: "file" as const })) }) });
    const result = await harness.behavior.callRpc("directory", { scope: folder(), path: "", includeHidden: true }) as { entries: unknown[]; truncated: boolean };
    expect(result.entries).toHaveLength(10_000);
    expect(result.truncated).toBe(true);
  });

  it("lists local folders shallowly with dotfiles while skipping symlink files and directories", async () => {
    await writeFile(path.join(temporary, "host-id"), "local");
    const root = path.join(temporary, "root");
    await mkdir(path.join(root, "nested"), { recursive: true });
    await writeFile(path.join(root, "nested", "deep.txt"), "deep");
    await writeFile(path.join(root, ".env"), "secret");
    await writeFile(path.join(root, "plain.txt"), "plain");
    await symlink(path.join(root, "plain.txt"), path.join(root, "file-link"));
    await symlink(path.join(root, "nested"), path.join(root, "dir-link"));
    const { harness } = setup();
    await expect(harness.behavior.callRpc("tree", { scope: folder(root, "local"), includeHidden: true })).resolves.toMatchObject({
      entries: [{ path: "nested", kind: "directory" }, { path: ".env", kind: "file" }, { path: "plain.txt", kind: "file" }], listing: "local",
    });
    await expect(harness.behavior.callRpc("directory", { scope: folder(root, "local"), path: "nested", includeHidden: false })).resolves.toEqual({ entries: [{ path: "nested/deep.txt", kind: "file" }], truncated: false });
    await expect(harness.behavior.callRpc("directory", { scope: folder(root, "local"), path: "dir-link", includeHidden: true })).rejects.toThrow(/Symbolic-link/);
    expect(harness.inspection.sdk.callsTo("files.listPaths")).toHaveLength(0);
  });

  it("preserves local missing-directory errors rather than returning an empty list", async () => {
    await writeFile(path.join(temporary, "host-id"), "local");
    const { harness } = setup();
    await expect(harness.behavior.callRpc("tree", { scope: folder(path.join(temporary, "missing"), "local"), includeHidden: true })).rejects.toThrow(/ENOENT/);
  });

  it("retains host, root confinement, and compare-and-swap guards for reads and writes", async () => {
    const read = vi.fn(() => ({ contentEncoding: "utf8", content: "before", sha256: "old", sizeBytes: 6 }));
    const write = vi.fn(() => ({ outcome: "written", sha256: "new", sizeBytes: 5 }));
    const { harness } = setup({ sdk: { files: { read, write } } });
    await expect(harness.behavior.callRpc("read", { scope: folder(), path: "src/a.txt" })).resolves.toMatchObject({ kind: "text", content: "before", absolutePath: "/chosen/src/a.txt" });
    await expect(harness.behavior.callRpc("write", { scope: folder(), path: "src/a.txt", content: "after", expectedSha256: "old" })).resolves.toEqual({ outcome: "written", sha256: "new", sizeBytes: 5 });
    expect(read).toHaveBeenCalledWith({ hostId: "remote", path: "/chosen/src/a.txt", rootPath: "/chosen" });
    expect(write).toHaveBeenCalledWith({ hostId: "remote", path: "/chosen/src/a.txt", rootPath: "/chosen", content: "after", contentEncoding: "utf8", expectedSha256: "old" });
    await expect(harness.behavior.callRpc("read", { scope: folder(), path: "../secret" })).rejects.toThrow(/escapes/);
    await expect(harness.behavior.callRpc("write", { scope: folder(), path: "../secret", content: "bad" })).rejects.toThrow(/escapes/);
    expect(read).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledTimes(1);
  });

  it("returns conflicts and propagates the host's symlink confinement rejection", async () => {
    const { harness } = setup({ sdk: { files: {
      read: () => { throw new Error("Path escapes root via symlink"); },
      write: () => ({ outcome: "conflict", currentSha256: "changed" }),
    } } });
    await expect(harness.behavior.callRpc("read", { scope: folder(), path: "link/secret" })).rejects.toThrow(/symlink/);
    await expect(harness.behavior.callRpc("write", { scope: folder(), path: "a.txt", content: "after", expectedSha256: "old" })).resolves.toEqual({ outcome: "conflict", currentSha256: "changed" });
    expect(harness.inspection.realtimeSignals).toHaveLength(0);
  });

  it("searches only the supplied loaded files and never recursively lists a folder", async () => {
    const read = vi.fn(() => ({ contentEncoding: "utf8", content: "needle", sha256: "sha", sizeBytes: 6 }));
    const { harness } = setup({ sdk: { files: { read } } });
    await expect(harness.behavior.callRpc("searchText", { ...search, scope: folder(), paths: ["loaded/a.txt", "loaded/a.txt", "vendor/skipped.txt"] })).resolves.toMatchObject({ status: "ok", files: [{ path: "loaded/a.txt", matchCount: 1 }], searchedFiles: 1 });
    expect(read).toHaveBeenCalledWith({ hostId: "remote", path: "/chosen/loaded/a.txt", rootPath: "/chosen" });
    expect(harness.inspection.sdk.callsTo("files.listPaths")).toHaveLength(0);
    expect(harness.inspection.sdk.callsTo("hosts.directory")).toHaveLength(1);
  });

  it("does no content reads when folder search has no loaded paths and rejects traversal", async () => {
    const read = vi.fn();
    const { harness } = setup({ sdk: { files: { read } } });
    await expect(harness.behavior.callRpc("searchText", { ...search, scope: folder() })).resolves.toMatchObject({ status: "ok", files: [], searchedFiles: 0 });
    await expect(harness.behavior.callRpc("searchText", { ...search, scope: folder(), paths: ["../secret"] })).rejects.toThrow(/escapes/);
    expect(read).not.toHaveBeenCalled();
  });

  it("uses the guarded SDK read for local folder search, including symlink paths supplied by a client", async () => {
    await writeFile(path.join(temporary, "host-id"), "local");
    const read = vi.fn(() => { throw new Error("Path escapes root via symlink"); });
    const { harness } = setup({ sdk: { files: { read } } });
    const result = await harness.behavior.callRpc("searchText", { ...search, scope: folder(temporary, "local"), paths: ["link/secret"] });
    expect(result).toMatchObject({ status: "ok", files: [], searchedFiles: 0 });
    expect(read).toHaveBeenCalledWith({ hostId: "local", path: path.join(temporary, "link", "secret"), rootPath: temporary });
  });

  it("keeps project search recursive and ignores the folder-only loaded path input", async () => {
    const { harness } = setup({ sdk: {
      projects: { get: () => ({ id: "project", name: "Project", sources: [{ path: "/project", hostId: "remote", isDefault: true }] }) },
      files: {
        listPaths: () => ({ paths: [{ path: "from-project.txt", kind: "file" }], truncated: false }),
        read: () => ({ contentEncoding: "utf8", content: "needle", sha256: "sha", sizeBytes: 6 }),
      },
    } });
    await expect(harness.behavior.callRpc("searchText", { ...search, scope: { kind: "project", id: "project" }, paths: ["../ignored"] })).resolves.toMatchObject({ status: "ok", files: [{ path: "from-project.txt" }] });
    expect(harness.inspection.sdk.callsTo("files.listPaths")).toEqual([[{ hostId: "remote", path: "/project", includeFiles: true, includeDirectories: true, limit: 10_000 }]]);
    expect(harness.inspection.sdk.callsTo("hosts.directory")).toHaveLength(0);
  });
});
