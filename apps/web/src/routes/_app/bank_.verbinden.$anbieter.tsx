import { Link, createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { type Config, type Einstellungen, standardConfig } from "../../components/ZahlungsdienstleisterFormular.tsx";
import { menueGruppe } from "../../lib/menue-gruppe.ts";
import { getPspSettings } from "../../server/functions/zahlungsdienstleister.ts";
import bankStyles from "../../styles/bank.css?url";
import { AbrufSchritt, EinstellungenSchritt, type Pruefung, Schrittleiste, useSpeichern, ZugangSchritt } from "./-bank-einrichtung.tsx";

/*
 * Geführte Einrichtung eines Zahlungsdienstleisters (#1951): „Konto verbinden › Zahlungsdienstleister hinzufügen“ auf der
 * Bankseite oder der Seite Verbindungen führt hierher. Die Schritte nennt der Adapter (#1729); Stripe und PayPal haben drei: Zugang, Name und Zeitraum,
 * erster Abruf. Der Zugang bleibt bis zum Speichern im Browser; neu laden beginnt von vorn.
 */

export const Route = createFileRoute("/_app/bank_/verbinden/$anbieter")({
  loader: () => getPspSettings(),
  head: () => ({ meta: [{ title: "Zahlungsdienstleister verbinden · Haben" }], links: [{ rel: "stylesheet", href: bankStyles }] }),
  component: EinrichtungPage,
});

function EinrichtungPage() {
  const daten = Route.useLoaderData();
  const { anbieter: provider } = Route.useParams();
  const anbieter = daten.anbieter.find((a) => a.provider === provider);
  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">
            {menueGruppe("/bank/verbindungen")} › <Link to="/bank/verbindungen">Verbindungen</Link>
          </div>
          <h1>{anbieter ? `${anbieter.name} verbinden` : "Zahlungsdienstleister verbinden"}</h1>
        </div>
      </div>
      {anbieter ? (
        <Einrichtung key={anbieter.provider} anbieter={anbieter} daten={daten} />
      ) : (
        <section className="card">
          <p style={{ margin: 0 }}>
            Für „{provider}“ holt Haben keine Umsätze über die Schnittstelle. <Link to="/bank/verbindungen">Zu den Verbindungen</Link>
          </p>
        </section>
      )}
    </>
  );
}

function Einrichtung({ anbieter, daten }: { anbieter: (typeof daten)["anbieter"][number]; daten: ReturnType<typeof Route.useLoaderData> }) {
  const [schritt, setSchritt] = useState(0);
  const [config, setConfig] = useState<Config>(standardConfig(anbieter));
  const [eingabe, setEingabe] = useState<Record<string, string>>({});
  const [pruefung, setPruefung] = useState<Pruefung | null>(null);
  const [gespeichert, setGespeichert] = useState<{ id: string; werte: Einstellungen } | null>(null);
  const speichern = useSpeichern(anbieter, eingabe, config);
  const von = anbieter.schritte.length;
  const art = anbieter.schritte[schritt];

  return (
    <>
      <Schrittleiste schritte={anbieter.schritte} aktuell={schritt} />
      {art === "zugang" && (
        <ZugangSchritt
          anbieter={anbieter}
          von={von}
          config={config}
          setConfig={setConfig}
          pruefung={pruefung}
          onGeprueft={(p, e) => {
            setPruefung(p);
            setEingabe(e);
          }}
          onWeiter={() => setSchritt(schritt + 1)}
        />
      )}
      {art === "einstellungen" && pruefung && (
        <EinstellungenSchritt
          anbieter={anbieter}
          daten={daten}
          von={von}
          pruefung={pruefung}
          speichern={speichern}
          onZurueck={() => setSchritt(schritt - 1)}
          onGespeichert={(id, werte) => {
            setGespeichert({ id, werte });
            setSchritt(schritt + 1);
          }}
        />
      )}
      {art === "abruf" && gespeichert && <AbrufSchritt daten={daten} von={von} verbindungId={gespeichert.id} werte={gespeichert.werte} />}
    </>
  );
}
