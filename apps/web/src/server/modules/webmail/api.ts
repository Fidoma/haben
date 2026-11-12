import { Hono } from "hono";
import api from "../../../../vendor/rotomail/server/routes/api.ts";
import type { AppEnv } from "../../../../vendor/rotomail/server/types.ts";
import { listWebmailAccounts, loadWebmailAccount, renameWebmailAccount, resolveWebmailHosts } from "./accounts.ts";

/**
 * Adapter zwischen Habens Sitzung und der unveränderten RotoMail-API. Geheimnisse werden nur für die Dauer der
 * Serveranfrage entschlüsselt und niemals Bestandteil einer Antwort.
 */
export async function handleWebmailApi(request: Request, userId: string): Promise<Response> {
  const summaries = await listWebmailAccounts(userId);
  const accounts = (
    await Promise.all(
      summaries.map(async ({ id }) => {
        const account = await loadWebmailAccount(userId, id);
        if (!account) return null;
        const { imapAddress, smtpAddress } = await resolveWebmailHosts(account.imapHost, account.smtpHost);
        return {
          email: account.email,
          displayName: account.displayName,
          saveDisplayName: (name: string) => renameWebmailAccount(userId, account.id, name),
          username: account.imapUsername,
          password: account.imapPassword,
          imap: { host: imapAddress, servername: account.imapHost, port: account.imapPort, secure: account.imapSecure },
          smtp: {
            host: smtpAddress,
            servername: account.smtpHost,
            port: account.smtpPort,
            secure: account.smtpSecure,
            username: account.smtpUsername,
            password: account.smtpPassword,
          },
        };
      }),
    )
  ).filter((account) => account !== null);

  const app = new Hono<AppEnv>();
  app.use("/api/webmail/v1/*", async (context, next) => {
    context.set("session", { sid: userId, accounts });
    await next();
  });
  app.route("/api/webmail/v1", api);
  return app.fetch(request);
}
