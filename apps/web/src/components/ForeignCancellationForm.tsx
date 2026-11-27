import { formatEuro } from "@haben/core";
import { useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { formatDate } from "../lib/format.ts";
import { Icon } from "./Icon.tsx";
import { adoptForeignCancellationFn, type readForeignInvoice } from "../server/functions/fremdrechnung.ts";

type Proposal = Awaited<ReturnType<typeof readForeignInvoice>>["proposal"];

/**
 * Storno einer übernommenen Rechnung aus dem Fremdsystem (#1900): Die E-Rechnung bezieht sich mit BT-25 auf die Rechnung.
 * Nummer, Datum und Beträge kommen aus der Datei und sind nicht änderbar; der Server prüft sie gegen die Rechnung.
 */
export function ForeignCancellationForm({
  file,
  proposal,
  cancels,
  onClose,
}: {
  file: File;
  proposal: Proposal;
  cancels: NonNullable<Proposal["cancels"]>;
  onClose: () => void;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const form = new FormData();
    form.set("file", file);
    form.set("storno", JSON.stringify({ invoiceId: cancels.invoiceId, number: proposal.number, issueDate: proposal.issueDate }));
    setBusy(true);
    setError(null);
    try {
      const { id } = await adoptForeignCancellationFn({ data: form });
      await router.navigate({ to: "/rechnungen/$id", params: { id } });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Das Storno konnte nicht übernommen werden.");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} aria-label="Storno aus dem Fremdsystem" style={{ display: "flex", flexDirection: "column" }}>
      <div className="form-section">
        {[...proposal.warnings, ...(cancels.problem ? [cancels.problem] : [])].map((w) => (
          <div key={w} className="banner banner-warn" role="status">
            <Icon name="alert" />
            <span>{w}</span>
          </div>
        ))}
        <div className="banner banner-info" role="status">
          <Icon name="info" />
          <span>
            Die Datei storniert die Rechnung {cancels.number} vom {formatDate(cancels.issueDate)} über {formatEuro(cancels.gross)}
            {cancels.contactName ? ` an ${cancels.contactName}` : ""}. Haben bucht das Storno zum Datum der Gutschrift; Nummer und PDF bleiben wie im
            Fremdsystem.
          </span>
        </div>
        {error && (
          <div className="banner banner-danger" role="alert">
            {error}
          </div>
        )}
        <dl style={{ margin: 0, display: "grid", gridTemplateColumns: "max-content 1fr", gap: "4px 16px" }}>
          <dt className="muted">Nummer des Stornos</dt>
          <dd style={{ margin: 0 }}>{proposal.number}</dd>
          <dt className="muted">Datum</dt>
          <dd style={{ margin: 0 }}>{formatDate(proposal.issueDate)}</dd>
          <dt className="muted">Betrag laut Datei</dt>
          <dd style={{ margin: 0 }}>{formatEuro(proposal.taxes.reduce((sum, t) => sum + t.net + t.tax, 0))}</dd>
        </dl>
      </div>
      <div className="actions form-footer">
        <button type="button" className="btn" onClick={onClose}>
          Abbrechen
        </button>
        <button type="submit" className="btn btn-primary" disabled={busy}>
          Storno übernehmen
        </button>
      </div>
    </form>
  );
}
