import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

describe.skipIf(!testDatabaseUrl)("Webmail-Konten (Postgres)", () => {
  let sql: postgres.Sql;
  let webmail: typeof import("./index.ts");
  let encrypt: typeof import("../../crypto.ts")["encrypt"];
  const own = "webmail-test-own";
  const other = "webmail-test-other";

  beforeAll(async () => {
    sql = await setupTestDb();
    webmail = await import("./index.ts");
    ({ encrypt } = await import("../../crypto.ts"));
    await sql`delete from "user" where id in (${own}, ${other})`;
    await sql`insert into "user" (id, name, email, email_verified, role) values
      (${own}, 'Eigener Zugang', 'own-webmail@example.test', true, 'inhaber'),
      (${other}, 'Anderer Zugang', 'other-webmail@example.test', true, 'steuerberatung')`;
    const ciphertext = encrypt(new TextEncoder().encode(JSON.stringify({ imapPassword: "imap-geheim", smtpPassword: "smtp-geheim" })));
    await sql`insert into webmail_accounts
      (user_id, email, imap_host, imap_username, smtp_host, smtp_username, ciphertext)
      values (${own}, 'own@example.test', 'imap.example.test', 'own', 'smtp.example.test', 'own', ${ciphertext}),
             (${other}, 'other@example.test', 'imap.example.test', 'other', 'smtp.example.test', 'other', ${ciphertext})`;
  }, 30_000);

  afterAll(async () => {
    await sql`delete from "user" where id in (${own}, ${other})`;
    await sql.end();
  });

  it("liefert nur die Konten des angemeldeten Zugangs und nie das Chiffrat", async () => {
    const accounts = await webmail.listWebmailAccounts(own);
    expect(accounts).toHaveLength(1);
    expect(accounts[0]?.email).toBe("own@example.test");
    expect(accounts[0]).not.toHaveProperty("ciphertext");
  });

  it("entschlüsselt Geheimnisse ausschließlich beim gezielten serverseitigen Laden", async () => {
    const [row] = await sql<{ id: string }[]>`select id from webmail_accounts where user_id = ${own}`;
    expect((await webmail.loadWebmailAccount(own, row!.id))?.imapPassword).toBe("imap-geheim");
    expect(await webmail.loadWebmailAccount(other, row!.id)).toBeNull();
    const [audit] = await sql<{ text: string }[]>`select coalesce(string_agg(coalesce(new_value::text, '') || coalesce(old_value::text, ''), ''), '') as text
      from audit_log where table_name = 'webmail_accounts'`;
    expect(audit!.text).not.toContain("geheim");
  });
});
