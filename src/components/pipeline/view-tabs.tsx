import Link from "next/link";
import { cn } from "@/lib/utils";

export function ViewTabs({ slug, active }: { slug: string; active: "table" | "kanban" }) {
  const tabs = [
    { key: "table", label: "Tabella", href: `/w/${slug}/contacts` },
    { key: "kanban", label: "Kanban", href: `/w/${slug}/pipeline` },
  ] as const;

  return (
    <div className="inline-flex rounded-lg border p-0.5 text-sm" role="tablist" aria-label="Vista">
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          role="tab"
          aria-selected={t.key === active}
          className={cn(
            "rounded-md px-3 py-1 transition-colors",
            t.key === active ? "bg-muted font-medium" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {t.label}
        </Link>
      ))}
    </div>
  );
}
