import { simpleParser } from "mailparser";
import { describe, expect, it } from "vitest";
import { buildDraftRaw } from "../../../../vendor/rotomail/server/smtp/mailer.ts";

describe("Webmail-Anhänge", () => {
  it("nimmt ausgewählte Dateien als MIME-Anhang auf", async () => {
    const raw = await buildDraftRaw({
      from: "sender@example.test",
      to: "recipient@example.test",
      subject: "Anhangstest",
      text: "Siehe Anhang",
      attachments: [{ filename: "test.txt", contentType: "text/plain", contentBase64: Buffer.from("hallo").toString("base64") }],
    });
    const parsed = await simpleParser(raw);
    expect(parsed.attachments).toHaveLength(1);
    expect(parsed.attachments[0]?.filename).toBe("test.txt");
    expect(parsed.attachments[0]?.content.toString()).toBe("hallo");
  });
});
