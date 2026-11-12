import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { authMiddleware } from "../middleware.ts";
import { mailSettingsSummary } from "../modules/mail/index.ts";
import { deleteWebmailAccount, listWebmailAccounts, saveWebmailAccount, testWebmailAccount, webmailAccountSchema } from "../modules/webmail/index.ts";

export const getWebmailSetup = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const [accounts, mail] = await Promise.all([listWebmailAccounts(context.user.id), mailSettingsSummary()]);
    const smtpProposal =
      mail?.transport === "smtp" ? { host: mail.host!, port: mail.port!, secure: mail.secure!, username: mail.username!, email: mail.fromAddress } : null;
    return { accounts, smtpProposal };
  });

export const testWebmailAccountFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(webmailAccountSchema)
  .handler(async ({ data, context }) => testWebmailAccount(context.user.id, data));

export const saveWebmailAccountFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(webmailAccountSchema)
  .handler(async ({ data, context }) => ({ id: await saveWebmailAccount(context.user.id, data) }));

export const deleteWebmailAccountFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.uuid())
  .handler(async ({ data, context }) => deleteWebmailAccount(context.user.id, data));
