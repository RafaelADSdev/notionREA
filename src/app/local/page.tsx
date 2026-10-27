import { redirect } from "next/navigation";
import { isLocalMode } from "@/lib/setup-mode";
import { LocalWorkspace } from "@/features/local/workspace";

export default function LocalPage() {
  if (!isLocalMode()) redirect("/");
  return <LocalWorkspace />;
}
