import { createFileRoute } from "@tanstack/react-router";
import { WebmailApp } from "../../modules/webmail/WebmailApp.tsx";
import { getWebmailSetup } from "../../server/functions/webmail.ts";

export const Route = createFileRoute("/_app/webmail")({
  loader: () => getWebmailSetup(),
  component: WebmailPage,
});

function WebmailPage() {
  const data = Route.useLoaderData();
  return <WebmailApp initialAccounts={data.accounts} smtpProposal={data.smtpProposal} />;
}
