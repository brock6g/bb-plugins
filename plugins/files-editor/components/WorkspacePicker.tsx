import { useEffect, useMemo, useRef, useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import { SearchableSelect, type SearchableSelectOption } from "@/components/ui/SearchableSelect";
import type { ScopeRef } from "@/lib/route";
import { sameScope } from "@/lib/route";
import { defaultOptionFor, groupWorkspaces } from "@/lib/workspaces";
import type { ResolvedScope, WorkspaceOption, rpcContract } from "../server.js";

const SERVER_ROOT = "folder:server-root";

/** Locations include project checkouts and the server's filesystem. */
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
  const [openingRoot, setOpeningRoot] = useState(false);
  const [rootError, setRootError] = useState<string | null>(null);
  const rootRequest = useRef(0);

  useEffect(() => () => { rootRequest.current += 1; }, []);

  async function openRoot() {
    const request = ++rootRequest.current;
    setOpeningRoot(true);
    setRootError(null);
    try {
      const { defaultHostId } = await rpc.call("machines", null);
      if (request !== rootRequest.current) return;
      if (defaultHostId === null) throw new Error("No connected machines. Reconnect a machine and try again.");
      const result = await rpc.call("openFolder", { hostId: defaultHostId, path: "/" });
      if (request === rootRequest.current) onSelect(result.scope.ref);
    } catch (error: unknown) {
      if (request === rootRequest.current) setRootError(error instanceof Error ? error.message : "Couldn’t open the server root. Try again.");
    } finally {
      if (request === rootRequest.current) setOpeningRoot(false);
    }
  }

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
  const isServerRoot = isFolder && current.isLocal && current.root === "/";
  const isLoading = options === null && !loadError;
  const listedHere = (options ?? []).some((option) => current !== null && sameScope(option.ref, current.ref));
  const locations: SearchableSelectOption[] = groups.map((group) => ({ value: group.projectId, label: group.projectName }));
  if (current !== null && selectedProjectId !== null && activeGroup === undefined) {
    locations.unshift({ value: selectedProjectId, label: current.label });
  }
  locations.unshift({ value: SERVER_ROOT, label: "Server root", meta: "Not a project", icon: "Laptop" });
  if (isFolder && !isServerRoot) locations.unshift({ value: keyOf(current.ref), label: current.root, meta: "Folder", icon: "FolderOpen" });
  const selectedLocation = isFolder ? isServerRoot ? SERVER_ROOT : keyOf(current.ref) : selectedProjectId;
  const workspaces = (activeGroup?.options ?? []).map((option) => ({ value: keyOf(option.ref), label: option.sublabel }));
  if (current !== null && !listedHere) {
    workspaces.unshift({ value: keyOf(current.ref), label: isFolder ? current.root : current.sublabel });
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      <SearchableSelect
        label="Location"
        icon={isFolder || openingRoot ? "Laptop" : "Folder"}
        value={openingRoot ? null : selectedLocation}
        options={locations}
        disabled={isLoading || loadError || openingRoot}
        placeholder={openingRoot ? "Opening server root…" : isLoading ? "Loading locations…" : loadError ? "Locations unavailable" : "Choose a location…"}
        onSelect={(value) => {
          if (value === SERVER_ROOT) { void openRoot(); return; }
          const next = defaultOptionFor(groups.find((group) => group.projectId === value));
          if (next !== null) onSelect(next.ref);
        }}
      />
      {!isFolder ? <SearchableSelect
        label="Workspace"
        icon={current?.environmentId === null ? "Folder" : "GitBranch"}
        value={current === null ? null : keyOf(current.ref)}
        options={workspaces}
        disabled={isLoading || loadError || current === null || openingRoot}
        placeholder={isLoading ? "Loading workspaces…" : loadError ? "Workspaces unavailable" : "Choose a workspace…"}
        onSelect={(value) => {
          const parsed = parseKey(value);
          if (parsed !== null) onSelect(parsed);
        }}
      /> : null}
      {rootError !== null ? (
        <div role="alert" className="flex flex-wrap items-center gap-x-2 gap-y-1 px-1 text-xs text-muted-foreground">
          <span>{rootError}</span>
          <button type="button" onClick={() => { void openRoot(); }} disabled={openingRoot} className="rounded-sm text-foreground underline underline-offset-2 focus-visible:outline-none focus-visible:bg-state-hover disabled:opacity-50">Retry</button>
        </div>
      ) : null}
      {loadError ? (
        <div role="alert" className="flex flex-wrap items-center gap-x-2 gap-y-1 px-1 text-xs text-muted-foreground">
          <span>Couldn’t load locations and workspaces.</span>
          <button type="button" onClick={() => setAttempt((value) => value + 1)} className="rounded-sm text-foreground underline underline-offset-2 focus-visible:outline-none focus-visible:bg-state-hover">Retry</button>
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
