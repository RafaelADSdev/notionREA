import { z } from "zod";

const environmentSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(20),
  APP_URL: z.url(),
  GOOGLE_AUTH_ENABLED: z.enum(["true", "false"]).default("false"),
});

export function getEnvironment() {
  const environment = environmentSchema.parse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    APP_URL: process.env.APP_URL,
    GOOGLE_AUTH_ENABLED: process.env.GOOGLE_AUTH_ENABLED,
  });
  const key = environment.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (key.startsWith("sb_secret_")) throw new Error("A privileged key cannot be public");
  if (key.startsWith("eyJ")) {
    const payload = key.split(".")[1];
    if (!payload || JSON.parse(Buffer.from(payload, "base64url").toString()).role !== "anon") {
      throw new Error("Only the anonymous legacy key may be public");
    }
  }
  for (const value of [environment.APP_URL, environment.NEXT_PUBLIC_SUPABASE_URL]) {
    const url = new URL(value);
    if (
      url.protocol !== "https:" &&
      !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))
    ) {
      throw new Error("HTTPS is required outside local development");
    }
  }
  return environment;
}
