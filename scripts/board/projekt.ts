/*
 * Welches Project (Board) die Automatik bewegt. In Haben ist es ohne Einstellung das Board von Haben; ein anderes Repository
 * (Haben AT) setzt die Nummer seines Boards als Variable BOARD_NUMMER (Settings → Secrets and variables → Actions → Variables).
 */

export const BOARD_INHABER = "Speicherstadt";
const HABEN = "Speicherstadt/haben";
const BOARD_VON_HABEN = 3;

/** Bricht ohne brauchbaren Wert ab, außer in Haben: Der Rückfall auf Board 3 schriebe Karten auf ein fremdes Board */
export function boardNummer(): number {
  const wert = process.env.BOARD_NUMMER?.trim();
  const repo = process.env.GITHUB_REPOSITORY ?? HABEN;
  if (!wert && repo === HABEN) return BOARD_VON_HABEN;
  if (!wert) throw new Error(`In ${repo} fehlt die Variable BOARD_NUMMER mit der Nummer des Boards.`);
  if (!/^[1-9]\d*$/.test(wert)) throw new Error(`BOARD_NUMMER ist keine Nummer eines Projects: „${wert}“`);
  return Number(wert);
}

export function boardLink(): string {
  return `[Board](https://github.com/orgs/${BOARD_INHABER}/projects/${boardNummer()})`;
}
