import { MEMO_VALUE } from "./afa-methoden.ts";
import type { ScheduleAsset, ScheduleYear } from "./afa.ts";
import type { Cents } from "./money.ts";

export interface SpecialDepreciationAmount {
  year: number;
  amount: Cents;
}

/** Betragsgrenze nach § 7g Abs. 5 und § 52 Abs. 16 EStG, auf volle Cent abgerundet. */
export function specialDepreciationLimit(acquisitionDate: string, basis: Cents): Cents {
  const tenths = acquisitionDate >= "2024-01-01" ? 4n : 2n;
  return Number((BigInt(basis) * tenths) / 10n);
}

/** Prüft die zeitliche Verteilung und den Gesamtbetrag nach § 7g Abs. 5 EStG. */
export function specialDepreciationIssues(acquisitionDate: string, basis: Cents, amounts: readonly SpecialDepreciationAmount[]): string[] {
  const firstYear = Number(acquisitionDate.slice(0, 4));
  const issues: string[] = [];
  if (amounts.some(({ year }) => !Number.isInteger(year) || year < firstYear || year > firstYear + 4)) {
    issues.push("Sonder-AfA nur im Anschaffungs- oder Herstellungsjahr und den vier Folgejahren");
  }
  if (new Set(amounts.map(({ year }) => year)).size !== amounts.length) {
    issues.push("Je Wirtschaftsjahr ist nur ein Sonder-AfA-Betrag möglich");
  }
  if (amounts.some(({ amount }) => !Number.isSafeInteger(amount) || amount < 0)) {
    issues.push("Sonder-AfA muss ein nicht negativer Betrag in vollen Cent sein");
  } else if (amounts.reduce((sum, { amount }) => sum + amount, 0) > specialDepreciationLimit(acquisitionDate, basis)) {
    issues.push("Gesamtbetrag der Sonder-AfA überschreitet die gesetzliche Obergrenze");
  }
  return issues;
}

export class AssetError extends Error {}

/** Nach dem Begünstigungszeitraum gilt der Restwert über die Restnutzungsdauer (§ 7a Abs. 9 EStG). */
export function linearSpecialSchedule(
  asset: ScheduleAsset,
  untilYear: number | undefined,
  regularSchedule: (asset: ScheduleAsset, untilYear?: number) => ScheduleYear[],
): ScheduleYear[] {
  const regularAsset = { ...asset, specialDepreciation: undefined };
  const endYear = Number(asset.acquisitionDate.slice(0, 4)) + 4;
  const memo = asset.memoValue ? MEMO_VALUE : 0;
  const entries = new Map(asset.specialDepreciation!.filter(({ amount }) => amount > 0).map(({ year, amount }) => [year, amount]));
  const rows: ScheduleYear[] = [];
  let bookValue = 0;
  for (const regular of regularSchedule(regularAsset, Math.max(endYear, untilYear ?? endYear))) {
    if (regular.year > endYear) {
      const date = `${regular.year}-01-01`;
      const opening = { date, bookValue };
      rows.push(...regularSchedule({ ...regularAsset, opening }, untilYear));
      break;
    }
    const opening = bookValue;
    const available = opening + regular.addition;
    const depreciation = Math.min(regular.depreciation, Math.max(available - memo, 0));
    const specialDepreciation = entries.get(regular.year) ?? 0;
    entries.delete(regular.year);
    const remaining = available - depreciation - specialDepreciation;
    if (remaining < memo) throw new AssetError("Sonder-AfA überschreitet den verfügbaren Buchwert");
    const isDisposalYear = asset.disposalDate?.startsWith(String(regular.year)) ?? false;
    const disposal = isDisposalYear ? remaining : 0;
    const closing = isDisposalYear ? 0 : remaining;
    rows.push({ ...regular, opening, depreciation, specialDepreciation, disposal, closing });
    bookValue = closing;
    if (closing === 0) break;
  }
  if (entries.size > 0) throw new AssetError("Für die Sonder-AfA fehlt im angegebenen Wirtschaftsjahr ein verfügbarer Buchwert");
  return rows;
}
