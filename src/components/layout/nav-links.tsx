"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ColumnsIcon, SettingsIcon, SunIcon, UsersIcon } from "lucide-react";
import { cn } from "@/lib/utils";

const ITEMS = [
  { href: "", label: "Oggi", icon: SunIcon },
  { href: "/contacts", label: "Contatti", icon: UsersIcon },
  { href: "/pipeline", label: "Pipeline", icon: ColumnsIcon },
  { href: "/settings", label: "Impostazioni", icon: SettingsIcon },
];

export function NavLinks({ slug, orientation }: { slug: string; orientation: "vertical" | "horizontal" }) {
  const pathname = usePathname();
  const base = `/w/${slug}`;

  return (
    <nav
      aria-label="Sezioni"
      className={cn("flex gap-0.5", orientation === "vertical" ? "flex-col" : "overflow-x-auto")}
    >
      {ITEMS.map(({ href, label, icon: Icon }) => {
        const target = base + href;
        const active = href === "" ? pathname === base : pathname.startsWith(target);
        return (
          <Link
            key={label}
            href={target}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex shrink-0 items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm transition-colors",
              active
                ? "bg-sidebar-accent font-medium text-foreground"
                : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground",
            )}
          >
            <Icon className="size-4" strokeWidth={1.75} />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
