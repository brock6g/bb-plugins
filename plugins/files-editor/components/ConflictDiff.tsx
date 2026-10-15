import { useEffect, useMemo, useState } from "react";
import { experimental_Diff as Diff, useRpc } from "@get-bb/plugin-sdk/app";
import { createTwoFilesPatch } from "diff";
import type { rpcContract } from "../server.js";
import type { ScopeRef } from "@/lib/route";

export function ConflictDiff({
  scope,
  path,
  draft,
}: {
  scope: ScopeRef;
  path: string;
  draft: string;
}) {
  const rpc = useRpc<typeof rpcContract>();
  const [disk, setDisk] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [view, setView] = useState<"unified" | "split">("unified");
  useEffect(() => {
    let cancelled = false;
    setDisk(null);
    setError(null);
    void rpc
      .call("read", { scope, path })
      .then((file) => {
        if (cancelled) return;
        if (file.kind !== "text")
          setError("The file on disk is no longer text");
        else setDisk(file.content);
      })
      .catch((cause: unknown) => {
        if (!cancelled)
          setError(
            cause instanceof Error
              ? cause.message
              : "Could not read the file on disk",
          );
      });
    return () => {
      cancelled = true;
    };
  }, [attempt, path, rpc, scope.id, scope.kind]);
  const patch = useMemo(
    () => (disk === null ? "" : createTwoFilesPatch(path, path, disk, draft)),
    [disk, draft, path],
  );
  return (
    <div
      className="flex min-h-0 min-w-0 flex-1 flex-col"
      aria-label="Compare changes"
    >
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2 text-xs">
        <span>Disk version → your draft</span>
        <button
          type="button"
          className="rounded px-2 py-1 hover:bg-state-hover focus-visible:ring-1 focus-visible:ring-ring"
          onClick={() =>
            setView((current) => (current === "unified" ? "split" : "unified"))
          }
        >
          {view === "unified" ? "Show side by side" : "Show inline"}
        </button>
      </div>
      {error !== null ? (
        <div
          role="alert"
          className="flex flex-wrap gap-2 p-4 text-sm text-destructive-text"
        >
          {error}
          <button
            type="button"
            className="underline"
            onClick={() => setAttempt((value) => value + 1)}
          >
            Try again
          </button>
        </div>
      ) : disk === null ? (
        <p role="status" className="p-4 text-sm text-muted-foreground">
          Loading disk version…
        </p>
      ) : disk === draft ? (
        <p className="p-4 text-sm text-muted-foreground">
          Your draft matches the disk version
        </p>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto">
          <Diff
            patch={patch}
            path={path}
            view={view}
            experimental_fullFileContents={{
              old: { path, content: disk },
              new: { path, content: draft },
            }}
          />
        </div>
      )}
    </div>
  );
}
