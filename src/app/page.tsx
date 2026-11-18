import { redirect } from "next/navigation";
import { listWorkspaces, requireUser } from "@/lib/session";

export default async function Home() {
  await requireUser();
  const workspaces = await listWorkspaces();
  redirect(workspaces.length > 0 ? `/w/${workspaces[0].slug}` : "/workspaces/new");
}
