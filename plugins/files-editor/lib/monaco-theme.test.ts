import { describe, expect, it, vi } from "vitest";
import type { PluginCodeThemeData } from "@get-bb/plugin-sdk/app";
import { applyCodeTheme, editorBackground, monacoThemeName, toMonacoTheme } from "./monaco-theme.js";

function theme(overrides: Partial<PluginCodeThemeData> = {}): PluginCodeThemeData {
  return {
    name: "bb:nord:light:1f4c9a2b", type: "light", fg: "#2e3440", bg: "#eceff4",
    colors: {}, tokenColors: [], ...overrides,
  };
}

describe("Monaco theme translation", () => {
  it("sanitizes namespaced BB theme names into valid Monaco names", () => {
    expect(monacoThemeName("bb:nord:light:1f4c9a2b")).toMatch(/^[a-zA-Z0-9-]+$/);
    expect(monacoThemeName("bb:nord:light")).not.toBe(monacoThemeName("bb:nord:dark"));
  });

  it("preserves the editor surface and drops unsupported workbench colors", () => {
    const converted = toMonacoTheme(theme({ colors: {
      "editor.background": "#123456", "editorCursor.foreground": "#abc",
      "editor.selectionBackground": "rgba(0,0,0,0.2)",
    } }));
    expect(converted.base).toBe("vs");
    expect(converted.colors).toEqual({
      "editor.background": "#123456", "editor.foreground": "#2e3440",
      "editorCursor.foreground": "#abc",
    });
    expect(editorBackground(theme())).toBe("#eceff4");
    expect(editorBackground(null)).toBeNull();
  });

  it("expands short hex, handles multiple scopes, and filters unsupported font styles", () => {
    const converted = toMonacoTheme(theme({ tokenColors: [
      { scope: "comment, keyword", settings: { foreground: "#abc", fontStyle: "italic strikethrough" } },
      { scope: ["string", "constant"], settings: { foreground: "#11223344" } },
      { scope: "invalid", settings: { foreground: "not-a-color" } },
    ] }));
    expect(converted.rules).toEqual([
      { token: "", foreground: "2e3440" },
      { token: "comment", foreground: "aabbcc", fontStyle: "italic" },
      { token: "keyword", foreground: "aabbcc", fontStyle: "italic" },
      { token: "string", foreground: "11223344" },
      { token: "constant", foreground: "11223344" },
    ]);
  });

  it("keeps the base in sync with the applied document while a theme switch resolves", () => {
    const defineTheme = vi.fn();
    const monaco = { editor: { defineTheme } } as unknown as Parameters<typeof applyCodeTheme>[0];
    expect(applyCodeTheme(monaco, { mode: "dark", theme: null })).toEqual({ name: "vs-dark", base: "vs-dark" });
    expect(defineTheme).not.toHaveBeenCalled();
    expect(applyCodeTheme(monaco, { mode: "dark", theme: theme() }).base).toBe("vs");
    expect(defineTheme).toHaveBeenCalledOnce();
  });
});
