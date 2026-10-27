# Schockboard Next 2.1.0

- Neue Einstellung **„Bierrunden im Durchschnitt berücksichtigen“** (Einstellungen → Hausregeln, auch im Admin-Web): Ist sie an, zählen Bierrunden der anwesenden Stammspieler in den Abwesenheitsdurchschnitt. Standardmäßig aus – bestehende Berechnungen bleiben unverändert, gespeicherte Buchungen werden nie angepasst. Vorschau, Abendabschluss und Abschlussübersicht rechnen identisch (Migration v11). (#4)
- Kasse: Der Kassenstand zählt nicht mehr bei jedem Bild neu durch, dadurch wackelt die Anzeige bei größeren Beträgen wie 50 € nicht mehr. (#3)
- Kasse: Zahlung und Entnahme werden bei Doppeltipp nur noch einmal gebucht. (#3)
- Tests für beide Schalterzustände, leere Abende, Persistenz und den Mehrfachklickschutz
