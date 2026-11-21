import { TextReader, TextWriter, Uint8ArrayReader, Uint8ArrayWriter, ZipReader, ZipWriter } from "@zip.js/zip.js";
import { describe, expect, it } from "vitest";
import { removeZipPassword, senderMatchesDomain, transformZipAttachment } from "./zip-attachments.ts";

async function encryptedZip(filename = "rechnung.txt", text = "vertraulich", password = "festes-passwort") {
  const output = new Uint8ArrayWriter();
  const writer = new ZipWriter(output);
  await writer.add(filename, new TextReader(text), { password });
  return writer.close();
}

async function readText(content: Uint8Array, password?: string) {
  const reader = new ZipReader(new Uint8ArrayReader(content), password ? { password } : undefined);
  try {
    const [entry] = await reader.getEntries();
    if (!entry || entry.directory) throw new Error("Test-ZIP enthält keine Datei.");
    return entry.getData(new TextWriter(), password ? { password } : undefined);
  } finally {
    await reader.close();
  }
}

describe("ZIP-Anhänge mit festem Passwort", () => {
  it("gleicht ausschließlich die vollständige Absender-Domain ohne Beachtung der Großschreibung ab", () => {
    expect(senderMatchesDomain("Belege@VERSENDER.example", "versender.example")).toBe(true);
    expect(senderMatchesDomain("belege@sub.versender.example", "versender.example")).toBe(false);
    expect(senderMatchesDomain("belege@falscher-versender.example", "versender.example")).toBe(false);
  });

  it("liefert ein verschlüsseltes ZIP mit dem richtigen Passwort als unverschlüsseltes ZIP", async () => {
    const encrypted = await encryptedZip();
    const decrypted = await removeZipPassword(encrypted, "festes-passwort");
    expect(await readText(decrypted)).toBe("vertraulich");
  });

  it("lehnt ein falsches Passwort ab", async () => {
    await expect(removeZipPassword(await encryptedZip(), "falsch")).rejects.toThrow();
  });

  it("verändert ZIP-Anhänge anderer Absender nicht", async () => {
    const content = Buffer.from(await encryptedZip());
    const attachment = { filename: "rechnung.zip", mimetype: "application/zip", content, senderAddress: "belege@andere.example" };
    expect(await transformZipAttachment(attachment, { senderDomain: "versender.example", password: "festes-passwort" })).toBe(attachment);
  });

  it("lehnt unsichere Pfade und zu großen entpackten Inhalt ab", async () => {
    await expect(removeZipPassword(await encryptedZip("../rechnung.txt"), "festes-passwort")).rejects.toThrow();
    await expect(
      removeZipPassword(await encryptedZip("rechnung.txt", "zu groß"), "festes-passwort", {
        archiveBytes: 1024 * 1024,
        entryCount: 10,
        uncompressedBytes: 2,
      }),
    ).rejects.toThrow("entpackte Inhalt ist zu groß");
  });
});
