import type { CSSProperties } from "react";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import {
  ArrowDown01Icon,
  ArrowReloadHorizontalIcon,
  ArrowRight01Icon,
  Cancel01Icon,
  File01Icon,
  FileEmpty02Icon,
  Folder02Icon,
  FolderIcon,
  GitBranchIcon,
  LaptopIcon,
  LinkSquare02Icon,
  Loading03Icon,
  Search01Icon,
  SidebarLeftIcon,
  SourceCodeIcon,
  Tick02Icon,
  ViewIcon,
  ViewOffIcon,
} from "@hugeicons/core-free-icons";
import { cn } from "../../lib/utils";

const ICON_MAP = {
  ArrowReloadHorizontal: ArrowReloadHorizontalIcon,
  Check: Tick02Icon,
  ChevronDown: ArrowDown01Icon,
  ChevronRight: ArrowRight01Icon,
  Code: SourceCodeIcon,
  ExternalLink: LinkSquare02Icon,
  Eye: ViewIcon,
  EyeOff: ViewOffIcon,
  File: FileEmpty02Icon,
  FileText: File01Icon,
  Folder: FolderIcon,
  FolderOpen: Folder02Icon,
  GitBranch: GitBranchIcon,
  Laptop: LaptopIcon,
  Loading: Loading03Icon,
  PanelLeft: SidebarLeftIcon,
  Search: Search01Icon,
  X: Cancel01Icon,
} as const satisfies Record<string, IconSvgElement>;

export type IconName = keyof typeof ICON_MAP;

export interface IconProps {
  name: IconName;
  className?: string;
  style?: CSSProperties;
  "aria-hidden"?: boolean | "true" | "false";
  "aria-label"?: string;
}

export function Icon({
  name,
  className,
  style,
  "aria-hidden": ariaHidden,
  "aria-label": ariaLabel,
}: IconProps) {
  return (
    <HugeiconsIcon
      icon={ICON_MAP[name]}
      className={cn(className)}
      style={style}
      aria-hidden={ariaHidden}
      aria-label={ariaLabel}
      data-icon={name}
    />
  );
}
