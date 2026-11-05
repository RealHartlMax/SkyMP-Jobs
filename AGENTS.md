# SkyMP-Jobs

Eigenständiges GPLv3-Framework für Jobs und Professionen; konkrete Gameplay-Berufe
gehören in externe Ressourcen. Bestehende LICENSE unverändert erhalten.

- Nur dieses Repository ändern. Lokale Änderungen erhalten; keine Commits, Pushes,
  Veröffentlichungen oder Änderungen an Referenzprojekten ohne Auftrag.
- Vor Integrationen die lokalen Implementierungen des Forks, SDK, UI Core und Chat
  prüfen. Entwürfe niemals als vorhandene Core-APIs darstellen.
- Serverautoritativ: keine Client-Rollen, XP, Identitäten, Ränge oder Zahlungen.
- Öffentliche Registrierungs-/Lese-API und explizite Verwaltungs-Capabilities trennen.
  Ein Owner-String ist kein Berechtigungsnachweis. Node-Plugins sind nicht isoliert.
- Charakterdaten bleiben im Core-Speicher. Kein eigener Account-/Charakterbestand,
  keine eigenen MariaDB-Verbindungen oder Zugangsdaten.
- `npm run check` und `npm run verify:fork` ausführen. Loader-/Fixture-Tests sind
  keine native Skyrim-, CEF-, MariaDB-, Mehrspieler- oder VPS-Abnahme.
- Serverentry als einzelne CJS-Datei bündeln: requireTemp kopiert nur den Entry.
  Konfiguration über `process.cwd()/Plugins/SkyMPJobs/config.json` lesen.
- SDK-Kopie unter vendor nur gezielt ändern; Herkunft unter vendor/README.md.
