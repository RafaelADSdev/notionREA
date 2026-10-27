import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";

type NullableArguments = {
  create_database: "p_parent_page_id";
  put_database_property: "p_id";
  put_database_view: "p_id";
  put_database_template: "p_id";
  move_database_record: "p_before_id";
};
type Functions = Database["public"]["Functions"];
type DatabaseRpcSchema = Omit<Database, "public"> & {
  public: Omit<Database["public"], "Functions"> & {
    Functions: {
      [Name in keyof Functions]: Name extends keyof NullableArguments
        ? Omit<Functions[Name], "Args"> & {
            Args: {
              [Argument in keyof Functions[Name]["Args"]]: Argument extends NullableArguments[Name]
                ? Functions[Name]["Args"][Argument] | null
                : Functions[Name]["Args"][Argument];
            };
          }
        : Functions[Name];
    };
  };
};
export async function databaseClient() {
  // PostgreSQL function parameters accept NULL, but pg-meta emits required UUID
  // parameters as plain strings. Correct only these documented RPC arguments;
  // the same authenticated client and strict runtime input validation remain in use.
  return (await createClient()) as SupabaseClient<DatabaseRpcSchema>;
}
