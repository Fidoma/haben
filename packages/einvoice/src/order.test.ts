import { describe, expect, it } from "vitest";
import { buildConfirmationPdf, buildDeliveryNotePdf, confirmationPdfData, deliveryNotePdfData } from "./order.ts";
import { mixedRateLines, sampleDocument } from "./samples.ts";

const sample = sampleDocument({ lines: mixedRateLines });
const quote = {
  number: "AN-2026-004",
  issueDate: "2026-09-20",
  validUntil: "2026-10-20",
  seller: sample.seller,
  buyer: sample.buyer,
  lines: sample.lines,
  totals: sample.totals,
};

describe("Auftragsbestätigung und Lieferschein", () => {
  it("Auftragsbestätigung: Bezug aufs Angebot, Auftragssumme, Dank statt Gültigkeit", () => {
    const data = confirmationPdfData(quote, "2026-09-25");
    expect(data.title).toBe("Auftragsbestätigung");
    expect(data.meta.slice(0, 2)).toEqual([
      { label: "Datum", value: "25.09.2026" },
      { label: "Zu Angebot", value: "AN-2026-004 (20.09.2026)" },
    ]);
    expect(data.meta.map((m) => m.label)).not.toContain("Gültig bis");
    expect(data.totals.gross.label).toBe("Auftragssumme");
    expect(data.payment).toMatch(/^Vielen Dank für Ihren Auftrag/);
    expect(confirmationPdfData({ ...quote, language: "en" }, "2026-09-25").title).toBe("Order confirmation");
    expect(Buffer.from(buildConfirmationPdf(quote, "2026-09-25").subarray(0, 5)).toString()).toBe("%PDF-");
  });

  it("Lieferschein: Mengen ohne Preise, Feld für die Unterschrift", () => {
    const doc = {
      reference: { kind: "rechnung" as const, number: "2026-034", issueDate: "2026-10-02" },
      deliveryDate: "2026-09-30",
      date: "2026-10-02",
      seller: sample.seller,
      buyer: sample.buyer,
      lines: sample.lines,
    };
    const data = deliveryNotePdfData(doc);
    expect(data.title).toBe("Lieferschein");
    expect(data.meta).toContainEqual({ label: "Zu Rechnung", value: "2026-034 (02.10.2026)" });
    expect(data.lines[0]).toMatchObject({ description: "Workshop „Buchhaltung für Freiberufler“", quantity: "2 Tag", unitPrice: "", net: "" });
    expect(data.totals).toBeNull();
    expect(JSON.stringify(data)).not.toContain("€");
    expect(Buffer.from(buildDeliveryNotePdf(doc).subarray(0, 5)).toString()).toBe("%PDF-");
  });

  it("Lieferschein: Text zur Position unter der Bezeichnung, wie auf Rechnung und Angebot", () => {
    const [first, ...rest] = sample.lines;
    const doc = {
      reference: { kind: "angebot" as const, number: "AN-2026-004", issueDate: "2026-09-20" },
      deliveryDate: "2026-09-30",
      date: "2026-09-25",
      seller: sample.seller,
      buyer: sample.buyer,
      lines: [{ ...first!, detail: "  Agenda nach Abstimmung\nzwei Tage vor Ort " }, ...rest],
    };
    const data = deliveryNotePdfData(doc);
    expect(data.lines[0]?.detail).toBe("Agenda nach Abstimmung\nzwei Tage vor Ort");
    expect(data.lines[1]?.detail).toBeNull();
    expect(Buffer.from(buildDeliveryNotePdf(doc).subarray(0, 5)).toString()).toBe("%PDF-");
  });
  // Lieferschein bei Leistung über mehrere Tage: Zeitraum statt nur das Ende als Lieferdatum (#1865)
  describe("Lieferschein: Leistungszeitraum (#1865)", () => {
    const doc = {
      reference: { kind: "rechnung" as const, number: "2026-034", issueDate: "2026-10-02" },
      deliveryDate: "2026-09-30",
      date: "2026-10-02",
      seller: sample.seller,
      buyer: sample.buyer,
      lines: sample.lines,
    };

    it("zeigt bei Beginn vor dem Ende den Zeitraum statt des Lieferdatums", () => {
      const { meta } = deliveryNotePdfData({ ...doc, serviceFrom: "2026-09-29" });
      expect(meta).toContainEqual({ label: "Leistungszeitraum", value: "29.–30.09.2026" });
      expect(meta.map((m) => m.label)).not.toContain("Lieferdatum");
    });

    it("über Monatsgrenzen und englisch wie auf Rechnung und Angebot", () => {
      const { meta } = deliveryNotePdfData({ ...doc, deliveryDate: "2026-10-14", serviceFrom: "2026-09-15", language: "en" });
      expect(meta).toContainEqual({ label: "Service period", value: "15 Sept – 14 Oct 2026" });
      expect(deliveryNotePdfData({ ...doc, deliveryDate: "2026-10-14", serviceFrom: "2026-09-15" }).meta).toContainEqual({
        label: "Leistungszeitraum",
        value: "15.09.–14.10.2026",
      });
    });

    it("bleibt beim Lieferdatum, wenn Beginn und Ende auf einen Tag fallen oder der Beginn fehlt", () => {
      for (const serviceFrom of [undefined, "2026-09-30"]) {
        const { meta } = deliveryNotePdfData({ ...doc, ...(serviceFrom ? { serviceFrom } : {}) });
        expect(meta).toContainEqual({ label: "Lieferdatum", value: "30.09.2026" });
        expect(meta.map((m) => m.label)).not.toContain("Leistungszeitraum");
      }
    });
  });
});
