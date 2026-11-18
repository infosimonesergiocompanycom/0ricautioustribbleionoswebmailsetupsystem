// Tipi di dominio allineati a supabase/migrations/0001_init.sql.

export type WorkspaceRole = "owner" | "admin" | "member";
export type StageKind = "open" | "won" | "lost";
export type EmailProvider = "resend" | "sendgrid" | "smtp";
export type EmailKind = "first_contact" | "soft_follow_up" | "case_study" | "closing_call" | "custom";
export type EmailStatus = "scheduled" | "sending" | "sent" | "failed" | "cancelled";
export type ActivityType =
  | "contact_created"
  | "note_added"
  | "stage_changed"
  | "email_scheduled"
  | "email_sent"
  | "email_failed"
  | "next_action_set";

export interface Workspace {
  id: string;
  slug: string;
  name: string;
  industry: string | null;
  website: string | null;
  description: string | null;
  tone_of_voice: string | null;
  email_examples: string | null;
  signature: string | null;
  language: string;
  created_at: string;
}

export type WorkspaceSummary = Pick<Workspace, "id" | "slug" | "name" | "industry">;

export interface EmailSettings {
  workspace_id: string;
  provider: EmailProvider;
  from_name: string;
  from_email: string;
  reply_to: string | null;
  smtp_host: string | null;
  smtp_port: number | null;
  smtp_user: string | null;
  secret_ciphertext: string | null;
}

export interface PipelineStage {
  id: string;
  workspace_id: string;
  name: string;
  position: number;
  kind: StageKind;
  follow_up_days: number | null;
  suggested_kind: EmailKind;
}

export interface Contact {
  id: string;
  workspace_id: string;
  stage_id: string;
  first_name: string;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  company: string | null;
  job_title: string | null;
  source: string | null;
  tags: string[];
  last_contacted_at: string | null;
  next_action: string | null;
  next_action_at: string | null;
  created_at: string;
}

export interface ContactNote {
  id: string;
  contact_id: string;
  body: string;
  created_at: string;
}

export interface Email {
  id: string;
  contact_id: string;
  direction: "outbound" | "inbound";
  kind: EmailKind;
  status: EmailStatus;
  subject: string;
  body: string;
  to_email: string;
  ai_generated: boolean;
  scheduled_at: string | null;
  sent_at: string | null;
  error: string | null;
  created_at: string;
}

export interface Activity {
  id: string;
  contact_id: string;
  type: ActivityType;
  payload: Record<string, unknown>;
  created_at: string;
}

export interface EmailDraft {
  subject: string;
  body: string;
}

export type ActionResult<T = undefined> =
  | ({ ok: true } & (T extends undefined ? { data?: undefined } : { data: T }))
  | { ok: false; error: string };

export function fullName(c: Pick<Contact, "first_name" | "last_name">): string {
  return [c.first_name, c.last_name].filter(Boolean).join(" ");
}
