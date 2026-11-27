import { useRouteContext } from "@tanstack/react-router";
import type { BereichId } from "./bereiche.ts";

/** Ist der Bereich unter Einstellungen › Bereiche eingeschaltet? Für Knöpfe und Reiter; die Navigation filtert lib/navigation.ts */
export function useBereichAktiv(id: BereichId): boolean {
  return !useRouteContext({ from: "/_app" }).ausgeblendet.includes(id);
}
