# Validierung

Stand: 2026-11-05. Lokaler Entwicklungsbuild, keine Veröffentlichung.

Letzter vollständiger Stand: **36 Tests bestanden**, keine Fehler/übersprungenen
Tests; Typprüfung, Build einschließlich installiertem TypeScript-Consumer und
Prüfung gegen den aktuellen lokalen Fork erfolgreich.

## Ausgeführte Prüfungen

- `npm run check`: strikte TypeScript-Prüfung, selbstständiges CJS-Bundle,
  Deklarationserzeugung und Node-Test-Suite.
- `npm run verify:fork`: aktuelle Loaderfunktionen direkt aus dem lokalen Fork
  extrahiert und ausgeführt; keine Nachimplementierung des Loaderverhaltens.
  Echte lokale UI-Core-/Chat-Provider mit nativer API-Fixture verwendet.
- GPL-Lizenzhash mit dem vor der Implementierung erfassten Hash verglichen.

Die Tests prüfen Registry/Owner/doppelte IDs, mehrere Jobs und zwei Slots desselben
Accounts, primären Job, Rang/Spezialisierung, Profession ohne Beschäftigung,
XP-Quellen/Limits/Deduplizierung, Qualifikationen, optionale Core-/Faction-Rechte,
Speicherkonflikte/-fehler, Migration und beschädigte Envelopes. Duty-Prüfungen
umfassen Online-Bindung, wiederholte Starts/Stops, Wechsel/Disconnect, Neustart,
Zeitlücken, Parallelitätslimit und Wiederholung nach verlorener Schreibbestätigung.
Economy-Prüfungen umfassen fehlenden Adapter, widersprüchliche Wiederholung,
mehrdeutigen Transfer und langsame externe Antworten ohne blockierte Jobverwaltung.

Runtime-Tests prüfen fehlende/spät verfügbare optionale APIs, Commandkollisionen,
private UI-Ziele, angebotene Aktionen, stale Sessions, konfigurierbare Commands,
Cleanup und beide separat lauffähigen Beispielressourcen.

Der Fork-Test bestätigt tatsächliche Safe-Discovery, persistierte Aktivierung,
explizite Reihenfolge und temporäres Laden aller drei selbstständigen Entries.
Jobs startet vor den echten UI-/Chat-Providern und findet diese nachträglich.
Das echte Chat-Command schaltet Dienst ein, die echte UI-Aktion wieder aus;
UI-Payloads entsprechen den tatsächlichen Provider-Limits. Ein zweiter Charakter
erhält keine fremden Jobdaten. Listener-/Menü-/Command-Cleanup ist nachgewiesen.
Ein maschinenlesbarer Bericht mit Quellen- und Entry-Hashes liegt anschließend in
`artifacts/fork-validation.json` (lokales, ignoriertes Testartefakt).

## Umgebung und Reproduzierbarkeit

Prüfumgebung: Windows/PowerShell, Node v24.19.0, npm 11.17.0;
TypeScript 5.9.3, esbuild 0.28.2 und @types/node 22.20.5 festgeschrieben.
Der Code-/Bundle-Zielstand ist Node 20. Ein eigener Node-20-Lauf wurde nicht ausgeführt.

`npm install --offline` konnte wegen fehlender npm-Cache-Metadaten nicht installieren.
Die Prüfungen verwenden deshalb identische bereits vorhandene Entwicklungspakete
aus dem lokalen Plugin-Template, ausschließlich in Jobs/node_modules kopiert.
Der Lockfile übernimmt dessen Registry-Integritätswerte mit angepassten
Projektmetadaten. Ein frischer `npm ci`-Download in einer sauberen Umgebung
ist damit vorbereitet, wurde in dieser eingeschränkten Sitzung aber nicht bestätigt.
Die installierbare Serverdatei benötigt diese Entwicklungspakete nicht.

## Noch separat abzunehmen

1. Nativer Server mit aktuellem Addon: Speichern, vollständiger Prozessneustart
   und Wiederladen von `private.skympJobs` mit realem Core-Treiber.
2. Reale MariaDB: angenommene versus bestätigte Speicherung, Ausfälle und
   Wiederanlauf, ohne eine vom nativen Adapter nicht verfügbare Commit-API zu behaupten.
3. Echte Charakterauswahl mit mehreren Slots, insbesondere Wiederverwendung
   desselben Actors/Datensatzes; zentralen Host-Lifecycle anbinden.
4. Skyrim/CEF: tatsächliche Darstellung, Eingabe/Fokus, Wiederverbinden,
   Dienstaktion und zwei echte Spielerclients.
5. Zukünftige Economy-/Factions-Services und konkrete Medic-/Law-/Crafting-Ressourcen.
6. Betreiber-/VPS-Installation mit passender vorhandener UI-/Chat-Runtime.

Lokale Fixture-, Loader- und Providerprüfungen ersetzen diese Laufzeitabnahme nicht.
Kein Server wurde gebaut, kein VPS verändert und kein Deployment durchgeführt.
