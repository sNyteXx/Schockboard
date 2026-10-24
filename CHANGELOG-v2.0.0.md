# Schockboard 2.0 – WIP

- Komplett überarbeitete Spielabend-Oberfläche mit Touch-Spielerkacheln, Live-Feed, Anwesenheit und Bierrunde
- Adaptives Tablet-Layout, seitliche Navigation und Unterstützung für Hoch- und Querformat
- BVB-09-Fan-Theme mit gezeichnetem Rundemblem, neuer Farbpalette und konsistenteren Komponenten
- Storno-Fix: keine doppelte Schuldminderung mehr; Migration v6 korrigiert historisch falsch verbuchte automatische Storno-Korrekturen
- Undo adressiert die exakte Buchung statt pauschal den letzten Posten eines Spielers
- SQLite-Backup und -Wiederherstellung mit Schema-/Integritätsprüfung und Bestätigung
- Standard-Einsatz wird bei neu angelegten Spielabenden übernommen
- Historienfilter ohne irreführenden No-op-Button
- CI-Installation mit Legacy-Peer-Auflösung sowie Android-Bundle-Export

## Vor Freigabe

- Reale Tests auf Android-Smartphone und Tablet (Portrait, Landscape, Split-Screen)
- Wiederherstellung von v1.1.0-/v1.1.5-Daten und Abgleich der Salden
- GitHub Actions und signierten APK-Release überprüfen
- Den Signaturschlüssel der bestehenden v1.1.0-APK für Updates wiederverwenden oder die Wiederherstellung über Backup testen
