import { describe, expect, it } from "vitest";
import { depreciationSchedule } from "./afa.ts";
import { specialDepreciationIssues } from "./afa-sonder.ts";

describe("Sonder-AfA nach § 7g EStG", () => {
  const amounts = [
    { year: 2024, amount: 150_000 },
    { year: 2028, amount: 250_000 },
  ];

  it("erlaubt bis zu 40 Prozent verteilt über fünf Wirtschaftsjahre", () => {
    expect(specialDepreciationIssues("2024-12-31", 1_000_000, amounts)).toEqual([]);
  });

  it("wendet für Anschaffungen vor 2024 die Grenze von 20 Prozent an", () => {
    expect(specialDepreciationIssues("2023-12-31", 1_000_000, [{ year: 2024, amount: 200_001 }])).toHaveLength(1);
  });

  it("lehnt Beträge außerhalb des Zeitraums und doppelte Jahre ab", () => {
    expect(specialDepreciationIssues("2024-01-01", 1_000_000, [{ year: 2029, amount: 1 }])).toHaveLength(1);
    expect(specialDepreciationIssues("2024-01-01", 1_000_000, [amounts[0]!, amounts[0]!])).toHaveLength(1);
  });

  it("lehnt negative Beträge und Bruchteile eines Cents ab", () => {
    expect(specialDepreciationIssues("2024-01-01", 1_000_000, [{ year: 2024, amount: -1 }])).toHaveLength(1);
    expect(specialDepreciationIssues("2024-01-01", 1_000_000, [{ year: 2024, amount: 1.5 }])).toHaveLength(1);
  });
});

describe("linearer Plan mit Sonder-AfA", () => {
  const asset = {
    acquisitionDate: "2024-01-01",
    cost: 1_000_000,
    method: "linear" as const,
    usefulLifeMonths: 120,
  };

  it("weist Sonder-AfA getrennt aus und verteilt den Restwert ab Jahr sechs", () => {
    const plan = depreciationSchedule({ ...asset, specialDepreciation: [{ year: 2024, amount: 400_000 }] });
    expect(plan[0]).toMatchObject({ depreciation: 100_000, specialDepreciation: 400_000, closing: 500_000 });
    expect(plan[4]?.closing).toBe(100_000);
    expect(plan[5]).toMatchObject({ depreciation: 20_000, closing: 80_000 });
    expect(plan.at(-1)?.closing).toBe(0);
  });

  it("lehnt eine Sonder-AfA über dem verfügbaren Buchwert ab", () => {
    expect(() => depreciationSchedule({ ...asset, usefulLifeMonths: 12, specialDepreciation: [{ year: 2024, amount: 1 }] })).toThrow("Buchwert");
  });
});

describe("degressiver Plan mit Sonder-AfA", () => {
  it("verteilt Sonder-AfA bei einem vorzeitigen Wechsel erst ab dem sechsten Jahr neu", () => {
    const asset = {
      acquisitionDate: "2025-07-01",
      cost: 1_000_000,
      method: "degressiv" as const,
      usefulLifeMonths: 120,
      degressiveRate: 3000,
      linearFromYear: 2026,
    };
    const regular = depreciationSchedule(asset);
    const plan = depreciationSchedule({ ...asset, specialDepreciation: [{ year: 2025, amount: 200_000 }] });
    expect(plan.slice(1, 5).map((row) => row.depreciation)).toEqual(regular.slice(1, 5).map((row) => row.depreciation));
    expect(plan[5]?.depreciation).toBe(Math.round((plan[5]!.opening * 12) / 66));
  });

  it("berechnet die AfA des Folgejahres vom geminderten Buchwert", () => {
    const plan = depreciationSchedule({
      acquisitionDate: "2025-07-01",
      cost: 1_000_000,
      method: "degressiv",
      usefulLifeMonths: 120,
      degressiveRate: 3000,
      specialDepreciation: [{ year: 2025, amount: 200_000 }],
    });
    expect(plan[0]).toMatchObject({ depreciation: 150_000, specialDepreciation: 200_000, closing: 650_000 });
    expect(plan[1]).toMatchObject({ opening: 650_000, depreciation: 195_000 });
    expect(plan[5]).toMatchObject({ year: 2030, opening: 156_065, depreciation: 28_375 });
    expect(plan[6]?.depreciation).toBe(28_376);
    expect(plan.at(-1)?.closing).toBe(0);
  });
});

it.each(["2025-12-01", "2026-12-01"])("lehnt Sonder-AfA bei einem frühen Abgang am %s ab", (disposalDate) => {
  expect(() =>
    depreciationSchedule({
      acquisitionDate: "2025-07-01",
      cost: 1_000_000,
      method: "linear",
      usefulLifeMonths: 120,
      disposalDate,
      specialDepreciation: [{ year: 2025, amount: 200_000 }],
    }),
  ).toThrow("Ende des Folgejahres");
});

it("führt eine übernommene Anlage mit der bisherigen Sonder-AfA ab dem Stichtag fort", () => {
  const plan = depreciationSchedule({
    acquisitionDate: "2024-01-01",
    cost: 1_000_000,
    method: "linear",
    usefulLifeMonths: 120,
    opening: { date: "2026-01-01", bookValue: 400_000 },
    specialDepreciation: [{ year: 2024, amount: 400_000 }],
  });
  expect(plan[0]).toMatchObject({ year: 2026, opening: 400_000, addition: 0, depreciation: 100_000, closing: 300_000 });
  expect(plan.every((row) => row.year >= 2026)).toBe(true);
});
