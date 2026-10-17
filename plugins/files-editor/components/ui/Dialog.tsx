import { useEffect, useId, useRef, type ReactNode } from "react";
import { Icon } from "./icon";

/** A native modal keeps background controls inert and restores trigger focus. */
export function Dialog({ title, onClose, children }: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const previous = document.activeElement;
    const dialog = ref.current;
    dialog?.showModal();
    return () => {
      dialog?.close();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      onKeyDown={(event) => event.stopPropagation()}
      onPointerDown={(event) => {
        if (event.target !== event.currentTarget) return;
        const rect = event.currentTarget.getBoundingClientRect();
        if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose();
      }}
      className="m-auto max-h-[calc(100dvh-2rem)] w-[min(28rem,calc(100vw-2rem))] overflow-y-auto overscroll-contain rounded-lg border border-border bg-popover p-0 text-popover-foreground shadow-lg backdrop:bg-surface-scrim"
    >
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <h2 id={titleId} className="text-sm font-medium">{title}</h2>
        <button type="button" aria-label={`Close ${title.toLowerCase()}`} onClick={onClose} className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-state-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
          <Icon name="X" aria-hidden className="size-4" />
        </button>
      </div>
      {children}
    </dialog>
  );
}
