import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { ImapFlow } from "imapflow";
import nodemailer from "nodemailer";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { decrypt, encrypt } from "../../crypto.ts";
import { withActor } from "../../db/actor.ts";
import { db, schema } from "../../db/index.ts";

const host = z
  .string()
  .trim()
  .min(1)
  .max(253)
  .regex(/^[A-Za-z0-9.-]+$/, "Nur ein Servername ist erlaubt.");
const port = z.number().int().min(1).max(65535);

export const webmailAccountSchema = z.object({
  id: z.uuid().optional(),
  email: z.email().trim(),
  displayName: z.string().trim().max(200).default(""),
  imapHost: host,
  imapPort: port.default(993),
  imapSecure: z.boolean().default(true),
  imapUsername: z.string().trim().min(1).max(320),
  imapPassword: z.string().min(1).max(500).optional(),
  smtpHost: host,
  smtpPort: port.default(587),
  smtpSecure: z.boolean().default(false),
  smtpUsername: z.string().trim().min(1).max(320),
  smtpPassword: z.string().min(1).max(500).optional(),
});

export type WebmailAccountInput = z.input<typeof webmailAccountSchema>;

interface Secrets {
  imapPassword: string;
  smtpPassword: string;
}

function secrets(ciphertext: Uint8Array): Secrets {
  return JSON.parse(decrypt(ciphertext).toString("utf8")) as Secrets;
}

function isPrivateAddress(address: string): boolean {
  const normalized = address.toLowerCase();
  if (normalized.startsWith("::ffff:")) return isPrivateAddress(normalized.slice(7));
  if (
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe8") ||
    normalized.startsWith("fe9") ||
    normalized.startsWith("fea") ||
    normalized.startsWith("feb") ||
    normalized.startsWith("ff")
  )
    return true;
  const parts = normalized.split(".").map(Number);
  if (parts.length !== 4) return false;
  const [a, b] = parts;
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b! >= 16 && b! <= 31) || (a === 192 && b === 168);
}

/** Frei konfigurierbare Mailserver dürfen nicht als TCP-SSRF in interne Netze zeigen. */
async function resolvePublicHost(name: string): Promise<string> {
  const addresses = isIP(name) ? [{ address: name }] : await lookup(name, { all: true, verbatim: true });
  if (addresses.length === 0) throw new Error("Der Mailserver konnte nicht aufgelöst werden.");
  if (process.env.HABEN_WEBMAIL_ALLOW_PRIVATE_HOSTS !== "true" && addresses.some(({ address }) => isPrivateAddress(address)))
    throw new Error("Der Mailserver muss öffentlich erreichbar sein.");
  return addresses[0]!.address;
}

export async function resolveWebmailHosts(imapHost: string, smtpHost: string) {
  const [imapAddress, smtpAddress] = await Promise.all([resolvePublicHost(imapHost), resolvePublicHost(smtpHost)]);
  return { imapAddress, smtpAddress };
}

export async function listWebmailAccounts(userId: string) {
  const rows = await db.select().from(schema.webmailAccounts).where(eq(schema.webmailAccounts.userId, userId));
  return rows.map(({ ciphertext: _secret, ...row }) => ({ ...row, hasSecret: true }));
}

export async function loadWebmailAccount(userId: string, id: string) {
  const [row] = await db
    .select()
    .from(schema.webmailAccounts)
    .where(and(eq(schema.webmailAccounts.userId, userId), eq(schema.webmailAccounts.id, id)));
  return row ? { ...row, ...secrets(row.ciphertext) } : null;
}

async function verifyConnections(account: z.output<typeof webmailAccountSchema> & Secrets): Promise<void> {
  const { imapAddress, smtpAddress } = await resolveWebmailHosts(account.imapHost, account.smtpHost);
  const imap = new ImapFlow({
    host: imapAddress,
    port: account.imapPort,
    secure: account.imapSecure,
    auth: { user: account.imapUsername, pass: account.imapPassword },
    tls: { servername: account.imapHost },
    logger: false,
  });
  try {
    await imap.connect();
    await imap.logout();
    const smtp = nodemailer.createTransport({
      host: smtpAddress,
      port: account.smtpPort,
      secure: account.smtpSecure,
      requireTLS: !account.smtpSecure && process.env.HABEN_WEBMAIL_ALLOW_PRIVATE_HOSTS !== "true",
      auth: { user: account.smtpUsername, pass: account.smtpPassword },
      tls: { servername: account.smtpHost },
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 10_000,
    });
    await smtp.verify();
    smtp.close();
  } finally {
    if (imap.usable) imap.close();
  }
}

export async function testWebmailAccount(userId: string, input: WebmailAccountInput): Promise<void> {
  const data = webmailAccountSchema.parse(input);
  const existing = data.id ? await loadWebmailAccount(userId, data.id) : null;
  const imapPassword = data.imapPassword ?? existing?.imapPassword;
  const smtpPassword = data.smtpPassword ?? existing?.smtpPassword;
  if (!imapPassword || !smtpPassword) throw new Error("IMAP- und SMTP-Passwort fehlen.");
  await verifyConnections({ ...data, imapPassword, smtpPassword });
}

export async function saveWebmailAccount(actor: string, input: WebmailAccountInput): Promise<string> {
  const data = webmailAccountSchema.parse(input);
  const existing = data.id ? await loadWebmailAccount(actor, data.id) : null;
  const imapPassword = data.imapPassword ?? existing?.imapPassword;
  const smtpPassword = data.smtpPassword ?? existing?.smtpPassword;
  if (!imapPassword || !smtpPassword) throw new Error("IMAP- und SMTP-Passwort fehlen.");
  await verifyConnections({ ...data, imapPassword, smtpPassword });
  const values = {
    userId: actor,
    email: data.email,
    displayName: data.displayName,
    imapHost: data.imapHost,
    imapPort: data.imapPort,
    imapSecure: data.imapSecure,
    imapUsername: data.imapUsername,
    smtpHost: data.smtpHost,
    smtpPort: data.smtpPort,
    smtpSecure: data.smtpSecure,
    smtpUsername: data.smtpUsername,
    ciphertext: encrypt(new TextEncoder().encode(JSON.stringify({ imapPassword, smtpPassword } satisfies Secrets))),
    updatedAt: new Date(),
  };
  if (data.id) {
    const changed = await withActor(actor, (tx) =>
      tx
        .update(schema.webmailAccounts)
        .set(values)
        .where(and(eq(schema.webmailAccounts.id, data.id!), eq(schema.webmailAccounts.userId, actor)))
        .returning({ id: schema.webmailAccounts.id }),
    );
    if (!changed[0]) throw new Error("Webmail-Konto nicht gefunden.");
    return changed[0].id;
  }
  const [created] = await withActor(actor, (tx) => tx.insert(schema.webmailAccounts).values(values).returning({ id: schema.webmailAccounts.id }));
  return created!.id;
}

export async function deleteWebmailAccount(actor: string, id: string): Promise<void> {
  await withActor(actor, (tx) => tx.delete(schema.webmailAccounts).where(and(eq(schema.webmailAccounts.id, id), eq(schema.webmailAccounts.userId, actor))));
}

export async function renameWebmailAccount(actor: string, id: string, displayName: string): Promise<void> {
  await withActor(actor, (tx) =>
    tx
      .update(schema.webmailAccounts)
      .set({ displayName: displayName.trim().slice(0, 200), updatedAt: new Date() })
      .where(and(eq(schema.webmailAccounts.id, id), eq(schema.webmailAccounts.userId, actor))),
  );
}
