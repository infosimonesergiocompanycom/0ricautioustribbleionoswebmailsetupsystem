"use client";

import Link from "next/link";
import { CheckIcon, ChevronsUpDownIcon, PlusIcon } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { initials } from "@/lib/format";
import type { WorkspaceSummary } from "@/lib/types";
import { cn } from "@/lib/utils";

function Monogram({ name, className }: { name: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-7 shrink-0 items-center justify-center rounded-md bg-primary text-[11px] font-medium tracking-wide text-primary-foreground",
        className,
      )}
    >
      {initials(name)}
    </span>
  );
}

/**
 * Selettore dell'azienda attiva. Il workspace corrente vive nell'URL
 * (/w/[slug]): cambiare azienda è una navigazione, e ogni pagina carica
 * soltanto i dati del workspace indicato dal proprio indirizzo.
 */
export function WorkspaceSwitcher({
  workspaces,
  currentSlug,
}: {
  workspaces: WorkspaceSummary[];
  currentSlug: string;
}) {
  const current = workspaces.find((w) => w.slug === currentSlug);
  if (!current) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Cambia azienda"
        className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left outline-none transition-colors hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-ring/50 data-popup-open:bg-sidebar-accent"
      >
        <Monogram name={current.name} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{current.name}</span>
          {current.industry && (
            <span className="block truncate text-xs text-muted-foreground">{current.industry}</span>
          )}
        </span>
        <ChevronsUpDownIcon className="size-4 shrink-0 text-muted-foreground" />
      </DropdownMenuTrigger>

      <DropdownMenuContent className="min-w-60 p-1.5">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Le tue aziende</DropdownMenuLabel>
          {workspaces.map((w) => (
            <DropdownMenuItem key={w.id} render={<Link href={`/w/${w.slug}`} />} className="gap-2.5 py-1.5">
              <Monogram name={w.name} className="size-6 text-[10px]" />
              <span className="min-w-0 flex-1 truncate">{w.name}</span>
              {w.slug === currentSlug && <CheckIcon className="text-muted-foreground" />}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem render={<Link href="/workspaces/new" />} className="gap-2.5 py-1.5">
          <span className="flex size-6 items-center justify-center rounded-md border border-dashed">
            <PlusIcon className="size-3.5" />
          </span>
          Nuova azienda
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
