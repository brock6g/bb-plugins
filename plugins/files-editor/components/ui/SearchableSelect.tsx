import { useEffect, useId, useRef, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { Icon, type IconName } from "@/components/ui/icon";
import { cn } from "@/lib/utils";

export interface SearchableSelectOption {
  value: string;
  label: string;
  description?: string;
}

export interface SearchableSelectProps {
  label: string;
  value: string | null;
  options: readonly SearchableSelectOption[];
  onSelect: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  icon?: IconName;
}

/** Searchable, viewport-contained picker using BB's shared overlay runtime. */
export function SearchableSelect({
  label,
  value,
  options,
  onSelect,
  disabled = false,
  placeholder = "Choose an option…",
  icon,
}: SearchableSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeValue, setActiveValue] = useState<string | null>(value);
  const [portalContainer, setPortalContainer] = useState<HTMLElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const tabbing = useRef(false);
  const id = useId();
  const listId = `${id}-options`;
  const selected = options.find((option) => option.value === value);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filtered = options.filter((option) =>
    `${option.label} ${option.description ?? ""}`.toLocaleLowerCase().includes(normalizedQuery),
  );
  const activeIndex = Math.max(0, filtered.findIndex((option) => option.value === activeValue));
  const activeOptionId = filtered[activeIndex] === undefined ? undefined : `${id}-option-${activeIndex}`;

  useEffect(() => {
    if (open && activeOptionId !== undefined) {
      document.getElementById(activeOptionId)?.scrollIntoView({ block: "nearest" });
    }
  }, [activeOptionId, activeValue, normalizedQuery, open]);

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  function changeOpen(next: boolean) {
    if (next && disabled) return;
    if (next) {
      setPortalContainer(triggerRef.current?.closest("dialog") ?? null);
      setQuery("");
      setActiveValue(value);
      tabbing.current = false;
    }
    setOpen(next);
  }

  function select(next: string) {
    setOpen(false);
    onSelect(next);
  }

  return (
    <Popover.Root open={open} onOpenChange={changeOpen}>
      <Popover.Trigger asChild>
        <button
          ref={triggerRef}
          type="button"
          aria-label={label}
          aria-describedby={`${id}-value`}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          disabled={disabled}
          title={selected?.label ?? placeholder}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              changeOpen(true);
              if (event.key === "ArrowUp" && value === null) setActiveValue(options.at(-1)?.value ?? null);
            }
          }}
          className={cn(
            "flex min-h-7 w-full min-w-0 items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1 text-start text-xs text-foreground",
            "hover:bg-state-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            "disabled:cursor-default disabled:text-muted-foreground",
          )}
        >
          {icon ? <Icon name={icon} aria-hidden className="size-3.5 shrink-0 text-muted-foreground" /> : null}
          <span id={`${id}-value`} className="min-w-0 flex-1 truncate">{selected?.label ?? placeholder}</span>
          <Icon name="ChevronDown" aria-hidden className="size-3 shrink-0 text-muted-foreground" />
        </button>
      </Popover.Trigger>
      <Popover.Portal container={portalContainer}>
        <Popover.Content
          align="start"
          side="bottom"
          sideOffset={4}
          collisionPadding={8}
          sticky="always"
          aria-label={`${label} options`}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            inputRef.current?.focus();
          }}
          onCloseAutoFocus={(event) => {
            if (tabbing.current) event.preventDefault();
          }}
          onEscapeKeyDown={(event) => event.stopPropagation()}
          className="z-50 flex min-h-0 flex-col overflow-hidden rounded-md border border-border bg-popover text-popover-foreground shadow-md"
          style={{
            width: "max(var(--radix-popover-trigger-width), 16rem)",
            maxWidth: "min(24rem, calc(100dvw - 16px), var(--radix-popover-content-available-width))",
            maxHeight: "min(20rem, var(--radix-popover-content-available-height))",
          }}
        >
          <div className="flex shrink-0 items-center gap-2 border-b border-border px-2">
            <Icon name="Search" aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
            <input
              ref={inputRef}
              type="text"
              role="combobox"
              aria-label={`Search ${label.toLocaleLowerCase()}`}
              aria-autocomplete="list"
              aria-expanded={open}
              aria-controls={listId}
              aria-activedescendant={activeOptionId}
              autoComplete="off"
              spellCheck={false}
              value={query}
              placeholder={`Search ${label.toLocaleLowerCase()}…`}
              onChange={(event) => {
                setQuery(event.target.value);
                setActiveValue(null);
              }}
              onKeyDown={(event) => {
                if (event.nativeEvent.isComposing) return;
                if (event.key === "Tab") {
                  tabbing.current = true;
                  triggerRef.current?.focus();
                  setOpen(false);
                  return;
                }
                if (event.key === "Enter") {
                  event.preventDefault();
                  const option = filtered[activeIndex];
                  if (option !== undefined) select(option.value);
                  return;
                }
                if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
                event.preventDefault();
                const nextIndex = event.key === "Home" ? 0
                  : event.key === "End" ? filtered.length - 1
                  : (activeIndex + (event.key === "ArrowDown" ? 1 : -1) + filtered.length) % filtered.length;
                setActiveValue(filtered[nextIndex]?.value ?? null);
              }}
              className="min-h-10 w-full min-w-0 rounded-sm bg-transparent text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring [@media(pointer:coarse)]:text-base"
            />
          </div>
          <div id={listId} role="listbox" aria-label={label} className="min-h-0 overflow-y-auto overscroll-contain p-1">
            {filtered.map((option, index) => (
              <div
                key={option.value}
                id={`${id}-option-${index}`}
                role="option"
                aria-selected={option.value === value}
                onPointerMove={() => setActiveValue(option.value)}
                onPointerDown={(event) => {
                  if (event.pointerType === "mouse") event.preventDefault();
                }}
                onClick={() => select(option.value)}
                title={option.description ? `${option.label}\n${option.description}` : option.label}
                className={cn(
                  "flex min-h-8 cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-xs",
                  index === activeIndex && "bg-state-hover text-foreground",
                )}
              >
                <div className="min-w-0 flex-1">
                  <div className="break-words [overflow-wrap:anywhere]">{option.label}</div>
                  {option.description ? <div className="break-words text-muted-foreground [overflow-wrap:anywhere]">{option.description}</div> : null}
                </div>
                {option.value === value ? <Icon name="Check" aria-hidden className="size-3.5 shrink-0" /> : null}
              </div>
            ))}
            {filtered.length === 0 ? (
              <div role="status" className="px-2 py-3 text-xs text-muted-foreground">
                {query === "" ? "No options available" : "No matches"}
              </div>
            ) : null}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
