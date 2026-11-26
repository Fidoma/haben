import { ELEKTRO_STAFFEL, elektroCumulative, MEMO_VALUE } from "./afa-methoden.ts";
import { AssetError } from "./afa-sonder.ts";
import type { ScheduleAsset, ScheduleYear } from "./afa.ts";
import type { Cents } from "./money.ts";

export const monthIndex = (date: string) => Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7)) - 1;

/** Ende des Plans: Buchwert 0, beim Erinnerungswert das letzte gewünschte Jahr ohne ausstehenden Abgang */
export function planEnds(closing: Cents, memo: Cents, year: number, disposalYear: number | null, untilYear: number | undefined): boolean {
  if (closing === 0 || year >= 2200) return true;
  return closing <= memo && disposalYear === null && year >= (untilYear ?? year);
}

/**
 * Degressive und Elektro-AfA, Jahr für Jahr vom Buchwert aus.
 * - Degressiv: Satz × Buchwert am Jahresanfang × Monate / 12, im Anschaffungs- und im Abgangsjahr zeitanteilig
 *   (§ 7 Abs. 2 Satz 3 i. V. m. Abs. 1 Satz 4 EStG; R 7.4 Abs. 8 EStR). Linear (Buchwert / Restnutzungsdauer) ab dem
 *   Jahr, in dem das mindestens so viel ist, oder ab linearFromYear, danach nie zurück (§ 7 Abs. 3 EStG).
 * - Elektro: Staffel nach § 7 Abs. 2a EStG ohne Zwölftelung im Anschaffungsjahr (Satz 3); im Abgangsjahr zeitanteilig
 *   bis zum Abgangsmonat (R 7.4 Abs. 8 EStR, konservativ wie bei der linearen AfA).
 */
export function stepSchedule(
  asset: ScheduleAsset,
  untilYear: number | undefined,
  regularSchedule: (asset: ScheduleAsset, untilYear?: number) => ScheduleYear[],
): ScheduleYear[] {
  const start = asset.opening?.date ?? asset.acquisitionDate;
  const firstYear = Number(start.slice(0, 4));
  const acquisitionYear = Number(asset.acquisitionDate.slice(0, 4));
  const disposalMonth = asset.disposalDate ? monthIndex(asset.disposalDate) : null;
  const disposalYear = asset.disposalDate ? Number(asset.disposalDate.slice(0, 4)) : null;
  const memo = asset.memoValue ? MEMO_VALUE : 0;
  let switched = false;
  const specialEntries = new Map(asset.specialDepreciation?.filter(({ amount }) => amount > 0).map(({ year, amount }) => [year, amount]));
  const hasSpecialDepreciation = specialEntries.size > 0;
  const endYear = acquisitionYear + 4;
  const regularPlan = hasSpecialDepreciation ? stepSchedule({ ...asset, specialDepreciation: undefined }, endYear, regularSchedule) : [];

  const elektro = (year: number, available: Cents): Cents => {
    const k = year - acquisitionYear;
    const planned = k >= ELEKTRO_STAFFEL.length - 1 ? available - memo : elektroCumulative(asset.cost, k) - elektroCumulative(asset.cost, k - 1);
    const months = disposalYear === year ? disposalMonth! - year * 12 + 1 : 12;
    return Math.round((planned * months) / 12);
  };
  const degressive = (year: number, available: Cents): Cents => {
    const firstMonth = Math.max(year * 12, monthIndex(start));
    const months = Math.min(year * 12 + 11, disposalMonth ?? Infinity) - firstMonth + 1;
    const remaining = asset.usefulLifeMonths! - (firstMonth - monthIndex(asset.acquisitionDate));
    if (months <= 0) return 0;
    if (remaining <= months) return available - memo;
    const linearAmount = Math.round((available * months) / remaining);
    const degressiveAmount = Math.round((available * asset.degressiveRate! * months) / 120_000);
    if (!switched && ((asset.linearFromYear != null && year >= asset.linearFromYear) || linearAmount >= degressiveAmount)) switched = true;
    if (!switched) return degressiveAmount;
    // Eine Sonder-AfA verändert die lineare Bemessungsgrundlage erst nach dem Begünstigungszeitraum.
    return hasSpecialDepreciation ? (regularPlan.find((row) => row.year === year)?.depreciation ?? 0) : linearAmount;
  };
  const amount = asset.method === "elektro" ? elektro : degressive;

  const rows: ScheduleYear[] = [];
  let bookValue = asset.opening ? asset.opening.bookValue : 0;
  for (let year = firstYear; ; year++) {
    // § 7a Abs. 9 EStG: https://www.gesetze-im-internet.de/estg/__7a.html
    if (hasSpecialDepreciation && year > endYear) {
      rows.push(
        ...regularSchedule(
          {
            ...asset,
            method: "linear",
            degressiveRate: null,
            linearFromYear: null,
            specialDepreciation: undefined,
            opening: { date: `${year}-01-01`, bookValue },
          },
          untilYear,
        ),
      );
      break;
    }
    const addition = !asset.opening && year === firstYear ? asset.cost : 0;
    const opening = bookValue;
    const available = opening + addition;
    const depreciation = Math.max(0, Math.min(amount(year, available), available - memo));
    // Die degressive AfA des Folgejahres beginnt beim geminderten Buchwert (§ 7 Abs. 2 Satz 2 EStG).
    const specialDepreciation = specialEntries.get(year) ?? 0;
    specialEntries.delete(year);
    if (specialDepreciation > 0 && specialDepreciation > available - depreciation - memo)
      throw new AssetError("Sonder-AfA überschreitet den verfügbaren Buchwert");
    let closing = available - depreciation - specialDepreciation;
    let disposal = 0;
    if (disposalYear === year) {
      disposal = closing;
      closing = 0;
    }
    rows.push({ year, opening, addition, depreciation, disposal, closing, ...(hasSpecialDepreciation ? { specialDepreciation } : {}) });
    bookValue = closing;
    if (planEnds(closing, memo, year, disposalYear, untilYear)) break;
  }
  if (specialEntries.size > 0) throw new AssetError("Für die Sonder-AfA fehlt im angegebenen Wirtschaftsjahr ein verfügbarer Buchwert");
  return rows;
}
