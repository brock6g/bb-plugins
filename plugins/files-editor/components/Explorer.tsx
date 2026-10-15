import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import type { FlatEntry } from "@/lib/tree";
import type { ScopeRef } from "@/lib/route";
import { ProjectTree } from "./ProjectTree";
import { SearchResults } from "./SearchResults";

export interface ExplorerProps {
  entries: readonly FlatEntry[];
  activePath: string | null;
  isLoading: boolean;
  error: string | null;
  truncated: boolean;
  /** BB's remote listing cannot return dotfiles, so the toggle is disabled. */
  hiddenSupported: boolean;
  includeHidden: boolean;
  onToggleHidden: (next: boolean) => void;
  onOpenFile: (path: string) => void;
  /** A hit from the text search: open the file on that line. */
  onOpenMatch: (path: string, line: number) => void;
  onRefresh: () => void;
  onQuickOpen: () => void;
  /** The workspace the text search runs in; null while none is resolved. */
  scope: ScopeRef | null;
  /** Bumped by ⌘⇧F: focus the search field and select what is in it. */
  searchFocusRequest: number;
  header: React.ReactNode;
}

export function Explorer({
  entries,
  activePath,
  isLoading,
  error,
  truncated,
  hiddenSupported,
  includeHidden,
  onToggleHidden,
  onOpenFile,
  onOpenMatch,
  onRefresh,
  onQuickOpen,
  scope,
  searchFocusRequest,
  header,
}: ExplorerProps) {
  // The field searches file CONTENTS across the workspace. Finding a file by
  // its name is the magnifier button (⌘P) beside it.
  const [query, setQuery] = useState("");
  const [matchCase, setMatchCase] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [regex, setRegex] = useState(false);
  const [submitNonce, setSubmitNonce] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const isSearching = query !== "" && scope !== null;

  useEffect(() => {
    if (searchFocusRequest === 0) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [searchFocusRequest]);

  const fileCount = useMemo(
    () => entries.reduce((total, entry) => total + (entry.kind === "file" ? 1 : 0), 0),
    [entries],
  );

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-surface-recessed">
      {header}

      <div className="flex shrink-0 items-center gap-1.5 px-2 pb-2">
        <div className="relative min-w-0 flex-1">
          <Icon
            name="Search"
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground"
          />
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape" && query !== "") {
                event.stopPropagation();
                setQuery("");
                return;
              }
              if (event.key === "Enter") {
                event.preventDefault();
                setSubmitNonce((current) => current + 1);
                return;
              }
              // VS Code's own bindings for the three toggles.
              if (event.altKey && !event.metaKey && !event.ctrlKey) {
                const key = event.code;
                if (key === "KeyC") setMatchCase((value) => !value);
                else if (key === "KeyW") setWholeWord((value) => !value);
                else if (key === "KeyR") setRegex((value) => !value);
                else return;
                event.preventDefault();
              }
            }}
            placeholder="Search in files"
            aria-label="Search in files"
            title="Search the text of every file (⌘⇧F)"
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            className={cn(
              "h-7 w-full min-w-0 rounded-md border border-border bg-background pr-[4.5rem] pl-7 text-sm",
              "text-foreground placeholder:text-muted-foreground",
              "focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none",
              "[&::-webkit-search-cancel-button]:hidden",
            )}
          />
          <div className="absolute top-1/2 right-1 flex -translate-y-1/2 items-center gap-px">
            <SearchToggle
              label="Match case (⌥C). Off: smart case — exact only when the query has a capital"
              glyph="Aa"
              isOn={matchCase}
              onToggle={() => setMatchCase((value) => !value)}
            />
            <SearchToggle
              label="Match whole word (⌥W)"
              glyph="ab"
              underline
              isOn={wholeWord}
              onToggle={() => setWholeWord((value) => !value)}
            />
            <SearchToggle
              label="Use regular expression (⌥R)"
              glyph=".*"
              isOn={regex}
              onToggle={() => setRegex((value) => !value)}
            />
          </div>
        </div>
        <ExplorerAction
          icon="Search"
          label="Go to file by name (⌘P)"
          onClick={onQuickOpen}
        />
        {hiddenSupported ? (
          <ExplorerAction
            icon={includeHidden ? "Eye" : "EyeOff"}
            label={includeHidden ? "Hide dotfiles" : "Show dotfiles"}
            isActive={includeHidden}
            onClick={() => onToggleHidden(!includeHidden)}
          />
        ) : null}
        <ExplorerAction
          icon="ArrowReloadHorizontal"
          label="Refresh files"
          isSpinning={isLoading}
          onClick={onRefresh}
        />
      </div>

      {isSearching ? (
        <SearchResults
          scope={scope}
          query={query}
          matchCase={matchCase}
          wholeWord={wholeWord}
          regex={regex}
          includeHidden={hiddenSupported && includeHidden}
          submitNonce={submitNonce}
          activePath={activePath}
          onOpenMatch={onOpenMatch}
        />
      ) : null}
      <div className={cn("min-h-0 flex-1 pb-2", isSearching && "hidden")}>
        {error !== null ? (
          <p className="px-3 py-2 text-xs text-destructive">{error}</p>
        ) : isLoading && entries.length === 0 ? (
          <p className="px-3 py-2 text-xs text-muted-foreground">Reading the workspace…</p>
        ) : entries.length === 0 ? (
          <p className="px-3 py-2 text-xs text-muted-foreground">
            This workspace has no files yet.
          </p>
        ) : (
          <ProjectTree
            key={scope === null ? "" : `${scope.kind}:${scope.id}`}
            entries={entries}
            activePath={activePath}
            onOpenFile={onOpenFile}
          />
        )}
      </div>

      <div className="shrink-0 border-t border-border px-3 py-1.5 text-[11px] text-muted-foreground">
        {`${fileCount.toLocaleString()} files`}
        {truncated ? " · listing truncated" : ""}
      </div>
    </div>
  );
}

function SearchToggle({
  label,
  glyph,
  underline,
  isOn,
  onToggle,
}: {
  label: string;
  glyph: string;
  underline?: boolean;
  isOn: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={isOn}
      aria-label={label}
      title={label}
      className={cn(
        "flex h-5 w-[1.35rem] cursor-pointer items-center justify-center rounded font-mono text-[10.5px] leading-none",
        "focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none",
        isOn
          ? "bg-primary/20 text-foreground ring-1 ring-primary/50"
          : "text-muted-foreground hover:bg-state-hover hover:text-foreground",
      )}
    >
      <span className={underline === true ? "underline underline-offset-2" : undefined}>
        {glyph}
      </span>
    </button>
  );
}

function ExplorerAction({
  icon,
  label,
  onClick,
  isActive,
  isSpinning,
}: {
  icon: React.ComponentProps<typeof Icon>["name"];
  label: string;
  onClick: () => void;
  isActive?: boolean;
  isSpinning?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={cn(
        "flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md",
        "text-muted-foreground transition-colors hover:bg-state-hover hover:text-foreground",
        "focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none",
        isActive === true && "text-foreground",
      )}
    >
      <Icon
        name={icon}
        aria-hidden
        className={cn("size-3.5", isSpinning === true && "animate-spin")}
      />
    </button>
  );
}
