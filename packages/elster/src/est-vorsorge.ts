import type { XmlNode } from "./erklaerung.ts";
import type { EstAngaben, EstArbeitnehmer, EstLohnsteuerbescheinigung, EstVorsorgePerson } from "./est.ts";
import { euro, euroAb, euroAuf } from "./est-werte.ts";

/* Anlage Vorsorgeaufwand der Einkommensteuererklärung (est.ts) */

type Arbeitnehmer = EstArbeitnehmer | undefined;

/**
 * Summe laut Lohnsteuerbescheinigungen mit Cent. In vollen Euro geht sie zugunsten der Person wie in der amtlichen Zuordnung
 * hinaus (euroAuf/euroAb, VAST_Vorberechnungen_<Jahr>.ods, Blatt „VaSt_LStB_Gesamt - Regeln“)
 */
const lstb = (an: Arbeitnehmer, key: keyof Omit<EstLohnsteuerbescheinigung, "steuerklasse">) =>
  an ? an.bescheinigungen.reduce((s, b) => s + (b[key] ?? 0), 0) : 0;

function altersvorsorge(person: string, v: EstVorsorgePerson | undefined, an: Arbeitnehmer): XmlNode | null {
  const rvAn = lstb(an, "rvArbeitnehmer");
  const rvAg = lstb(an, "rvArbeitgeber");
  // Regel 950020: Arbeitnehmer- und Arbeitgeberanteil nur gemeinsam, gegebenenfalls mit 0 (Berechne_E2000401, Berechne_E2000801)
  const lohn = rvAn !== 0 || rvAg !== 0;
  const felder: XmlNode[] = [
    ["E2000401", lohn ? (euroAuf(rvAn) ?? "0") : undefined],
    ["E2000601", euro(v?.rentenversicherung)],
    // Zeile 8: zertifizierte Basisrentenverträge (Rürup), teilt den Höchstbetrag mit Zeile 4 bis 6
    ["E2000701", euro(v?.basisrente)],
    ["E2000801", lohn ? (euroAb(rvAg) ?? "0") : undefined],
  ];
  return felder.some((f) => f[1]) ? ["AVor", [["Person", person], ...felder]] : null;
}

function gesetzlicheKvPv(person: string, v: EstVorsorgePerson | undefined, an: Arbeitnehmer): XmlNode | null {
  const kvAn = euroAuf(lstb(an, "kvArbeitnehmer"));
  const pvAn = euroAuf(lstb(an, "pvArbeitnehmer"));
  const andere = euro(v?.gkv) || euro(v?.gpv) || euro(v?.gkvZusatz);
  if (!kvAn && !pvAn && !andere) return null;
  return [
    "Beitr_g_KV_PV_Inl",
    [
      ["Person", person],
      kvAn || pvAn
        ? [
            "AN",
            [
              ["E2001203", kvAn],
              ["E2001505", pvAn],
            ],
          ]
        : null,
      andere
        ? [
            "And_Pers",
            [
              ["E2001805", euro(v?.gkv)],
              ["E2002105", euro(v?.gpv)],
              ["E2002206", euro(v?.gkvZusatz)],
            ],
          ]
        : null,
    ],
  ];
}

function privateKvPv(person: string, v: EstVorsorgePerson | undefined): XmlNode | null {
  // Zeile 27: über die Basisabsicherung hinaus, brutto; erstattete Beiträge stehen in Zeile 25 (E2003302)
  // und sind hier deshalb nicht noch einmal abzuziehen
  const wahl = euro(v?.pkvWahlleistungen);
  if (!euro(v?.pkv) && !euro(v?.ppv) && !euro(v?.pkvErstattung) && !wahl) return null;
  return [
    "Beitr_p_KV_PV_Inl",
    [
      ["Person", person],
      ["E2003104", euro(v?.pkv)],
      ["E2003202", euro(v?.ppv)],
      ["E2003302", euro(v?.pkvErstattung)],
      wahl ? ["WL_Zvers", [["E2003502", wahl]]] : null,
    ],
  ];
}

function arbeitgeberZuschuss(person: string, v: EstVorsorgePerson | undefined, an: Arbeitnehmer): XmlNode | null {
  // Zeilen 34 bis 36: steuerfreie Zuschüsse des Arbeitgebers laut Nr. 24 a, 24 b und 24 c
  const gkv = euro(v?.agZuschussGkv);
  const pkv = euro(v?.agZuschussKv);
  const pv = euro(v?.agZuschussPv);
  if (!gkv && !pkv && !pv) return null;
  // Regel 100240078: Zuschüsse zur Kranken- und zur Pflegeversicherung nur gemeinsam; fehlt einer, steht dort 0 wie in
  // der Zuordnung (Berechne_E2003705, Berechne_E2003907). Die 0 zur Krankenversicherung gehört zu der Versicherung, deren
  // Beiträge die Person angibt, sonst greift Regel 100240075 bzw. 100240076
  const kvNull = gkv || pkv ? undefined : "0";
  const privat = !euroAuf(lstb(an, "kvArbeitnehmer")) && !euro(v?.gkv) && !!euro(v?.pkv);
  return [
    "Stfr_AG_Zusch",
    [
      ["Person", person],
      ["E2003705", gkv ?? (privat ? undefined : kvNull)],
      ["E2003807", pkv ?? (privat ? kvNull : undefined)],
      ["E2003907", pv ?? "0"],
    ],
  ];
}

function arbeitslosenversicherung(person: string, an: Arbeitnehmer): XmlNode | null {
  const av = euroAuf(lstb(an, "avArbeitnehmer"));
  return av
    ? [
        "Pers",
        [
          ["Person", person],
          ["E2004403", av],
        ],
      ]
    : null;
}

/** Anlage Vorsorgeaufwand; die Arbeitnehmerbeiträge kommen aus den Lohnsteuerbescheinigungen */
export function anlageVorsorge(x: EstAngaben, zusammen: boolean, personen: [string, Arbeitnehmer][]): XmlNode {
  const vorsorgePersonen: [string, EstVorsorgePerson | undefined][] = [
    ["PersonA", x.vorsorge.a],
    ["PersonB", zusammen ? x.vorsorge.b : undefined],
  ];
  const arbeitnehmerVon = (person: string) => personen.find(([p]) => p === person)?.[1];
  return [
    "VOR",
    [
      ...vorsorgePersonen.map(([person, v]) => altersvorsorge(person, v, arbeitnehmerVon(person))),
      ...vorsorgePersonen.map(([person, v]) => gesetzlicheKvPv(person, v, arbeitnehmerVon(person))),
      ...vorsorgePersonen.map(([person, v]) => privateKvPv(person, v)),
      ...vorsorgePersonen.map(([person, v]) => arbeitgeberZuschuss(person, v, arbeitnehmerVon(person))),
      [
        "Weit_Sons_VorAW",
        [
          ...vorsorgePersonen.map(([person]) => arbeitslosenversicherung(person, arbeitnehmerVon(person))),
          ["A_B_LP", [["U_HP_Ris_Vers", [["Sum", [["E2001803", euro(x.vorsorge.sonstige)]]]]]]],
        ],
      ],
    ],
  ];
}
