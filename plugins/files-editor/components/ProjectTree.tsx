import { useEffect, useMemo, useRef, type CSSProperties } from "react";
import { experimental_useCodeTheme } from "@get-bb/plugin-sdk/app";
import { themeToTreeStyles } from "@pierre/trees";
import { FileTree, useFileTree } from "@pierre/trees/react";
import type { FlatEntry } from "@/lib/tree";
import {
  pathsForPierreTree,
  resetTreePaths,
  revealTreePath,
} from "@/lib/pierre-tree";

interface ProjectTreeProps {
  entries: readonly FlatEntry[];
  activePath: string | null;
  onOpenFile: (path: string) => void;
}

export function ProjectTree({
  entries,
  activePath,
  onOpenFile,
}: ProjectTreeProps) {
  const { theme, mode } = experimental_useCodeTheme();
  const paths = useMemo(() => pathsForPierreTree(entries), [entries]);
  const previousPaths = useRef(paths);
  const syncing = useRef(false);
  const onOpenFileRef = useRef(onOpenFile);
  onOpenFileRef.current = onOpenFile;

  const { model } = useFileTree({
    paths,
    initialExpansion: "closed",
    flattenEmptyDirectories: false,
    density: "compact",
    stickyFolders: false,
    search: false,
    unsafeCSS: `
      *, *::before, *::after { transition: none !important; }
    `,
    onSelectionChange: (selected) => {
      // Programmatic tab reveals and multiple selection must not open files.
      if (syncing.current || selected.length !== 1) return;
      const path = selected[0]!;
      if (model.getItem(path)?.isDirectory() === false)
        onOpenFileRef.current(path);
    },
  });

  useEffect(() => {
    syncing.current = true;
    try {
      if (previousPaths.current !== paths) {
        resetTreePaths(model, paths, previousPaths.current);
        previousPaths.current = paths;
      }
      revealTreePath(model, activePath);
      model
        .getFileTreeContainer()
        ?.shadowRoot?.querySelector('[role="tree"]')
        ?.setAttribute("aria-label", "Workspace files");
    } finally {
      syncing.current = false;
    }
  }, [activePath, model, paths]);

  const style: CSSProperties = {
    ...(theme === null
      ? {}
      : themeToTreeStyles({ ...theme, colors: { ...theme.colors } })),
    colorScheme: mode,
    height: "100%",
    minHeight: 0,
    backgroundColor: "transparent",
    color: "var(--foreground)",
    "--trees-bg-override": "var(--surface-recessed)",
    "--trees-bg-muted-override": "var(--state-hover)",
    "--trees-fg-override": "var(--foreground)",
    "--trees-fg-muted-override": "var(--muted-foreground)",
    "--trees-selected-bg-override": "var(--surface-selected)",
    "--trees-selected-fg-override": "var(--foreground)",
    "--trees-focus-ring-color-override": "var(--ring)",
    "--trees-selected-focused-border-color-override": "var(--ring)",
    "--trees-border-color-override": "var(--border)",
    "--trees-font-family-override": "var(--font-sans)",
    "--trees-padding-inline-override": "0px",
    "--trees-item-margin-x-override": "0px",
    "--trees-item-padding-x-override": "8px",
    "--trees-level-gap-override": "10px",
    "--trees-border-radius-override": "0px",
  } as CSSProperties;

  return <FileTree model={model} style={style} />;
}
