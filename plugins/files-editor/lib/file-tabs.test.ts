// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  isDirty,
  useFileTabs,
  type FileContent,
} from "../components/use-file-tabs.js";
import type { ScopeRef } from "./route.js";

const rpc = vi.hoisted(() => ({ call: vi.fn() }));

vi.mock("@get-bb/plugin-sdk/app", () => ({ useRpc: () => rpc }));

const SCOPE: ScopeRef = { kind: "environment", id: "workspace-a" };
const PATH = "src/example.ts";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function textFile(content: string, sha256: string): FileContent {
  return {
    kind: "text",
    content,
    sha256,
    sizeBytes: content.length,
    absolutePath: `/workspace/${PATH}`,
    editable: true,
  };
}

function mountTabs() {
  const initialProps: { scope: ScopeRef | null } = { scope: SCOPE };
  const hook = renderHook(({ scope }) => useFileTabs(scope), { initialProps });
  const open = async (
    path = PATH,
    file = textFile("original", "hash-original"),
  ) => {
    rpc.call.mockResolvedValueOnce(file);
    await act(async () => hook.result.current.open(path));
    expect(hook.result.current.activeTab?.file).toEqual(file);
  };
  return { ...hook, open };
}

beforeEach(() => rpc.call.mockReset());
afterEach(cleanup);

describe("useFileTabs", () => {
  it.each(["src/example.ts", "README.md"])(
    "opens %s ready to edit",
    async (path) => {
      const pending = deferred<FileContent>();
      rpc.call.mockReturnValueOnce(pending.promise);
      const { result } = mountTabs();

      act(() => result.current.open(path));
      expect(result.current.activeTab?.mode).toBe("edit");
      expect(result.current.activeTab?.file).toBeNull();

      await act(async () =>
        pending.resolve(textFile("original", "hash-original")),
      );
      expect(result.current.activeTab?.mode).toBe("edit");
      expect(rpc.call).toHaveBeenCalledWith("read", { scope: SCOPE, path });
    },
  );

  it("saves against the original hash and preserves typing while the write is pending", async () => {
    const { result, open } = mountTabs();
    await open();
    act(() => result.current.setDraft(PATH, "first edit"));
    const pending = deferred<{
      outcome: "written";
      sha256: string;
      sizeBytes: number;
    }>();
    rpc.call.mockReturnValueOnce(pending.promise);

    act(() => result.current.save());
    expect(rpc.call).toHaveBeenLastCalledWith("write", {
      scope: SCOPE,
      path: PATH,
      content: "first edit",
      expectedSha256: "hash-original",
    });
    expect(result.current.activeTab?.save.kind).toBe("saving");
    act(() => result.current.setDraft(PATH, "second edit"));

    await act(async () =>
      pending.resolve({
        outcome: "written",
        sha256: "hash-first-edit",
        sizeBytes: "first edit".length,
      }),
    );

    expect(result.current.activeTab).toMatchObject({
      draft: "second edit",
      sha256: "hash-first-edit",
      file: { content: "first edit", sha256: "hash-first-edit" },
      save: { kind: "clean" },
    });
    expect(isDirty(result.current.activeTab!)).toBe(true);
  });

  it("refreshes a clean tab when the file changes on disk", async () => {
    const { result, open } = mountTabs();
    await open();
    const changed = textFile("written by an agent", "hash-agent");
    rpc.call.mockResolvedValueOnce(changed);

    await act(async () => result.current.refresh(PATH));

    expect(rpc.call).toHaveBeenLastCalledWith("read", {
      scope: SCOPE,
      path: PATH,
    });
    expect(result.current.activeTab).toMatchObject({
      file: changed,
      draft: null,
      sha256: "hash-agent",
      mode: "edit",
      save: { kind: "clean" },
    });
  });

  it("keeps an existing draft and reports a conflict when disk contents change", async () => {
    const { result, open } = mountTabs();
    await open();
    act(() => result.current.setDraft(PATH, "my unsaved edit"));
    rpc.call.mockResolvedValueOnce(textFile("agent edit", "hash-agent"));

    await act(async () => result.current.refresh(PATH));

    expect(result.current.activeTab).toMatchObject({
      draft: "my unsaved edit",
      file: { content: "original", sha256: "hash-original" },
      sha256: "hash-original",
      save: { kind: "conflict" },
    });
  });

  it("preserves edits typed while a refresh is reading and reports a conflict", async () => {
    const { result, open } = mountTabs();
    await open();
    const pending = deferred<FileContent>();
    rpc.call.mockReturnValueOnce(pending.promise);

    act(() => result.current.refresh(PATH));
    act(() => result.current.setDraft(PATH, "typed while reading"));
    await act(async () =>
      pending.resolve(textFile("agent edit", "hash-agent")),
    );

    expect(result.current.activeTab).toMatchObject({
      draft: "typed while reading",
      file: { content: "original", sha256: "hash-original" },
      sha256: "hash-original",
      save: { kind: "conflict" },
    });
  });

  it.each([
    { content: "original", hash: "hash-original", save: "clean" },
    { content: "agent edit", hash: "hash-agent", save: "conflict" },
  ])(
    "keeps typing during reload when the resulting save state is $save",
    async ({ content, hash, save }) => {
      const { result, open } = mountTabs();
      await open();
      act(() => result.current.setDraft(PATH, "draft to discard"));
      const pending = deferred<FileContent>();
      rpc.call.mockReturnValueOnce(pending.promise);

      act(() => result.current.reload());
      expect(result.current.activeTab?.draft).toBeNull();
      act(() => result.current.setDraft(PATH, "typed during reload"));
      await act(async () => pending.resolve(textFile(content, hash)));

      expect(result.current.activeTab).toMatchObject({
        draft: "typed during reload",
        file: { content: "original", sha256: "hash-original" },
        sha256: "hash-original",
        save: { kind: save },
      });
    },
  );

  it("does not replace a newer successful save with a pending reload response", async () => {
    const { result, open } = mountTabs();
    await open();
    const pendingRead = deferred<FileContent>();
    rpc.call.mockReturnValueOnce(pendingRead.promise);
    act(() => result.current.reload());
    act(() => result.current.setDraft(PATH, "saved after reload started"));
    rpc.call.mockResolvedValueOnce({
      outcome: "written",
      sha256: "hash-new-save",
      sizeBytes: "saved after reload started".length,
    });
    await act(async () => result.current.save());

    await act(async () =>
      pendingRead.resolve(textFile("original", "hash-original")),
    );

    expect(result.current.activeTab).toMatchObject({
      draft: null,
      file: { content: "saved after reload started", sha256: "hash-new-save" },
      sha256: "hash-new-save",
      save: { kind: "clean" },
    });
  });

  it("does not report a conflict for an unsaved draft when disk contents are unchanged", async () => {
    const { result, open } = mountTabs();
    await open();
    act(() => result.current.setDraft(PATH, "my unsaved edit"));
    rpc.call.mockResolvedValueOnce(textFile("original", "hash-original"));

    await act(async () => result.current.refresh(PATH));

    expect(result.current.activeTab).toMatchObject({
      draft: "my unsaved edit",
      sha256: "hash-original",
      save: { kind: "clean" },
    });
  });

  it("ignores a refresh response from the previous workspace", async () => {
    const { result, rerender, open } = mountTabs();
    await open();
    const pending = deferred<FileContent>();
    rpc.call.mockReturnValueOnce(pending.promise);
    act(() => result.current.refresh(PATH));

    const nextScope: ScopeRef = { kind: "environment", id: "workspace-b" };
    rerender({ scope: nextScope });
    const nextFile = textFile("other workspace", "hash-other-workspace");
    await open(PATH, nextFile);
    await act(async () =>
      pending.resolve(textFile("stale workspace", "hash-stale")),
    );

    expect(result.current.activeTab).toMatchObject({
      file: nextFile,
      sha256: "hash-other-workspace",
      draft: null,
      save: { kind: "clean" },
    });
    expect(rpc.call).toHaveBeenLastCalledWith("read", {
      scope: nextScope,
      path: PATH,
    });
  });

  it("ignores a refresh response after the same file is closed and reopened", async () => {
    const { result, open } = mountTabs();
    await open();
    const pending = deferred<FileContent>();
    rpc.call.mockReturnValueOnce(pending.promise);
    act(() => result.current.refresh(PATH));

    act(() => result.current.close(PATH));
    const reopened = textFile("newly opened", "hash-reopened");
    await open(PATH, reopened);
    await act(async () =>
      pending.resolve(textFile("stale refresh", "hash-stale")),
    );

    expect(result.current.activeTab).toMatchObject({
      file: reopened,
      sha256: "hash-reopened",
      draft: null,
      save: { kind: "clean" },
    });
  });
});
