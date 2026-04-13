# Changelog – Schockboard v1.1.5

## Neu

- **Undo-Toast für Buchungen** – Nach jedem Verlust oder jeder Bierrunde erscheint für 5 Sekunden ein Undo-Button am unteren Bildschirmrand. Ein Tipp macht die Buchung sofort rückgängig.

## Bugfixes

- **Bierrunden-Löschung** – `deleteLastLoss` erkennt jetzt Bierrunden und loggt sie separat (`beerround.deleted` statt `loss.deleted`). Der Korrekturtext zeigt korrekt "Bierrunde gelöscht" an.
- **Session-Abschluss-Audit** – Wird versucht, einen bereits geschlossenen Spielabend erneut abzuschließen, wird jetzt ein Audit-Event (`session.close_attempted_already_closed`) geschrieben.
- **CSV-Export formatiert Beträge** – History- und Cashbox-CSV exportieren jetzt `15,00 €` statt `1500` (Cents).

## Technisch

- Neuer Undo-Service (`src/services/undo-service.ts`) mit zeitgesteuerter Rückabwicklung
- Neue UndoToast-Komponente (`src/components/undo-toast.tsx`) mit Fade-Animation
- RuntimeProvider reicht `scheduleUndo`/`cancelUndo` durch
- Audit-Event-Übersetzung um `beerround.deleted`, `loss.deleted` und `session.close_attempted_already_closed` erweitert
