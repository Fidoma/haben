import type { IconName } from "../components/Icon.tsx";

export interface ModuleRegistration {
  id: string;
  navigation: { label: string; icon: IconName; hint: string; to: string; linkIcon: IconName; linkLabel: string };
  migrations: { directory: string; table: string };
}

/** Optionale Haben-Module mit ihren stabilen Einhängepunkten für Navigation und Datenbankmigrationen. */
export const MODULES = [
  {
    id: "webmail",
    navigation: {
      label: "Externe Dienste",
      icon: "external",
      hint: "Dienste, die Haben um Kommunikation und weitere Arbeitsabläufe ergänzen",
      to: "/webmail",
      linkIcon: "mail",
      linkLabel: "Web-Mail",
    },
    migrations: { directory: "webmail/migrations", table: "__webmail_migrations" },
  },
  {
    id: "pms",
    navigation: {
      label: "PMS",
      icon: "company",
      hint: "Zimmer, Reservierungen, Housekeeping und Meldestatistik an einem Ort",
      to: "/pms/belegungsplan",
      linkIcon: "calendar",
      linkLabel: "Belegungsplan",
    },
    migrations: { directory: "pms/migrations", table: "__pms_migrations" },
  },
] as const satisfies readonly ModuleRegistration[];
