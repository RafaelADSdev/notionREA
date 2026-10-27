import { redirect } from "next/navigation";
import { getTranslations } from "@/lib/i18n/server";
import { createClient, currentUser } from "@/lib/supabase/server";

export default async function HomePage() {
  const t = await getTranslations();

  if (!(await currentUser())) redirect("/login");
  const client = await createClient();
  const { data, error } = await client
    .from("workspaces")
    .select("id")
    .order("created_at")
    .order("id")
    .limit(1);
  if (error) throw new Error(t("workspaces.loadYourFailed"));
  redirect(data[0] ? `/w/${data[0].id}` : "/workspaces/new");
}
