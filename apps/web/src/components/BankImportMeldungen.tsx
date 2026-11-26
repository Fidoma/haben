import { type FormEvent, useState } from "react";
import { BankCsvZuordnung, type ImportedCsv, type ZuordnungKonto } from "./BankCsvZuordnung.tsx";
import { Field } from "./Field.tsx";

/**
 * Meldung nach einem Import. `datei` ist eine Datei, deren Spalten sich zuordnen lassen (#1275): eine unbekannte Bank
 * („Spalten zuordnen“) oder eine, die Haben mit der Zuordnung am Konto gelesen hat („Zuordnung ändern“).
 */
export type ImportMessage = {
  tone: "ok" | "danger" | "info";
  text: string;
  datei?: { file: File; aktion: "Spalten zuordnen" | "Zuordnung ändern" };
  /** Die Datei nennt kein Konto, das Haben findet (#1951): die Meldung fragt danach und importiert noch einmal */
  kontoWaehlen?: File;
};

type Importiert = Omit<ImportedCsv, "mitZuordnung" | "zuordnungGespeichert"> & Partial<Pick<ImportedCsv, "mitZuordnung" | "zuordnungGespeichert">>;

export function importMessages(r: Importiert, file?: File): ImportMessage[] {
  const gespeichert = r.zuordnungGespeichert ? ` Spaltenzuordnung für ${r.accountName} gespeichert.` : "";
  return [
    {
      tone: "ok",
      text: `${r.filename}: ${r.added} neue Umsätze für ${r.accountName}${r.skipped ? `, ${r.skipped} schon vorhanden` : ""}.${gespeichert}`,
      datei: r.mitZuordnung && file ? { file, aktion: "Zuordnung ändern" } : undefined,
    },
    ...(r.gap ? [{ tone: "danger" as const, text: r.gap }] : []),
    ...(r.quelle ? [{ tone: "danger" as const, text: r.quelle }] : []),
    ...r.warnings.map((w) => ({ tone: "info" as const, text: `${r.filename}: ${w}` })),
  ];
}

/** Meldungen des Dateiimports im Bankabgleich, mit dem Knopf zur Spaltenzuordnung */
export function ImportMeldungen({
  messages,
  accounts,
  accountId,
  onImported,
  alleKonten = [],
  onKontoGewaehlt,
}: {
  messages: ImportMessage[];
  accounts: ZuordnungKonto[];
  accountId: string;
  onImported: (result: ImportedCsv, file: File) => void;
  /** Alle Konten, auch die der Zahlungsdienstleister, für die Nachfrage nach dem Konto */
  alleKonten?: { id: string; name: string }[];
  onKontoGewaehlt?: (file: File, accountId: string) => void;
}) {
  const [zuordnen, setZuordnen] = useState<File | null>(null);
  return (
    <>
      {messages.length > 0 && (
        <div role="status">
          <ul className="upload-messages" style={{ maxWidth: 560 }}>
            {messages.map((m, i) => (
              <li key={i} className={`banner banner-${m.tone}`}>
                {m.text}
                {m.datei && (
                  <>
                    {" "}
                    <button type="button" className="btn btn-sm" style={{ whiteSpace: "nowrap" }} onClick={() => setZuordnen(m.datei?.file ?? null)}>
                      {m.datei.aktion}
                    </button>
                  </>
                )}
                {m.kontoWaehlen && onKontoGewaehlt && <KontoNachfrage file={m.kontoWaehlen} konten={alleKonten} onWahl={onKontoGewaehlt} />}
              </li>
            ))}
          </ul>
        </div>
      )}
      {zuordnen && (
        <BankCsvZuordnung
          file={zuordnen}
          accounts={accounts}
          accountId={accountId}
          onClose={() => setZuordnen(null)}
          onImported={(result) => {
            setZuordnen(null);
            onImported(result, zuordnen);
          }}
        />
      )}
    </>
  );
}

/** Nachfrage in der Meldung: Konto wählen und dieselbe Datei noch einmal importieren */
function KontoNachfrage({ file, konten, onWahl }: { file: File; konten: { id: string; name: string }[]; onWahl: (file: File, accountId: string) => void }) {
  const [konto, setKonto] = useState(konten[0]?.id ?? "");
  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (konto) onWahl(file, konto);
  }
  return (
    <form onSubmit={onSubmit} className="konto-nachfrage" aria-label={`Konto für ${file.name}`}>
      <Field label="Konto">
        {(control) => (
          <select {...control} value={konto} onChange={(e) => setKonto(e.target.value)} required>
            {konten.map((k) => (
              <option key={k.id} value={k.id}>
                {k.name}
              </option>
            ))}
          </select>
        )}
      </Field>
      <button type="submit" className="btn btn-sm" disabled={!konto}>
        Importieren
      </button>
    </form>
  );
}
