// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { FileTree } from "@pierre/trees";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectTree } from "../components/ProjectTree";
import type { FlatEntry } from "./tree";

vi.mock("@get-bb/plugin-sdk/app", () => ({
  experimental_useCodeTheme: () => ({ theme: null, mode: "dark" }),
}));

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function directory(path: string): FlatEntry {
  return { path, kind: "directory" };
}

function file(path: string): FlatEntry {
  return { path, kind: "file" };
}

async function treeRow(container: HTMLElement, name: string): Promise<HTMLElement> {
  let row: HTMLElement | undefined;
  await waitFor(() => {
    const shadow = container.querySelector("file-tree-container")?.shadowRoot;
    row = Array.from(shadow?.querySelectorAll<HTMLElement>('[role="treeitem"]') ?? [])
      .find((item) => {
        const path = item.getAttribute("data-item-path")?.replace(/\/$/, "");
        return path === name || path?.endsWith(`/${name}`);
      });
    expect(row).toBeDefined();
  });
  return row!;
}

describe("lazy ProjectTree directories", () => {
  it("reports pointer and keyboard expansion of empty directory rows", async () => {
    const onExpandDirectory = vi.fn();
    const onOpenFile = vi.fn();
    const view = render(createElement(ProjectTree, {
      entries: [directory("pointer"), directory("keyboard"), directory("closed"), file("readme.ts")],
      activePath: null,
      onOpenFile,
      onExpandDirectory,
    }));
    const pointer = await treeRow(view.container, "pointer");
    expect(onExpandDirectory).not.toHaveBeenCalled();
    fireEvent.click(pointer);
    await waitFor(() => expect(onExpandDirectory.mock.calls).toEqual([["pointer"]]));

    const keyboard = await treeRow(view.container, "keyboard");
    fireEvent.focus(keyboard);
    fireEvent.keyDown(keyboard, { key: "ArrowRight" });
    await waitFor(() => expect(onExpandDirectory.mock.calls).toEqual([["pointer"], ["keyboard"]]));
    expect(onOpenFile).not.toHaveBeenCalled();
    fireEvent.click(await treeRow(view.container, "readme.ts"));
    expect(onOpenFile.mock.calls).toEqual([["readme.ts"]]);
    expect(onExpandDirectory.mock.calls).toEqual([["pointer"], ["keyboard"]]);
  });

  it("reveals successive active-path ancestors without opening files during listing updates", async () => {
    const onExpandDirectory = vi.fn();
    const onOpenFile = vi.fn();
    const props = { activePath: "src/nested/index.ts", onOpenFile, onExpandDirectory };
    const view = render(createElement(ProjectTree, { ...props, entries: [directory("src"), directory("closed")] }));
    await waitFor(() => expect(onExpandDirectory).toHaveBeenCalledWith("src"));
    expect(onExpandDirectory).not.toHaveBeenCalledWith("closed");

    view.rerender(createElement(ProjectTree, {
      ...props,
      entries: [directory("src"), directory("src/nested"), directory("closed")],
    }));
    await waitFor(() => expect(onExpandDirectory).toHaveBeenCalledWith("src/nested"));

    view.rerender(createElement(ProjectTree, {
      ...props,
      entries: [directory("src"), directory("src/nested"), file("src/nested/index.ts"), directory("closed")],
    }));
    const active = await treeRow(view.container, "index.ts");
    await waitFor(() => expect(active.getAttribute("aria-selected")).toBe("true"));
    expect(onOpenFile).not.toHaveBeenCalled();
    expect(document.activeElement?.tagName).toBe("BODY");
  });

  it("keeps collapsed ancestors, selection, and scroll when lazy children arrive", async () => {
    const onExpandDirectory = vi.fn();
    const onOpenFile = vi.fn();
    const scrollToPath = vi.spyOn(FileTree.prototype, "scrollToPath");
    const props = { activePath: "src/nested/index.ts", onOpenFile, onExpandDirectory };
    const entries = [directory("src"), directory("src/nested"), file("src/nested/index.ts"), directory("closed")];
    const view = render(createElement(ProjectTree, { ...props, entries }));
    await treeRow(view.container, "index.ts");
    fireEvent.click(await treeRow(view.container, "src"));
    const collapsed = await treeRow(view.container, "src");
    await waitFor(() => expect(collapsed.getAttribute("aria-expanded")).toBe("false"));
    expect(collapsed.getAttribute("aria-selected")).toBe("true");
    onExpandDirectory.mockClear();
    scrollToPath.mockClear();

    view.rerender(createElement(ProjectTree, { ...props, entries: [...entries, file("new.ts")] }));
    await treeRow(view.container, "new.ts");
    const refreshed = await treeRow(view.container, "src");
    expect(refreshed.getAttribute("aria-expanded")).toBe("false");
    expect(refreshed.getAttribute("aria-selected")).toBe("true");
    expect(onExpandDirectory).not.toHaveBeenCalled();
    expect(scrollToPath).not.toHaveBeenCalled();
    expect(onOpenFile).not.toHaveBeenCalled();
  });

  it("rechecks expanded directories when the loading callback changes and cleans up on unmount", async () => {
    const getContainer = vi.spyOn(FileTree.prototype, "getFileTreeContainer");
    const onExpandDirectory = vi.fn();
    const props = { entries: [directory("src"), directory("other")], activePath: null, onOpenFile: vi.fn() };
    const view = render(createElement(ProjectTree, { ...props, onExpandDirectory }));
    fireEvent.click(await treeRow(view.container, "src"));
    await waitFor(() => expect(onExpandDirectory.mock.calls).toEqual([["src"]]));
    const nextCallback = vi.fn();
    view.rerender(createElement(ProjectTree, { ...props, onExpandDirectory: nextCallback }));
    expect(nextCallback.mock.calls).toEqual([["src"]]);

    const model = getContainer.mock.contexts.find((context): context is FileTree => context instanceof FileTree)!;
    const other = model.getItem("other");
    view.unmount();
    if (other !== null && "expand" in other) other.expand();
    expect(nextCallback.mock.calls).toEqual([["src"]]);
    expect(onExpandDirectory.mock.calls).toEqual([["src"]]);
  });
});
