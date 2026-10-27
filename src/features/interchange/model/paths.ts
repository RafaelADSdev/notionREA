import { INTERCHANGE_LIMITS } from "./contracts";

const hasControl = (value: string) =>
  Array.from(value).some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);
const device = /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i;
export function archivePath(input: string, directory = false): string {
  if (!input || input.length > 1000 || /[\\:]/.test(input) || hasControl(input) || input.startsWith("/"))
    throw new Error("Unsafe archive path");
  let path = input.normalize("NFC");
  if (directory && path.endsWith("/")) path = path.slice(0, -1);
  const parts = path.split("/");
  for (const part of parts) {
    const canonical = part.normalize("NFKC");
    if (
      !part ||
      canonical === "." ||
      canonical === ".." ||
      /[\\/:]/.test(canonical) ||
      /[. ]$/.test(part) ||
      device.test(canonical)
    )
      throw new Error("Unsafe archive path");
    let decoded: string;
    try {
      decoded = decodeURIComponent(part);
    } catch {
      decoded = part;
    }
    if ([".", ".."].includes(decoded) || /[\\/:]/.test(decoded) || hasControl(decoded))
      throw new Error("Unsafe archive path");
  }
  return path;
}
export class ArchivePaths {
  private readonly paths = new Map<string, boolean>();
  add(input: string, directory: boolean): string {
    if (this.paths.size >= INTERCHANGE_LIMITS.entries) throw new Error("Archive entry limit exceeded");
    const path = archivePath(input, directory);
    const key = path.normalize("NFKC").toUpperCase();
    if (this.paths.has(key)) throw new Error("Colliding archive paths");
    const parts = key.split("/");
    for (let index = 1; index < parts.length; index++)
      if (this.paths.get(parts.slice(0, index).join("/")) === false)
        throw new Error("File and directory collision");
    if (!directory && [...this.paths.keys()].some((other) => other.startsWith(`${key}/`)))
      throw new Error("File and directory collision");
    this.paths.set(key, directory);
    return path;
  }
}
export function safeExportName(title: string, id: string, extension: string): string {
  let stem =
    title
      .normalize("NFKC")
      .replace(/[<>:"/\\|?*\u202a-\u202e\u2066-\u2069]/g, "_")
      .split("")
      .map((character) => (hasControl(character) ? "_" : character))
      .join("")
      .replace(/[. ]+$/, "")
      .slice(0, 100) || "Sem título";
  if (device.test(stem)) stem = `_${stem}`;
  return `${stem}--${id}.${extension}`;
}
export function resolveArchiveLink(from: string, href: string): string | null {
  if (/^[a-z][a-z\d+.-]*:/i.test(href) || href.startsWith("//")) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(href.split(/[?#]/, 1)[0] ?? "");
  } catch {
    return null;
  }
  const parts = from.split("/").slice(0, -1);
  for (const part of decoded.split("/")) {
    if (part === "." || !part) continue;
    if (part === "..") {
      if (!parts.length) return null;
      parts.pop();
    } else parts.push(part);
  }
  try {
    return archivePath(parts.join("/"));
  } catch {
    return null;
  }
}
