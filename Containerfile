# Haben – App-Container. ERiC wird nicht mitgeliefert (Lizenz); Haben lädt es auf Wunsch nach /var/lib/haben/eric
# (Volume) oder es wird nach /opt/eric gemountet.
FROM docker.io/oven/bun:1.4.5-slim AS build
WORKDIR /app
COPY bun.lock bunfig.toml package.json ./
COPY apps/web/package.json apps/web/
COPY apps/elster-helfer/package.json apps/elster-helfer/
COPY apps/firmenportal/package.json apps/firmenportal/
# Alle Workspace-Pakete, sonst fehlen deren Abhängigkeiten (z. B. pdf-lib in einvoice, zod in import)
COPY packages/core/package.json packages/core/
COPY packages/einvoice/package.json packages/einvoice/
COPY packages/elster/package.json packages/elster/
COPY packages/gobd-kern/package.json packages/gobd-kern/
COPY packages/import/package.json packages/import/
RUN bun install --frozen-lockfile
COPY . .
# Ins Laufzeit-Image kommt nur, was zur Laufzeit läuft (scripts/container/laufzeit.ts): das Server-Bundle, die Skripte,
# die Bun im Image startet, gebündelt unter ihrem Pfad aus dem Repository, und ein node_modules nur mit den nativen
# Paketen (Typst, koffi). Keine Build-Werkzeuge und keine Pakete, die schon im Bundle stecken; der CI-Job container
# lädt die externen Module aller Bundles
RUN bun run build \
 && bun scripts/container/laufzeit.ts /laufzeit

# Laufzeit auf Wolfi statt Debian: glibc wie bisher (ERiC ist eine glibc-Bibliothek, Alpine mit musl ginge nicht),
# aber aktuelle Upstream-Versionen, vor allem von poppler, das jedes hochgeladene PDF liest. Wolfi ist rollend; der
# Digest hält den Build reproduzierbar, Renovate hebt ihn an.
FROM cgr.dev/chainguard/wolfi-base:latest@sha256:be019c1c74fe69204a42c4e10bc4d886a49bf5403ffa74374ef7baa408fc9a26
# Dasselbe Bun wie in der Build-Stufe (glibc-Build); Renovate verfolgt oven/bun weiter an beiden Stellen
COPY --from=docker.io/oven/bun:1.4.5-slim /usr/local/bin/bun /usr/local/bin/bun
# poppler-utils: pdftotext und pdftoppm für hochgeladene PDFs (Textebene, Seitenbilder für einen eigenen KI-Dienst),
# als eigener Prozess. font-liberation: ohne Schriften rendert pdftoppm nicht eingebettete Standardschriften wie
# Helvetica gar nicht. libgcc: libgcc_s braucht ERiC neben glibc (steckt schon in wolfi-base, hier ausdrücklich).
# Benutzer bun mit UID 1000 wie im Image von oven/bun, damit bestehende Volumes lesbar bleiben. Die Pakete kommen aus
# dem freien Wolfi-Repository; wolfi-base nennt in /etc/apk/repositories das von Chainguard, das eine Anmeldung verlangt.
RUN echo https://packages.wolfi.dev/os > /etc/apk/repositories \
 && apk add --no-cache poppler-utils font-liberation tzdata libgcc \
 && addgroup -g 1000 bun \
 && adduser -D -u 1000 -G bun -h /home/bun -s /bin/sh bun
ENV NODE_ENV=production \
    PORT=3000 \
    ERIC_WORKER_PATH=/app/packages/elster/src/worker.ts \
    HABEN_EINVOICE_DIR=/app/packages/einvoice \
    DOCUMENTS_DIR=/var/lib/haben/belege \
    ERIC_LOG_DIR=/var/lib/haben/eric-log \
    ERIC_DIR=/var/lib/haben/eric \
    XDG_CACHE_HOME=/tmp/.cache
# XDG_CACHE_HOME: Fontconfig (pdftoppm) braucht einen beschreibbaren Cache, auch bei schreibgeschütztem Dateisystem
WORKDIR /app
COPY --from=build /laufzeit ./
COPY deploy/entrypoint.sh /usr/local/bin/haben-entrypoint
# haben status [--json]: Version, ERiC, letzte Sicherung und Speicher, etwa für deploy/instanzen
COPY deploy/haben.sh /usr/local/bin/haben
RUN mkdir -p /var/lib/haben/eric-log /var/lib/haben/eric /var/lib/haben/belege && chown -R bun:bun /var/lib/haben
# Commit des Builds (#887) für haben status und als OCI-Label, etwa --build-arg HABEN_COMMIT="$(git rev-parse HEAD)".
# Ohne Angabe leer. Erst hier, damit ein anderer Commit nur diese Schichten neu baut
ARG HABEN_COMMIT=""
LABEL org.opencontainers.image.revision="$HABEN_COMMIT"
ENV HABEN_COMMIT="$HABEN_COMMIT"
USER bun
EXPOSE 3000
# Ohne curl im Image: Bun hat fetch eingebaut. Die Startphase deckt die Migrationen ab.
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s \
  CMD ["bun", "-e", "fetch('http://127.0.0.1:3000/api/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
ENTRYPOINT ["haben-entrypoint"]
