import type { ScopeRef } from "./route.js";

export interface FolderLocation {
  hostId: string;
  root: string;
}

/** Folder references stay one URL segment, including Unicode and Windows paths. */
export function encodeFolderScope(hostId: string, root: string): ScopeRef {
  if (!validLocation(hostId, root)) throw new Error("Invalid folder location.");
  const bytes = new TextEncoder().encode(JSON.stringify([hostId, root]));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const id = btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  if (id.length > 65_536) throw new Error("Folder location is too long.");
  return { kind: "folder", id };
}

export function decodeFolderScope(id: string): FolderLocation | null {
  if (id.length === 0 || id.length > 65_536 || !/^[A-Za-z0-9_-]+$/.test(id)) return null;
  try {
    const binary = atob(id.replace(/-/g, "+").replace(/_/g, "/"));
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (!Array.isArray(value) || value.length !== 2) return null;
    const [hostId, root] = value;
    if (typeof hostId !== "string" || typeof root !== "string" || !validLocation(hostId, root)) return null;
    // Reject alternate encodings and trailing base64 bits at the route boundary.
    if (encodeFolderScope(hostId, root).id !== id) return null;
    return { hostId, root };
  } catch {
    return null;
  }
}

function validLocation(hostId: string, root: string): boolean {
  return hostId.length > 0 && !hostId.includes("\0") && !root.includes("\0") && (
    root.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(root) || /^\\\\[^\\]+\\[^\\]+/.test(root)
  );
}
