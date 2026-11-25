/**
 * Die zwei Wege, eine festgeschriebene Rechnung zu ändern: Storno und Rechnungskorrektur. Unter jedem Knopf steht, was er
 * tut, und gehört per aria-describedby dazu; die Namen der Knöpfe bleiben (E2E, Suchwörter).
 */
export function KorrekturAktionen({ busy, onCancel, onCorrect }: { busy: boolean; onCancel: () => void; onCorrect: () => void }) {
  return (
    <div className="actions">
      <div className="korrektur-aktion">
        <button type="button" className="btn btn-danger" onClick={onCancel} disabled={busy} aria-describedby="amend-cancel-hint">
          Stornieren
        </button>
        <p id="amend-cancel-hint" className="field-hint">
          Hebt die Rechnung ganz auf: Es entsteht eine Stornorechnung mit neuer Nummer. Festgeschriebene Korrekturen werden mit storniert.
        </p>
      </div>
      <div className="korrektur-aktion">
        <button type="button" className="btn" onClick={onCorrect} disabled={busy} aria-describedby="amend-correct-hint">
          Rechnungskorrektur anlegen
        </button>
        <p id="amend-correct-hint" className="field-hint">
          Mindert den Betrag: ein Entwurf mit allen Positionen negativ, den du kürzt.
        </p>
      </div>
    </div>
  );
}
