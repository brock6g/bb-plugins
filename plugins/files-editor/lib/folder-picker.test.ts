// @vitest-environment jsdom
import { createElement } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FolderPicker } from "../components/FolderPicker";
import { encodeFolderScope } from "./folder-scope";
import type { ResolvedScope } from "../server";

const rpc = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock("@get-bb/plugin-sdk/app", () => ({ useRpc: () => rpc }));
const dialogMethods = ["showModal", "close"] as const;
const originalMethods = dialogMethods.map((name) => Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, name));
beforeEach(() => {
  rpc.call.mockReset();
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value: function(this: HTMLDialogElement) { this.setAttribute("open", ""); } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value: function(this: HTMLDialogElement) { this.removeAttribute("open"); } });
});
afterEach(() => {
  cleanup();
  dialogMethods.forEach((name, index) => {
    const original = originalMethods[index];
    if (original !== undefined) Object.defineProperty(HTMLDialogElement.prototype, name, original);
    else Reflect.deleteProperty(HTMLDialogElement.prototype, name);
  });
});
const machines = { machines: [
  { id: "server", name: "Server", isLocal: true, connected: true },
  { id: "offline", name: "Offline", isLocal: false, connected: false },
], defaultHostId: "server" };

async function mount(current: ResolvedScope | null = null) {
  const onSelect = vi.fn();
  const onClose = vi.fn();
  rpc.call.mockResolvedValueOnce(machines);
  const view = render(createElement(FolderPicker, { current, onSelect, onClose }));
  await screen.findByRole("button", { name: "Machine" });
  await waitFor(() => expect(screen.getByRole<HTMLButtonElement>("button", { name: "Browse filesystem" }).disabled).toBe(false));
  return { ...view, onSelect, onClose };
}

function showPath() {
  fireEvent.click(screen.getByRole("button", { name: "Open a specific folder" }));
  return screen.getByRole<HTMLInputElement>("textbox", { name: "Folder path" });
}

describe("opening a server folder", () => {
  it("offers the filesystem root directly without requiring or displaying a path", async () => {
    const { onSelect } = await mount({
      root: "/srv/project", hostId: "server", hostName: "Server", isLocal: true,
      ref: encodeFolderScope("server", "/srv/project"), label: "Server", sublabel: "/srv/project",
      projectId: null, environmentId: null,
    });
    expect(screen.queryByRole("textbox", { name: "Folder path" })).toBeNull();
    const next = encodeFolderScope("server", "/");
    rpc.call.mockResolvedValueOnce({ scope: { ref: next } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Browse filesystem" })));
    expect(rpc.call).toHaveBeenLastCalledWith("openFolder", { hostId: "server", path: "/" });
    expect(onSelect).toHaveBeenCalledWith(next);
  });
  it("keeps an invalid path visible, announces the error, and lets the user correct it", async () => {
    const { onSelect } = await mount();
    const input = showPath();
    expect(document.activeElement).toBe(input);
    fireEvent.change(input, { target: { value: "relative" } });
    rpc.call.mockRejectedValueOnce(new Error("Enter an absolute folder path"));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Open folder" })));
    expect(screen.getByRole("alert").textContent).toContain("Enter an absolute folder path");
    expect(input.value).toBe("relative");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(document.activeElement).toBe(input);
    expect(onSelect).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: "/etc" } });
    expect(input.getAttribute("aria-invalid")).toBe("false");
    rpc.call.mockResolvedValueOnce({ scope: { ref: encodeFolderScope("server", "/etc") } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Open folder" })));
    expect(onSelect).toHaveBeenCalledOnce();
  });
  it("ignores a folder result after the dialog closes", async () => {
    const { onSelect, unmount } = await mount();
    let resolve!: (value: unknown) => void;
    rpc.call.mockReturnValueOnce(new Promise((yes) => { resolve = yes; }));
    fireEvent.click(screen.getByRole("button", { name: "Browse filesystem" }));
    unmount();
    await act(async () => resolve({ scope: { ref: encodeFolderScope("server", "/") } }));
    expect(onSelect).not.toHaveBeenCalled();
  });
  it("retries a failed machine listing without losing the entered path", async () => {
    rpc.call.mockRejectedValueOnce(new Error("Connection unavailable"));
    render(createElement(FolderPicker, { current: null, onSelect: vi.fn(), onClose: vi.fn() }));
    await screen.findByRole("alert");
    fireEvent.change(showPath(), { target: { value: "/opt" } });
    rpc.call.mockResolvedValueOnce(machines);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Retry" })));
    expect(screen.getByRole<HTMLInputElement>("textbox", { name: "Folder path" }).value).toBe("/opt");
    expect(screen.queryByRole("alert")).toBeNull();
  });
  it("keeps a failed root action retryable without revealing a path field", async () => {
    const { onSelect } = await mount();
    rpc.call.mockRejectedValueOnce(new Error("Machine disconnected"));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Browse filesystem" })));
    expect(screen.getByRole("alert").textContent).toContain("Machine disconnected");
    expect(screen.queryByRole("textbox", { name: "Folder path" })).toBeNull();
    rpc.call.mockResolvedValueOnce({ scope: { ref: encodeFolderScope("server", "/") } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Browse filesystem" })));
    expect(onSelect).toHaveBeenCalledOnce();
  });
  it("does not submit a second request while the root action is opening", async () => {
    await mount();
    rpc.call.mockReturnValueOnce(new Promise(() => {}));
    const button = screen.getByRole("button", { name: "Browse filesystem" });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(rpc.call.mock.calls.filter(([method]) => method === "openFolder")).toHaveLength(1);
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Machine" }).disabled).toBe(true);
  });
});
