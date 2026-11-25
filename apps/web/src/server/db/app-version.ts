import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type postgres from "postgres";

/** Hinweis in der ersten Zeile auf Bestandsinstanzen (#841). */
export const VERSION_HISTORY_GENESIS_NOTE = "Versionsverlauf ab diesem Start aufgezeichnet; für die Zeit davor liegt keine Aufzeichnung vor.";

/**
 * Sucht ab `start` aufwärts die Wurzel-`package.json` (Name `haben`). Nicht über einen festen relativen Pfad: Im Image
 * ist dieser Code in Skripte und den Server gebündelt, `import.meta.url` zeigt dann auf die gebündelte Datei.
 */
export function findRootPackageJson(start = fileURLToPath(new URL(".", import.meta.url))): string | null {
  for (let dir = start; ; dir = dirname(dir)) {
    const path = join(dir, "package.json");
    if (existsSync(path) && (JSON.parse(readFileSync(path, "utf8")) as { name?: unknown }).name === "haben") return path;
    if (dirname(dir) === dir) return null;
  }
}

/**
 * Liest die Haben-Version aus der Wurzel-`package.json`. Gibt `null` zurück, wenn die Datei in einer
 * isolierten Testumgebung außerhalb des Repositories fehlt.
 */
export function readAppVersion(packageJsonPath = findRootPackageJson()): string | null {
  if (!packageJsonPath || !existsSync(packageJsonPath)) return null;
  const parsed = JSON.parse(readFileSync(packageJsonPath, "utf8")) as { version?: unknown };
  return typeof parsed.version === "string" && parsed.version.length > 0 ? parsed.version : null;
}

/**
 * Hält die gestartete Haben- und PostgreSQL-Version fest (GoBD, BMF-Schreiben vom 28.11.2019, Rz. 150 und Rz. 154),
 * sobald die Haben- oder die PostgreSQL-Version vom zuletzt protokollierten Eintrag abweicht (inklusive Zurückrollen auf ältere Stände).
 */
export async function recordAppVersion(client: postgres.Sql, version = readAppVersion()): Promise<boolean> {
  if (!version) return false;
  return client.begin(async (tx) => {
    await tx`select set_config('haben.actor', 'system:migration', true)`;
    const [last] = await tx<{ version: string; sameServer: boolean }[]>`
      select version, postgres_version = current_setting('server_version') as "sameServer"
      from app_versions order by id desc limit 1
    `;
    if (last?.version === version && last.sameServer) return false;

    let note: string | null = null;
    if (!last) {
      const [existing] = await tx<{ existing: boolean }[]>`
        select (
          exists(select 1 from audit_log where actor is distinct from 'system:migration')
          or exists(select 1 from "user")
          or exists(select 1 from company)
        ) as existing
      `;
      if (existing?.existing) note = VERSION_HISTORY_GENESIS_NOTE;
    }

    await tx`
      insert into app_versions (version, postgres_version, note)
      values (${version}, current_setting('server_version'), ${note})
    `;
    return true;
  });
}
