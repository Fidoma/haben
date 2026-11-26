import { NAV_GROUPS, STEUERBERATUNG_NAV } from "./navigation.ts";

/**
 * Name der Menügruppe, in der die Seite `to` steht: der Eyebrow ihres Seitenkopfs (DESIGN.md, Seitenkopf). Die
 * Steuerberatung hat ein eigenes Menü, ihre Seiten reichen `inhaber` durch.
 */
export function menueGruppe(to: string, inhaber = true): string {
  const gruppe = (inhaber ? NAV_GROUPS : STEUERBERATUNG_NAV).find((g) => g.links.some((link) => link.to === to));
  if (!gruppe) throw new Error(`${to} steht nicht im Menü${inhaber ? "" : " der Steuerberatung"}`);
  return gruppe.label;
}
