/*
 * Belege von Ausgaben und Einnahmen aus FastBill für den Umzug nach Haben, die die API nicht herausgibt.
 *
 * Bei manchen Ausgaben und Einnahmen liefert DOCUMENT_URL die Datei nur, wenn man im Browser bei FastBill angemeldet ist;
 * der Abruf in Haben bekommt dort eine leere Antwort und merkt den Eintrag als „wartet auf Beleg“ vor. Haben setzt beim
 * Kopieren unten die Liste dieser Einträge ein (Kennung und Download-Adresse aus der API).
 *
 * Ausführen: In my.fastbill.com anmelden, die Entwicklerwerkzeuge öffnen (F12), in der Konsole dieses Skript einfügen und
 * mit Enter starten. Es lädt mit deiner Anmeldung genau diese Dateien und gibt sie als ZIP-Dateien zurück (je höchstens
 * etwa 50 MB). Diese lädst du in Haben unter Archiv → Umzug → Umzug aus FastBill hoch. Das Skript liest nur.
 *
 * Inhalt jeder ZIP-Datei:
 *   manifest.json             Format, Version, Teil, Zeitpunkt, IDs ohne Datei
 *   belege/<Kennung>.<ext> die Datei, benannt nach der INVOICE_ID in FastBill, bei Einnahmen mit „einnahme-“ davor
 */
{
  // Ein Block statt einer Funktion um alles: Die Hilfen bleiben lokal, auch wenn man das Skript zweimal einfügt, und keine
  // Funktion wird länger als 80 Zeilen (#1676). Der Kommentar oben muss vor der Klammer bleiben: Safari setzt eine Eingabe,
  // die mit { beginnt und mit } endet, ungeprüft in runde Klammern (WebKit, RuntimeManager.wrapLiteralExpression)
  const FORMAT = "haben-fastbill-belege";
  const VERSION = 1;
  const PART_LIMIT = 50 * 1024 * 1024;
  const PAUSE_MS = 150;
  const MAX_RETRIES = 5;
  const EXTENSIONS = { "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/heic": "heic" };

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const log = (...args) => console.log("[Haben-FastBill]", ...args);
  const encoder = new TextEncoder();

  // ------------------------------------------------------------------ HTTP

  /** Ein Abruf mit Pause davor; bei 429, 502–504 und Netzwerkfehlern mit wachsender Wartezeit wiederholt. */
  const request = async (url) => {
    for (let attempt = 0; ; attempt++) {
      await sleep(PAUSE_MS);
      let response;
      try {
        response = await fetch(url, { credentials: "include" });
      } catch (error) {
        if (attempt >= MAX_RETRIES) throw error;
        await sleep(1000 * 2 ** attempt);
        continue;
      }
      if ([429, 502, 503, 504].includes(response.status) && attempt < MAX_RETRIES) {
        await sleep(1000 * 2 ** attempt);
        continue;
      }
      return response;
    }
  };

  /** Datei eines Eintrags oder null, wenn FastBill keine liefert (leere oder HTML-Antwort, etwa abgemeldet) */
  const receipt = async (entry) => {
    const url = new URL(entry.url);
    if (url.host !== location.host) return null;
    const response = await request(url);
    if (!response.ok) return null;
    const type = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length === 0 || type.includes("html")) return null;
    const disposition = response.headers.get("content-disposition") ?? "";
    const fromName = /\.([a-z0-9]{2,5})"?\s*$/i.exec(disposition)?.[1]?.toLowerCase();
    return { bytes, ext: EXTENSIONS[type] ?? fromName ?? "bin" };
  };

  // ------------------------------------------------------------------ ZIP (ohne Kompression, wie lexware-sicherung.js)

  const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
    return table;
  })();

  const crc32 = (bytes) => {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };

  /** Sammelt Einträge und baut daraus eine ZIP-Datei (Methode „stored“, Dateinamen in UTF-8) */
  const zipWriter = () => {
    const chunks = [];
    const central = [];
    let offset = 0;
    const header = (size) => {
      const buffer = new Uint8Array(size);
      return { buffer, view: new DataView(buffer.buffer) };
    };
    return {
      get size() {
        return offset;
      },
      add(name, bytes) {
        const nameBytes = encoder.encode(name);
        const crc = crc32(bytes);
        const local = header(30 + nameBytes.length);
        local.view.setUint32(0, 0x04034b50, true);
        local.view.setUint16(4, 20, true);
        local.view.setUint16(6, 0x0800, true);
        local.view.setUint32(14, crc, true);
        local.view.setUint32(18, bytes.length, true);
        local.view.setUint32(22, bytes.length, true);
        local.view.setUint16(26, nameBytes.length, true);
        local.buffer.set(nameBytes, 30);
        const entry = header(46 + nameBytes.length);
        entry.view.setUint32(0, 0x02014b50, true);
        entry.view.setUint16(4, 20, true);
        entry.view.setUint16(6, 20, true);
        entry.view.setUint16(8, 0x0800, true);
        entry.view.setUint32(16, crc, true);
        entry.view.setUint32(20, bytes.length, true);
        entry.view.setUint32(24, bytes.length, true);
        entry.view.setUint16(28, nameBytes.length, true);
        entry.view.setUint32(42, offset, true);
        entry.buffer.set(nameBytes, 46);
        chunks.push(local.buffer, bytes);
        central.push(entry.buffer);
        offset += local.buffer.length + bytes.length;
      },
      finish() {
        const centralSize = central.reduce((sum, c) => sum + c.length, 0);
        const end = header(22);
        end.view.setUint32(0, 0x06054b50, true);
        end.view.setUint16(8, central.length, true);
        end.view.setUint16(10, central.length, true);
        end.view.setUint32(12, centralSize, true);
        end.view.setUint32(16, offset, true);
        return new Blob([...chunks, ...central, end.buffer], { type: "application/zip" });
      },
    };
  };

  const download = (blob, name) => {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  // ------------------------------------------------------------------ Ablauf

  /** Bricht ab, wenn das Skript nicht in FastBill läuft oder Haben die Liste nicht eingesetzt hat */
  const checkSetup = (LISTE) => {
    if (location.hostname !== "my.fastbill.com") {
      throw new Error("Bitte in my.fastbill.com ausführen, angemeldet, in der Konsole der Entwicklerwerkzeuge.");
    }
    if (!Array.isArray(LISTE) || LISTE.length === 0) {
      throw new Error("Die Liste der Belege ist leer. Kopiere das Skript in Haben über „Skript kopieren“, nicht aus der Datei.");
    }
  };

  /**
   * ZIP-Teile bis PART_LIMIT: add legt eine Datei in den laufenden Teil oder beginnt einen neuen, finish schreibt
   * manifest.json in den Teil und lädt ihn herunter. missing ist die Liste der IDs ohne Datei; ein Manifest nennt die bis zum
   * Abschluss seines Teils
   */
  const zipParts = (createdAt, missing) => {
    const stamp = createdAt.slice(0, 10);
    let part = 0;
    let zip = null;
    let inPart = 0;
    const finish = () => {
      if (!zip || inPart === 0) return;
      zip.add("manifest.json", encoder.encode(JSON.stringify({ format: FORMAT, version: VERSION, part, createdAt, count: inPart, missing })));
      const name = `fastbill-belege-${stamp}-teil-${part}.zip`;
      download(zip.finish(), name);
      log(`${name} heruntergeladen (${inPart} Belege).`);
      zip = null;
      inPart = 0;
    };
    return {
      get count() {
        return part;
      },
      add(name, bytes) {
        if (zip && zip.size + bytes.length > PART_LIMIT) finish();
        if (!zip) {
          zip = zipWriter();
          part += 1;
        }
        zip.add(name, bytes);
        inPart += 1;
      },
      finish,
    };
  };

  /** Lädt jede Datei der Liste in die Teile; gibt die Zahl der gefundenen und die Teile zurück */
  const fetchReceipts = async (LISTE, missing) => {
    const zips = zipParts(new Date().toISOString(), missing);
    let found = 0;
    for (const [index, entry] of LISTE.entries()) {
      const file = await receipt(entry);
      if (!file) {
        missing.push(entry.id);
      } else {
        zips.add(`belege/${entry.id}.${file.ext}`, file.bytes);
        found += 1;
      }
      if ((index + 1) % 25 === 0) log(`${index + 1} / ${LISTE.length}`);
    }
    zips.finish();
    return { found, parts: zips.count };
  };

  (async (LISTE) => {
    checkSetup(LISTE);
    log(`${LISTE.length} Belege. Das dauert etwa ${Math.max(1, Math.ceil((LISTE.length * (PAUSE_MS + 300)) / 60000))} Minuten.`);
    const missing = [];
    const { found, parts } = await fetchReceipts(LISTE, missing);
    log(`Fertig: ${found} Belege in ${parts} ZIP-Datei(en).`);
    if (missing.length) {
      log(
        `${missing.length} ohne Datei: FastBill liefert dort auch angemeldet nichts. Gibt es in FastBill wirklich keinen Beleg, übernimm diese Einträge in Haben „ohne Beleg“.`,
      );
    }
  })(/*HABEN_LISTE*/ []);
}
