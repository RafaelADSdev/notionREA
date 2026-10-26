import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { cache } from "react";
import { getEnvironment } from "@/lib/env";
import type { Database } from "./database.types";

export async function createClient(writable = false) {
  const environment = getEnvironment();
  const cookieStore = await cookies();
  return createServerClient<Database>(
    environment.NEXT_PUBLIC_SUPABASE_URL,
    environment.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookieOptions: {
        httpOnly: true,
        sameSite: "lax",
        secure: new URL(environment.APP_URL).protocol === "https:",
      },
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (items) => {
          if (writable) {
            for (const { name, value, options } of items)
              cookieStore.set(name, value, { ...options, httpOnly: true });
          }
          // Server Components read the session already refreshed by proxy.ts.
        },
      },
    },
  );
}

export const currentUser = cache(async () => {
  const client = await createClient();
  const {
    data: { user },
  } = await client.auth.getUser();
  return user;
});
