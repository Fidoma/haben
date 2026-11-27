import { currentFilingPeriod, isKapitalgesellschaft } from "@haben/core";
import { Link, redirect, createFileRoute } from "@tanstack/react-router";
import { BackupCard } from "../../components/BackupCard.tsx";
import { BankverbindungenCard } from "../../components/BankverbindungenCard.tsx";
import { BereicheCard } from "../../components/BereicheCard.tsx";
import { ArchiveSearchCard } from "../../components/ArchiveSearchCard.tsx";
import { ArchiveTargetCard } from "../../components/ArchiveTargetCard.tsx";
import { DatevCard } from "../../components/DatevCard.tsx";
import { KontoabrufKarten } from "../../components/FintsCard.tsx";
import { ExchangeRatesCard } from "../../components/ExchangeRatesCard.tsx";
import { ExportCard } from "../../components/ExportCard.tsx";
import { SettingsExportCard } from "../../components/SettingsExportCard.tsx";
import { SettingsImportCard } from "../../components/SettingsImportCard.tsx";
import { InboxCard } from "../../components/InboxCard.tsx";
import { IntegrityCard } from "../../components/IntegrityCard.tsx";
import { DatabaseAccessCard } from "../../components/DatabaseAccessCard.tsx";
import { LatestVersionCard } from "../../components/LatestVersionCard.tsx";
import { VersionsCard } from "../../components/VersionsCard.tsx";
import { ProcedureDocCard } from "../../components/ProcedureDocCard.tsx";
import { AccentColorCard } from "../../components/AccentColorCard.tsx";
import { LetterheadBackgroundCard, LetterheadOptionsCard } from "../../components/GestaltungCards.tsx";
import { LayoutsCard } from "../../components/LayoutsCard.tsx";
import { getLayouts } from "../../server/functions/layouts.ts";
import { FooterCard } from "../../components/FooterCard.tsx";
import { CustomerNumberCard } from "../../components/CustomerNumberCard.tsx";
import { NumberFormatCard } from "../../components/NumberFormatCard.tsx";
import { NumberingCard } from "../../components/NumberingCard.tsx";
import { PlanTemplatesCard } from "../../components/PlanTemplatesCard.tsx";
import { InvoiceAttachments } from "../../components/InvoiceAttachments.tsx";
import { getQuoteDefaultAttachments } from "../../server/functions/invoice-attachments.ts";
import { MailCard } from "../../components/MailCard.tsx";
import { EigeneSeitenCard } from "../../components/EigeneSeitenCard.tsx";
import { OwnAccountsCard } from "../../components/OwnAccountsCard.tsx";
import { McpCard } from "../../components/McpCard.tsx";
import { ExtractionCard } from "../../components/ExtractionCard.tsx";
import { ExtractionLimitsCard } from "../../components/ExtractionLimitsCard.tsx";
import { PasskeysCard } from "../../components/PasskeysCard.tsx";
import { PasswordCard } from "../../components/PasswordCard.tsx";
import { SsoZugaengeCard } from "../../components/SsoZugaengeCard.tsx";
import { ZugaengeCard } from "../../components/ZugaengeCard.tsx";
import { getBackupStatus } from "../../server/functions/backup.ts";
import { getEnableBankingSettings } from "../../server/functions/bank.ts";
import { getPspSettings } from "../../server/functions/zahlungsdienstleister.ts";
import { anbieterAufzaehlung } from "../../lib/zahlungsdienstleister-text.ts";
import { SETTINGS_AREAS, settingsAreas, type SettingsArea } from "../../lib/settings-areas.ts";
import { getCompany, getExchangeRates } from "../../server/functions/company.ts";
import reportStyles from "../../styles/auswertungen.css?url";
import { getEricStatus } from "../../server/functions/eric.ts";
import { getCustomPages } from "../../server/functions/eigene-seiten.ts";
import { getExportArea } from "../../server/functions/export.ts";
import { getNumbering } from "../../server/functions/invoices.ts";
import { getInbox } from "../../server/functions/inbox.ts";
import { getAppVersions, getChainHead, getDatabaseAccessInfo } from "../../server/functions/integrity.ts";
import { getBackground, getFooterPreview, getLetterheadDesign, getLogo } from "../../server/functions/logo.ts";
import { getMailSettings } from "../../server/functions/mail.ts";
import { getMcpSettings } from "../../server/functions/mcp.ts";
import { getZugaenge } from "../../server/functions/zugang.ts";
import { getExtractionSettings } from "../../server/functions/documents.ts";
import { getVatPeriod } from "../../server/functions/vat.ts";
import { CompanyForm } from "../../components/firma/FirmaForm.tsx";
import { NavMarkCard } from "../../components/NavMarkCard.tsx";
import { getOwnAccounts } from "../../server/functions/eigene-konten.ts";
import { SettingsHead, SettingsNav } from "../../components/SettingsNav.tsx";
import { UnitsCard } from "../../components/UnitsCard.tsx";
import { getUnits } from "../../server/functions/units.ts";
import { getBankverbindungen } from "../../server/functions/bankverbindungen.ts";
import { TaxpayerForm } from "./-einstellungen-steuerpflichtige.tsx";
import { CertificateForm, EricCard } from "./-einstellungen-elster.tsx";

/** Anbindungen unter Bank: Zugang der Installation zu Enable Banking und FinTS; die Verbindungen selbst stehen unter Geld › Verbindungen */
async function loadBankConnections() {
  const [enableBanking, zahlungsdienstleister] = await Promise.all([getEnableBankingSettings(), getPspSettings()]);
  return { enableBanking, zahlungsdienstleister };
}

/** Beleggestaltung: Logo, Briefpapier, Gestaltung, Layouts und Vorschau der Fußzeile */
async function loadGestaltung() {
  const [logo, background, design, overview, footerPreview] = await Promise.all([
    getLogo(),
    getBackground(),
    getLetterheadDesign(),
    getLayouts(),
    getFooterPreview(),
  ]);
  return { logo, background, design, layouts: overview.layouts, layoutHints: overview.hints, footerPreview };
}

export const Route = createFileRoute("/_app/einstellungen")({
  beforeLoad: ({ context, search }) => {
    if (context.oidc.only && search.bereich === "sicherheit") throw redirect({ to: "/einstellungen", search: { bereich: "zugaenge" }, replace: true });
    if (!context.oidc.only && search.bereich === "zugaenge") throw redirect({ to: "/einstellungen", search: { bereich: "sicherheit" }, replace: true });
  },
  loader: async () => {
    const [
      company,
      vat,
      numbering,
      eric,
      mail,
      gestaltung,
      inbox,
      exportArea,
      chainHead,
      appVersions,
      databaseAccess,
      backup,
      mcp,
      rates,
      bankConnections,
      customPages,
      zugaenge,
      extraction,
      quoteDefaultAttachments,
      ownAccounts,
      units,
      bankverbindungen,
    ] = await Promise.all([
      getCompany(),
      getVatPeriod({ data: currentFilingPeriod(new Date()) }),
      getNumbering(),
      getEricStatus(),
      getMailSettings(),
      loadGestaltung(),
      getInbox(),
      getExportArea(),
      getChainHead(),
      getAppVersions(),
      getDatabaseAccessInfo(),
      getBackupStatus(),
      getMcpSettings(),
      getExchangeRates(),
      loadBankConnections(),
      getCustomPages(),
      getZugaenge(),
      getExtractionSettings(),
      getQuoteDefaultAttachments(),
      getOwnAccounts(),
      getUnits(),
      getBankverbindungen(),
    ]);
    return {
      ...company,
      certificate: vat.certificate,
      mode: vat.mode,
      numbering,
      eric,
      mail,
      ...gestaltung,
      inbox,
      ...exportArea,
      chainHead,
      appVersions,
      databaseAccess,
      backup,
      mcp,
      rates,
      ...bankConnections,
      customPages,
      zugaenge,
      extraction,
      quoteDefaultAttachments,
      ownAccounts,
      units,
      bankverbindungen,
    };
  },
  head: () => ({ meta: [{ title: "Einstellungen · Haben" }], links: [{ rel: "stylesheet", href: reportStyles }] }),
  validateSearch: (search: Record<string, unknown>): { bereich?: SettingsArea } =>
    search.bereich === "zugaenge" || SETTINGS_AREAS.some((a) => a.id === search.bereich) ? { bereich: search.bereich as SettingsArea } : {},
  component: SettingsPage,
});

function SettingsPage() {
  const { oidc, ausgeblendet } = Route.useRouteContext();
  const {
    company,
    numbering,
    logo,
    background,
    design,
    layouts,
    layoutHints,
    mail,
    inbox,
    exportYears,
    datev,
    chainHead,
    appVersions,
    databaseAccess,
    backup,
    mcp,
    rates,
    enableBanking,
    zahlungsdienstleister,
    customPages,
    zugaenge,
    extraction,
    quoteDefaultAttachments,
    ownAccounts,
    units,
    bankverbindungen,
    footerPreview,
    ablage,
    neueInstanz,
  } = Route.useLoaderData();
  const search = Route.useSearch();
  const bereich = search.bereich ?? "firma";
  // Ohne ?bereich zeigt das Handy nur die Liste der Bereiche, der Desktop daneben die Firma
  const uebersicht = search.bereich === undefined;
  // Eine GmbH oder UG zahlt keine Einkommensteuer; die persönlichen Angaben braucht ELSTER dort für Nachrichten und Postfach
  const areas = settingsAreas(oidc.only).map((a) =>
    a.id === "persoenlich" && isKapitalgesellschaft(company.rechtsform) ? { ...a, hint: "Für Nachrichten an das Finanzamt" } : a,
  );
  const area = areas.find((a) => a.id === bereich)!;
  return (
    <>
      <SettingsHead area={area} uebersicht={uebersicht} />
      <div className="settings-layout" data-uebersicht={uebersicht || undefined}>
        <SettingsNav areas={areas} current={bereich} uebersicht={uebersicht} />
        <div className="stack settings-content" aria-label={area.label}>
          {bereich === "firma" && (
            <>
              <CompanyForm />
              <BankverbindungenCard bankverbindungen={bankverbindungen} />
              <NavMarkCard color={company.navColor} logo={company.navLogo} logoSha256={logo?.sha256 ?? null} />
            </>
          )}
          {bereich === "persoenlich" && <TaxpayerForm />}
          {bereich === "bereiche" && <BereicheCard ausgeblendet={ausgeblendet} />}
          {bereich === "rechnungen" && (
            <>
              <NumberingCard numbering={numbering.invoice} />
              <NumberingCard numbering={numbering.quote} />
              <NumberFormatCard
                invoice={company.invoiceNumberFormat}
                quote={company.quoteNumberFormat}
                invoiceRunning={company.invoiceCounterRunning}
                quoteRunning={company.quoteCounterRunning}
                invoicePerCustomer={company.invoiceCounterPerCustomer}
                quotePerCustomer={company.quoteCounterPerCustomer}
                date={numbering.invoice.date}
              />
              <UnitsCard units={units} />
              <PlanTemplatesCard templates={company.paymentPlanTemplates} />
              <InvoiceAttachments kind="standard" attachments={quoteDefaultAttachments} editable />
              <CustomerNumberCard format={company.customerNumberFormat} next={company.customerNumberNext} date={numbering.invoice.date} />
            </>
          )}
          {bereich === "gestaltung" && (
            <>
              <LetterheadOptionsCard design={design} logo={logo?.sha256 ?? null} hints={layoutHints} />
              <LetterheadBackgroundCard design={design} background={background?.sha256 ?? null} hints={layoutHints} />
              <AccentColorCard color={design.accent} fromLayout={design.accentFromLayout} hint={layoutHints.accent} />
              <FooterCard design={design} seller={company} preview={footerPreview} hints={layoutHints} hidden={design.footerHidden && background !== null} />
              <LayoutsCard design={design} layouts={layouts} />
            </>
          )}
          {bereich === "elster" && (
            <>
              <CertificateForm />
              <EricCard />
            </>
          )}
          {bereich === "email" && (
            <>
              <MailCard data={mail} />
              <InboxCard data={inbox} />
            </>
          )}
          {bereich === "bank" && (
            <>
              <KontoabrufKarten data={enableBanking} />
              <section className="card" aria-labelledby="psp-heading">
                <h2 id="psp-heading">Zahlungsdienstleister und Stores</h2>
                <p className="small muted" style={{ margin: 0 }}>
                  {anbieterAufzaehlung(zahlungsdienstleister.anbieter.map((a) => a.name))}, Etsy Payments und die Berichte von Google Play und App Store
                  verbindest du unter <Link to="/bank/verbindungen">Geld › Verbindungen</Link>.
                </p>
              </section>
            </>
          )}
          {bereich === "zugaenge" && zugaenge.mode === "sso" && <SsoZugaengeCard accounts={zugaenge.ssoAccounts} providerName={oidc.name} />}
          {bereich === "sicherheit" && zugaenge.mode === "lokal" && (
            <>
              <PasskeysCard />
              <PasswordCard />
              <ZugaengeCard data={zugaenge} />
            </>
          )}
          {bereich === "ki" && (
            <>
              <McpCard data={mcp} />
              <ExtractionCard settings={extraction} />
              {extraction.provider !== null && <ExtractionLimitsCard limits={extraction.limits} />}
            </>
          )}
          {bereich === "konten" && <OwnAccountsCard overview={ownAccounts} />}
          {bereich === "seiten" && <EigeneSeitenCard pages={customPages} />}
          {bereich === "waehrung" && <ExchangeRatesCard data={rates} />}
          {bereich === "export" && (
            <>
              <SettingsImportCard neueInstanz={neueInstanz} />
              <ExportCard years={exportYears} />
              <SettingsExportCard />
              <DatevCard years={exportYears} numbers={datev} />
              <ArchiveTargetCard data={ablage} />
              <IntegrityCard head={chainHead} />
              <LatestVersionCard />
              <VersionsCard versions={appVersions} />
              <DatabaseAccessCard access={databaseAccess} />
              <BackupCard status={backup} />
              <ProcedureDocCard />
              <ArchiveSearchCard enabled={company.archiveSearch} />
            </>
          )}
        </div>
      </div>
    </>
  );
}
