// Lettura di file tabellari esportati da strumenti diversi (Excel, Meta Lead
// Ads, CRM): riconosce codifica e separatore invece di presumerli.

export interface ParsedTable {
  headers: string[];
  rows: string[][];
}

/** Decodifica rispettando il BOM; senza BOM prova UTF-8 e ripiega su Windows-1252. */
export function decodeText(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes.subarray(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes.subarray(2));
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^\uFEFF/, "");
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

function detectDelimiter(text: string): string {
  const firstLine = text.slice(0, text.search(/\r?\n/) === -1 ? undefined : text.search(/\r?\n/));
  let best = ",";
  let bestCount = 0;
  for (const candidate of ["\t", ";", ","]) {
    let count = 0;
    let quoted = false;
    for (const ch of firstLine) {
      if (ch === '"') quoted = !quoted;
      else if (ch === candidate && !quoted) count += 1;
    }
    if (count > bestCount) {
      best = candidate;
      bestCount = count;
    }
  }
  return best;
}

/** Parser CSV/TSV con campi tra virgolette, virgolette raddoppiate e a capo interni. */
export function parseDelimited(text: string): ParsedTable {
  const delimiter = detectDelimiter(text);
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"' && field === "") {
      quoted = true;
    } else if (ch === delimiter) {
      record.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i += 1;
      record.push(field);
      records.push(record);
      record = [];
      field = "";
    } else {
      field += ch;
    }
  }
  if (field !== "" || record.length > 0) {
    record.push(field);
    records.push(record);
  }

  const [headerRow, ...body] = records;
  const headers = (headerRow ?? []).map((h) => h.trim());
  const rows = body
    .filter((r) => r.some((cell) => cell.trim() !== ""))
    .map((r) => headers.map((_, i) => (r[i] ?? "").trim()));
  return { headers, rows };
}
