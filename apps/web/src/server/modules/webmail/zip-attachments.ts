import { domainToASCII } from "node:url";
import { Uint8ArrayReader, Uint8ArrayWriter, ZipReader, ZipWriter } from "@zip.js/zip.js";

const MAX_ARCHIVE_BYTES = 25 * 1024 * 1024;
const MAX_ENTRY_COUNT = 100;
const MAX_UNCOMPRESSED_BYTES = 100 * 1024 * 1024;

interface ZipLimits {
  archiveBytes: number;
  entryCount: number;
  uncompressedBytes: number;
}

const DEFAULT_LIMITS: ZipLimits = {
  archiveBytes: MAX_ARCHIVE_BYTES,
  entryCount: MAX_ENTRY_COUNT,
  uncompressedBytes: MAX_UNCOMPRESSED_BYTES,
};

export interface WebmailAttachment {
  filename: string;
  mimetype: string;
  content: Buffer;
  senderAddress?: string;
}

export interface ZipAttachmentRule {
  senderDomain: string;
  password: string;
}

function normalizedDomain(value: string): string {
  return domainToASCII(value.trim().toLowerCase().replace(/^@/, ""));
}

export function senderMatchesDomain(address: string | undefined, domain: string): boolean {
  if (!address) return false;
  const separator = address.lastIndexOf("@");
  if (separator < 1) return false;
  const senderDomain = normalizedDomain(address.slice(separator + 1));
  const expectedDomain = normalizedDomain(domain);
  return expectedDomain.length > 0 && senderDomain === expectedDomain;
}

function isZipAttachment(attachment: WebmailAttachment): boolean {
  const zipName = attachment.filename.toLowerCase().endsWith(".zip");
  const zipType = /^(application\/(?:zip|x-zip-compressed)|multipart\/x-zip)$/i.test(attachment.mimetype);
  const zipSignature = attachment.content[0] === 0x50 && attachment.content[1] === 0x4b;
  return (zipName || zipType) && zipSignature;
}

function safeEntryName(filename: string): string {
  const containsControlCharacter = [...filename].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint < 32 || codePoint === 127;
  });
  if (
    filename.length === 0 ||
    filename.length > 512 ||
    filename.includes("\\") ||
    filename.startsWith("/") ||
    /^[A-Za-z]:/.test(filename) ||
    filename.split("/").some((part) => part === ".." || part === ".") ||
    containsControlCharacter
  )
    throw new Error("Unsicherer Dateiname im ZIP-Archiv.");
  return filename;
}

/** Entschlüsselt ein ZIP vollständig im Speicher und erzeugt ein neues ZIP ohne Passwort. */
export async function removeZipPassword(content: Uint8Array, password: string, limits: ZipLimits = DEFAULT_LIMITS): Promise<Uint8Array> {
  if (content.byteLength > limits.archiveBytes) throw new Error("Das ZIP-Archiv ist zu groß.");
  const reader = new ZipReader(new Uint8ArrayReader(content), { password, checkCrc32: true, strictness: "strict" });
  try {
    const entries = await reader.getEntries();
    if (entries.length > limits.entryCount) throw new Error("Das ZIP-Archiv enthält zu viele Dateien.");
    const totalSize = entries.reduce((sum, entry) => sum + entry.uncompressedSize, 0);
    if (totalSize > limits.uncompressedBytes) throw new Error("Der entpackte Inhalt ist zu groß.");
    if (!entries.some((entry) => entry.encrypted)) return content;

    const output = new Uint8ArrayWriter();
    const writer = new ZipWriter(output);
    for (const entry of entries) {
      const filename = safeEntryName(entry.filename);
      if (entry.directory) {
        await writer.add(filename, undefined, { directory: true });
        continue;
      }
      const data = await entry.getData(new Uint8ArrayWriter(), { password, checkCrc32: true });
      await writer.add(filename, new Uint8ArrayReader(data), { lastModDate: entry.lastModDate });
    }
    return writer.close();
  } finally {
    await reader.close();
  }
}

export async function transformZipAttachment(attachment: WebmailAttachment, rule: ZipAttachmentRule): Promise<WebmailAttachment> {
  if (!senderMatchesDomain(attachment.senderAddress, rule.senderDomain) || !isZipAttachment(attachment)) return attachment;
  return { ...attachment, mimetype: "application/zip", content: Buffer.from(await removeZipPassword(attachment.content, rule.password)) };
}
