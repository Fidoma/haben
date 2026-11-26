import { formatDuration, formatEuro, formatQuantity } from "@haben/core";
import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { errorMessage } from "../lib/format.ts";
import { billEntries, getBillingPreview } from "../server/functions/leistungen.ts";

type Preview = Awaited<ReturnType<typeof getBillingPreview>>;

/**
 * Abrechnen (#417, #1933): Aus den abgehakten Einträgen der Liste wird ein Rechnungsentwurf. Kunde und Filter stehen in der
 * Liste darunter; `candidates` sind die Einträge, die sie zeigt, `entryIds` die abgehakten davon.
 */
export function ServiceBillingForm({
  customer,
  candidates,
  entryIds,
  onClose,
}: {
  customer: { id: string; inactive: boolean } | null;
  candidates: number;
  entryIds: string[];
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const preview = useServerFn(getBillingPreview);
  const bill = useServerFn(billEntries);
  const [result, setResult] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const contactId = customer && !customer.inactive ? customer.id : null;
  const ready = contactId !== null && entryIds.length > 0;
  const idsKey = entryIds.join(",");

  useEffect(() => {
    if (contactId === null || idsKey === "") {
      setResult(null);
      return;
    }
    let current = true;
    preview({ data: { contactId, entryIds: idsKey.split(",") } })
      .then((p) => {
        if (current) {
          setResult(p);
          setError(null);
        }
      })
      .catch((e) => {
        if (current) {
          setResult(null);
          setError(errorMessage(e));
        }
      });
    return () => {
      current = false;
    };
  }, [contactId, idsKey, preview]);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (contactId === null || entryIds.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const { invoiceId } = await bill({ data: { contactId, entryIds } });
      await navigate({ to: "/rechnungen/$id", params: { id: invoiceId } });
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  const missing = result !== null && result.withoutRate > 0;
  const hint = !customer
    ? "Wähle in der Liste unten den Kunden, den du abrechnen willst."
    : customer.inactive
      ? "Für diesen Kunden lässt sich nicht abrechnen: Er ist archiviert oder kein Kunde mehr."
      : candidates === 0
        ? "Für diesen Filter gibt es keine offenen, abrechenbaren Einträge dieses Kunden."
        : entryIds.length === 0
          ? "Hake unten mindestens einen Eintrag an."
          : null;
  return (
    <form className="card stack" aria-label="Leistungen abrechnen" onSubmit={onSubmit} noValidate>
      <h2 style={{ margin: 0 }}>Leistungen abrechnen</h2>
      <p className="muted small" style={{ margin: 0, maxWidth: 680 }}>
        Aus den angehakten, offenen und abrechenbaren Einträgen eines Kunden wird ein Rechnungsentwurf: eine Position je Stundensatz, der Leistungszeitraum vom
        ersten bis zum letzten Arbeitstag. Kunde, Zeitraum, Projekt und Tätigkeit grenzt der Filter in der Liste ein. Gebucht wird erst, wenn du die Rechnung
        festschreibst.
      </p>
      {hint && (
        <p className="muted" style={{ margin: 0 }} aria-live="polite">
          {hint}
        </p>
      )}
      {result && ready && (
        <div className="stack" style={{ gap: 6 }} aria-live="polite">
          <div>
            {result.entries} {result.entries === 1 ? "Eintrag" : "Einträge"} gewählt, {formatDuration(result.minutes)} Std., zusammen {formatEuro(result.net)}{" "}
            netto
          </div>
          {result.lines.map((line) => (
            <div key={line.rateCents} className="small muted">
              Position: {formatQuantity(line.quantity)} Std. zu {formatEuro(line.rateCents)}
              {line.projects.length > 0 && ` · ${line.projects.join(", ")}`}
            </div>
          ))}
        </div>
      )}
      {missing && ready && (
        <div className="banner banner-danger" role="alert">
          Bei {result.withoutRate} {result.withoutRate === 1 ? "Eintrag fehlt" : "Einträgen fehlt"} der Stundensatz. Trage ihn am Eintrag oder im Kontakt ein,
          dann lässt sich abrechnen.
        </div>
      )}
      {error && (
        <div className="banner banner-danger" role="alert">
          {error}
        </div>
      )}
      <div className="actions">
        <button type="button" className="btn" onClick={onClose}>
          Abbrechen
        </button>
        {/* Gesperrt, solange nichts zu tun ist oder die Vorschau lädt (einen Augenblick); den Grund nennt der Hinweis darüber */}
        <button type="submit" className="btn btn-primary" disabled={busy || !ready || result === null || missing}>
          Rechnungsentwurf anlegen
        </button>
      </div>
    </form>
  );
}
