import {
  ArrowRightLeftIcon,
  BellIcon,
  CalendarClockIcon,
  MailCheckIcon,
  MailOpenIcon,
  MailXIcon,
  StickyNoteIcon,
  UserPlusIcon,
  type LucideIcon,
} from "lucide-react";
import { emailKindLabel } from "@/lib/ai/email-kinds";
import { formatDate, formatDateTime } from "@/lib/format";
import type { Activity, ActivityType, Email, EmailKind } from "@/lib/types";

const ICONS: Record<ActivityType, LucideIcon> = {
  contact_created: UserPlusIcon,
  note_added: StickyNoteIcon,
  stage_changed: ArrowRightLeftIcon,
  email_scheduled: CalendarClockIcon,
  email_sent: MailCheckIcon,
  email_failed: MailXIcon,
  email_received: MailOpenIcon,
  next_action_set: BellIcon,
};

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function Entry({ activity, email }: { activity: Activity; email?: Email }) {
  const p = activity.payload;

  switch (activity.type) {
    case "contact_created":
      return <p>Contatto creato{str(p.source) ? `, fonte: ${str(p.source)}` : ""}.</p>;
    case "note_added":
      return (
        <>
          <p className="text-muted-foreground">Nota</p>
          <p className="mt-1 whitespace-pre-line">{str(p.body)}</p>
        </>
      );
    case "stage_changed":
      return (
        <p>
          Spostato da <span className="font-medium">{str(p.from) ?? "—"}</span> a{" "}
          <span className="font-medium">{str(p.to) ?? "—"}</span>.
        </p>
      );
    case "next_action_set":
      return (
        <p>
          Promemoria: {str(p.action) ?? "ricontattare"}
          {str(p.due_at) ? `, il ${formatDate(str(p.due_at)!)}` : ""}.
        </p>
      );
    case "email_scheduled":
      return (
        <p>
          Email programmata{str(p.scheduled_at) ? ` per il ${formatDateTime(str(p.scheduled_at)!)}` : ""}:{" "}
          <span className="font-medium">{str(p.subject)}</span>
          {email?.status === "cancelled" && <span className="text-muted-foreground"> (annullata)</span>}
        </p>
      );
    case "email_failed":
      return (
        <>
          <p className="text-destructive">
            Invio non riuscito: <span className="font-medium">{str(p.subject)}</span>
          </p>
          {email?.error && <p className="mt-1 text-muted-foreground">{email.error}</p>}
        </>
      );
    case "email_received":
      return (
        <details className="group" open>
          <summary className="cursor-pointer list-none">
            <span className="font-medium">Ha risposto</span>
            <span className="text-muted-foreground"> · {str(p.subject)}</span>
          </summary>
          {email && (
            <p className="mt-3 rounded-lg border bg-card p-4 leading-relaxed whitespace-pre-line">{email.body}</p>
          )}
        </details>
      );
    case "email_sent":
      return (
        <details className="group">
          <summary className="cursor-pointer list-none">
            <span className="text-muted-foreground">
              {emailKindLabel((str(p.kind) as EmailKind | null) ?? "custom")} inviata
              {p.automated === true ? " in automatico" : ""} ·{" "}
            </span>
            <span className="font-medium underline-offset-4 group-open:no-underline hover:underline">
              {str(p.subject)}
            </span>
          </summary>
          {email && (
            <p className="mt-3 rounded-lg bg-muted/60 p-4 leading-relaxed whitespace-pre-line">{email.body}</p>
          )}
        </details>
      );
  }
}

export function Timeline({ activities, emails }: { activities: Activity[]; emails: Email[] }) {
  const emailById = new Map(emails.map((e) => [e.id, e]));

  if (activities.length === 0) {
    return <p className="text-sm text-muted-foreground">Ancora nessuna attività.</p>;
  }

  return (
    <ol className="relative space-y-7 before:absolute before:top-2 before:bottom-2 before:left-[13px] before:w-px before:bg-border">
      {activities.map((activity) => {
        const Icon = ICONS[activity.type];
        const emailId = typeof activity.payload.email_id === "string" ? activity.payload.email_id : null;
        return (
          <li key={activity.id} className="relative flex gap-4">
            <span className="z-10 flex size-7 shrink-0 items-center justify-center rounded-full border bg-background">
              <Icon className="size-3.5 text-muted-foreground" strokeWidth={1.75} />
            </span>
            <div className="min-w-0 flex-1 pt-0.5 text-sm">
              <Entry activity={activity} email={emailId ? emailById.get(emailId) : undefined} />
              <time className="mt-1 block text-xs text-muted-foreground">{formatDateTime(activity.created_at)}</time>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
