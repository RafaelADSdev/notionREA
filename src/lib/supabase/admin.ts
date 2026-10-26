import "server-only";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { getEnvironment } from "@/lib/env";
import type { Database } from "./database.types";

export function createAdminClient() {
  const secret = z.string().min(20).parse(process.env.SUPABASE_SECRET_KEY);
  return createClient<Database>(getEnvironment().NEXT_PUBLIC_SUPABASE_URL, secret, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
