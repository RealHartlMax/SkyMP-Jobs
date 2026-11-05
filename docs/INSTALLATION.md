# Lokale Installation

Entwicklungsstand vom 2026-11-04, Version `0.1.0-dev.20261104`, API 1.
Kein veröffentlichter Release und keine VPS-Abnahme.

1. Node.js >=20 und `npm ci` im Jobs-Repository, anschließend `npm run check`.
2. `build/Plugins/SkyMPJobs/` nach `<Server>/Plugins/SkyMPJobs/` kopieren.
   `config.example.json` bei Erstinstallation als `config.json` übernehmen.
   Der Build enthält absichtlich kein `config.json`; Updates erhalten Betreiberwerte.
3. Im bestehenden Dashboard unter Plugins `skymp-jobs` aktivieren. In der
   Ladefolge UI Core und Chat vor Jobs, Job-Ressourcen dahinter einordnen.
   Im Safe-Modus bleiben neu entdeckte Plugins zunächst deaktiviert.
4. Gameserver vollständig neu starten. Dashboard-Status allein genügt nicht:
   Log `Ready API=1` und `globalThis.skympJobs.apiVersion === 1` prüfen.

Der reguläre `gamemode`-Loader erhält eine einzelne selbstständige `index.cjs`.
Keine Server-/Gamemode-Quelldatei muss geändert werden. Konfigurationspfad:
`process.cwd()/Plugins/SkyMPJobs/config.json`. Keine zusätzliche CEF-Anwendung,
Clientdatei oder Runtime wird installiert. Die bereits vorhandene UI-Core-
Client/CEF-Runtime muss zur installierten UI-Core-Version passen.

Standard: `identity=native-record`, `persistence=native`. Ein Charakter wird durch
seinen vorhandenen Core-FormDesc plus Profil identifiziert; Jobs erfindet keine
Account-/Charakter-IDs. Verschiedene gespeicherte FormDescs desselben Profils
bleiben getrennt. Verwendet die Charakterauswahl denselben Datensatz erneut,
muss stattdessen der Host-Identitätsvertrag mit echten Slot-/Sitzungswechseln
angebunden werden. Der aktuelle Character-Creator implementiert diesen noch nicht.

Native Speicherung verwendet `private.skympJobs` im vorhandenen ChangeForm.
Der konfigurierte Core-Treiber (Dateien oder MariaDB) verwaltet dessen Speicherung.
`mp.set` bestätigt Annahme, keinen dauerhaften Datenbank-Commit. Keine separaten
SQL-Zugangsdaten, Tabellen oder MariaDB-Verbindung im Jobs-Plugin.

`persistence=memory` ist ausschließlich für Entwicklung/Tests: alle Daten gehen
bei einem neuen Adapter/Prozess verloren. `identity=host` und/oder
`persistence=host` benötigen den ausdrücklich vorgeschlagenen Jobs-Host-Adapter
vor dem Jobs-Start; bei fehlendem Adapter bricht Jobs nachvollziehbar ab.

Optionale UI/Chat-Abhängigkeiten werden mit Version-/Feature-Prüfung einmal pro
Sekunde bis zu 30 Anbindungsversuchen gesucht. Bei Kollisionen werden fremde
Commands erhalten und die betroffenen Jobs-Commands mit Diagnose ausgelassen.
Namen in `commands` konfigurieren, dann Gameserver neu starten.
`/job` öffnet bei verfügbarem UI Core zusätzlich die Übersicht mit Navigation,
primärem Job und Dienstaktionen; `/duty [jobId] [on|off]` bedient nur den eigenen
aktuellen Charakter. UI und Chat lassen sich unabhängig deaktivieren.

Kein allgemeines Plugin-Unload im Core vorhanden. Externe Ressourcen müssen ihre
Registrierung über `dispose()` aufräumen. Geordnete Host-Abschaltung soll
`await controls.shutdown()` ausführen; Core/SDK-Stop und Node-exit können keine
asynchrone Speicherbestätigung garantieren. Nach Absturz/Neustart ist jeder außer
Dienst. Nur zuvor angenommene Checkpoints zählen; es gibt keine Offline-Zeitgutschrift.

Die Deklarationen liegen in `build/Plugins/SkyMPJobs/types/src/library.d.ts` und
`dist/types/src/library.d.ts`. Beispiele unter `examples/` sind separat aktivierbare
Serverressourcen; sie gehören nicht zum automatischen Jobs-Start.
