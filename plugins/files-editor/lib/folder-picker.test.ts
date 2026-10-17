// @vitest-environment jsdom
import { createElement } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FolderPicker } from "../components/FolderPicker";
import { encodeFolderScope } from "./folder-scope";

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

async function mount() {
  const onSelect = vi.fn();
  const onClose = vi.fn();
  rpc.call.mockResolvedValueOnce(machines);
  const view = render(createElement(FolderPicker, { current: null, onSelect, onClose }));
  await screen.findByRole("button", { name: "Machine" });
  await waitFor(() => expect(screen.getByRole<HTMLButtonElement>("button", { name: "Open folder" }).disabled).toBe(false));
  return { ...view, onSelect, onClose };
}

describe("opening a server folder", () => {
  it("defaults to the filesystem root and opens it on the selected machine", async () => {
    const { onSelect } = await mount();
    const next = encodeFolderScope("server", "/");
    rpc.call.mockResolvedValueOnce({ scope: { ref: next } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Open folder" })));
    expect(rpc.call).toHaveBeenLastCalledWith("openFolder", { hostId: "server", path: "/" });
    expect(onSelect).toHaveBeenCalledWith(next);
  });
  it("keeps an invalid path visible, announces the error, and lets the user correct it", async () => {
    const { onSelect } = await mount();
    const input = screen.getByRole<HTMLInputElement>("textbox", { name: "Folder path" });
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
    fireEvent.click(screen.getByRole("button", { name: "Open folder" }));
    unmount();
    await act(async () => resolve({ scope: { ref: encodeFolderScope("server", "/") } }));
    expect(onSelect).not.toHaveBeenCalled();
  });
  it("retries a failed machine listing without losing the entered path", async () => {
    rpc.call.mockRejectedValueOnce(new Error("Connection unavailable"));
    render(createElement(FolderPicker, { current: null, onSelect: vi.fn(), onClose: vi.fn() }));
    await screen.findByRole("alert");
    fireEvent.change(screen.getByRole("textbox", { name: "Folder path" }), { target: { value: "/opt" } });
    rpc.call.mockResolvedValueOnce(machines);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Retry" })));
    expect(screen.getByRole<HTMLInputElement>("textbox", { name: "Folder path" }).value).toBe("/opt");
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
