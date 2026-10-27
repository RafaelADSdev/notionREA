import "server-only";
import { cookies } from "next/headers";
import { createTranslator, LOCALE_COOKIE, resolveLocale } from "./core";
export async function getLocale() {
  return resolveLocale((await cookies()).get(LOCALE_COOKIE)?.value);
}
export async function getTranslations() {
  return createTranslator(await getLocale());
}
