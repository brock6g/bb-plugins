import { describe, expect, it } from "vitest";
import { languageForPath } from "./monaco-loader.js";

const monaco = {
  languages: {
    getLanguages: () => [
      { id: "typescript", extensions: [".ts", ".tsx", ".mts", ".cts"] },
      { id: "javascript", extensions: [".js", ".jsx"] },
      { id: "dockerfile", filenames: ["Dockerfile"], extensions: [".dockerfile"] },
      { id: "json", extensions: [".json", ".jsonc"] },
      { id: "compound", extensions: [".test.ts"] },
    ],
  },
} as unknown as Parameters<typeof languageForPath>[0];

describe("languageForPath", () => {
  it("uses Monaco’s registrations for extensions and exact filenames", () => {
    expect(languageForPath(monaco, "src/app.TSX")).toBe("typescript");
    expect(languageForPath(monaco, "project/Dockerfile")).toBe("dockerfile");
    expect(languageForPath(monaco, "config.jsonc")).toBe("json");
  });

  it("prefers the most specific registered suffix", () => {
    expect(languageForPath(monaco, "src/app.test.ts")).toBe("compound");
  });

  it("uses available embedded grammars for common config and component files", () => {
    expect(languageForPath(monaco, ".env.local")).toBe("shell");
    expect(languageForPath(monaco, "settings.toml")).toBe("ini");
    expect(languageForPath(monaco, "App.vue")).toBe("html");
    expect(languageForPath(monaco, "App.svelte")).toBe("html");
  });

  it("keeps unsupported files as plain text", () => {
    expect(languageForPath(monaco, "README")).toBe("plaintext");
    expect(languageForPath(monaco, "file.unknown")).toBe("plaintext");
  });
});
