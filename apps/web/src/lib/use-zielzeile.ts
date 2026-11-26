import { useLocation } from "@tanstack/react-router";
import { useEffect, useState } from "react";

/**
 * Die Buchung, auf die ein Link zeigt (`#buchung-<id>`): aus der BWA ins Kontenblatt (#1635), von Rechnung, Beleg und
 * Bankumsatz ins Journal (#1855). Die Seite markiert ihre Zeile, rollt sie in die Mitte und setzt den Fokus darauf. Erst
 * nach dem Laden, denn der Server kennt den Anker nicht; `:target` griffe bei einem Link innerhalb der App nicht, weil
 * der Router die Adresse ohne Seitenwechsel setzt.
 */
export function useZielzeile(): string {
  const hash = useLocation({ select: (l) => l.hash });
  const [ziel, setZiel] = useState("");
  useEffect(() => setZiel(hash), [hash]);
  // Erst nach dem Zeichnen mit `ziel`: Vorher hat die Zeile kein tabIndex und nimmt den Fokus nicht an
  useEffect(() => {
    if (!ziel.startsWith("buchung-")) return;
    const zeile = document.getElementById(ziel);
    zeile?.scrollIntoView({ block: "center" });
    zeile?.focus({ preventScroll: true });
  }, [ziel]);
  return ziel;
}

/** Attribute der Zeile einer Buchung: ihr Anker und, ist sie das Ziel, hervorgehoben (aria-current) und fokussierbar */
export function zielzeile(anker: string | undefined, ziel: string) {
  const getroffen = anker !== undefined && anker === ziel;
  return { id: anker, "aria-current": getroffen ? ("true" as const) : undefined, tabIndex: getroffen ? -1 : undefined };
}
