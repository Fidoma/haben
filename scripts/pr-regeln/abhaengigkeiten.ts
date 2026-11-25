import type { Report } from "./regel.ts";

/*
 * Neue Abhängigkeiten in einem Pull Request (docs/entwicklung.md, Konventionen, „Wenige Abhängigkeiten“): Jedes Paket
 * ist fremder Code mit eigenen Abhängigkeiten, Angriffsfläche und Pflege. Deshalb immer eine Warnung, die man im Pull
 * Request sieht, und ein Fehler, solange die Beschreibung den Grund nicht unter „## Neue Abhängigkeiten“ nennt.
 * Verglichen werden die package.json-Dateien vorher und nachher; ein Update der Version zählt nicht, ein Paket,
 * das aus devDependencies zur Laufzeit wechselt, schon, umgekehrt oder zwischen den Feldern zur Laufzeit nicht. Neue Pakete nur in bun.lock (transitiv) sieht die Prüfung nicht.
 */

const FELDER = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"] as const;
const LAUFZEIT = ["dependencies", "optionalDependencies", "peerDependencies"] as const;

export type NeueAbhaengigkeit = { file: string; name: string; feld: string };

/** Pakete je Feld aus dem Inhalt einer package.json; leer, wenn es sie nicht gibt oder sie sich nicht lesen lässt */
function felder(inhalt: string | null): Record<string, string[]> {
  if (inhalt === null) return {};
  try {
    const paket = JSON.parse(inhalt) as Record<string, Record<string, string> | undefined>;
    return Object.fromEntries(
      FELDER.map((feld) => [
        feld,
        Object.entries(paket[feld] ?? {})
          .filter(([, version]) => !String(version).startsWith("workspace:"))
          .map(([name]) => name),
      ]),
    );
  } catch {
    return {};
  }
}

export function neueAbhaengigkeiten(staende: { file: string; before: string | null; after: string | null }[]): NeueAbhaengigkeit[] {
  return staende.flatMap(({ file, before, after }) => {
    const vorher = felder(before);
    const nachher = felder(after);
    // Bekannt ist für devDependencies jedes Paket von vorher, für die Felder zur Laufzeit nur eins, das schon zur Laufzeit lief
    const bekannt = (feld: string) => new Set((feld === "devDependencies" ? FELDER : LAUFZEIT).flatMap((f) => vorher[f] ?? []));
    return FELDER.flatMap((feld) => {
      const alt = bekannt(feld);
      return (nachher[feld] ?? []).filter((name) => !alt.has(name)).map((name) => ({ file, name, feld }));
    });
  });
}

const ABSCHNITT = "## Neue Abhängigkeiten";

/** Text des Abschnitts „## Neue Abhängigkeiten“ bis zur nächsten Überschrift derselben Ebene */
function abschnitt(body: string | null): string | null {
  const zeilen = (body ?? "").split("\n");
  const start = zeilen.findIndex((zeile) => zeile.trim().toLowerCase() === ABSCHNITT.toLowerCase());
  if (start < 0) return null;
  const ende = zeilen.findIndex((zeile, i) => i > start && /^##\s/.test(zeile));
  return zeilen.slice(start + 1, ende < 0 ? undefined : ende).join("\n");
}

/**
 * Der Name als Ganzes, nicht als Teil eines anderen Namens oder Worts (`pg` nicht in `@types/pg`, `pg-boss` oder
 * „Upgrade“). Ein Bindestrich vor einem Großbuchstaben beginnt ein deutsches Wort („pg-Treiber“): Paketnamen auf npm
 * sind klein geschrieben.
 */
function genannt(text: string, name: string): boolean {
  const zeichen = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^\\w@/.-])${zeichen}($|[^\\w/-]|-(?=[A-ZÄÖÜ]))`).test(text);
}

/** Ohne Beschreibungsprüfung (Bots wie Renovate, lokal ohne --titel) nur der Hinweis, ohne Fehler */
export function abhaengigkeitHinweise(neu: NeueAbhaengigkeit[], body: string | null, ohneBeschreibung: boolean): Report[] {
  if (neu.length === 0) return [];
  const liste = neu.map(({ file, name, feld }) => `\`${name}\` (${file}, ${feld})`).join(", ");
  const meldungen: Report[] = [
    {
      level: "warning",
      message: `Neue Abhängigkeit: ${liste}. Jedes Paket bringt fremden Code und meist weitere Pakete mit; vorher prüfen, ob wenige Zeilen eigener Code oder ein vorhandenes Paket reichen (docs/entwicklung.md, Konventionen, „Wenige Abhängigkeiten“).`,
    },
  ];
  if (ohneBeschreibung) return meldungen;
  const begruendung = abschnitt(body) ?? "";
  const fehlt = [...new Set(neu.map(({ name }) => name))].filter((name) => !genannt(begruendung, name));
  if (fehlt.length > 0)
    meldungen.push({
      level: "error",
      message: `Begründung fehlt für ${fehlt.map((name) => `\`${name}\``).join(", ")}: In der Beschreibung unter „${ABSCHNITT}“ je Paket, wofür es nötig ist, warum eigener Code nicht reicht, Lizenz und wie viele Pakete es mitbringt.`,
    });
  return meldungen;
}
