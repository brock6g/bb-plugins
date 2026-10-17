import { useEffect, useId, useRef, useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import type { ResolvedScope, rpcContract } from "../server.js";
import type { ScopeRef } from "@/lib/route";
import { Dialog } from "./ui/Dialog";
import { SearchableSelect } from "./ui/SearchableSelect";

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
  const [machineError, setMachineError] = useState<string | null>(null);
  const [pathError, setPathError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [opening, setOpening] = useState(false);
  const busy = useRef(false);
  const mounted = useRef(true);
  const pathRef = useRef<HTMLInputElement>(null);
  const pathId = useId();
  const errorId = useId();
  const hintId = useId();

  useEffect(() => {
    mounted.current = true;
    pathRef.current?.focus();
    pathRef.current?.select();
    return () => { mounted.current = false; };
  }, []);

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

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (hostId === null || busy.current || machines === null) return;
    busy.current = true;
    setOpening(true);
    setPathError(null);
    void rpc.call("openFolder", { hostId, path }).then((result) => {
      if (mounted.current) onSelect(result.scope.ref);
    }).catch((error: unknown) => {
      if (!mounted.current) return;
      setPathError(error instanceof Error ? error.message : "Could not open this folder");
      setOpening(false);
      busy.current = false;
    });
  }

  return (
    <Dialog title="Open folder" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4 p-4">
        <div className="space-y-1.5">
          <span className="block text-xs font-medium">Machine</span>
          <SearchableSelect
            label="Machine"
            icon="Laptop"
            value={hostId}
            options={(machines ?? []).map((machine) => ({ value: machine.id, label: machine.name, description: machine.isLocal ? "This server" : "Connected machine" }))}
            onSelect={(next) => { setHostId(next); setPathError(null); }}
            disabled={opening || machines === null || machines.length === 0}
            placeholder={machineError !== null ? "Machines unavailable" : machines === null ? "Loading machines…" : "No connected machines"}
          />
          {machineError !== null ? (
            <p role="alert" className="break-words text-xs text-destructive-text">
              {machineError}{" "}
              <button type="button" onClick={() => setAttempt((value) => value + 1)} className="rounded underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">Retry</button>
            </p>
          ) : null}
        </div>
        <div className="space-y-1.5">
          <label htmlFor={pathId} className="block text-xs font-medium">Folder path</label>
          <input
            ref={pathRef}
            id={pathId}
            name="folderPath"
            required
            value={path}
            disabled={opening}
            autoComplete="off"
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            aria-invalid={pathError !== null}
            aria-describedby={pathError === null ? hintId : `${hintId} ${errorId}`}
            onChange={(event) => { setPath(event.target.value); setPathError(null); }}
            className="min-h-9 w-full min-w-0 rounded-md border border-border bg-background px-2 py-1.5 font-mono text-base text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring sm:text-sm"
          />
          <p id={hintId} className="text-xs text-muted-foreground">Enter an absolute path, such as /etc. Use / to browse the filesystem root.</p>
          {pathError !== null ? <p id={errorId} role="alert" className="break-words text-xs text-destructive-text">{pathError}</p> : null}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <button type="button" onClick={onClose} className="min-h-8 rounded-md border border-border px-3 py-1.5 text-xs hover:bg-state-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">Cancel</button>
          <button type="submit" disabled={opening || machines === null || hostId === null} className="min-h-8 rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground hover:opacity-90 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-default disabled:opacity-50">{opening ? "Opening…" : "Open folder"}</button>
        </div>
      </form>
    </Dialog>
  );
}
