/**
 * Bereiche, die sich ausblenden lassen (#266, Stufe 1). Ausblenden nimmt nur die Menüpunkte aus Navigation und
 * Schnellsuche und die Knöpfe, die dorthin führen; Daten, Buchungen, Auswertungen, API und direkte Links bleiben.
 * Rechnungen, Belege, Bank, Umsatzsteuer und Jahreserklärung stehen nicht in der Liste: Ohne sie geht keine
 * Buchhaltung. „Rechnungen schreiben“ und „Mahnwesen“ haben keinen eigenen Menüpunkt, nur Knöpfe und Reiter.
 */
export const BEREICHE = [
  {
    id: "rechnungserstellung",
    label: "Rechnungen schreiben",
    frage: "Schreibst du deine Rechnungen mit Haben?",
    wirkung: "Knöpfe, um eine Rechnung zu schreiben, abzurechnen oder zu kopieren",
    seiten: [],
  },
  { id: "mahnwesen", label: "Mahnwesen", frage: "Mahnst du mit Haben?", wirkung: "Reiter und Knöpfe zum Mahnen", seiten: [] },
  { id: "artikel", label: "Artikel", frage: "Nutzt du einen Artikelkatalog?", wirkung: "Im Menü: Artikel", seiten: ["/artikel"] },
  { id: "zeiteintraege", label: "Zeiteinträge", frage: "Erfasst du Zeiten für deine Kunden?", wirkung: "Im Menü: Zeiteinträge", seiten: ["/leistungen"] },
  { id: "textbausteine", label: "Textbausteine", frage: "Nutzt du Textbausteine?", wirkung: "Im Menü: Textbausteine", seiten: ["/textbausteine"] },
  { id: "angebote", label: "Angebote", frage: "Schreibst du Angebote?", wirkung: "Im Menü: Angebote", seiten: ["/angebote"] },
  {
    id: "personal",
    label: "Personal",
    frage: "Hast du Angestellte oder Minijobber?",
    wirkung: "Im Menü: Lohn, SV-Meldeportal",
    seiten: ["/lohn", "/sv-meldeportal"],
  },
  { id: "kasse", label: "Kasse", frage: "Nimmst du Bargeld ein?", wirkung: "Im Menü: Kasse", seiten: ["/kasse"] },
  { id: "lastschriften", label: "Lastschriften", frage: "Ziehst du Geld per Lastschrift ein?", wirkung: "Im Menü: Lastschriften", seiten: ["/lastschriften"] },
  {
    id: "anlagen",
    label: "Anlagen und Darlehen",
    frage: "Hast du Anlagegüter oder Darlehen?",
    wirkung: "Im Menü: Anlagen, Darlehen",
    seiten: ["/anlagen", "/darlehen"],
  },
] as const;

export type BereichId = (typeof BEREICHE)[number]["id"];

export const BEREICH_IDS = BEREICHE.map((b) => b.id) as [BereichId, ...BereichId[]];

/** Pfade der Menüpunkte, die zu den ausgeblendeten Bereichen gehören; Unbekanntes aus älteren Ständen zählt nicht */
export function ausgeblendeteSeiten(ausgeblendet: readonly string[]): ReadonlySet<string> {
  return new Set(BEREICHE.filter((b) => ausgeblendet.includes(b.id)).flatMap((b) => b.seiten));
}
