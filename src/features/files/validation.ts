import { z } from "zod";

export const MAX_FILE_BYTES = 25 * 1024 * 1024;
export const COVER_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;
export const coverUploadSchema = z.object({
  pageId: z.uuid(),
  name: z
    .string()
    .trim()
    .min(1)
    .max(180)
    .refine((value) =>
      Array.from(value).every((character) => {
        const code = character.charCodeAt(0);
        return code >= 32 && code !== 127 && character !== "/" && character !== "\\";
      }),
    ),
  type: z.enum(COVER_TYPES),
  size: z.number().int().positive().max(MAX_FILE_BYTES),
});

export const blockUploadSchema = coverUploadSchema
  .omit({ type: true })
  .extend({
    kind: z.enum(["image", "file"]),
    type: z.string().max(255),
  })
  .transform((value) => ({ ...value, type: value.kind === "file" ? "application/octet-stream" : value.type }))
  .refine((value) => value.kind === "file" || COVER_TYPES.some((type) => type === value.type));

export function verifyImageBytes(
  bytes: Uint8Array,
  declaredType: string,
  declaredSize: number,
): (typeof COVER_TYPES)[number] {
  if (bytes.length === 0 || bytes.length > MAX_FILE_BYTES || bytes.length !== declaredSize) {
    throw new Error("O tamanho da imagem não corresponde ao arquivo enviado.");
  }
  const begins = (prefix: readonly number[], offset = 0) =>
    prefix.every((value, index) => bytes[index + offset] === value);
  let actual: (typeof COVER_TYPES)[number] | null = null;
  if (begins([137, 80, 78, 71, 13, 10, 26, 10])) actual = "image/png";
  else if (begins([255, 216, 255])) actual = "image/jpeg";
  else if (begins([71, 73, 70, 56, 55, 97]) || begins([71, 73, 70, 56, 57, 97])) actual = "image/gif";
  else if (begins([82, 73, 70, 70]) && begins([87, 69, 66, 80], 8)) actual = "image/webp";
  if (!actual || actual !== declaredType) throw new Error("Envie uma imagem PNG, JPEG, WebP ou GIF válida.");
  return actual;
}

export function fileDisposition(name: string, inline = true): string {
  const encoded = encodeURIComponent(name).replace(
    /['()*]/g,
    (value) => `%${value.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `${inline ? "inline; filename=cover" : "attachment; filename=download"}; filename*=UTF-8''${encoded}`;
}
