import { useState } from "react";
import { Markdown } from "@get-bb/plugin-sdk/app";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import { formatBytes, languageLabel } from "@/lib/file-kind";
import type { ScopeRef } from "@/lib/route";
import type { FileTab } from "./use-file-tabs";
import { MonacoEditor } from "./MonacoEditor";
import { ConflictDiff } from "./ConflictDiff";

export interface FileViewProps {
  tab: FileTab;
  scope: ScopeRef | null;
  onChangeDraft: (path: string, draft: string) => void;
  onSave: () => void;
  onReload: () => void;
  onOverwrite: () => void;
  onRetry: () => void;
  findRequest: number;
  revealLine: { line: number; nonce: number } | null;
}

export function FileView(props: FileViewProps) {
  const { tab, onRetry } = props;
  const file = tab.file;
  if (file === null) {
    return tab.error === null ? (
      <Centered>
        <Icon name="Loading" aria-hidden className="size-4 animate-spin" />
        <span>Opening {tab.path}…</span>
      </Centered>
    ) : (
      <Centered tone="error">
        <span>{tab.error}</span>
        <NoticeAction onClick={onRetry}>Try again</NoticeAction>
      </Centered>
    );
  }
  if (file.kind === "image") {
    return (
      <div className="flex min-h-0 flex-1 flex-col overflow-auto p-6">
        <img
          src={file.dataUrl}
          alt={tab.path}
          className="mx-auto max-w-full rounded-md border border-border bg-card object-contain"
        />
        <p className="mt-3 text-center text-xs text-muted-foreground">
          {formatBytes(file.sizeBytes)}
        </p>
      </div>
    );
  }
  if (file.kind === "binary")
    return (
      <Centered>
        {file.reason} ({formatBytes(file.sizeBytes)})
      </Centered>
    );
  return (
    <TextFileView
      key={tab.path}
      {...props}
      content={tab.draft ?? file.content}
      readOnly={!file.editable}
    />
  );
}

function TextFileView({
  tab,
  scope,
  content,
  readOnly,
  onChangeDraft,
  onSave,
  onReload,
  onOverwrite,
  findRequest,
  revealLine,
}: FileViewProps & { content: string; readOnly: boolean }) {
  const [compare, setCompare] = useState(false);
  const hasConflict = tab.save.kind === "conflict";
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {hasConflict ? (
        <NoticeRow tone="error">
          <span className="min-w-0 flex-1">This file changed on disk</span>
          <NoticeAction onClick={() => setCompare((value) => !value)}>
            {compare ? "Back to editor" : "Compare changes"}
          </NoticeAction>
          <NoticeAction onClick={onReload}>Reload</NoticeAction>
          <NoticeAction onClick={onOverwrite}>Overwrite</NoticeAction>
        </NoticeRow>
      ) : tab.save.kind === "error" ? (
        <NoticeRow tone="error">{tab.save.message}</NoticeRow>
      ) : null}
      {readOnly ? (
        <NoticeRow tone="warning">
          This file is too large to edit here
        </NoticeRow>
      ) : null}
      {hasConflict && compare && scope !== null ? (
        <ConflictDiff scope={scope} path={tab.path} draft={content} />
      ) : tab.mode === "preview" ? (
        <div
          tabIndex={0}
          role="region"
          aria-label={`Preview of ${tab.path}`}
          className="min-h-0 flex-1 overflow-auto focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none"
        >
          <div className="mx-auto w-full max-w-[52rem] p-5">
            <Markdown content={content} />
          </div>
        </div>
      ) : (
        <MonacoEditor
          path={tab.path}
          value={content}
          readOnly={readOnly}
          onChange={(value) => onChangeDraft(tab.path, value)}
          onSave={onSave}
          findRequest={findRequest}
          revealLine={revealLine}
        />
      )}
    </div>
  );
}

function NoticeRow({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone: "error" | "warning";
}) {
  return (
    <div
      role="status"
      className={cn(
        "flex shrink-0 items-center gap-2 px-4 py-1.5 text-xs",
        tone === "error"
          ? "bg-surface-destructive text-destructive-text"
          : "bg-surface-attention text-foreground",
      )}
    >
      {children}
    </div>
  );
}

function NoticeAction({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="cursor-pointer rounded-sm font-medium underline underline-offset-2 hover:opacity-80 focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none"
    >
      {children}
    </button>
  );
}

function Centered({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone?: "error";
}) {
  return (
    <div
      className={cn(
        "flex min-h-0 flex-1 flex-wrap items-center justify-center gap-2 p-8 text-sm",
        tone === "error" ? "text-destructive-text" : "text-muted-foreground",
      )}
    >
      {children}
    </div>
  );
}

export function fileMetaLabel(tab: FileTab): string {
  if (tab.file === null) return "";
  const language = languageLabel(tab.path);
  if (tab.file.kind === "text") {
    const lines =
      tab.file.content === "" ? 0 : tab.file.content.split("\n").length;
    return `${language} · ${lines.toLocaleString()} lines · ${formatBytes(tab.file.sizeBytes)}`;
  }
  return `${language} · ${formatBytes(tab.file.sizeBytes)}`;
}
