import { notFound, redirect } from "next/navigation";
import { uuidSchema } from "@/features/auth/validation";
import { WorkspaceShell } from "@/features/workspaces/shell";
import { getTranslations } from "@/lib/i18n/server";
import { createClient, currentUser } from "@/lib/supabase/server";

export default async function WorkspaceLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ workspaceId: string }>;
}) {
  const t = await getTranslations();

  const user = await currentUser();
  if (!user) redirect("/login");
  const id = (await params).workspaceId;
  if (!uuidSchema.safeParse(id).success) notFound();
  const client = await createClient();
  const [current, memberships, list] = await Promise.all([
    client.from("workspaces").select("id,name").eq("id", id).maybeSingle(),
    client
      .from("workspace_members")
      .select("role")
      .eq("workspace_id", id)
      .eq("user_id", user.id)
      .maybeSingle(),
    client.from("workspaces").select("id,name").order("id").limit(50),
  ]);
  if (!current.data || !memberships.data) notFound();
  if (current.error || memberships.error || list.error) throw new Error(t("workspaces.openFailed"));
  const workspaces = list.data.some((item) => item.id === id) ? list.data : [current.data, ...list.data];
  return (
    <WorkspaceShell
      workspace={current.data}
      workspaces={workspaces}
      email={user.email ?? t("workspaces.yourAccount")}
      userId={user.id}
      isOwner={memberships.data.role === "owner"}
    >
      {children}
    </WorkspaceShell>
  );
}
