import { getRouteApi, Link } from "@tanstack/react-router";
import {
  bankStand,
  type Data,
  fortschrittArt,
  gezeigteKonten,
  leereListeText,
  naechsteSchritte,
  naechstenOffenenZiel,
  nextOpenAfter,
  offenText,
} from "./-bank-daten.ts";

const bankRoute = getRouteApi("/_app/bank");

/**
 * Fortschritt über der Umsatzliste (#1253), `sichtbar` die Umsätze der Zeilen (ohne Gebühr einer Zahlung): wie viele
 * Umsätze noch offen sind und „Nächsten offenen“; sind alle zugeordnet, der nächste Schritt.
 */
export function Fortschritt({ data, sichtbar, selectedId }: { data: Data; sichtbar: Data["transactions"]; selectedId: string | undefined }) {
  const search = bankRoute.useSearch();
  const { offen, hatUmsaetze } = bankStand(gezeigteKonten(data));
  const art = fortschrittArt(offen, hatUmsaetze);
  if (art === "keine") return null;
  if (art === "fertig") {
    const schritte = naechsteSchritte(data.kleinunternehmer);
    return (
      <p className="tx-fortschritt small" role="status">
        <span>
          Alles zugeordnet. Als Nächstes{" "}
          <Link to="/belege" search={{ status: "pruefen" }}>
            Belege prüfen
          </Link>
          {schritte.includes("voranmeldung") && (
            <>
              {" "}
              oder <Link to="/umsatzsteuer">Voranmeldung prüfen</Link>
            </>
          )}
          .
        </span>
      </p>
    );
  }
  const naechster = nextOpenAfter(sichtbar, selectedId);
  const ziel = naechstenOffenenZiel(naechster, search.filter, search.suche);
  return (
    <div className="tx-fortschritt" role="status">
      <span className="small">{offenText(offen)}</span>
      {ziel && (
        <Link to="/bank" search={{ ...search, ...ziel }} replace className="btn btn-sm" onClick={() => document.getElementById(`tx-${naechster}`)?.focus()}>
          Nächsten offenen
        </Link>
      )}
    </div>
  );
}

/** Text der leeren Liste */
export function LeereListe({ data, filter }: { data: Data; filter: string }) {
  const { offen, hatUmsaetze } = bankStand(gezeigteKonten(data));
  const text = leereListeText(filter, data.transactions.length, offen, hatUmsaetze);
  return (
    text && (
      <p className="muted" style={{ margin: 0, padding: "16px 20px" }}>
        {text}
      </p>
    )
  );
}
