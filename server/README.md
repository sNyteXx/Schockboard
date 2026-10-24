# Schockboard Web-Verwaltung (Server)

Admin-Server und Web-Oberfläche unter **https://sh0ckb04rd.snytex.de**. Das Gerät (Handy/Tablet) bleibt die einzige
Datenquelle: der Server zeigt nur den zuletzt hochgeladenen Stand an und sammelt Aufträge, die das Gerät später im
Hintergrund selbst ausführt. Der Server ändert nie Spieldaten.

## Architektur

```
App (SQLite, Wahrheit) ──PUT /api/device/snapshot──▶ snapshot.sqlite ─▶ snapshot-work.sqlite ─▶ App-Queries (../src/db/queries)
        ▲                                                                                        │
        └──GET /api/device/commands ◀── Auftragswarteschlange (server.db) ◀── Web-UI /api/admin/* ◀┘
           POST /api/device/commands/results
```

- **Hono** auf Node 24, Speicherung mit `node:sqlite` (keine nativen Abhängigkeiten).
- Vertrag: `src/remote/protocol.ts` (zod-Schemas, Endpunkte, Pairing-URL).
- Lese-Ansichten nutzen **die echten Queries der App** (`@` → `../src`, `@/db/client` → `src/snapshot-client.ts`),
  damit alle Beträge exakt wie in der App gerechnet werden. Jeder Upload wird geprüft (Header, Größe ≤ 50 MB,
  `quick_check`, Pflichttabellen), atomar abgelegt und als Arbeitskopie (WAL-Header → Rollback) geöffnet.
- `DATA_DIR`: `server.db` (Gerät mit SHA-256-Token-Hash, Aufträge, Snapshot-Metadaten), `snapshot.sqlite`, `snapshot-work.sqlite`.
- Web-UI: React 19 + Vite in `web/`, gebaut nach `dist/public`, ausgeliefert vom selben Server.

## Authentifizierung

- `/api/device/*`: `Authorization: Bearer <Gerätetoken>` (nur Hash gespeichert, konstanter Vergleich, Rate-Limit).
- Alles andere (Web-UI + `/api/admin/*`): Cloudflare Access. Der Header `Cf-Access-Jwt-Assertion` wird gegen das
  JWKS des Teams geprüft (Issuer, optional Audience), danach muss `email` in `ADMIN_EMAILS` stehen.
- Ohne Anmeldung erreichbar: nur `/healthz`.

## Umgebungsvariablen

| Variable | Standard | Zweck |
| --- | --- | --- |
| `PORT` / `HOST` | `8787` / `0.0.0.0` | Listen-Adresse |
| `DATA_DIR` | `/data` | Datenverzeichnis |
| `PUBLIC_ORIGIN` | `https://sh0ckb04rd.snytex.de` | Öffentliche Server-Adresse |
| `ADMIN_EMAILS` | `snytex@snytex.de` | Erlaubte Access-E-Mails (kommagetrennt) |
| `CF_ACCESS_TEAM_DOMAIN` | `snytex.cloudflareaccess.com` | Access-Team (Issuer + JWKS) |
| `CF_ACCESS_AUD` | – | Audience-Tag der Access-App; wird nur geprüft, wenn gesetzt (empfohlen) |
| `DEV_NO_AUTH` | – | `1` schaltet die Admin-Anmeldung ab – **nur lokal!** |
| `DEVICE_RATE_LIMIT_PER_MINUTE` | `120` | Anfragen pro IP und Minute an `/api/device` |
| `PUBLIC_DIR` | `dist/public` | Ort der gebauten Web-UI |

## Entwicklung

```bash
cd server
npm install
npm run typecheck && npm test
npm run build                 # Web-UI + Server-Bundle nach dist/
DEV_NO_AUTH=1 DATA_DIR=./.data PORT=8787 npm start
npm run dev:web               # optional: Vite-Dev-Server mit Proxy auf :8787
node dist/make-demo-snapshot.js /tmp/demo.sqlite   # Test-Datenbank mit den App-Queries erzeugen
```

## Docker / Unraid

Der Build-Kontext muss das **Repo-Root** sein (der Server bindet `../src` ein):

```bash
docker build -f server/Dockerfile -t schockboard-server:latest .
```

`server/docker-compose.yml` ist ein Beispiel für Unraid: Container `schockboard`, Netzwerk `cloudflare-net`, kein
Host-Port, Volume `/mnt/user/appdata/schockboard/data:/data`. DockFlare-Labels: die ganze Domain hinter Access
(`authenticated-default`), nur `/api/device` mit `public-default-bypass`.

## Gerät verbinden

Keine Kopplung nötig: Die App kennt `https://sh0ckb04rd.snytex.de` fest und meldet sich beim ersten Start
selbst über `POST /api/device/enroll` an.

- Das **allererste** Gerät wird automatisch angenommen, danach ist die Anmeldung geschlossen.
- Gerätewechsel/Neuinstallation: Web-UI → **Gerät** → „Neues Gerät zulassen (10 Min.)“, dann die App öffnen.
  Das neue Gerät ersetzt das bisherige.
- „Gerät trennen“ widerruft den Token sofort, öffnet die Anmeldung aber nicht.
