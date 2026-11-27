import { createFileRoute } from "@tanstack/react-router";
import { ContactForm } from "../../../components/ContactForm.tsx";
import { getBankverbindungAuswahl } from "../../../server/functions/bankverbindungen.ts";
import { getCustomerNumbering } from "../../../server/functions/company.ts";

export const Route = createFileRoute("/_app/kontakte/neu")({
  loader: async () => {
    const [numbering, bankverbindungen] = await Promise.all([getCustomerNumbering(), getBankverbindungAuswahl()]);
    return { ...numbering, bankverbindungen };
  },
  head: () => ({ meta: [{ title: "Neuer Kontakt · Haben" }] }),
  component: NewContactPage,
});

function NewContactPage() {
  const { preview, bankverbindungen } = Route.useLoaderData();
  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">Kontakte</div>
          <h1>Neuer Kontakt</h1>
        </div>
      </div>
      <ContactForm contact={null} nextNumber={preview} bankverbindungen={bankverbindungen} />
    </>
  );
}
