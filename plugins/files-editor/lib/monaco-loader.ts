import type * as MonacoNs from "monaco-editor";

let bootPromise: Promise<typeof MonacoNs> | null = null;
let stylesheetPromise: Promise<void> | null = null;
let loadAttempt = 0;
let workerBaseUrl = "";
let refreshWorkerBaseUrl: (() => Promise<string>) | undefined;

export function loadMonaco(
  baseUrl: string,
  refreshBaseUrl?: () => Promise<string>,
): Promise<typeof MonacoNs> {
  workerBaseUrl = baseUrl.replace(/\/$/, "");
  refreshWorkerBaseUrl = refreshBaseUrl;
  bootPromise ??= boot(workerBaseUrl).catch((error: unknown) => {
    bootPromise = null;
    throw error;
  });
  return bootPromise;
}

async function boot(baseUrl: string): Promise<typeof MonacoNs> {
  const attempt = ++loadAttempt;
  stylesheetPromise ??= injectStylesheet(`${baseUrl}/editor.css`).catch(
    (error: unknown) => {
      stylesheetPromise = null;
      throw error;
    },
  );
  await stylesheetPromise;
  const environment: MonacoNs.Environment = {
    async getWorker() {
      // Monaco can replace an idle worker long after the initial preview lease
      // expired. Resolve a current lease before each worker starts.
      const currentBaseUrl = refreshWorkerBaseUrl
        ? await refreshWorkerBaseUrl()
        : workerBaseUrl;
      return new Worker(
        new URL(
          `${currentBaseUrl.replace(/\/$/, "")}/editor.worker.js`,
          window.location.origin,
        ),
        { type: "module", name: "files-editor" },
      );
    },
  };
  (
    globalThis as { MonacoEnvironment?: MonacoNs.Environment }
  ).MonacoEnvironment = environment;

  const moduleUrl = new URL(`${baseUrl}/editor.js`, window.location.origin);
  // Browsers cache failed module imports, so a retry needs a fresh module URL.
  if (attempt > 1)
    moduleUrl.searchParams.set("files-editor-retry", String(attempt));
  const loaded: { monaco?: typeof MonacoNs } = await import(
    /* @vite-ignore */ moduleUrl.href
  );
  if (!loaded.monaco)
    throw new Error("The Monaco bundle did not expose its API");
  registerOccurrenceHighlighting(loaded.monaco);
  return loaded.monaco;
}

function injectStylesheet(href: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    link.onload = () => resolve();
    link.onerror = () => {
      link.remove();
      reject(new Error("Could not load the editor stylesheet"));
    };
    document.head.appendChild(link);
  });
}

function registerOccurrenceHighlighting(monaco: typeof MonacoNs): void {
  monaco.languages.registerDocumentHighlightProvider(
    monaco.languages.getLanguages().map((language) => language.id),
    {
      provideDocumentHighlights(model, position) {
        const word = model.getWordAtPosition(position);
        if (!word) return [];
        return model
          .findMatches(
            word.word,
            false,
            false,
            true,
            "`~!@#$%^&*()-=+[{]}\\|;:'\",.<>/?",
            false,
            1000,
          )
          .map((match) => ({
            range: match.range,
            kind: monaco.languages.DocumentHighlightKind.Text,
          }));
      },
    },
  );
}

/** Resolve registered grammars, preferring an exact filename or longest suffix. */
export function languageForPath(monaco: typeof MonacoNs, path: string): string {
  const name = (path.split("/").at(-1) ?? path).toLowerCase();
  const languages = monaco.languages.getLanguages();
  const exact = languages.find((language) =>
    language.filenames?.some((filename) => filename.toLowerCase() === name),
  );
  if (exact) return exact.id;
  let match = { id: "plaintext", length: 0 };
  for (const language of languages) {
    for (const extension of language.extensions ?? []) {
      if (
        name.endsWith(extension.toLowerCase()) &&
        extension.length > match.length
      ) {
        match = { id: language.id, length: extension.length };
      }
    }
  }
  if (match.length > 0) return match.id;
  if (name === ".env" || name.startsWith(".env.")) return "shell";
  if (name.endsWith(".toml")) return "ini";
  if (name.endsWith(".vue") || name.endsWith(".svelte")) return "html";
  return "plaintext";
}
