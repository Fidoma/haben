import { formatEuro } from "@haben/core";
import { formatDate } from "../lib/format.ts";
import type { InvoiceEditorModel } from "./use-invoice-editor.ts";

/** Schlussrechnung: die offenen Abschlagsrechnungen des Kunden zum Abziehen (§ 14 Abs. 5 UStG) */
export function InvoiceDeductsCard({ editor }: { editor: InvoiceEditorModel }) {
  const { contactId, customerAbschlaege, deducts, toggleDeduct } = editor;
  return (
    <section className="card" aria-labelledby="deducts-heading">
      <h2 id="deducts-heading">Abschlagsrechnungen abziehen</h2>
      {!contactId ? (
        <p className="small muted" style={{ margin: 0 }}>
          Erst den Kunden wählen.
        </p>
      ) : customerAbschlaege.length === 0 ? (
        <p className="small muted" style={{ margin: 0 }}>
          Für diesen Kunden gibt es keine offenen festgeschriebenen Abschlagsrechnungen.
        </p>
      ) : (
        customerAbschlaege.map((a) => (
          <label key={a.id} className="checkbox">
            <input type="checkbox" checked={deducts.includes(a.id)} onChange={(e) => toggleDeduct(a.id, e.target.checked)} />
            <span>
              Abschlagsrechnung {a.number} vom {formatDate(a.issueDate)} · {formatEuro(a.gross)}
            </span>
          </label>
        ))
      )}
      <p className="small muted" style={{ margin: 0 }}>
        Unter Positionen steht die gesamte Leistung. Die Abzüge erscheinen auf der Rechnung als eigene Positionen mit Netto und Umsatzsteuer der
        Abschlagsrechnung (§ 14 Abs. 5 UStG).
      </p>
    </section>
  );
}
