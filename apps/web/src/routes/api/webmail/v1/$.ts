import { createFileRoute } from "@tanstack/react-router";
import { handleWebmailApi } from "../../../../server/modules/webmail/index.ts";
import { requireUser } from "../../../../server/rollen.ts";

export const Route = createFileRoute("/api/webmail/v1/$")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const user = await requireUser(request, "inhaber");
        if (user instanceof Response) return user;
        return handleWebmailApi(request, user.id);
      },
      POST: async ({ request }) => {
        const user = await requireUser(request, "inhaber");
        if (user instanceof Response) return user;
        return handleWebmailApi(request, user.id);
      },
      PUT: async ({ request }) => {
        const user = await requireUser(request, "inhaber");
        if (user instanceof Response) return user;
        return handleWebmailApi(request, user.id);
      },
      DELETE: async ({ request }) => {
        const user = await requireUser(request, "inhaber");
        if (user instanceof Response) return user;
        return handleWebmailApi(request, user.id);
      },
    },
  },
});
