const TZ = "Europe/Rome";

export function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("it-IT", { day: "numeric", month: "short", year: "numeric", timeZone: TZ }).format(
    new Date(iso),
  );
}

export function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat("it-IT", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: TZ,
  }).format(new Date(iso));
}

export function formatLongDate(date: Date): string {
  return new Intl.DateTimeFormat("it-IT", { weekday: "long", day: "numeric", month: "long", timeZone: TZ }).format(date);
}

/** "oggi", "ieri", "3 giorni fa", "tra 2 giorni". */
export function relativeDay(iso: string, now: Date = new Date()): string {
  const day = (d: Date) => Math.floor(new Date(d.toLocaleString("en-US", { timeZone: TZ })).setHours(0, 0, 0, 0) / 86_400_000);
  const diff = day(new Date(iso)) - day(now);
  if (diff === 0) return "oggi";
  if (diff === -1) return "ieri";
  if (diff === 1) return "domani";
  return diff < 0 ? `${-diff} giorni fa` : `tra ${diff} giorni`;
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
}

export function greeting(now: Date = new Date()): string {
  const hour = Number(new Intl.DateTimeFormat("it-IT", { hour: "numeric", hour12: false, timeZone: TZ }).format(now));
  if (hour < 13) return "Buongiorno";
  if (hour < 18) return "Buon pomeriggio";
  return "Buonasera";
}
