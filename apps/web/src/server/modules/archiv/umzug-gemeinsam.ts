import { reportInternalError, UserError, userMessage } from "../../errors.ts";
import type { LegacyVoucher } from "@haben/import";
import { sniff } from "../../storage.ts";

export class LexofficeError extends UserError {}
export function progressMessage(error: unknown): string {
  const message = userMessage(error);
  return message ?? reportInternalError("Lexoffice-Abruf", error);
}
export function fallbackName(voucher: Pick<LegacyVoucher, "number" | "lexofficeId">, role: "pdf" | "xml" | "anhang", bytes: Uint8Array): string {
  const base = (voucher.number || voucher.lexofficeId).replace(/[^\w.-]+/g, "_");
  const kind = sniff(bytes)?.kind;
  const extension = role === "xml" ? "xml" : kind === "jpeg" ? "jpg" : (kind ?? "pdf");
  return `${base}.${extension}`;
}
