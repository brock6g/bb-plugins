import { describe, expect, it } from "vitest";
import { decodeFolderScope, encodeFolderScope } from "./folder-scope.js";
import { formatRoute, parseRoute } from "./route.js";

describe("folder references and routes", () => {
  it.each([
    ["host_1", "/"],
    ["host/with spaces", "/srv/Project files/été/文書"],
    ["机器 🌍", "C:\\Users\\Dev Name\\資料"],
    ["host_2", "C:/Program Files/App"],
    ["host_3", "\\\\server\\share\\Team files"],
  ])("round-trips %s and %s through a URL-safe opaque reference", (hostId, root) => {
    const scope = encodeFolderScope(hostId, root);
    expect(scope.id).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(encodeFolderScope(hostId, root)).toEqual(scope);
    expect(decodeFolderScope(scope.id)).toEqual({ hostId, root });
    const route = formatRoute(scope, "nested/文書 with spaces.txt");
    const encodedRoute = route.split("/").map(encodeURIComponent).join("/");
    expect(parseRoute(encodedRoute)).toEqual({ scope, filePath: "nested/文書 with spaces.txt" });
    expect(parseRoute(formatRoute(scope, null))).toEqual({ scope, filePath: null });
  });

  it.each(["", "!", "abc=", "a", "W10", "bnVsbA", "WyJob3N0IiwicmVsYXRpdmUiXQ", "_w"])("rejects malformed references: %s", (id) => {
    expect(decodeFolderScope(id)).toBeNull();
    expect(parseRoute(`folder/${id}/file.txt`).scope).toBeNull();
  });

  it("rejects empty hosts, relative roots, nul bytes, and oversized inputs", () => {
    expect(() => encodeFolderScope("", "/tmp")).toThrow(/Invalid/);
    expect(() => encodeFolderScope("host", "relative")).toThrow(/Invalid/);
    expect(() => encodeFolderScope("host", "/bad\0path")).toThrow(/Invalid/);
    expect(() => encodeFolderScope("host", `/${"a".repeat(65_536)}`)).toThrow(/too long/);
    expect(decodeFolderScope("a".repeat(65_537))).toBeNull();
  });

  it("rejects noncanonical base64 trailing bits", () => {
    const scope = encodeFolderScope("h", "/");
    expect(decodeFolderScope(`${scope.id}A`)).toBeNull();
  });
});
