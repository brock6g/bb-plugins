import { useEffect, useId, useRef, useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import type { ResolvedScope, rpcContract } from "../server.js";
import type { ScopeRef } from "@/lib/route";
import { Dialog } from "./ui/Dialog";
import { SearchableSelect } from "./ui/SearchableSelect";
import { Icon } from "./ui/icon";

type Machine = { id: string; name: string; isLocal: boolean; connected: boolean };

export function FolderPicker({ current, onSelect, onClose }: {
  current: ResolvedScope | null;
  onSelect: (scope: ScopeRef) => void;
  onClose: () => void;
}) {
  const rpc = useRpc<typeof rpcContract>();
  const [machines, setMachines] = useState<Machine[] | null>(null);
  const [hostId, setHostId] = useState<string | null>(current?.hostId ?? null);
  const [path, setPath] = useState(current?.ref.kind === "folder" ? current.root : "/");
  const [showPath, setShowPath] = useState(false);
  const [machineError, setMachineError] = useState<string | null>(null);
  const [pathError, setPathError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [opening, setOpening] = useState<"root" | "path" | null>(null);
  const busy = useRef(false);
  const mounted = useRef(true);
  const pathRef = useRef<HTMLInputElement>(null);
  const pathId = useId();
  const errorId = useId();
  const hintId = useId();
  const formId = useId();
  const disabled = opening !== null || machines === null || hostId === null;

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    if (showPath) {
      pathRef.current?.focus();
      pathRef.current?.select();
    }
  }, [showPath]);

  useEffect(() => {
    if (pathError !== null) pathRef.current?.focus();
  }, [pathError]);

  useEffect(() => {
    let cancelled = false;
    setMachines(null);
    setMachineError(null);
    void rpc.call("machines", null).then((result) => {
      if (cancelled) return;
      const connected = result.machines.filter((machine) => machine.connected);
      setMachines(connected);
      setHostId((previous) => connected.some((machine) => machine.id === previous)
        ? previous
        : result.defaultHostId ?? connected[0]?.id ?? null);
    }).catch((error: unknown) => {
      if (!cancelled) setMachineError(error instanceof Error ? error.message : "Could not load machines");
    });
    return () => { cancelled = true; };
  }, [attempt, rpc]);

  function openFolder(requestedPath: string, target: "root" | "path") {
    if (hostId === null || busy.current || machines === null) return;
    busy.current = true;
    setOpening(target);
    setPathError(null);
    void rpc.call("openFolder", { hostId, path: requestedPath }).then((result) => {
      if (mounted.current) onSelect(result.scope.ref);
    }).catch((error: unknown) => {
      if (!mounted.current) return;
      setPathError(error instanceof Error ? error.message : "Could not open this folder");
      setOpening(null);
      busy.current = false;
    });
  }

  return (
    <Dialog title="Open folder" onClose={onClose}>
      <div className="space-y-4 p-4">
        <div className="space-y-1.5">
          <span className="block text-xs font-medium">Machine</span>
          <SearchableSelect
            label="Machine"
            icon="Laptop"
            value={hostId}
            options={(machines ?? []).map((machine) => ({ value: machine.id, label: machine.name, description: machine.isLocal ? "This server" : "Connected machine" }))}
            onSelect={(next) => { setHostId(next); setPathError(null); }}
            disabled={opening !== null || machines === null || machines.length === 0}
            placeholder={machineError !== null ? "Machines unavailable" : machines === null ? "Loading machines…" : "No connected machines"}
          />
          {machineError !== null ? (
            <p role="alert" className="break-words text-xs text-destructive-text">
              {machineError}{" "}
              <button type="button" onClick={() => setAttempt((value) => value + 1)} className="rounded underline focus-visible:outline-none focus-visible:bg-state-hover">Retry</button>
            </p>
          ) : null}
        </div>
        <button
          type="button"
          aria-label="Browse filesystem"
          disabled={disabled}
          onClick={() => { setShowPath(false); openFolder("/", "root"); }}
          className="flex min-h-16 w-full items-center gap-3 rounded-md border border-border p-3 text-start hover:bg-state-hover focus-visible:outline-none focus-visible:bg-state-hover disabled:cursor-default disabled:opacity-50"
        >
          <Icon name={opening === "root" ? "Loading" : "FolderOpen"} aria-hidden className={`size-5 shrink-0 text-muted-foreground${opening === "root" ? " animate-spin motion-reduce:animate-none" : ""}`} />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium">{opening === "root" ? "Opening…" : "Browse filesystem"}</span>
            <span className="block text-xs text-muted-foreground">Start at the root folder</span>
          </span>
          <Icon name="ChevronRight" aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        </button>
        {!showPath && pathError !== null ? <p id={errorId} role="alert" className="break-words text-xs text-destructive-text">{pathError}</p> : null}
        <div className="border-t border-border pt-2">
          <button
            type="button"
            aria-expanded={showPath}
            aria-controls={formId}
            disabled={opening !== null}
            onClick={() => { setShowPath((value) => !value); setPathError(null); }}
            className="flex min-h-8 items-center gap-1.5 rounded-sm text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:bg-state-hover disabled:opacity-50"
          >
            <Icon name="ChevronRight" aria-hidden className={`size-3.5${showPath ? " rotate-90" : ""}`} />
            Open a specific folder
          </button>
          {showPath ? <form id={formId} onSubmit={(event) => { event.preventDefault(); openFolder(path, "path"); }} className="space-y-1.5 pt-2">
            <label htmlFor={pathId} className="block text-xs font-medium">Folder path</label>
            <input
              ref={pathRef}
              id={pathId}
              name="folderPath"
              required
              value={path}
              disabled={opening !== null}
              autoComplete="off"
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              aria-invalid={pathError !== null}
              aria-describedby={pathError === null ? hintId : `${hintId} ${errorId}`}
              onChange={(event) => { setPath(event.target.value); setPathError(null); }}
              className="min-h-9 w-full min-w-0 rounded-md border border-border bg-background px-2 py-1.5 font-mono text-base text-foreground focus-visible:outline-none focus-visible:border-muted-foreground sm:text-sm"
            />
            <p id={hintId} className="text-xs text-muted-foreground">Enter an absolute folder path, such as /etc.</p>
            {pathError !== null ? <p id={errorId} role="alert" className="break-words text-xs text-destructive-text">{pathError}</p> : null}
          </form> : null}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <button type="button" onClick={onClose} className="min-h-8 rounded-md border border-border px-3 py-1.5 text-xs hover:bg-state-hover focus-visible:outline-none focus-visible:bg-state-hover">Cancel</button>
          {showPath ? <button type="submit" form={formId} disabled={disabled} className="min-h-8 rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground hover:opacity-90 focus-visible:outline-none focus-visible:bg-primary/80 disabled:cursor-default disabled:opacity-50">{opening === "path" ? "Opening…" : "Open folder"}</button> : null}
        </div>
      </div>
    </Dialog>
  );
}
