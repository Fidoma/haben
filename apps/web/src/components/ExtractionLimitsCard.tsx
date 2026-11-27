import { useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState, type FormEvent } from "react";
import { useAction } from "../lib/use-action.ts";
import { useSubmitCheck } from "../lib/use-submit-check.ts";
import { saveExtractionLimitsFn } from "../server/functions/documents.ts";
import { Field } from "./Field.tsx";
import { NoticeBanner } from "./NoticeBanner.tsx";

type Limits = { maxParallel: number; maxTokensPerRequest: number | null; requestsPerMinute: number | null; tokensPerMinute: number | null };
type Key = keyof Limits;
type Grenze = Exclude<Key, "maxParallel">;

const PARALLEL_HOECHSTENS = 20;

const FELDER: { key: Grenze; label: string; hint: string }[] = [
  { key: "maxTokensPerRequest", label: "Tokens je Anfrage", hint: "Größere Anfragen schickt Haben nicht; der Grund steht am Beleg" },
  { key: "requestsPerMinute", label: "Anfragen pro Minute", hint: "Etwa RPM bei Azure OpenAI oder rpm in LiteLLM" },
  { key: "tokensPerMinute", label: "Tokens pro Minute", hint: "Etwa TPM bei Azure OpenAI oder tpm in LiteLLM" },
];

const HOECHSTENS = 100_000_000;
const text = (value: number | null) => (value === null ? "" : String(value));
const parallel = (value: string): number | undefined => {
  const n = zahl(value);
  return n != null && n <= PARALLEL_HOECHSTENS ? n : undefined;
};
/** Leer = keine Grenze; sonst eine ganze Zahl ab 1, Punkte als Tausendertrenner erlaubt */
const zahl = (value: string): number | null | undefined => {
  const plain = value.trim().replace(/\./g, "");
  if (plain === "") return null;
  if (!/^\d+$/.test(plain)) return undefined;
  const n = Number(plain);
  return n >= 1 && n <= HOECHSTENS ? n : undefined;
};

/**
 * Einstellungen › KI-Assistenten und API: Grenzen des KI-Dienstes (#1735), passend zum Kontingent des Anbieters. Jede ist
 * optional; Haben schickt die nächste Anfrage erst, wenn sie alle gesetzten einhält.
 */
export function ExtractionLimitsCard({ limits }: { limits: Limits }) {
  const router = useRouter();
  const save = useServerFn(saveExtractionLimitsFn);
  const { busy, notice, run } = useAction();
  const [werte, setWerte] = useState<Record<Key, string>>({
    maxParallel: text(limits.maxParallel),
    maxTokensPerRequest: text(limits.maxTokensPerRequest),
    requestsPerMinute: text(limits.requestsPerMinute),
    tokensPerMinute: text(limits.tokensPerMinute),
  });
  const fehler = (key: Grenze) => (zahl(werte[key]) === undefined ? "Eine ganze Zahl ab 1, oder leer für keine Grenze." : null);
  const { form, error, check } = useSubmitCheck({
    maxParallel: parallel(werte.maxParallel) === undefined ? `Eine ganze Zahl von 1 bis ${PARALLEL_HOECHSTENS}.` : null,
    maxTokensPerRequest: fehler("maxTokensPerRequest"),
    requestsPerMinute: fehler("requestsPerMinute"),
    tokensPerMinute: fehler("tokensPerMinute"),
  });

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!check()) return;
    const data = {
      maxParallel: parallel(werte.maxParallel)!,
      maxTokensPerRequest: zahl(werte.maxTokensPerRequest) ?? null,
      requestsPerMinute: zahl(werte.requestsPerMinute) ?? null,
      tokensPerMinute: zahl(werte.tokensPerMinute) ?? null,
    };
    void run(async () => {
      await save({ data });
      await router.invalidate();
    }, "Grenzen gespeichert.");
  };

  return (
    <section className="card" aria-labelledby="extraction-limits-heading">
      <h2 id="extraction-limits-heading">Grenzen der Belegauslesung</h2>
      <p className="small muted" style={{ margin: 0, maxWidth: 760 }}>
        Haben liest höchstens so viele Belege gleichzeitig aus, wie unter „Parallele Anfragen“ steht. Begrenzt dein Anbieter die Anfragen, trag sein Kontingent
        hier ein: Haben schickt die nächste Anfrage erst, wenn sie alle gesetzten Grenzen einhält. Die Tokens einer Anfrage schätzt Haben vor dem Senden, eher
        zu hoch. Leer heißt keine Grenze.
      </p>
      <form ref={form} onSubmit={onSubmit} className="form-row cols-2" noValidate>
        <Field
          label="Parallele Anfragen"
          hint={`Belege, die Haben gleichzeitig ausliest, 1 bis ${PARALLEL_HOECHSTENS}; Vorgabe 4`}
          error={error("maxParallel")}
        >
          {(control) => (
            <input
              {...control}
              inputMode="numeric"
              value={werte.maxParallel}
              onChange={(e) => setWerte((prev) => ({ ...prev, maxParallel: e.target.value }))}
            />
          )}
        </Field>
        {FELDER.map(({ key, label, hint }) => (
          <Field key={key} label={label} hint={hint} error={error(key)}>
            {(control) => (
              <input
                {...control}
                inputMode="numeric"
                value={werte[key]}
                placeholder="keine Grenze"
                onChange={(e) => setWerte((prev) => ({ ...prev, [key]: e.target.value }))}
              />
            )}
          </Field>
        ))}
        <div className="actions" style={{ gridColumn: "1 / -1" }}>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            Grenzen speichern
          </button>
        </div>
      </form>
      <NoticeBanner notice={notice} />
    </section>
  );
}
