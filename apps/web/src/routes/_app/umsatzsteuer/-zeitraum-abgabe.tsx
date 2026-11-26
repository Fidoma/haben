import { type computeUstva, periodLabel } from "@haben/core";
import { useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState, type FormEvent } from "react";
import { EinklappAbschnitt } from "../../../components/firma/EinklappAbschnitt.tsx";
import { ElsterSubmit } from "../../../components/ElsterSubmit.tsx";
import { MeinElsterWerte } from "../../../components/MeinElsterWerte.tsx";
import { AbgabeVermerken } from "../../../components/umsatzsteuer/AbgabeVermerken.tsx";
import { UstvaZahlung } from "../../../components/umsatzsteuer/UstvaZahlung.tsx";
import { ablaufSchritt, ergebnisSatz, VoranmeldungAblauf } from "../../../components/umsatzsteuer/VoranmeldungAblauf.tsx";
import { elsterNotice, zahllastFakt, type ElsterKind } from "../../../lib/elster.ts";
import { errorMessage } from "../../../lib/format.ts";
import type { Notice } from "../../../lib/use-action.ts";
import { createVatCorrection, getMeinElsterUstvaWerte, saveVatDraft, submitVatReturn } from "../../../server/functions/vat.ts";
import type { FieldKey } from "./-zeitraum-kennzahlen.tsx";
import { History, type PageData } from "./-zeitraum-quellen.tsx";

/** Speichern, Senden und Berichtigen der Anmeldung; `busy`, solange eine davon läuft */
export function useVoranmeldungAktionen(
  data: PageData,
  {
    mode,
    manualFigures,
    reason,
    dirty,
    setDirty,
  }: { mode: "berechnet" | "manuell"; manualFigures: Record<FieldKey, number>; reason: string; dirty: boolean; setDirty: (dirty: boolean) => void },
  setNotice: (notice: Notice) => void,
) {
  const router = useRouter();
  const save = useServerFn(saveVatDraft);
  const submit = useServerFn(submitVatReturn);
  const correct = useServerFn(createVatCorrection);
  const current = data.current;
  const [busy, setBusy] = useState(false);

  async function persist(): Promise<string> {
    const result = await save({
      data: mode === "berechnet" ? { mode: "berechnet", period: data.period } : { mode: "manuell", period: data.period, ...manualFigures, reason },
    });
    setDirty(false);
    return result.id;
  }

  async function run(work: () => Promise<void>) {
    setBusy(true);
    setNotice(null);
    try {
      await work();
    } catch (error) {
      setNotice({ tone: "danger", text: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  }

  const onSave = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      await persist();
      await router.invalidate({ sync: true });
      setNotice({ tone: "ok", text: "Entwurf gespeichert." });
    });
  };

  const onSubmit = (kind: ElsterKind, pin?: string) =>
    run(async () => {
      const id = dirty || !current ? await persist() : current.id;
      const result = await submit({ data: { id, kind, pin } });
      await router.invalidate({ sync: true });
      setNotice(elsterNotice(kind, result, "Voranmeldung übermittelt und festgeschrieben."));
    });

  const onCorrect = () =>
    run(async () => {
      await correct({ data: data.period });
      await router.invalidate({ sync: true });
      setNotice({ tone: "info", text: "Berichtigte Anmeldung angelegt. Werte prüfen und erneut senden." });
    });

  return { busy, onSave, onSubmit, onCorrect };
}

/** Ein Zeitraum, der nicht zum eingestellten Voranmeldungszeitraum passt, lässt sich nicht neu anmelden; berichtigen geht */
export function anmeldbar(data: PageData): boolean {
  return !data.periodProblem || Boolean(data.current?.berichtigt);
}

/**
 * Ablauf und Ergebnis über den Kennzahlen (#1253). Der Satz entfällt bei einer festgeschriebenen Anmeldung (Status und „Zahlung
 * an das Finanzamt“ zeigen den echten Stand), bei einer berichtigten (ihr Posten ist die Differenz zur ersten Anmeldung, nicht
 * Kz 83), bei einem Zeitraum, der nicht zur Voranmeldung passt (`anmeldbar`: Der Hinweis darüber und das gesperrte Senden widersprächen
 * dem Satz), und solange ein Wert von Hand nicht lesbar ist (`werteGueltig` false): Die Seite rechnet ihn dann als 0, und „nichts zu
 * zahlen“ wäre falsch. `geaendert`: ungespeicherte oder veraltete Werte.
 */
export function ZeitraumAblauf({
  data,
  shown,
  geaendert,
  werteGueltig,
}: {
  data: PageData;
  shown: ReturnType<typeof computeUstva>;
  geaendert: boolean;
  werteGueltig: boolean;
}) {
  const locked = data.current?.status === "sent";
  const schritt = ablaufSchritt({
    locked,
    gespeichert: Boolean(data.current),
    geaendert,
    // Alle Posten des Zeitraums (`data.posten`): Eine Berichtigung nach unten verrechnet ihre Minderung, der Rest steht dann als Zahllast offen am Posten des Originals.
    // Eine offene Erstattung (offen < 0) ist nichts zu zahlen und hält das Zahlen nicht offen.
    ausgeglichen: !data.posten.some((p) => p.offen > 0),
  });
  return (
    <VoranmeldungAblauf
      schritt={schritt}
      satz={locked || data.current?.berichtigt || !anmeldbar(data) || !werteGueltig ? null : ergebnisSatz(shown.kz83, data.dueDate, data.today)}
    />
  );
}

/** Rechte Spalte: an ELSTER senden, Zahlung an das Finanzamt, Abgabe außerhalb von Haben, Werte für Mein ELSTER, Verlauf */
export function AbgabeSpalte({
  data,
  locked,
  check,
  busy,
  shown,
  dirty,
  stale,
  onSubmit,
  setNotice,
  vermerk,
}: {
  data: PageData;
  locked: boolean;
  /** Prüft die Werte von Hand beim Druck auf „Nur prüfen“ oder „Senden“ (usePruefungBeimSpeichern) */
  check: () => boolean;
  busy: boolean;
  shown: ReturnType<typeof computeUstva>;
  dirty: boolean;
  stale: boolean;
  onSubmit: (kind: ElsterKind, pin?: string) => Promise<void>;
  setNotice: (notice: Notice) => void;
  /** Ob „Schon anders abgegeben?“ offen steht; die Seite hält es, damit es das Neuaufsetzen nach dem Speichern übersteht */
  vermerk: { offen: boolean; onOffen: (offen: boolean) => void };
}) {
  const loadWerte = useServerFn(getMeinElsterUstvaWerte);
  const current = data.current;
  return (
    <div className="stack">
      {!locked && (
        <ElsterSubmit
          setup={data}
          title="An ELSTER übermitteln"
          ready={anmeldbar(data) && data.companyIssues.length === 0}
          busy={busy}
          confirmTitle="Voranmeldung verbindlich senden?"
          confirmFacts={[
            { label: "Steuerart", value: "Umsatzsteuer-Voranmeldung" },
            { label: "Zeitraum", value: periodLabel(data.period) },
            zahllastFakt(shown.kz83),
          ]}
          confirmText="Die Voranmeldung geht an das Finanzamt und wird danach festgeschrieben."
          footer="ERiC prüft die Daten vor dem Versand. Das Übertragungsprotokoll wird als PDF abgelegt. Die PIN wird nicht gespeichert."
          pruefen={check}
          onSubmit={onSubmit}
        />
      )}
      <UstvaZahlung posten={data.posten} />
      {!locked && current && (
        <EinklappAbschnitt
          id="ust-vermerk"
          titel="Schon anders abgegeben?"
          kurz="Abgabe in Mein ELSTER vermerken"
          offen={vermerk.offen}
          onOffen={vermerk.onOffen}
        >
          <AbgabeVermerken
            returnId={current.id}
            kz83={shown.kz83}
            blocked={dirty || stale}
            today={data.today}
            onFiled={() => setNotice({ tone: "ok", text: "Abgabe vermerkt und Voranmeldung festgeschrieben. Die Zahllast steht jetzt im Bankabgleich." })}
          />
        </EinklappAbschnitt>
      )}
      {!data.herstellerIdConfigured && !locked && current && (
        <MeinElsterWerte
          load={() => loadWerte({ data: { id: current.id } })}
          label={`Umsatzsteuer-Voranmeldung ${periodLabel(data.period)}`}
          blocked={dirty || stale || data.companyIssues.length > 0}
        />
      )}
      <History data={data} />
    </div>
  );
}
