"use server";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { getEnvironment } from "@/lib/env";
import { LOCALE_COOKIE, type Locale } from "./core";
export async function setLocale(locale: Locale): Promise<void> {
  if (locale !== "pt-BR" && locale !== "en") throw new Error("Invalid locale");
  (await cookies()).set(LOCALE_COOKIE, locale, {
    httpOnly: true,
    sameSite: "lax",
    secure: new URL(getEnvironment().APP_URL).protocol === "https:",
    path: "/",
    maxAge: 31_536_000,
  });
  revalidatePath("/", "layout");
}
