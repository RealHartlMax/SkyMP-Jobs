# SkyMP-Jobs

Eigenständiges, serverautoritäres Job- und Profession-Framework für den lokalen
SkyMP-Fork. Berufe registrieren ihre Definitionen aus **separaten Plugin-Ressourcen**;
Jobs verwaltet Mitgliedschaften, Ränge, primären Job, Professionen, XP,
Qualifikationen, Rechte und Dienstzeit. Kein fest verdrahteter RP-Gamemode.

Lokaler Entwicklungsstand: `0.1.0-dev.20261104`, öffentliche API **1**, Datenschema **2**.
Die bestehende [GPLv3-Lizenz](LICENSE) wurde unverändert erhalten.

```powershell
npm ci
npm run check
npm run verify:fork
```

Der lokale, entpackte Build liegt unter `build/Plugins/SkyMPJobs/`; Installation
und Grenzen beschreibt [INSTALLATION](docs/INSTALLATION.md). Das Bundle ist eine
einzelne CJS-Datei für den vorhandenen `gamemode`-/`requireTemp`-Loader. Der
Build verändert keine Nachbar-Repositories und enthält keine Betreiber-Konfiguration.

```ts
const jobs = globalThis.skympJobs;
if (jobs?.apiVersion !== 1) throw new Error('SkyMP-Jobs API v1 benötigt');
const resource = jobs.registerResource('skymp-job-medic');
resource.registerJob({
  id: 'medic', owner: resource.owner, version: 1,
  label: 'Heiler', description: 'Medizinischer Beruf', category: 'medical',
  supportsDuty: true,
  grades: [{ id: 'apprentice', label: 'Lehrling' }, { id: 'healer', label: 'Heiler' }],
  permissions: [{ id: 'job.medic.treat', grades: ['healer'], requiresDuty: true }]
});
// Beim Ressourcenstop: await resource.dispose();
```

Registrierung verleiht keine Verwaltungsrechte. Ein vertrauenswürdiger Host
übergibt begrenzte Capabilities ausdrücklich; ein Owner-String reicht dafür nicht.
Alle Node-Plugins teilen allerdings denselben Prozess und sind keine Sandbox.

Standardmäßig bindet der native Adapter bestehende Core-Charakterdatensätze über
`profileId + FormDesc` und speichert Jobs-Daten in deren `private.skympJobs`-
ChangeForm. Damit wird auch der vorhandene Core-MariaDB-Treiber verwendet, ohne
eine parallele Datenbank anzulegen. Eine allgemeine zentrale Charakter-/Persistenz-
API ist im geprüften Fork noch nicht verfügbar. Die vorbereiteten Host-Verträge
ersetzen diese fehlende Integration ausdrücklich nicht. Native Schreibannahme
ist keine dauerhafte Commit-Bestätigung. In-Memory ist nur ein Testadapter.

UI Core und Chat sind optional. Die Übersicht zeigt Jobs/Ränge, Profession-XP und
Dienststatus und bietet eigene Dienst-/Primärjob-Aktionen. Sie öffnet sich bei der
ersten Veröffentlichung einer Charaktersitzung; `/job` öffnet sie erneut. `/jobs`,
`/professions` und `/duty [jobId] [on|off]` nutzen die öffentliche Chat-Command-API.
Alle Namen sind konfigurierbar; Kollisionen überschreiben keine fremden Commands.
Es gibt keine zweite Chat- oder CEF-Anwendung.

- [Architektur und Vertrauensgrenzen](docs/ARCHITECTURE.md)
- [Öffentliche API und Capabilities](docs/API.md)
- [Persistenz und Migrationen](docs/PERSISTENCE.md)
- [Quellcode-Audit und Core-Integrationsvorschläge](docs/AUDIT.md)
- [Economy, Factions und geplante Berufsressourcen](docs/INTEGRATIONS.md)
- [Eigenständige Beispiele](examples/README.md)
- [Validierung und offene Laufzeitabnahme](docs/VALIDATION.md)

Keine Implementierung von Medic, Law, Blacksmith, Merchant, Hunter oder Miner
ist enthalten. Diese Ressourcen konsumieren später das gemeinsame Framework.
