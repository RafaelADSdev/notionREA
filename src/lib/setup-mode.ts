import "server-only";

/** An unconfigured hosted installation must not attempt to use a local database. */
export function isSetupMode(environment: Readonly<Record<string, string | undefined>> = process.env): boolean {
  if (environment.BLOCO_SETUP_MODE === "true") return true;
  return (
    environment.VERCEL === "1" &&
    ![
      environment.NEXT_PUBLIC_SUPABASE_URL,
      environment.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
      environment.SUPABASE_SECRET_KEY,
      environment.APP_URL,
    ].every(Boolean)
  );
}
