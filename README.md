# Schockboard 2.0 APK

Schockboard ist eine Android-App zur Verwaltung von Spielabenden, Verlusten und offenen Beträgen in der Runde.
Die App läuft vollständig lokal auf dem Gerät (SQLite), ohne Cloud-Backend.

## Aktueller Stand

- Kein Login erforderlich
- APK ist als offizielles GitHub-Release verfügbar
- Fokus auf schnelle Bedienung während des Spielabends
- Adaptives Live-Spielbrett für Android-Smartphones und -Tablets (Hoch-/Querformat)
- BVB-09-Fan-Theme mit dem originalen Vereinslogo als lokal eingebundene PNG-Datei
- Vollständiger SQLite-Export und überprüfte Wiederherstellung über den Android-Dateiauswahldialog

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
- Große Spieler-Kacheln mit direkter Schnellbuchung, Anwesenheit und Live-Feed

### Verluste & Schnellbuchung

- Verluste per Schnellbuttons (+ / -) erfassen
- Letzten Verlust pro Spieler rückgängig machen
- Storno entfernt den Verlust genau einmal; bestehende doppelte Korrekturen werden durch Migration v6 bereinigt
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
- Sicherungsformat: original SQLite-Datenbank, lokal exportiert; vor Restore werden SQLite-Integrität und Schockboard-Schema geprüft

## Schockboard 2.0 (WIP)

Die Hauptoberfläche ist für Touch-Interaktion neu aufgebaut. Im breiten Tablet-Fenster gibt es ein Spielerbrett links und Aktions-/Verlaufsbereiche rechts; auf schmalen Displays werden sie untereinander angeordnet. Im Tabletmodus sitzt die Navigation als seitliche Leiste.

Der BVB-09-Look verwendet das echte BVB-Logo aus [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Borussia_Dortmund_logo.svg) (ursprünglich von bvb.de). Die Bilddatei ist dort als gemeinfrei wegen fehlender Schöpfungshöhe gekennzeichnet; **Markenrechte bleiben unberührt**. Schockboard ist ein inoffizielles Fan-Projekt ohne Verbindung zum Verein. Das Paket bleibt `de.schockboard.apk`. Für ein direktes APK-Update muss **auch derselbe Android-Signaturschlüssel wie bei v1.1.0** verwendet werden; andernfalls ist ein Gerätewechsel per vorher exportierter SQLite-Sicherung nötig. Vor realen Updates die Migration auf einem Testgerät validieren.

## Release

Die aktuelle APK ist im Bereich **Releases** dieses Repositories verfügbar.
