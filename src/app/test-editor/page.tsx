import { notFound } from "next/navigation";
import { CollaborationLab } from "@/features/editor/testing/collaboration-lab";
import { getEnvironment } from "@/lib/env";
import seed from "@/features/editor/testing/seed.json";

export default async function EditorLab({ searchParams }: { searchParams: Promise<{ session?: string }> }) {
  const local = new URL(getEnvironment().APP_URL);
  if (
    process.env.ENABLE_COLLABORATION_SPIKE !== "true" ||
    !["localhost", "127.0.0.1"].includes(local.hostname)
  )
    notFound();
  const { session } = await searchParams;
  if (!session || !/^[a-f0-9-]{36}$/.test(session)) notFound();
  return <CollaborationLab seed={seed} session={session} />;
}
