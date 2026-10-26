import { notFound, redirect } from "next/navigation";
import { WorkspaceShell } from "@/features/workspaces/shell";
import { createClient, currentUser } from "@/lib/supabase/server";
import { uuidSchema } from "@/features/auth/validation";

export default async function WorkspaceLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ workspaceId: string }>;
}) {
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
  if (current.error || memberships.error || list.error)
    throw new Error("Não foi possível abrir o workspace.");
  const workspaces = list.data.some((item) => item.id === id) ? list.data : [current.data, ...list.data];
  return (
    <WorkspaceShell
      workspace={current.data}
      workspaces={workspaces}
      email={user.email ?? "Sua conta"}
      isOwner={memberships.data.role === "owner"}
    >
      {children}
    </WorkspaceShell>
  );
}
