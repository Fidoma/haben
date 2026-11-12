import { describe, expect, it } from "vitest";

process.env.DATABASE_URL ??= "postgres://haben:haben@127.0.0.1:1/haben_test";
process.env.BETTER_AUTH_SECRET ??= "test-secret-test-secret-test-secret";
process.env.HABEN_ENCRYPTION_KEY ??= Buffer.alloc(32).toString("base64");
delete process.env.HABEN_WEBMAIL_ALLOW_PRIVATE_HOSTS;

const { resolveWebmailHosts, testWebmailAccount, webmailAccountSchema } = await import("./index.ts");

const account = {
  email: "mail@example.test",
  displayName: "Muster",
  imapHost: "127.0.0.1",
  imapPort: 993,
  imapSecure: true,
  imapUsername: "mail@example.test",
  imapPassword: "nur-ein-test",
  smtpHost: "127.0.0.1",
  smtpPort: 587,
  smtpSecure: false,
  smtpUsername: "mail@example.test",
  smtpPassword: "nur-ein-test",
};

describe("Webmail-Konten", () => {
  it("nimmt vollständige IMAP- und SMTP-Einstellungen an", () => {
    expect(webmailAccountSchema.parse(account)).toMatchObject({ email: "mail@example.test", imapPort: 993, smtpPort: 587 });
  });

  it("lehnt interne Ziele vor einem Verbindungsversuch ab", async () => {
    await expect(testWebmailAccount("nutzer-a", account)).rejects.toThrow("öffentlich erreichbar");
  });

  it("nimmt keine URLs als Mailserver an", () => {
    expect(() => webmailAccountSchema.parse({ ...account, imapHost: "https://mail.example.test" })).toThrow("Nur ein Servername");
  });

  it("lehnt IPv4-gemappte lokale IPv6-Adressen ab", async () => {
    await expect(resolveWebmailHosts("::ffff:127.0.0.1", "mail.example.test")).rejects.toThrow();
  });
});
