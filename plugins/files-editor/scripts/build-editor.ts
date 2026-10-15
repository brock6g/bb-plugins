import { copyFile, mkdir, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { build, type BuildOptions } from "esbuild";

const pluginRoot = path.resolve(import.meta.dirname, "..");
const outDir = path.join(pluginRoot, "dist", "monaco");
const require = createRequire(import.meta.url);
const monacoRoot = path.resolve(
  path.dirname(require.resolve("monaco-editor/editor/editor.api.js")),
  "..",
);
await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

// Keep Monaco outside the initial plugin app bundle, and inline its icon font
// so every asset is one of the three files served by the editor preview lease.
const shared: BuildOptions = {
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  minify: true,
  legalComments: "eof",
  absWorkingDir: pluginRoot,
  loader: { ".ttf": "dataurl" },
  metafile: true,
  plugins: [
    {
      name: "monaco-css",
      setup(build) {
        // Monaco’s exports only map JS paths; its own relative CSS imports work,
        // but the two standalone icon styles need their actual package paths.
        build.onResolve({ filter: /^monaco-editor\/.*\.css$/ }, (args) => ({
          path: path.join(monacoRoot, args.path.slice("monaco-editor/".length)),
        }));
      },
    },
  ],
};

const editor = await build({
  ...shared,
  entryPoints: [path.join(pluginRoot, "editor-bundle", "editor.ts")],
  outfile: path.join(outDir, "editor.js"),
});
const worker = await build({
  ...shared,
  entryPoints: [path.join(pluginRoot, "editor-bundle", "worker.ts")],
  outfile: path.join(outDir, "editor.worker.js"),
});

await Promise.all(
  ["LICENSE", "ThirdPartyNotices.txt"].map((name) =>
    copyFile(path.join(monacoRoot, "..", "..", name), path.join(outDir, name)),
  ),
);

// An API-only bundle still lets you type, but silently loses find, folding,
// word navigation and syntax grammars. Check the features in the built output.
const inputs = Object.keys(editor.metafile!.inputs);
const output = await readFile(path.join(outDir, "editor.js"), "utf8");
const required = [
  [
    "language grammars",
    inputs.some((input) => input.includes("languages/definitions/")),
  ],
  ["find widget", output.includes("find-widget")],
  ["folding", output.includes("foldRecursively")],
  ["word navigation", output.includes("cursorWordLeft")],
  ["line sorting", output.includes("sortLinesAscending")],
] as const;
const missing = required
  .filter(([, present]) => !present)
  .map(([name]) => name);
if (missing.length > 0) {
  throw new Error(`Monaco is missing: ${missing.join(", ")}`);
}
if (
  inputs.some((input) =>
    /languages\/features\/.*\/(?:register|.*Mode)\.js$/.test(input),
  )
) {
  throw new Error("Monaco unexpectedly includes standalone language services");
}

const bytes = [editor, worker].reduce(
  (total, result) =>
    total +
    Object.values(result.metafile!.outputs).reduce(
      (sum, entry) => sum + entry.bytes,
      0,
    ),
  0,
);
console.log(
  `Monaco assets built in dist/monaco (${(bytes / 1024 / 1024).toFixed(2)} MB)`,
);
