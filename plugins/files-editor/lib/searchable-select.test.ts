// @vitest-environment jsdom
import { createElement } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { WorkspacePicker } from "../components/WorkspacePicker";
import { SearchableSelect } from "../components/ui/SearchableSelect";
import type { ResolvedScope, WorkspaceOption } from "../server";
import { encodeFolderScope } from "./folder-scope";

const { call, rpc } = vi.hoisted(() => {
  const call = vi.fn();
  return { call, rpc: { call } };
});
vi.mock("@get-bb/plugin-sdk/app", () => ({ useRpc: () => rpc }));

beforeAll(() => {
  // jsdom has no top layer; nwsapi otherwise recursively evaluates :modal.
  const matches = Element.prototype.matches;
  vi.spyOn(Element.prototype, "matches").mockImplementation(function (this: Element, selector) {
    if ([":modal", ":popover-open", ":fullscreen"].includes(selector)) return false;
    return matches.call(this, selector);
  });
  vi.stubGlobal("ResizeObserver", class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
  HTMLElement.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  cleanup();
  call.mockReset();
});

const options = [
  { value: "a", label: "Alpha", description: "/srv/alpha" },
  { value: "b", label: "Beta", description: "/srv/second" },
  { value: "c", label: "Charlie", description: "/srv/charlie" },
];

describe("searchable select", () => {
  it("focuses search, filters descriptions, selects with the keyboard and restores focus", async () => {
    const onSelect = vi.fn();
    render(createElement(SearchableSelect, { label: "Project", value: "a", options, onSelect }));
    const trigger = screen.getByRole("button", { name: "Project" });
    fireEvent.click(trigger);
    const input = screen.getByRole("combobox", { name: "Search project" });
    expect(document.activeElement).toBe(input);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(trigger.getAttribute("aria-controls")).toBe(screen.getByRole("listbox").id);
    expect(screen.getByRole("option", { name: "Alpha /srv/alpha" }).getAttribute("aria-selected")).toBe("true");

    fireEvent.change(input, { target: { value: " SECOND " } });
    expect(screen.getAllByRole("option")).toHaveLength(1);
    expect(document.getElementById(input.getAttribute("aria-activedescendant")!)?.textContent).toContain("Beta");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSelect).toHaveBeenCalledExactlyOnceWith("b");
    await waitFor(() => expect(document.activeElement === trigger).toBe(true));
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("matches search height to the dropdown trigger", () => {
    render(createElement(SearchableSelect, { label: "Project", value: "a", options, onSelect: vi.fn() }));
    fireEvent.click(screen.getByRole("button", { name: "Project" }));
    expect((screen.getByRole("combobox") as HTMLInputElement).style.height).toBe("var(--radix-popover-trigger-height)");
  });

  it("supports arrows, Home and End while keeping focus in the search input", () => {
    const onSelect = vi.fn();
    render(createElement(SearchableSelect, { label: "Workspace", value: "a", options, onSelect }));
    fireEvent.keyDown(screen.getByRole("button", { name: "Workspace" }), { key: "ArrowDown" });
    const input = screen.getByRole("combobox");
    const activeLabel = () => document.getElementById(input.getAttribute("aria-activedescendant")!)?.textContent;
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(activeLabel()).toContain("Beta");
    fireEvent.keyDown(input, { key: "End" });
    expect(activeLabel()).toContain("Charlie");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(activeLabel()).toContain("Alpha");
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(activeLabel()).toContain("Charlie");
    fireEvent.keyDown(input, { key: "Home" });
    expect(activeLabel()).toContain("Alpha");
    expect(document.activeElement).toBe(input);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSelect).toHaveBeenCalledWith("a");
  });

  it("preserves the selected label for an empty filter and Escape returns focus", async () => {
    render(createElement(SearchableSelect, { label: "Project", value: "a", options, onSelect: vi.fn() }));
    const trigger = screen.getByRole("button", { name: "Project" });
    fireEvent.click(trigger);
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "nothing matches" } });
    expect(screen.queryAllByRole("option")).toHaveLength(0);
    expect(screen.getByRole("status").textContent).toBe("No matches");
    expect(input.hasAttribute("aria-activedescendant")).toBe(false);
    expect(trigger.textContent).toBe("Alpha");
    expect(trigger.title).toBe("Alpha");
    fireEvent.keyDown(input, { key: "Escape" });
    await waitFor(() => expect(document.activeElement === trigger).toBe(true));
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(trigger);
    expect(screen.getAllByRole("option")).toHaveLength(3);
  });

  it("closes on Tab without cancelling natural keyboard navigation", async () => {
    render(createElement(SearchableSelect, { label: "Project", value: null, options, onSelect: vi.fn() }));
    const trigger = screen.getByRole("button", { name: "Project" });
    fireEvent.click(trigger);
    expect(fireEvent.keyDown(screen.getByRole("combobox"), { key: "Tab" })).toBe(true);
    await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
  });

  it("portals inside a containing native dialog and constrains the menu to available space", () => {
    render(createElement("dialog", { open: true, "aria-label": "Open folder" },
      createElement(SearchableSelect, { label: "Machine", value: "a", options, onSelect: vi.fn() })));
    const dialog = screen.getByRole("dialog", { name: "Open folder" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Machine" }));
    const menu = within(dialog).getByRole("dialog", { name: "Machine options" });
    expect(menu.getAttribute("data-bb-plugin")).toBe("files-editor");
    expect(menu.style.maxHeight).toContain("--radix-popover-content-available-height");
    expect(menu.style.maxWidth).toContain("100dvw - 16px");
    expect(within(dialog).getByRole("listbox").className).toContain("overscroll-contain");
  });

  it("keeps disabled controls closed", () => {
    render(createElement(SearchableSelect, { label: "Project", value: "a", options, onSelect: vi.fn(), disabled: true }));
    const trigger = screen.getByRole("button", { name: "Project" }) as HTMLButtonElement;
    expect(trigger.disabled).toBe(true);
    fireEvent.click(trigger);
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    expect(screen.queryByRole("listbox")).toBeNull();
  });
});

const workspaces: WorkspaceOption[] = [
  { ref: { kind: "environment", id: "env-a" }, kind: "environment", projectId: "a", label: "Alpha", sublabel: "Feature" },
  { ref: { kind: "project", id: "a" }, kind: "project", projectId: "a", label: "Alpha", sublabel: "Checkout" },
  { ref: { kind: "environment", id: "env-b" }, kind: "environment", projectId: "b", label: "Beta", sublabel: "Feature" },
  { ref: { kind: "project", id: "b" }, kind: "project", projectId: "b", label: "Beta", sublabel: "Checkout" },
];

const current: ResolvedScope = {
  root: "/srv/alpha", hostId: "local", hostName: "This server", isLocal: true,
  ref: { kind: "project", id: "a" }, projectId: "a", environmentId: null,
  label: "Alpha", sublabel: "Checkout",
};

describe("workspace picker", () => {
  it("replaces native project and workspace selects with searchable controls", async () => {
    call.mockResolvedValue({ workspaces: [] });
    const view = render(createElement(WorkspacePicker, { current: null, onSelect: vi.fn() }));
    await waitFor(() => expect(call).toHaveBeenCalledWith("workspaces"));
    expect(view.container.querySelector("select")).toBeNull();
    expect(screen.getByRole("button", { name: "Location" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Workspace" })).toBeDefined();
  });

  it("selects a project's checkout and then its worktree", async () => {
    call.mockResolvedValue({ workspaces });
    const onSelect = vi.fn();
    render(createElement(WorkspacePicker, { current, onSelect }));
    const project = screen.getByRole("button", { name: "Location" }) as HTMLButtonElement;
    await waitFor(() => expect(project.disabled).toBe(false));
    fireEvent.click(project);
    fireEvent.click(screen.getByRole("option", { name: "Beta" }));
    expect(onSelect).toHaveBeenCalledWith({ kind: "project", id: "b" });
    fireEvent.click(screen.getByRole("button", { name: "Workspace" }));
    fireEvent.click(screen.getByRole("option", { name: "Feature" }));
    expect(onSelect).toHaveBeenLastCalledWith({ kind: "environment", id: "env-a" });
  });

  it("preserves project and workspace labels for an unlisted thread scope", async () => {
    call.mockResolvedValue({ workspaces: [] });
    const thread: ResolvedScope = { ...current, ref: { kind: "thread", id: "unlisted" }, projectId: "unlisted-project", label: "Archived project", sublabel: "Thread checkout" };
    render(createElement(WorkspacePicker, { current: thread, onSelect: vi.fn() }));
    const project = screen.getByRole("button", { name: "Location" }) as HTMLButtonElement;
    await waitFor(() => expect(project.disabled).toBe(false));
    expect(project.title).toBe("Archived project");
    const workspace = screen.getByRole("button", { name: "Workspace" });
    expect(workspace.title).toBe("Thread checkout");
    fireEvent.click(workspace);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "no match" } });
    expect(workspace.textContent).toBe("Thread checkout");
  });

  it("shows a server folder's path without treating it as a project or worktree", async () => {
    call.mockResolvedValue({ workspaces });
    const folder: ResolvedScope = {
      ...current, ref: { kind: "folder", id: "opaque-folder" }, projectId: null,
      root: "/srv/unlisted folder", label: "unlisted folder", sublabel: "Server folder",
    };
    const onSelect = vi.fn();
    render(createElement(WorkspacePicker, { current: folder, onSelect }));
    const project = screen.getByRole("button", { name: "Location" }) as HTMLButtonElement;
    await waitFor(() => expect(project.disabled).toBe(false));
    expect(project.textContent).toBe(folder.root);
    expect(screen.queryByRole("button", { name: "Workspace" })).toBeNull();
    fireEvent.click(project);
    fireEvent.click(screen.getByRole("option", { name: "Beta" }));
    expect(onSelect).toHaveBeenCalledExactlyOnceWith({ kind: "project", id: "b" });
  });

  it("disables loading controls and exposes a retryable load failure", async () => {
    let reject!: (error: Error) => void;
    call.mockReturnValueOnce(new Promise((_resolve, rejectPromise) => { reject = rejectPromise; }));
    render(createElement(WorkspacePicker, { current: null, onSelect: vi.fn() }));
    const project = screen.getByRole("button", { name: "Location" }) as HTMLButtonElement;
    const workspace = screen.getByRole("button", { name: "Workspace" }) as HTMLButtonElement;
    expect(project.disabled).toBe(true);
    expect(workspace.disabled).toBe(true);
    expect(project.textContent).toBe("Loading locations…");
    reject(new Error("offline"));
    expect((await screen.findByRole("alert")).textContent).toContain("Couldn’t load");
    expect(project.disabled).toBe(true);
    expect(workspace.disabled).toBe(true);
    call.mockResolvedValueOnce({ workspaces });
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(project.disabled).toBe(false));
    expect(call).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(workspace.disabled).toBe(true);
  });

  it("opens the actual server root from the location menu without a folder dialog", async () => {
    const root = encodeFolderScope("server", "/");
    call.mockImplementation(async (method) => {
      if (method === "workspaces") return { workspaces };
      if (method === "machines") return { defaultHostId: "server" };
      if (method === "openFolder") return { scope: { ref: root } };
      throw new Error(`Unexpected RPC: ${method}`);
    });
    const onSelect = vi.fn();
    render(createElement(WorkspacePicker, { current, onSelect }));
    const location = screen.getByRole<HTMLButtonElement>("button", { name: "Location" });
    await waitFor(() => expect(location.disabled).toBe(false));
    fireEvent.click(location);
    fireEvent.click(screen.getByRole("option", { name: "Server root Not a project" }));
    await waitFor(() => expect(onSelect).toHaveBeenCalledExactlyOnceWith(root));
    expect(call).toHaveBeenCalledWith("openFolder", { hostId: "server", path: "/" });
    expect(screen.queryByRole("textbox", { name: "Folder path" })).toBeNull();
  });

  it("shows the root as the current location and labels it as a non-project option", async () => {
    call.mockResolvedValue({ workspaces });
    const folder: ResolvedScope = { ...current, root: "/", projectId: null, environmentId: null, ref: encodeFolderScope("local", "/") };
    render(createElement(WorkspacePicker, { current: folder, onSelect: vi.fn() }));
    const location = screen.getByRole<HTMLButtonElement>("button", { name: "Location" });
    await waitFor(() => expect(location.disabled).toBe(false));
    expect(location.textContent).toBe("Server root");
    expect(screen.queryByRole("button", { name: "Workspace" })).toBeNull();
    fireEvent.click(location);
    expect(screen.getByRole("option", { name: "Server root Not a project" }).getAttribute("aria-selected")).toBe("true");
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "not a project" } });
    expect(screen.getAllByRole("option")).toHaveLength(1);
  });

  it("keeps project choices available if opening the root fails, and supports retry", async () => {
    const root = encodeFolderScope("server", "/");
    let failures = 1;
    call.mockImplementation(async (method) => {
      if (method === "workspaces") return { workspaces };
      if (method === "machines") return { defaultHostId: "server" };
      if (method === "openFolder") {
        if (failures-- > 0) throw new Error("Machine disconnected");
        return { scope: { ref: root } };
      }
      throw new Error(`Unexpected RPC: ${method}`);
    });
    const onSelect = vi.fn();
    render(createElement(WorkspacePicker, { current, onSelect }));
    const location = screen.getByRole<HTMLButtonElement>("button", { name: "Location" });
    await waitFor(() => expect(location.disabled).toBe(false));
    fireEvent.click(location);
    fireEvent.click(screen.getByRole("option", { name: "Server root Not a project" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Machine disconnected");
    expect(location.disabled).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(onSelect).toHaveBeenCalledExactlyOnceWith(root));
  });

  it("reports when there is no connected machine without opening a folder", async () => {
    call.mockImplementation(async (method) => method === "workspaces" ? { workspaces } : { defaultHostId: null });
    const onSelect = vi.fn();
    render(createElement(WorkspacePicker, { current, onSelect }));
    const location = screen.getByRole<HTMLButtonElement>("button", { name: "Location" });
    await waitFor(() => expect(location.disabled).toBe(false));
    fireEvent.click(location);
    fireEvent.click(screen.getByRole("option", { name: "Server root Not a project" }));
    expect((await screen.findByRole("alert")).textContent).toContain("No connected machines");
    expect(call.mock.calls.some(([method]) => method === "openFolder")).toBe(false);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("does not navigate if the root request completes after unmount", async () => {
    let resolve!: (value: unknown) => void;
    call.mockImplementation(async (method) => {
      if (method === "workspaces") return { workspaces };
      if (method === "machines") return { defaultHostId: "server" };
      return new Promise((yes) => { resolve = yes; });
    });
    const onSelect = vi.fn();
    const view = render(createElement(WorkspacePicker, { current, onSelect }));
    const location = screen.getByRole<HTMLButtonElement>("button", { name: "Location" });
    await waitFor(() => expect(location.disabled).toBe(false));
    fireEvent.click(location);
    fireEvent.click(screen.getByRole("option", { name: "Server root Not a project" }));
    await waitFor(() => expect(resolve).toBeTypeOf("function"));
    view.unmount();
    await act(async () => resolve({ scope: { ref: encodeFolderScope("server", "/") } }));
    expect(onSelect).not.toHaveBeenCalled();
  });
});
