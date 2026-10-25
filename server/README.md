# Schockboard Web-Verwaltung (Server)

Admin-Server und Web-Oberfläche unter **https://sh0ckb04rd.snytex.de**. Jedes Gerät (Handy/Tablet) bleibt die einzige
Datenquelle für seine eigene Kasse: der Server zeigt je Gerät nur den zuletzt hochgeladenen Stand an und sammelt je Gerät
Aufträge, die es später im Hintergrund selbst ausführt. Der Server ändert nie Spieldaten und führt Geräte nie zusammen.

Alle Aufträge aus dem Web sind **still**: das Gerät übernimmt sie beim nächsten Hintergrund-Sync (meist innerhalb von
1–15 Minuten) ohne Eintrag im Protokoll der App und ohne Beleg. Dazu gehört die „Übermacht“: Buchungen bearbeiten oder
löschen (`entry.update`/`entry.delete`, auch an beendeten Abenden), Abende bearbeiten/löschen (`session.update`/
`session.delete`), Spieler umbenennen (`player.rename`) und Einträge des App-Protokolls entfernen (`audit.delete`,
`audit.purge`). Ausstehende Aufträge zeigt die Web-UI nur als Hinweis „ausstehend“ an – die Zahlen stammen immer aus dem
letzten Stand des Geräts.

## Architektur

```
App A (SQLite, Wahrheit) ──PUT /api/device/snapshot──▶ snapshots/<A>.sqlite ─▶ <A>-work.sqlite ─▶ App-Queries (../src/db/queries)
        ▲                                                                                          │  ?device=<A>
        └──GET /api/device/commands ◀── Warteschlange von A (server.db) ◀── Web-UI /api/admin/* ◀──┘
           POST /api/device/commands/results
App B … genauso, mit eigenem Snapshot und eigener Warteschlange
```

- **Hono** auf Node 24, Speicherung mit `node:sqlite` (keine nativen Abhängigkeiten).
- Vertrag: `src/remote/protocol.ts` (zod-Schemas, Endpunkte, Pairing-URL).
- Lese-Ansichten nutzen **die echten Queries der App** (`@` → `../src`, `@/db/client` → `src/snapshot-client.ts`),
  damit alle Beträge exakt wie in der App gerechnet werden. Jeder Upload wird geprüft (Header, Größe ≤ 50 MB,
  `quick_check`, Pflichttabellen), atomar abgelegt und als Arbeitskopie (WAL-Header → Rollback) geöffnet.
- `DATA_DIR`: `server.db` (Geräte mit SHA-256-Token-Hash und Namen, Aufträge mit `device_id`, Snapshot-Metadaten je Gerät),
  `snapshots/<deviceId>.sqlite` (Rohbild) und `snapshots/<deviceId>-work.sqlite` (Arbeitskopie, beim ersten Zugriff neu erzeugt).
- Je Gerät bleibt eine geöffnete Arbeitskopie im Cache (nach Upload neu). Lese-Handler sind synchron; `snapshots.withDevice(id, fn)`
  wählt die Datenbank für `getSqlite()` genau für die Dauer von `fn` und stellt danach die vorige Auswahl wieder her.
- Web-UI: React 19 + Vite in `web/`, gebaut nach `dist/public`, ausgeliefert vom selben Server.

## Authentifizierung

- `/api/device/*`: `Authorization: Bearer <Gerätetoken>` (nur Hash gespeichert, konstanter Vergleich, Rate-Limit).
- Alles andere (Web-UI + `/api/admin/*`): Cloudflare Access. Der Header `Cf-Access-Jwt-Assertion` wird gegen das
  JWKS des Teams geprüft (Issuer, optional Audience), danach muss `email` in `ADMIN_EMAILS` stehen.
- Ohne Anmeldung erreichbar: nur `/healthz`.

### Rollen

| Rolle | Wer | Darf |
| --- | --- | --- |
| **Administrator** | `ADMIN_EMAILS` | alles, inkl. Geräteverwaltung (umbenennen, sperren, ersetzen, entfernen) |
| **Verwalter** | `MANAGER_EMAILS` | alles sehen (alle Geräte), alle Daten-, Übermacht- und Protokoll-Aufträge anlegen und stornieren, Auftragsverlauf leeren – aber keine Geräteverwaltung (`/api/admin/device/*` und schreibende `/api/admin/devices/*` → 403) |

Steht eine Adresse in beiden Listen, gilt Administrator. `GET /api/admin/me` liefert `{ email, role }`; die Web-UI blendet
Admin-Aktionen für Verwalter aus und zeigt die Rolle in der Seitenleiste. Beide Rollen müssen zusätzlich in der
Cloudflare-Access-Policy freigegeben sein.

## Gerät wählen

Alle Lese-, Diagramm- und Auftrags-Endpunkte unter `/api/admin` beziehen sich auf **ein** Gerät: `?device=<id>` oder Header
`X-Schockboard-Device: <id>`; ohne Angabe das erste aktive Gerät. Unbekannte oder gesperrte Geräte → 404 `device_not_found`.
Die Web-UI merkt sich die Auswahl in `localStorage` und in der URL (`?device=`).

| Endpunkt | Zweck |
| --- | --- |
| `GET /api/admin/devices` | alle Geräte: `id, label, deviceName, pairedAt, lastSeenAt, lastSnapshotAt, pendingCommands, status (active/blocked)` |
| `GET /api/admin/devices/cashbox` | Kasse/offen je aktivem Gerät (Übersichtsleiste) |
| `PATCH /api/admin/devices/:id` `{label}` | umbenennen (nur Web-Name) |
| `POST /api/admin/devices/:id/revoke` `{replacedBy?}` | sperren: Token ungültig, ausstehende Aufträge storniert; mit `replacedBy` übernimmt dieses Gerät den Namen („Gerät ersetzen“) |
| `DELETE /api/admin/devices/:id` | gesperrtes Gerät samt Snapshot und Auftragsverlauf entfernen |
| `GET /api/admin/status` | Stand des gewählten Geräts + `devices` (alle), `activeDevices`, `maxDevices` |

## Auftragsverlauf

- Aufträge gehören immer genau einem Gerät (`device_id`); nur dieses Gerät bekommt sie und darf Ergebnisse dazu melden.
- `DELETE /api/admin/commands` löscht die abgeschlossenen Aufträge (übernommen, abgelehnt, storniert) des gewählten Geräts,
  `?device=all` die aller Geräte; ausstehende bleiben.
  Danach ist im Web nicht mehr nachvollziehbar, was beauftragt wurde.
- Automatisch: abgeschlossene Aufträge älter als `COMMAND_RETENTION_DAYS` werden beim Start und einmal täglich gelöscht.
- Auftragsinhalte und E-Mail-Adressen werden nie auf stdout geloggt.

## Diagramm-Endpunkte

Aus dem letzten Stand per SQL berechnet (Saison-Werte zählen nur beendete Abende, Bierrunden = `loss_entries.is_beer_round = 1`):

- `GET /api/admin/charts/evenings?season=YYYY|all` – je beendetem Abend: Datum, Titel, Verluste, Bierrunden, Abwesenheit, Summe, pro Spieler.
- `GET /api/admin/charts/players` – je Spieler: Schulden-Verlauf (Abende, Zahlungen, Korrekturen; ein laufender Abend als letzter Punkt mit `open: true`), Summen, Abende dabei/verpasst.
- `GET /api/admin/charts/cashbox` – Zahlungen kumuliert (`payments`), Entnahmen (`withdrawals`), beides zusammen mit laufendem
  Kassenstand (`events[].cashOnHandCents` = Zahlungen − Entnahmen), Summen `totalPaymentsCents`/`totalWithdrawalsCents`/
  `cashOnHandCents` und aktuell offene Schulden.

Historie, Abend-Verlauf und „Zuletzt passiert“ liefern zu jeder Buchung `entryKind` (`loss|payment|correction|absence|withdrawal`)
und die Roh-Notiz `note` für die Übermacht-Aufträge; `GET /api/admin/history?kind=withdrawal` listet nur Entnahmen.

## Entnahmen

`cashbox.withdraw` `{ amountCents > 0, note }` nimmt Geld aus der Kasse (z. B. „Kasten Bier“); Spielerkonten bleiben unverändert.
Der Server prüft gegen den letzten Stand des gewählten Geräts: Notiz Pflicht, Betrag ≤ Kassenstand minus bereits beauftragter
Entnahmen. `entry.update`/`entry.delete` mit `kind: 'withdrawal'` verlangen eine existierende Entnahme; eine Erhöhung darf den
verfügbaren Kassenstand nicht übersteigen, Betrag > 0 und Notiz bleiben Pflicht. Das Gerät prüft beim Übernehmen erneut.

## Web-Oberfläche („Kommandozentrale“)

Design-Tokens (Farben, Radien, Abstände) erzeugt `web/src/theme.ts` zur Laufzeit aus `src/theme/tokens.ts` (Palette `bvb09`),
Spielerfarben kommen aus derselben `playerColor()`-Funktion wie in der App. Schriften (Inter, Barlow Condensed) sind über
`@fontsource` gebündelt, Icons sind Inline-SVGs (`web/src/icons.tsx`) – kein CDN.

Tastatur: **Strg/⌘ + K** oder **/** öffnet die Befehlspalette (Spieler, Abende, Buchungen suchen; „Zahlung buchen“,
„Entnahme buchen“, „Korrektur buchen“, „Spieler anlegen“, „Gerät wechseln“), ↑/↓ + Enter wählen, Esc schließt. In Listen
öffnet der Stift die Inline-Bearbeitung (Enter speichert, Esc bricht ab). Bewegung ≤ 240 ms, aus bei `prefers-reduced-motion`.

## Umgebungsvariablen

| Variable | Standard | Zweck |
| --- | --- | --- |
| `PORT` / `HOST` | `8787` / `0.0.0.0` | Listen-Adresse |
| `DATA_DIR` | `/data` | Datenverzeichnis |
| `PUBLIC_ORIGIN` | `https://sh0ckb04rd.snytex.de` | Öffentliche Server-Adresse |
| `ADMIN_EMAILS` | `snytex@snytex.de` | Administratoren (Access-E-Mails, kommagetrennt) |
| `MANAGER_EMAILS` | – | Verwalter ohne Geräteverwaltung (kommagetrennt) |
| `COMMAND_RETENTION_DAYS` | `30` | Abgeschlossene Aufträge werden nach so vielen Tagen gelöscht |
| `CF_ACCESS_TEAM_DOMAIN` | `snytex.cloudflareaccess.com` | Access-Team (Issuer + JWKS) |
| `CF_ACCESS_AUD` | – | Audience-Tag der Access-App; wird nur geprüft, wenn gesetzt (empfohlen) |
| `DEV_NO_AUTH` | – | `1` schaltet die Admin-Anmeldung ab – **nur lokal!** |
| `DEVICE_RATE_LIMIT_PER_MINUTE` | `120` | Anfragen pro IP und Minute an `/api/device` |
| `MAX_DEVICES` | `10` | Höchstzahl aktiver Geräte; weitere Anmeldungen → 403 `device_limit` |
| `ENROLL_RATE_LIMIT_PER_MINUTE` / `ENROLL_RATE_LIMIT_PER_DAY` | `5` / `20` | Selbst-Anmeldungen pro Client-IP (`CF-Connecting-IP`) |
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

## Geräte verbinden

Keine Kopplung nötig: Die App kennt `https://sh0ckb04rd.snytex.de` fest und meldet sich beim ersten Start
selbst über `POST /api/device/enroll {deviceName}` an.

- **Jede** Anmeldung legt ein neues, eigenständiges Gerät an (Name = Gerätename der App, im Web änderbar), solange weniger als
  `MAX_DEVICES` aktive Geräte existieren. Streng begrenzt: 5 pro Minute und 20 pro Tag je Client-IP.
- Jedes Gerät ist eine eigene Kasse mit eigenem Datenstand und eigener Auftragswarteschlange. Neue Geräte tragen im Web 24 Stunden
  lang das Kennzeichen „Neu“ – ein unbekanntes Gerät sofort sperren.
- **Sperren** (Web → Geräte) macht den Token sofort ungültig und storniert die ausstehenden Aufträge dieses Geräts. Die App vergisst
  den Token und meldet sich beim nächsten Start ggf. als *neues* Gerät an.
- Neuinstallation/Gerätewechsel: Die App erscheint als neues Gerät. „Gerät ersetzen“ sperrt das alte und gibt dessen Namen an das
  neue weiter; die Daten werden nicht zusammengeführt.

## Umstellung von einem Gerät auf mehrere (einmalig beim Start)

Ein `DATA_DIR` im alten Format (`server.db` ohne `devices.label`/`commands.device_id`, `snapshot.sqlite`) wird beim ersten Start
automatisch umgestellt:

1. `server.db.pre-multidevice.bak` – Kopie der alten `server.db` (`VACUUM INTO`, nur wenn noch nicht vorhanden).
2. In **einer** Transaktion: `devices` bekommt `label` und `device_name` (aus `paired_by` ohne `app: `, z. B. „SM-X910“);
   `commands` wird mit `device_id NOT NULL` neu angelegt, alle Aufträge (auch ausstehende) gehören dem aktiven Gerät;
   `snapshot_meta` wird je Gerät geführt, der bisherige Eintrag gehört dem aktiven Gerät. `PRAGMA user_version = 2`.
3. `snapshot.sqlite` wird nach `snapshots/<aktives Gerät>.sqlite` **umbenannt** (bytegleich), `snapshot-work.sqlite` gelöscht.

Das Gerät behält seinen Token und synchronisiert ohne Änderung weiter. Ein erneuter Start ändert nichts mehr (idempotent).

## Next: gekoppelte Runden und Geräteumzug

`/api/device/connect/*` verwendet das Gerätetoken; `/api/admin/connect/*` verlangt Administratorrechte. Alle Admin-Aufrufe wählen das Gerät per Query oder `X-Schockboard-Device`. QR-Codes enthalten einen zufälligen Einmalcode (nur SHA-256 im Server gespeichert), kein dauerhaftes Gerätetoken. Neue Funktionen setzen Schema 10 voraus; alte Apps können weiterhin die bisherigen Aufträge bearbeiten.

Der Host bleibt alleiniger Schreiber. Gäste starten als Zuschauer und erhalten nur Teilnehmer, Verlustzahlen und Erfolge. Bediener sehen zusätzlich Konten und dürfen genau drei Auftragstypen anlegen. Widerruf storniert ausstehende Gäste-Aufträge. Web- und Gäste-Buchungen behalten Wiederholungskennungen auch nach Bereinigung des Auftragsverlaufs. Während eines Geräteumzugs werden Quell-Uploads und Quell-Aufträge gesperrt. Abschluss verlangt den bytegleichen Upload der gesicherten Quelldatenbank durch das Ziel. Bestehende Gäste wechseln zum Ziel, die Quelle wird Zuschauer.

`GET /api/admin/achievements`, `/recap?year=2026` oder `/recap?sessionId=…` liefern die gemeinsame App-Auswertung. `includeBalances=1` aktiviert persönliche Kontostände ausdrücklich. `/backups` sowie `/backup/latest` und `/backup/:name` liefern zugriffsgeschützte Sicherungen; kein öffentlicher Dateipfad. Automatische Stände liegen in `DATA_DIR/backups/<deviceId>` (maximal zehn pro Gerät). Für eine Rücksicherung erst herunterladen und dann in der App mit Sicherheitskopie wiederherstellen.
