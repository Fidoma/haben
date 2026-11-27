import { formatDecimal } from "@haben/core";
import { naechsterTermin, vorauszahlungJahre, type VorauszahlungQuartal } from "@haben/elster/vorauszahlung-zeitraum";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { KIRCHENSTEUER_FORTSCHREIBUNG } from "../../lib/kirchensteuer.ts";
import { finanzamtFakten } from "../../lib/elster.ts";
import { sendFinanzamtMessage } from "../../server/functions/finanzamt.ts";
import { Field } from "../../components/Field.tsx";
import { vorauszahlungBetrag } from "./-finanzamt-betrag.ts";
import { type Basis, type Data, prepaymentLetter, QUARTAL_LABEL, TOPIC_LABEL } from "./-finanzamt-daten.ts";
import { AnFinanzamt, SendPanel } from "./-finanzamt-nachrichten.tsx";
import { Schaetzung } from "./-finanzamt-schaetzung.tsx";

export function PrepaymentForm({ data, basis: b }: { data: Data; basis: Basis }) {
  const [current, setCurrent] = useState("");
  const p = b.prognose;
  const [wanted, setWanted] = useState(p.jeQuartal > 0 ? formatDecimal(p.jeQuartal) : "");
  const [reason, setReason] = useState("");
  const [usePrognose, setUsePrognose] = useState(true);
  const vorschlag = naechsterTermin(b.until);
  const [quartal, setQuartal] = useState<VorauszahlungQuartal>(vorschlag.quartal);
  const [jahr, setJahr] = useState(vorschlag.jahr);
  const bisher = vorauszahlungBetrag(current);
  const gewuenscht = vorauszahlungBetrag(wanted);
  const currentCents = bisher.cents;
  const wantedCents = gewuenscht.cents;
  const letter = prepaymentLetter(data, b, { quartal, jahr }, currentCents, wantedCents, reason, usePrognose);

  return (
    <div className="stack" style={{ gap: 16 }}>
      <section className="card" aria-labelledby="basis-heading">
        <h2 id="basis-heading">Einkommensteuer-Vorauszahlungen {b.year}</h2>
        <p className="small muted" style={{ margin: 0 }}>
          Das Finanzamt setzt die Vorauszahlungen (fällig 10.3., 10.6., 10.9. und 10.12.) nach dem letzten Bescheid fest. Verdienst du weniger, kannst du eine
          Herabsetzung beantragen. Haben schreibt die Begründung mit den Zahlen aus deiner EÜR; du prüfst den Text und schickst den Antrag über ELSTER an dein
          Finanzamt.
        </p>
        <Schaetzung basis={b} />
        {/* Die Prognose übernimmt die Angaben des Vorjahres; ohne den Hinweis bleibt eine fehlende
            Lohnkirchensteuer dort unbemerkt (#1451). Lohnkirchensteuer gibt es nur mit Arbeitslohn,
            für Freiberufler ohne Lohn wäre der Satz nur Rauschen */}
        {p.einkuenfteArbeit !== 0 && b.angabenAus !== null && b.angabenAus < b.year && (
          <p className="small muted" style={{ margin: 0 }}>
            {KIRCHENSTEUER_FORTSCHREIBUNG}
          </p>
        )}
        <p className="small muted" style={{ margin: 0 }}>
          {b.angabenAus === null
            ? "Ohne gespeicherte Angaben zur Einkommensteuer (Vorsorge, Kinder …) rechnet Haben nur mit dem Sonderausgaben-Pauschbetrag. "
            : b.angabenAus < b.year
              ? `Abzüge aus deinen Angaben zur Einkommensteuer ${b.angabenAus}. `
              : ""}
          {b.priorBenefitsOmitted && `Einkommensersatzleistungen aus ${b.angabenAus} sind in dieser Schätzung für ${b.year} nicht enthalten. `}
          Grundlage sind der Gewinn aus der Buchhaltung und der Arbeitslohn aus deinen Angaben; Vermietung und Kapitalerträge fehlen. Eine Schätzung, keine
          Steuerberechnung.{" "}
          <Link to="/jahreserklaerung/$jahr" params={{ jahr: String(b.year) }}>
            Angaben bearbeiten
          </Link>
        </p>
        <label className="checkbox">
          <input type="checkbox" checked={usePrognose} onChange={(e) => setUsePrognose(e.target.checked)} />
          Voraussichtliche Steuer im Antrag nennen
        </label>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <Field label="Bisherige Vorauszahlung je Quartal (€)" style={{ flex: "1 1 200px" }} error={bisher.fehler ?? undefined}>
            {(control) => (
              <input {...control} inputMode="decimal" value={current} onChange={(e) => setCurrent(e.target.value)} placeholder="laut letztem Bescheid" />
            )}
          </Field>
          <Field label="Gewünschte Vorauszahlung je Quartal (€)" style={{ flex: "1 1 200px" }} error={gewuenscht.fehler ?? undefined}>
            {(control) => <input {...control} inputMode="decimal" value={wanted} onChange={(e) => setWanted(e.target.value)} placeholder="z. B. 1.000,00" />}
          </Field>
        </div>
        <Field label="Weitere Begründung (optional)">
          {(control) => (
            <textarea {...control} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="z. B. ein großer Auftrag ist weggefallen" />
          )}
        </Field>
        <p className="small muted" style={{ margin: 0 }}>
          Die Hochrechnung nimmt den bisherigen Gewinn taggenau aufs Jahr. Die gewünschte Vorauszahlung ist mit einem Viertel der voraussichtlichen Steuer
          vorbelegt, du kannst sie ändern.
        </p>
      </section>
      <AntragForm
        data={data}
        zeitraum={{ quartal, jahr, setQuartal, setJahr }}
        jahre={vorauszahlungJahre(b.until)}
        zahlenJahr={b.year}
        initial={letter}
        figures={{ ...b, current: currentCents, wanted: wantedCents }}
      />
    </div>
  );
}

/**
 * Antrag auf Anpassung der Einkommensteuer-Vorauszahlungen (ELSTER-Datenart AnpassungVorauszahlung): ab welchem Quartal
 * und für welches Jahr, der Brief geht als Begründung mit. Ohne eigene Änderung folgt die Begründung den Zahlen darüber.
 */
function AntragForm({
  data,
  zeitraum,
  jahre,
  zahlenJahr,
  initial,
  figures,
}: {
  data: Data;
  zeitraum: { quartal: VorauszahlungQuartal; jahr: number; setQuartal: (q: VorauszahlungQuartal) => void; setJahr: (j: number) => void };
  jahre: number[];
  /** Jahr, aus dem die Zahlen der Begründung stammen */
  zahlenJahr: number;
  initial: string;
  figures: Record<string, unknown>;
}) {
  const send = useServerFn(sendFinanzamtMessage);
  const [ownText, setText] = useState<string | null>(null);
  const text = ownText ?? initial;
  const { quartal, jahr } = zeitraum;
  const ready = data.issues.length === 0 && text.trim() !== "";

  return (
    <SendPanel
      data={data}
      ready={ready}
      confirmTitle="Antrag an das Finanzamt senden?"
      confirmText="Der Antrag auf Anpassung der Vorauszahlungen geht an das Finanzamt."
      confirmFacts={[
        ...finanzamtFakten(data.company.finanzamt, data.company.steuernummer),
        { label: "Steuerart", value: "Einkommensteuer" },
        { label: quartal === "nVz" ? "Für" : "Ab", value: quartal === "nVz" ? `${QUARTAL_LABEL.nVz} ${jahr}` : `${quartal.slice(1)}. Quartal ${jahr}` },
      ]}
      footer="Die Antwort des Finanzamts kommt als geänderter Vorauszahlungsbescheid, per Brief oder in dein ELSTER-Postfach. Die PIN wird nicht gespeichert."
      send={(kind, pin) => send({ data: { topic: "vorauszahlung", quartal, jahr, text, figures, kind, pin } })}
    >
      <section className="card" aria-label={TOPIC_LABEL.vorauszahlung}>
        <h2>Antrag</h2>
        <AnFinanzamt data={data} />
        <div className="form-row cols-2">
          <Field label="Ab Quartal">
            {(control) => (
              <select {...control} value={quartal} onChange={(e) => zeitraum.setQuartal(e.target.value as VorauszahlungQuartal)}>
                {(Object.keys(QUARTAL_LABEL) as VorauszahlungQuartal[]).map((q) => (
                  <option key={q} value={q}>
                    {QUARTAL_LABEL[q]}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Jahr" hint={jahr !== zahlenJahr ? `Die Zahlen in der Begründung sind die von ${zahlenJahr}; passe sie an.` : undefined}>
            {(control) => (
              <select {...control} value={jahr} onChange={(e) => zeitraum.setJahr(Number(e.target.value))}>
                {jahre.map((j) => (
                  <option key={j} value={j}>
                    {j}
                  </option>
                ))}
              </select>
            )}
          </Field>
        </div>
        <Field label="Begründung" hint={<>{text.length} von 15.000 Zeichen</>}>
          {(control) => (
            <textarea {...control} className="autogrow" rows={14} value={text} onChange={(e) => setText(e.target.value)} maxLength={15_000} required />
          )}
        </Field>
      </section>
    </SendPanel>
  );
}
