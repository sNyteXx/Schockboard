# Schockboard APK

Android-first Expo-App als separater APK-Fork fuer das bestehende Schockboard. Die App nutzt eine lokale SQLite-Datenbank auf dem Geraet, hat keinen externen Server und ist fuer Handy-Hochformat sowie Tablet-Layouts ausgelegt.

## Enthalten

- lokaler Login mit Secure Storage
- Dashboard, Sessions, Session-Detail, Kasse, Historie, Einstellungen
- CSV-Export fuer Historie und Kasse
- SQLite + Drizzle-Schema/Migrationsgrundlage
- GitHub-CI fuer Typecheck und Domain-Tests
- EAS-Build-Profile fuer signierbare APK-Releases

## Starten

```bash
npm install
npm run start
```

Android lokal starten:

```bash
npm run android
```

## Qualitaet

```bash
npm run typecheck
npm test
```

## Release als APK

Voraussetzung: EAS CLI und Expo-Account.

```bash
npx eas build -p android --profile preview
```

Fuer produktionsnahe Builds:

```bash
npx eas build -p android --profile production
```

## Projektstruktur

- `app/`: Expo-Router-Screens
- `src/db/`: SQLite, Schema, Bootstrap, Queries
- `src/domain/`: Regeln, Formatierung, Ledger, Typen
- `src/services/`: Auth, Export, Sessions, Kasse
- `tests/`: Domain-Tests

## Aktueller Stand

Der Fork ist als lauffaehiges Grundprodukt angelegt. Die Kernworkflows sind mobil umgesetzt; fuer einen oeffentlichen Release sollten als naechstes Emulator-Smokes, App-Icons/Splash-Finishing, Store-/Release-Assets und ein echter Release-Workflow mit Secrets ergaenzt werden.
