import { createFileRoute } from "@tanstack/react-router";
import { handleWebmailApi } from "../../../../server/modules/webmail/index.ts";
import { requireUser } from "../../../../server/rollen.ts";

async function handle(request: Request) {
  const user = await requireUser(request, "inhaber");
  if (user instanceof Response) return user;
  return handleWebmailApi(request, user.id);
}

export const Route = createFileRoute("/api/webmail/v1/$")({
  server: {
    handlers: {
      GET: ({ request }) => handle(request),
      POST: ({ request }) => handle(request),
      PUT: ({ request }) => handle(request),
      DELETE: ({ request }) => handle(request),
    },
  },
});
