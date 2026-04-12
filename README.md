# Schockboard APK

Schockboard ist eine Android-App zur Verwaltung von Spielabenden, Verlusten und offenen Beträgen in der Runde.
Die App läuft vollständig lokal auf dem Gerät (SQLite), ohne Cloud-Backend.

## Aktueller Stand

- Kein Login erforderlich
- APK ist als offizielles GitHub-Release verfügbar
- Fokus auf schnelle Bedienung während des Spielabends

## Funktionsübersicht

### Dashboard

- Überblick über Getränkekasse und offene Schulden
- Aktiver Spielabend mit Direktzugriff
- Größte offene Posten auf einen Blick
- Timeline der letzten Buchungen

### Spielabende

- Spielabend anlegen und starten
- Einsatz pro Verlust festlegen und später anpassen
- Anwesenheit pro Spieler direkt umschalten
- Gäste spontan zum laufenden Abend hinzufügen
- Spielabend abschließen

### Verluste & Schnellbuchung

- Verluste per Schnellbuttons (+ / -) erfassen
- Letzten Verlust pro Spieler rückgängig machen
- Verluste optional mit Notiz dokumentieren

### Bierrunde (Sonderposten)

- Eigene Karte „Bierrunde“ im Spielabend
- Betrag frei definierbar (Standard: 5,00 €)
- Betrag wird einem anwesenden Spieler zugewiesen
- Bierrunden erscheinen im Log/Verlauf
- Bierrunden zählen **nicht** in den Abwesenheitsdurchschnitt für abwesende Stammspieler

### Abwesenheit & Regeln

- Automatische Zuschläge für abwesende Stammspieler beim Abschließen
- Unterstützte Modi:
	- kein Zuschlag
	- voller Durchschnitt
	- auf Abwesende aufgeteilter Durchschnitt
- Hausregel-Profil inkl. Schock-spezifischer Hinweise

### Historie & Korrekturen

- Chronologische Historie aller Buchungen
- Filter nach Spieler und Buchungstyp
- Korrekturen mit Begründung erfassen
- Audit-Einträge für wichtige Systemereignisse

### Kasse & Export

- Zahlungen in die Getränkekasse buchen
- Offene Beträge je Spieler transparent nachvollziehen
- CSV-Export für Historie und Kasse

## Daten & Technik

- Lokale Datenhaltung mit SQLite
- Klare Trennung von UI, Domain-Logik und Datenzugriff
- Robuste Domain-Logik mit automatisierten Tests

## Release

Die aktuelle APK ist im Bereich **Releases** dieses Repositories verfügbar.
