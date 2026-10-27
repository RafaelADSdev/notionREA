import { createTranslator, DEFAULT_LOCALE, type Translator } from "@/lib/i18n/core";
import type { PreparedFileUpload } from "./actions";
import { MAX_FILE_BYTES } from "./validation";

export async function uploadPreparedFile(
  prepared: PreparedFileUpload,
  file: File,
  signal?: AbortSignal,
  t: Translator = createTranslator(DEFAULT_LOCALE),
): Promise<void> {
  if (file.size < 1 || file.size > MAX_FILE_BYTES) throw new Error(t("files.imageTooLarge"));
  const body = new FormData();
  body.append("cacheControl", "0");
  body.append("", file);
  const response = await fetch(prepared.signedUrl, {
    method: "PUT",
    headers: { "x-upsert": "false" },
    body,
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) throw new Error(t("files.uploadConnectionFailure"));
}
