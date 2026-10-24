# Schockboard 2.0 – WIP

- Komplett überarbeitete Spielabend-Oberfläche mit Touch-Spielerkacheln, Live-Feed, Anwesenheit und Bierrunde
- Adaptives Tablet-Layout, seitliche Navigation und Unterstützung für Hoch- und Querformat
- BVB-09-Fan-Theme mit originalem, lokal eingebundenem Vereinslogo, neuer Farbpalette und konsistenteren Komponenten
- Storno-Fix: keine doppelte Schuldminderung mehr; Migration v6 korrigiert historisch falsch verbuchte automatische Storno-Korrekturen
- Undo adressiert die exakte Buchung statt pauschal den letzten Posten eines Spielers
- SQLite-Backup und -Wiederherstellung mit Schema-/Integritätsprüfung und Bestätigung
- Standard-Einsatz wird bei neu angelegten Spielabenden übernommen
- Historienfilter ohne irreführenden No-op-Button
- CI-Installation mit Legacy-Peer-Auflösung sowie Android-Bundle-Export
- Backup-Fix: eigene Sicherungen (WAL-Modus) werden jetzt angenommen; Restore prüft alle Tabellen/Views und Fremdschlüssel und rollt bei Fehlern sauber zurück
- Abwesenheitsvorschau rundet identisch zur späteren Abbuchung (Modus „auf Abwesende aufgeteilt“)
- Spielabend-Abschluss vollständig transaktional, doppelte Zuschläge ausgeschlossen
- Migration v6 protokolliert jede neutralisierte Storno-Korrektur im Log
- Fehlgeschlagenes Undo wird angezeigt statt verschluckt; offenes Undo wird bei Restore/Reset verworfen
- Animationen (Reanimated): federnde Kacheln, hüpfender Zähler, Aufleuchten bei Buchung, Undo-Toast mit Countdown, Karten-Einblendung
- Haptisches Feedback bei Buchung, Storno, Abschluss und Fehlern
- Echte Tab-Icons (Ionicons) statt Unicode-Zeichen
- Integrationstests gegen echtes SQLite (Abschluss, Storno, Migration v6)

## Vor Freigabe

- Reale Tests auf Android-Smartphone und Tablet (Portrait, Landscape, Split-Screen)
- Wiederherstellung von v1.1.0-/v1.1.5-Daten und Abgleich der Salden
- GitHub Actions und signierten APK-Release überprüfen
- Den Signaturschlüssel der bestehenden v1.1.0-APK für Updates wiederverwenden oder die Wiederherstellung über Backup testen
