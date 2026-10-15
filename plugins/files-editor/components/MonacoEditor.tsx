import {
  createContext,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  experimental_useCodeTheme as useCodeTheme,
  useRpc,
} from "@get-bb/plugin-sdk/app";
import type * as Monaco from "monaco-editor";
import type { rpcContract } from "../server.js";
import { loadMonaco, languageForPath } from "@/lib/monaco-loader";
import { applyCodeTheme } from "@/lib/monaco-theme";
import { Icon } from "./ui/icon";

type Document = {
  model: Monaco.editor.ITextModel;
  view: Monaco.editor.ICodeEditorViewState | null;
  revealNonce: number | null;
  findNonce: number;
};

type Documents = {
  id: string;
  entries: Map<string, Document>;
};

const DocumentsContext = createContext<Documents | null>(null);

export function MonacoDocuments({
  scopeKey,
  paths,
  children,
}: {
  scopeKey: string;
  paths: string[];
  children: ReactNode;
}) {
  const id = useId();
  const documents = useMemo<Documents>(
    () => ({ id: `${id}:${scopeKey}`, entries: new Map() }),
    [id, scopeKey],
  );
  useEffect(
    () => () => {
      for (const document of documents.entries.values())
        document.model.dispose();
      documents.entries.clear();
    },
    [documents],
  );
  useEffect(() => {
    const open = new Set(paths);
    for (const [path, document] of documents.entries) {
      if (!open.has(path)) {
        document.model.dispose();
        documents.entries.delete(path);
      }
    }
  }, [documents, paths]);
  return (
    <DocumentsContext.Provider value={documents}>
      {children}
    </DocumentsContext.Provider>
  );
}

export function MonacoEditor({
  path,
  value,
  readOnly,
  onChange,
  onSave,
  findRequest,
  revealLine,
}: {
  path: string;
  value: string;
  readOnly: boolean;
  onChange: (value: string) => void;
  onSave: () => void;
  findRequest: number;
  revealLine: { line: number; nonce: number } | null;
}) {
  const documents = useContext(DocumentsContext);
  if (documents === null) throw new Error("MonacoEditor needs a workspace");
  const rpc = useRpc<typeof rpcContract>();
  const theme = useCodeTheme();
  const container = useRef<HTMLDivElement>(null);
  const editor = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
  const monaco = useRef<typeof Monaco | null>(null);
  const overflowNode = useRef<HTMLDivElement | null>(null);
  const latest = useRef({
    value,
    onChange,
    onSave,
    theme,
    readOnly,
    findRequest,
    revealLine,
  });
  latest.current = {
    value,
    onChange,
    onSave,
    theme,
    readOnly,
    findRequest,
    revealLine,
  };
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let instance: Monaco.editor.IStandaloneCodeEditor | null = null;
    let listener: Monaco.IDisposable | null = null;
    let overflow: HTMLDivElement | null = null;
    setStatus("loading");
    void (async () => {
      try {
        const assets = await rpc.call("editorAssets", null);
        const api = await loadMonaco(
          assets.baseUrl,
          async () => (await rpc.call("editorAssets", null)).baseUrl,
        );
        if (cancelled || container.current === null) return;
        monaco.current = api;
        let document = documents.entries.get(path);
        if (document === undefined) {
          const uri = api.Uri.from({
            scheme: "bb-files",
            authority: encodeURIComponent(documents.id),
            path: `/${path}`,
          });
          document = {
            model: api.editor.createModel(
              latest.current.value,
              languageForPath(api, path),
              uri,
            ),
            view: null,
            revealNonce: null,
            findNonce: 0,
          };
          documents.entries.set(path, document);
        } else if (
          document.model.getValue(undefined, true) !== latest.current.value
        ) {
          document.model.setValue(latest.current.value);
        }
        const applied = applyCodeTheme(api, latest.current.theme);
        overflow = window.document.createElement("div");
        overflow.className = `monaco-editor ${applied.base}`;
        Object.assign(overflow.style, {
          position: "absolute",
          top: "0",
          left: "0",
          zIndex: "40",
        });
        window.document.body.appendChild(overflow);
        overflowNode.current = overflow;
        instance = api.editor.create(container.current, {
          model: document.model,
          theme: applied.name,
          readOnly: latest.current.readOnly,
          ariaLabel: `Editor for ${path}`,
          automaticLayout: true,
          fixedOverflowWidgets: true,
          overflowWidgetsDomNode: overflow,
          fontFamily:
            getComputedStyle(window.document.documentElement).getPropertyValue(
              "--font-mono",
            ) || undefined,
          fontSize: 13,
          lineHeight: 20,
          lineNumbersMinChars: 3,
          padding: { top: 12, bottom: 12 },
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          tabSize: 2,
          insertSpaces: true,
          renderWhitespace: "selection",
          bracketPairColorization: { enabled: true },
          wordBasedSuggestions: "currentDocument",
        });
        editor.current = instance;
        if (document.view !== null) instance.restoreViewState(document.view);
        const model = document.model;
        listener = instance.onDidChangeModelContent(() => {
          latest.current.onChange(model.getValue(undefined, true));
        });
        instance.addCommand(api.KeyMod.CtrlCmd | api.KeyCode.KeyS, () =>
          latest.current.onSave(),
        );
        find(instance, latest.current.findRequest, document);
        reveal(instance, latest.current.revealLine, document);
        instance.focus();
        setStatus("ready");
      } catch (cause) {
        if (!cancelled) {
          setError(
            cause instanceof Error
              ? cause.message
              : "Could not load the editor",
          );
          setStatus("error");
        }
      }
    })();
    return () => {
      cancelled = true;
      const document = documents.entries.get(path);
      if (
        instance !== null &&
        document !== undefined &&
        !document.model.isDisposed()
      ) {
        document.view = instance.saveViewState();
      }
      listener?.dispose();
      instance?.dispose();
      overflow?.remove();
      overflowNode.current = null;
      editor.current = null;
    };
  }, [attempt, documents, path, rpc]);

  useEffect(() => {
    const model = editor.current?.getModel();
    if (
      model !== null &&
      model !== undefined &&
      model.getValue(undefined, true) !== value
    )
      model.setValue(value);
  }, [value]);

  useEffect(() => {
    const api = monaco.current;
    if (api === null || editor.current === null) return;
    const applied = applyCodeTheme(api, theme);
    editor.current.updateOptions({ theme: applied.name });
    const overflow = overflowNode.current;
    if (overflow !== null) overflow.className = `monaco-editor ${applied.base}`;
  }, [theme]);

  useEffect(() => {
    editor.current?.updateOptions({ readOnly });
  }, [readOnly]);
  useEffect(() => {
    const instance = editor.current;
    const document = documents.entries.get(path);
    if (instance !== null && document !== undefined)
      find(instance, findRequest, document);
  }, [documents, path, findRequest]);
  useEffect(() => {
    const document = documents.entries.get(path);
    if (editor.current !== null && document !== undefined)
      reveal(editor.current, revealLine, document);
  }, [documents, path, revealLine?.nonce]);

  return (
    <div
      className="relative flex min-h-0 min-w-0 flex-1 flex-col"
      data-files-editor={path}
    >
      <div ref={container} className="min-h-0 min-w-0 flex-1" />
      {status !== "ready" ? (
        <div
          role="status"
          className="absolute inset-0 flex items-center justify-center gap-2 bg-background p-4 text-sm text-muted-foreground"
        >
          {status === "loading" ? (
            <>
              <Icon
                name="Loading"
                aria-hidden
                className="size-4 animate-spin"
              />
              Loading editor…
            </>
          ) : (
            <>
              <span>{error}</span>
              <button
                type="button"
                className="underline underline-offset-2"
                onClick={() => setAttempt((value) => value + 1)}
              >
                Try again
              </button>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

function reveal(
  editor: Monaco.editor.IStandaloneCodeEditor,
  target: { line: number; nonce: number } | null,
  document: Document,
) {
  const model = editor.getModel();
  if (
    target === null ||
    model === null ||
    document.revealNonce === target.nonce
  )
    return;
  document.revealNonce = target.nonce;
  const lineNumber = Math.max(1, Math.min(target.line, model.getLineCount()));
  editor.setPosition({ lineNumber, column: 1 });
  editor.revealLineInCenter(lineNumber);
}

function find(
  editor: Monaco.editor.IStandaloneCodeEditor,
  nonce: number,
  document: Document,
) {
  if (nonce <= 0 || nonce === document.findNonce) return;
  document.findNonce = nonce;
  void editor.getAction("actions.find")?.run();
}
