export function isLocalPreviewEnabled(environment: { APP_URL: string; NEXT_PUBLIC_SUPABASE_URL: string }) {
  if (process.env.LOCAL_PREVIEW_ENABLED !== "true") return false;
  const app = new URL(environment.APP_URL);
  const backend = new URL(environment.NEXT_PUBLIC_SUPABASE_URL);
  return (
    [app, backend].every(
      (url) => url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname),
    ) &&
    app.port === "3000" &&
    backend.port === "54321"
  );
}
