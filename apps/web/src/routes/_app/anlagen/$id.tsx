import {
  ASSET_KINDS,
  ASSET_METHODS,
  formatDecimal,
  parseEuro,
  formatDegressiveRate,
  elektroAvailable,
  isKapitalgesellschaft,
  type SpecialDepreciationAmount,
} from "@haben/core";
import { Link, createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Field } from "../../../components/Field.tsx";
import { AssetForm } from "../../../components/AssetForm.tsx";
import { formatDate } from "../../../lib/format.ts";
import { NoticeBanner } from "../../../components/NoticeBanner.tsx";
import { useSubmitCheck } from "../../../lib/use-submit-check.ts";
import { useAction } from "../../../lib/use-action.ts";
import { deleteAssetFn, getAssetDetail, updateAssetFn } from "../../../server/functions/assets.ts";
import { ConfirmDialog } from "../../../components/ConfirmDialog.tsx";
import { ScrollBox } from "../../../components/ScrollTable.tsx";
import { Status } from "../../../components/Status.tsx";

export const Route = createFileRoute("/_app/anlagen/$id")({
  loader: ({ params }) => getAssetDetail({ data: params.id }),
  head: ({ loaderData }) => ({ meta: [{ title: `${loaderData?.asset.name ?? "Anlage"} · Haben` }] }),
  component: AssetPage,
});

function AssetPage() {
  const { asset, schedule, bookedYears } = Route.useLoaderData();
  const { rechtsform } = Route.useRouteContext();
  const router = useRouter();
  const navigate = useNavigate();
  const update = useServerFn(updateAssetFn);
  const remove = useServerFn(deleteAssetFn);
  const { busy, notice, run } = useAction();
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const booked = bookedYears.length > 0 || asset.openingEntryId !== null;
  const fromDocument = asset.documentId !== null;
  const lastBooked = bookedYears.at(-1) ?? null;
  // § 7 Abs. 3 EStG: Wechsel zur linearen AfA, solange er noch nicht gebucht ist
  const switchEditable = asset.method === "degressiv" && (lastBooked === null || asset.linearFromYear === null || asset.linearFromYear > lastBooked);

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">
            <Link to="/anlagen">Anlagen</Link> › {ASSET_KINDS[asset.kind].label}
          </div>
          <h1>{asset.name}</h1>
        </div>
        {!booked && !fromDocument && (
          <div className="actions">
            <button type="button" className="btn btn-danger" disabled={busy} onClick={() => setConfirmingDelete(true)}>
              Löschen
            </button>
            <ConfirmDialog
              open={confirmingDelete}
              title={`${asset.name} löschen?`}
              confirmLabel="Anlage löschen"
              danger
              onConfirm={() =>
                run(async () => {
                  await remove({ data: asset.id });
                  await navigate({ to: "/anlagen" });
                })
              }
              onClose={() => setConfirmingDelete(false)}
            >
              <p>Die Anlage wird endgültig entfernt. Das lässt sich nicht rückgängig machen.</p>
            </ConfirmDialog>
          </div>
        )}
      </div>
      <NoticeBanner notice={notice} />

      <div className="grid-main">
        <section className="card stack" aria-labelledby="plan-heading">
          <h2 id="plan-heading">Abschreibungsplan</h2>
          <p className="small muted" style={{ margin: 0 }}>
            {ASSET_METHODS[asset.method]}
            {asset.usefulLifeMonths ? `, ${asset.usefulLifeMonths / 12} Jahre` : ""}
            {asset.degressiveRate ? `, ${formatDegressiveRate(asset.degressiveRate)}` : ""}
            {asset.linearFromYear ? `, linear ab ${asset.linearFromYear}` : ""}
            {asset.memoValue ? ", Erinnerungswert 1 €" : ""} · Konto {asset.account} ·{" "}
            {fromDocument ? (
              <Link to="/belege/$id" params={{ id: asset.documentId! }}>
                Anschaffungsbeleg
              </Link>
            ) : (
              `übernommen zum ${formatDate(asset.openingDate!)}`
            )}
          </p>
          <ScrollBox label="Jahresbeträge der Anlage">
            <div className="table">
              <div className="table-row head plan-cols">
                <div>Jahr (€)</div>
                <div className="num">Buchwert Anfang</div>
                <div className="num">Zugang</div>
                <div className="num">AfA</div>
                <div className="num">Abgang</div>
                <div className="num">Buchwert Ende</div>
                <div />
              </div>
              {schedule.map((row) => (
                <div key={row.year} className="table-row plan-cols">
                  <div className="mono">{row.year}</div>
                  <div className="num">{formatDecimal(row.opening)}</div>
                  <div className="num">{formatDecimal(row.addition)}</div>
                  <div className="num">
                    {formatDecimal(row.depreciation)}
                    {row.specialDepreciation ? <div className="small">+ {formatDecimal(row.specialDepreciation)} Sonder-AfA</div> : null}
                  </div>
                  <div className="num">{formatDecimal(row.disposal)}</div>
                  <div className="num">{formatDecimal(row.closing)}</div>
                  <div>{bookedYears.includes(row.year) ? <Status tone="ok">Gebucht</Status> : null}</div>
                </div>
              ))}
            </div>
          </ScrollBox>
        </section>

        <section className="card stack" aria-labelledby="edit-heading">
          <h2 id="edit-heading">Angaben</h2>
          {(booked || fromDocument) && (
            <p className="small muted" style={{ margin: 0 }}>
              {booked
                ? "Es ist schon gebucht; änderbar sind Bezeichnung und Notiz sowie für ungebuchte Jahre Abgang, Sonder-AfA und der Wechsel von degressiver zu linearer AfA."
                : "Art, Datum und Kosten kommen aus dem gebuchten Beleg; bis zur ersten AfA lassen sich Abschreibung und Nutzungsdauer ändern."}
            </p>
          )}
          {!isKapitalgesellschaft(rechtsform) && (asset.method === "linear" || asset.method === "degressiv") && (
            <SpecialDepreciationForm
              key={`sonder-afa-${asset.updatedAt.toISOString()}`}
              asset={asset}
              lastBooked={lastBooked}
              busy={busy}
              onSave={(specialDepreciation) =>
                run(async () => {
                  await update({ data: { id: asset.id, asset: { name: asset.name, specialDepreciation } } });
                  await router.invalidate({ sync: true });
                }, "Sonder-AfA gespeichert.")
              }
            />
          )}
          <AssetForm
            key={`angaben-${asset.updatedAt.toISOString()}`}
            initial={{
              name: asset.name,
              kind: asset.kind,
              method: asset.method,
              acquisitionDate: asset.acquisitionDate,
              cost: asset.cost,
              usefulLifeMonths: asset.usefulLifeMonths,
              degressiveRate: asset.degressiveRate,
              linearFromYear: asset.linearFromYear,
              memoValue: asset.memoValue,
              openingDate: asset.openingDate ?? "",
              openingBookValue: asset.openingBookValue ?? 0,
              disposalDate: asset.disposalDate,
              privateUse: asset.privateUse,
              note: asset.note,
            }}
            locked={booked || fromDocument}
            privateUseAvailable={!isKapitalgesellschaft(rechtsform)}
            elektroOffered={elektroAvailable(rechtsform)}
            privateUseLocked={booked}
            lifeEditable={!booked}
            switchEditable={switchEditable}
            showOpening={!fromDocument}
            submitLabel="Speichern"
            busy={busy}
            onSubmit={(values) =>
              run(async () => {
                const { openingDate, openingBookValue, ...rest } = values;
                await update({
                  data: { id: asset.id, asset: fromDocument ? rest : { ...rest, openingDate, openingBookValue } },
                });
                await router.invalidate({ sync: true });
              }, "Gespeichert.")
            }
          />
        </section>
      </div>
    </>
  );
}

function SpecialDepreciationForm({
  asset,
  lastBooked,
  busy,
  onSave,
}: {
  asset: { acquisitionDate: string; specialDepreciation: SpecialDepreciationAmount[] };
  lastBooked: number | null;
  busy: boolean;
  onSave: (entries: SpecialDepreciationAmount[]) => Promise<boolean>;
}) {
  const years = Array.from({ length: 5 }, (_, index) => {
    const year = Number(asset.acquisitionDate.slice(0, 4)) + index;
    return { year, amount: asset.specialDepreciation.find((entry) => entry.year === year)?.amount ?? 0, locked: year <= (lastBooked ?? 0) };
  });
  const [values, setValues] = useState(() => Object.fromEntries(years.map(({ year, amount }) => [year, formatDecimal(amount)])));
  const [confirmed, setConfirmed] = useState(false);
  const amounts = years.map(({ year, amount, locked }) => ({
    year,
    amount: locked ? amount : parseEuro(values[year] || "0"),
    locked,
  }));
  const needsConfirmation = amounts.some(({ locked, amount }) => !locked && (amount ?? 0) > 0);
  const errors = Object.fromEntries(
    amounts.map(({ year, amount }) => [String(year), amount === null || amount < 0 ? "Trag einen Betrag ab 0 € in vollen Cent ein." : null]),
  );
  const { form, error, check } = useSubmitCheck<string>({
    ...errors,
    confirmed: needsConfirmation && !confirmed ? "Bestätige die Voraussetzungen für die Sonder-AfA." : null,
  });
  return (
    <form
      ref={form}
      noValidate
      className="form-section"
      onSubmit={(event) => {
        event.preventDefault();
        if (!check()) return;
        void onSave(amounts.flatMap(({ year, amount }) => (amount && amount > 0 ? [{ year, amount }] : [])));
      }}
    >
      <h3>Sonder-AfA nach § 7g EStG</h3>
      {years.map(({ year, locked }) => (
        <Field key={year} label={`${year} (€)`} error={error(String(year))}>
          {(control) => (
            <input
              {...control}
              inputMode="decimal"
              value={values[year]}
              disabled={locked}
              onChange={(event) => setValues({ ...values, [year]: event.target.value })}
            />
          )}
        </Field>
      ))}
      <label className="checkbox">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(event) => setConfirmed(event.target.checked)}
          aria-required={needsConfirmation}
          aria-invalid={Boolean(error("confirmed"))}
          aria-describedby={error("confirmed") ? "sonder-afa-bestaetigung-fehler" : undefined}
        />{" "}
        Der maßgebliche Vorjahresgewinn beträgt höchstens 200.000 €. Die Anlage wird im Anschaffungsjahr und im Folgejahr vermietet oder zu mindestens 90 % in
        einer inländischen Betriebsstätte betrieblich genutzt.
      </label>
      {error("confirmed") && (
        <p id="sonder-afa-bestaetigung-fehler" className="field-error">
          {error("confirmed")}
        </p>
      )}
      <div className="actions">
        <button type="submit" className="btn" disabled={busy}>
          Sonder-AfA speichern
        </button>
      </div>
    </form>
  );
}
