"use client";

import Link from "next/link";
import { useOptimistic, useState, useTransition } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { GripVerticalIcon } from "lucide-react";
import { toast } from "sonner";
import { moveContact } from "@/actions/contacts";
import { relativeDay } from "@/lib/format";
import type { Contact, PipelineStage } from "@/lib/types";
import { fullName } from "@/lib/types";
import { cn } from "@/lib/utils";

function CardBody({ contact, slug, handle }: { contact: Contact; slug: string; handle?: React.ReactNode }) {
  return (
    <div className="flex gap-1.5">
      <div className="min-w-0 flex-1">
        <Link
          href={`/w/${slug}/contacts/${contact.id}`}
          className="block truncate text-sm font-medium underline-offset-4 hover:underline"
        >
          {fullName(contact)}
        </Link>
        {contact.company && <p className="truncate text-xs text-muted-foreground">{contact.company}</p>}
        <p className="mt-2 text-xs text-muted-foreground">
          {contact.next_action_at
            ? `${contact.next_action ?? "Ricontattare"} ${relativeDay(contact.next_action_at)}`
            : contact.last_contacted_at
              ? `Ultimo contatto ${relativeDay(contact.last_contacted_at)}`
              : "Mai contattato"}
        </p>
      </div>
      {handle}
    </div>
  );
}

function ContactCard({ contact, slug }: { contact: Contact; slug: string }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: contact.id });

  return (
    <li
      ref={setNodeRef}
      className={cn("rounded-lg border bg-card p-3 shadow-xs transition-opacity", isDragging && "opacity-30")}
    >
      <CardBody
        contact={contact}
        slug={slug}
        handle={
          <button
            type="button"
            aria-label={`Sposta ${fullName(contact)}`}
            className="-mr-1 h-fit cursor-grab touch-none rounded p-0.5 text-muted-foreground/60 hover:text-foreground active:cursor-grabbing"
            {...listeners}
            {...attributes}
          >
            <GripVerticalIcon className="size-4" />
          </button>
        }
      />
    </li>
  );
}

function StageColumn({ stage, contacts, slug }: { stage: PipelineStage; contacts: Contact[]; slug: string }) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id });

  return (
    <section
      ref={setNodeRef}
      aria-label={stage.name}
      className={cn(
        "flex w-64 shrink-0 flex-col rounded-xl bg-muted/50 p-2 transition-colors",
        isOver && "bg-accent ring-1 ring-foreground/15",
      )}
    >
      <header className="flex items-baseline justify-between gap-2 px-1.5 py-2">
        <h2 className="truncate font-sans text-sm font-medium tracking-normal">{stage.name}</h2>
        <span className="text-xs tabular-nums text-muted-foreground">{contacts.length}</span>
      </header>
      <ul className="flex min-h-24 flex-1 flex-col gap-2">
        {contacts.map((c) => (
          <ContactCard key={c.id} contact={c} slug={slug} />
        ))}
      </ul>
    </section>
  );
}

export function KanbanBoard({
  slug,
  stages,
  contacts,
}: {
  slug: string;
  stages: PipelineStage[];
  contacts: Contact[];
}) {
  const [, startTransition] = useTransition();
  const [optimistic, applyMove] = useOptimistic(
    contacts,
    (state, move: { contactId: string; stageId: string }) =>
      state.map((c) => (c.id === move.contactId ? { ...c, stage_id: move.stageId } : c)),
  );
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor),
  );
  const dragging = optimistic.find((c) => c.id === draggingId);

  function onDragEnd(event: DragEndEvent) {
    setDraggingId(null);
    const contactId = String(event.active.id);
    const stageId = event.over ? String(event.over.id) : null;
    const contact = optimistic.find((c) => c.id === contactId);
    if (!stageId || !contact || contact.stage_id === stageId) return;

    startTransition(async () => {
      applyMove({ contactId, stageId });
      const result = await moveContact({ slug, contactId, stageId });
      if (!result.ok) toast.error(result.error);
    });
  }

  return (
    <DndContext
      id="pipeline-board"
      sensors={sensors}
      onDragStart={(e) => setDraggingId(String(e.active.id))}
      onDragCancel={() => setDraggingId(null)}
      onDragEnd={onDragEnd}
    >
      <div className="flex gap-3 overflow-x-auto pb-4">
        {stages.map((stage) => (
          <StageColumn
            key={stage.id}
            stage={stage}
            slug={slug}
            contacts={optimistic.filter((c) => c.stage_id === stage.id)}
          />
        ))}
      </div>
      <DragOverlay>
        {dragging && (
          <div className="w-60 rotate-1 rounded-lg border bg-card p-3 shadow-lg">
            <CardBody contact={dragging} slug={slug} />
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}
