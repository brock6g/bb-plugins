import { useEffect, useMemo, useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import type { ScopeRef } from "@/lib/route";
import { sameScope } from "@/lib/route";
import { defaultOptionFor, groupWorkspaces } from "@/lib/workspaces";
import type { ResolvedScope, WorkspaceOption, rpcContract } from "../server.js";

/** Project selection opens its checkout; the second control selects a worktree. */
export function WorkspacePicker({
  current,
  onSelect,
}: {
  current: ResolvedScope | null;
  onSelect: (scope: ScopeRef) => void;
}) {
  const rpc = useRpc<typeof rpcContract>();
  const [options, setOptions] = useState<WorkspaceOption[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setOptions(null);
    setLoadError(false);
    void rpc.call("workspaces").then((result) => {
      if (!cancelled) setOptions(result.workspaces);
    }).catch(() => {
      if (!cancelled) setLoadError(true);
    });
    return () => { cancelled = true; };
  }, [rpc, attempt]);

  const groups = useMemo(() => groupWorkspaces(options ?? []), [options]);
  const selectedProjectId = current?.projectId ?? null;
  const activeGroup = groups.find((group) => group.projectId === selectedProjectId);
  const isFolder = current !== null && current.projectId === null;
  const isLoading = options === null && !loadError;
  const listedHere = (options ?? []).some((option) => current !== null && sameScope(option.ref, current.ref));
  const projects = groups.map((group) => ({ value: group.projectId, label: group.projectName }));
  if (current !== null && selectedProjectId !== null && activeGroup === undefined) {
    projects.unshift({ value: selectedProjectId, label: current.label });
  }
  const workspaces = (activeGroup?.options ?? []).map((option) => ({ value: keyOf(option.ref), label: option.sublabel }));
  if (current !== null && !listedHere) {
    workspaces.unshift({ value: keyOf(current.ref), label: isFolder ? current.root : current.sublabel });
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      <SearchableSelect
        label="Project"
        icon="Folder"
        value={selectedProjectId}
        options={projects}
        disabled={isLoading || loadError}
        placeholder={isLoading ? "Loading projects…" : loadError ? "Projects unavailable" : "Choose a project…"}
        onSelect={(projectId) => {
          const next = defaultOptionFor(groups.find((group) => group.projectId === projectId));
          if (next !== null) onSelect(next.ref);
        }}
      />
      <SearchableSelect
        label="Workspace"
        icon={current?.environmentId === null ? "Folder" : "GitBranch"}
        value={current === null ? null : keyOf(current.ref)}
        options={workspaces}
        disabled={isLoading || loadError || current === null || isFolder}
        placeholder={isLoading ? "Loading workspaces…" : loadError ? "Workspaces unavailable" : "Choose a workspace…"}
        onSelect={(value) => {
          const parsed = parseKey(value);
          if (parsed !== null) onSelect(parsed);
        }}
      />
      {loadError ? (
        <div role="alert" className="flex flex-wrap items-center gap-x-2 gap-y-1 px-1 text-xs text-muted-foreground">
          <span>Couldn’t load projects and workspaces.</span>
          <button type="button" onClick={() => setAttempt((value) => value + 1)} className="rounded-sm text-foreground underline underline-offset-2 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">Retry</button>
        </div>
      ) : null}
    </div>
  );
}

function keyOf(ref: ScopeRef): string {
  return `${ref.kind}:${ref.id}`;
}

function parseKey(value: string): ScopeRef | null {
  const separator = value.indexOf(":");
  if (separator === -1) return null;
  const kind = value.slice(0, separator);
  const id = value.slice(separator + 1);
  if (id === "") return null;
  if (kind !== "thread" && kind !== "environment" && kind !== "project") return null;
  return { kind, id };
}
