import { LogOutIcon } from "lucide-react";
import { signOut } from "@/actions/auth";
import { NavLinks } from "@/components/layout/nav-links";
import { WorkspaceSwitcher } from "@/components/workspace/workspace-switcher";
import { listWorkspaces, requireUser, requireWorkspace } from "@/lib/session";

export default async function WorkspaceLayout({ children, params }: LayoutProps<"/w/[slug]">) {
  const { slug } = await params;
  const user = await requireUser();
  const [{ workspace }, workspaces] = await Promise.all([requireWorkspace(slug), listWorkspaces()]);

  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      <aside className="hidden w-64 shrink-0 flex-col border-r bg-sidebar p-3 md:flex">
        <WorkspaceSwitcher workspaces={workspaces} currentSlug={workspace.slug} />
        <div className="mt-6 flex-1">
          <NavLinks slug={workspace.slug} orientation="vertical" />
        </div>
        <form action={signOut} className="flex items-center gap-2 border-t pt-3">
          <span className="min-w-0 flex-1 truncate px-2 text-xs text-muted-foreground">{user.email}</span>
          <button
            type="submit"
            aria-label="Esci"
            title="Esci"
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
          >
            <LogOutIcon className="size-4" strokeWidth={1.75} />
          </button>
        </form>
      </aside>

      <header className="sticky top-0 z-30 space-y-2 border-b bg-sidebar/95 p-3 backdrop-blur md:hidden">
        <WorkspaceSwitcher workspaces={workspaces} currentSlug={workspace.slug} />
        <NavLinks slug={workspace.slug} orientation="horizontal" />
      </header>

      <main className="min-w-0 flex-1">
        <div className="mx-auto w-full max-w-5xl px-5 py-10 md:px-12 md:py-16">{children}</div>
      </main>
    </div>
  );
}
