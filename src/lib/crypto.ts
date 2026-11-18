import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// Cifratura applicativa (AES-256-GCM) dei segreti dei provider email.
// Formato: v1.<iv>.<tag>.<ciphertext>, tutto in base64url.

function key(): Buffer {
  const raw = process.env.EMAIL_SECRETS_KEY;
  const buf = raw ? Buffer.from(raw, "base64") : Buffer.alloc(0);
  if (buf.length !== 32) {
    throw new Error(
      "EMAIL_SECRETS_KEY mancante o non valida: servono 32 byte in base64 (openssl rand -base64 32).",
    );
  }
  return buf;
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv, cipher.getAuthTag(), data]
    .map((p) => (typeof p === "string" ? p : p.toString("base64url")))
    .join(".");
}

export function decryptSecret(payload: string): string {
  const [version, iv, tag, data] = payload.split(".");
  if (version !== "v1" || !iv || !tag || !data) throw new Error("Segreto cifrato in formato non valido.");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
}
