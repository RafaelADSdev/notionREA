import { redirect } from "next/navigation";
import { createClient, currentUser } from "@/lib/supabase/server";

export default async function HomePage() {
  if (!(await currentUser())) redirect("/login");
  const client = await createClient();
  const { data, error } = await client
    .from("workspaces")
    .select("id")
    .order("created_at")
    .order("id")
    .limit(1);
  if (error) throw new Error("Não foi possível carregar seus workspaces.");
  redirect(data[0] ? `/w/${data[0].id}` : "/workspaces/new");
}
