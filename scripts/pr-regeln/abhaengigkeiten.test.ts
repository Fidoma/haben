import { describe, expect, it } from "vitest";
import { abhaengigkeitHinweise, neueAbhaengigkeiten } from "./abhaengigkeiten.ts";

const paket = (felder: Record<string, Record<string, string>>) => JSON.stringify({ name: "x", ...felder });

describe("neueAbhaengigkeiten", () => {
  it("findet ein neues Paket je Feld und Datei", () => {
    const neu = neueAbhaengigkeiten([
      {
        file: "apps/web/package.json",
        before: paket({ dependencies: { zod: "^4" } }),
        after: paket({ dependencies: { zod: "^4", "left-pad": "^1" }, devDependencies: { vitest: "^5" } }),
      },
    ]);
    expect(neu).toEqual([
      { file: "apps/web/package.json", name: "left-pad", feld: "dependencies" },
      { file: "apps/web/package.json", name: "vitest", feld: "devDependencies" },
    ]);
  });

  it("meldet kein Update der Version, aber ein Paket, das von devDependencies zur Laufzeit wechselt", () => {
    const neu = neueAbhaengigkeiten([
      {
        file: "packages/core/package.json",
        before: paket({ dependencies: { zod: "^4.0.0" }, devDependencies: { fflate: "^0.8" } }),
        after: paket({ dependencies: { zod: "^4.6.5", fflate: "^0.8" } }),
      },
    ]);
    expect(neu).toEqual([{ file: "packages/core/package.json", name: "fflate", feld: "dependencies" }]);
  });

  it("meldet kein Paket, das zu den devDependencies oder zwischen den Feldern zur Laufzeit wechselt", () => {
    const neu = neueAbhaengigkeiten([
      {
        file: "apps/web/package.json",
        before: paket({ dependencies: { fflate: "^0.8", qrcode: "^1" } }),
        after: paket({ devDependencies: { fflate: "^0.8" }, optionalDependencies: { qrcode: "^1" } }),
      },
    ]);
    expect(neu).toEqual([]);
  });

  it("zählt bei einem neuen Workspace-Paket alles als neu, aber keine Pakete aus dem Workspace", () => {
    const neu = neueAbhaengigkeiten([
      { file: "packages/neu/package.json", before: null, after: paket({ dependencies: { "@haben/core": "workspace:*", qrcode: "^1" } }) },
    ]);
    expect(neu).toEqual([{ file: "packages/neu/package.json", name: "qrcode", feld: "dependencies" }]);
  });

  it("übersteht eine gelöschte oder kaputte package.json", () => {
    expect(neueAbhaengigkeiten([{ file: "a/package.json", before: paket({ dependencies: { zod: "^4" } }), after: null }])).toEqual([]);
    expect(neueAbhaengigkeiten([{ file: "a/package.json", before: null, after: "{ kaputt" }])).toEqual([]);
  });
});

describe("abhaengigkeitHinweise", () => {
  const neu = [
    { file: "apps/web/package.json", name: "left-pad", feld: "dependencies" },
    { file: "package.json", name: "vitest", feld: "devDependencies" },
  ];
  const mitBegruendung = "Text\n\n## Neue Abhängigkeiten\n\n- `left-pad`: weil …\n- `vitest`: weil …\n\n## Wie geprüft\n";

  it("warnt bei jeder neuen Abhängigkeit, auch mit Begründung", () => {
    const meldungen = abhaengigkeitHinweise(neu, mitBegruendung, false);
    expect(meldungen).toHaveLength(1);
    expect(meldungen[0]).toMatchObject({ level: "warning" });
    expect(meldungen[0]?.message).toContain("`left-pad` (apps/web/package.json, dependencies)");
    expect(meldungen[0]?.message).toContain("`vitest` (package.json, devDependencies)");
  });

  it("ist ein Fehler, wenn der Abschnitt fehlt oder ein Paket darin nicht genannt ist", () => {
    expect(abhaengigkeitHinweise(neu, "Ohne Abschnitt", false)).toContainEqual(expect.objectContaining({ level: "error" }));
    const halb = "## Neue Abhängigkeiten\n\n- `left-pad`: weil …\n\n## Wie geprüft\n\n`vitest` nur hier\n";
    const fehler = abhaengigkeitHinweise(neu, halb, false).find((m) => m.level === "error");
    expect(fehler?.message).toContain("`vitest`");
    expect(fehler?.message).not.toContain("`left-pad`");
  });

  it("zählt ein Paket nicht als begründet, nur weil sein Name in einem anderen Namen oder Wort steckt", () => {
    const pg = [
      { file: "apps/web/package.json", name: "pg", feld: "dependencies" },
      { file: "apps/web/package.json", name: "@types/pg", feld: "devDependencies" },
    ];
    const nurTypen = "## Neue Abhängigkeiten\n\n- `@types/pg`: Typen, ein Upgrade später unnötig\n";
    const fehler = abhaengigkeitHinweise(pg, nurTypen, false).find((m) => m.level === "error");
    expect(fehler?.message).toContain("Begründung fehlt für `pg`");
  });

  it("zählt den Namen vor einem deutschen Wort mit Bindestrich als genannt (`pg-Treiber`), nicht vor einem Paketnamen (`pg-boss`)", () => {
    const pg = [{ file: "apps/web/package.json", name: "pg", feld: "dependencies" }];
    const kompositum = "## Neue Abhängigkeiten\n\nDer pg-Treiber spricht mit Postgres, MIT, ohne weitere Pakete.\n";
    expect(abhaengigkeitHinweise(pg, kompositum, false).map((m) => m.level)).toEqual(["warning"]);
    const anderesPaket = "## Neue Abhängigkeiten\n\n- `pg-boss`: Warteschlange\n";
    expect(abhaengigkeitHinweise(pg, anderesPaket, false)).toContainEqual(expect.objectContaining({ level: "error" }));
  });

  it("verlangt von Bots keinen Abschnitt und meldet ohne neue Pakete nichts", () => {
    expect(abhaengigkeitHinweise(neu, null, true).map((m) => m.level)).toEqual(["warning"]);
    expect(abhaengigkeitHinweise([], null, false)).toEqual([]);
  });
});
