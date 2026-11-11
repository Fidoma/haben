import { formatEuro } from "@haben/core";
import { useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState, type FormEvent } from "react";
import { errorMessage } from "../../lib/format.ts";
import type { Notice } from "../../lib/use-action.ts";
import { savePmsSettingsOptions, type getReservationFormOptions } from "../../server/functions/pms.ts";

type Options = Awaited<ReturnType<typeof getReservationFormOptions>>;

/** Einstellungen, die direkt das Anlegen neuer PMS-Reservierungen beeinflussen. */
export function PmsSettingsForm({ options, onDone }: { options: Options; onDone: (notice: Notice) => void }) {
  const router = useRouter();
  const save = useServerFn(savePmsSettingsOptions);
  const [defaultArticleId, setDefaultArticleId] = useState(options.defaultArticleId ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await save({ data: { defaultArticleId: defaultArticleId || null } });
      await router.invalidate();
      onDone({ tone: "ok", text: "PMS-Einstellungen gespeichert." });
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card contact-form" onSubmit={onSubmit} aria-label="PMS-Einstellungen">
      <p className="muted" style={{ marginTop: 0 }}>
        Der Standardartikel samt aktuellem Preis wird in jeder neuen Reservierungsposition vorausgewählt. Bestehende Reservierungen bleiben unverändert.
      </p>
      <label className="field" htmlFor="pms-default-article">
        <span className="field-label">Standardartikel</span>
        <select id="pms-default-article" value={defaultArticleId} disabled={busy} onChange={(event) => setDefaultArticleId(event.target.value)}>
          <option value="">Kein Standardartikel</option>
          {options.articles.map((article) => (
            <option key={article.id} value={article.id}>
              {article.number ? `${article.number} · ` : ""}
              {article.description} · {formatEuro(article.unitPrice)} {article.priceIncludesTax ? "brutto" : "netto"}
            </option>
          ))}
        </select>
      </label>
      {error && (
        <div className="banner banner-danger" role="alert">
          {error}
        </div>
      )}
      <div className="actions form-footer">
        <button type="submit" className="btn btn-primary" disabled={busy}>
          Speichern
        </button>
        <button type="button" className="btn" disabled={busy} onClick={() => onDone(null)}>
          Abbrechen
        </button>
      </div>
    </form>
  );
}
