# Öffentliche API v1

Typquelle: `src/library.ts`. Nach Build: `dist/types/src/library.d.ts`;
für ein installiertes Plugin: `types/src/library.d.ts`. Das Bibliotheksbundle
`dist/library.cjs` startet keinen Plugin-Lifecycle. Der reguläre Plugin-Entry
veröffentlicht dagegen `globalThis.skympJobs`.

## Lesen und Registrieren

| Operation auf `skympJobs` | Ergebnis |
| --- | --- |
| `apiVersion` | Literal `1`; vor Verwendung prüfen |
| `status` | Adaptermodus und tatsächliche Commit-Bestätigung, keine Behauptung über DB-Erreichbarkeit |
| `registerResource(owner)` | Nur `ResourceRegistrationV1`; doppelte aktive Owner abgewiesen |
| `getJob(id)` / `listJobs()` | Immutable registrierte Definitionen einschließlich `enabled=false` |
| `getProfession(id)` / `listProfessions()` | Immutable Professiondefinitionen |
| `getCharacter(characterId)` | Promise mit vollständigem gespeichertem Zustand oder leerem Schema-2-Zustand |
| `getActiveJobs(characterId)` | Nutzbare Mitgliedschaften samt Definition und `primary` |
| `getProfessions(characterId)` | Fortschritt, Level, Unlocks, Qualifikationen und Verfügbarkeit |
| `hasQualification(characterId, requirement)` | Profession vorhanden und Mindest-XP/Qualifikationsschwelle erfüllt |
| `hasPermission(characterId, permission)` | Zentrale berufliche Prüfung ohne automatischen Admin-Bypass |
| `getDuty(characterId, jobId)` | `onDuty`, `canStart`, insgesamt angenommene `creditedMs`, aktuelles begrenztes Intervall `currentMs` |
| `subscribe(listener)` | Rückgabe ist eine Abmeldefunktion |

Alle Charakter-IDs kommen aus vertrauenswürdigen Serverquellen. Die API ist kein
Client-Endpunkt und liest Daten anderer Charaktere nur für vertrauenswürdige
Server-Plugins. Keine vollständigen Charakterzustände an unbeteiligte Clients senden.

Ein Registrierungs-Handle bietet `registerJob`, `deregisterJob`, `setJobEnabled`,
`registerProfession`, `deregisterProfession`, `subscribe` und `dispose`.
Registrierung erfordert `id`, passenden `owner`, positive ganzzahlige
Definitions-`version`, `label` und `description`; Jobs zusätzlich `category` und
mindestens einen Rang. Definitionen sind unveränderlich. Änderungen erfolgen
über Deregistrierung/Neuregistrierung mit höherer Version; Inkompatibilitäten
gespeicherter Ränge werden niemals stillschweigend umgedeutet.

Eine Jobdefinition kann `specializations`, `access`, `supportsDuty`, `dutyAccess`
und `permissions` anbieten. Rechte müssen im Namensraum `job.<jobId>.` liegen:

```ts
permissions: [{
  id: 'job.medic.revive', grades: ['master'], requiresDuty: true,
  qualifications: [{ professionId: 'medicine', qualificationId: 'revival' }],
  corePermission: 'host.medical-practice'
}]
```

`AccessConditions` kombinieren Qualifikationen, optionales `corePermission` und
optionale `factionId`. Fehlen angeforderte Core-/Faction-Adapter oder lehnen sie
ab, bleibt der Zugriff verweigert. Jobs installiert keinen fremden Core-/Chat-
Permission-Resolver. Qualifikationsschwellen und Berufsränge bleiben verschiedene
Konzepte. Fehlende Professiondefinitionen können keine Qualifikation erfüllen.

Professionen definieren `maxExperience`, zulässige `experienceSources` mit
`maxAward`, aufsteigende `levels` mit optionalen Unlock-IDs und konfigurierbare
`qualifications` mit XP-Schwelle. Die reine Registrierung lernt keine Profession.

## Privilegierte Server-Handles

Nur `controls.provisionResource(owner, grants)` erzeugt
`ResourceAdministrationV1`. `controls` wird ausschließlich dem explizit
installierten Host-Adapter übergeben, nicht global veröffentlicht.
`registerResource('admin')` bietet keinerlei Verwaltungsoperationen.

| Capability | Freigeschaltete Operationen innerhalb der angegebenen IDs |
| --- | --- |
| `manageJobs: string[]` | `assignJob`, `removeJob`, `setPrimaryJob`, `setGrade`, `setSpecialization`, `setDuty` |
| `manageProfessions: string[]` | `learnProfession` |
| `experience: {professionId,sources}[]` | `addExperience` nur aus expliziten Quellen und innerhalb der Definitionslimits |
| `payments: string[]` | `requestPayment` für die angegebenen Jobs |

Die Registrierung bleibt auf den eigenen Owner beschränkt. Verwaltungsrechte
können vom Host bewusst auch einem separaten Hiring-/Gameplaycontroller für
eine bestimmte Job-ID übergeben werden. Ein Controller braucht keine globale
Adminrolle und bekommt keine Rechte an anderen Jobs.

```ts
await admin.assignJob(characterId, 'medic', 'apprentice');
await admin.setGrade(characterId, 'medic', 'master');
await admin.setSpecialization(characterId, 'medic', 'field-medicine');
await admin.setPrimaryJob(characterId, 'medic');
await admin.learnProfession(characterId, 'medicine');
await admin.addExperience(characterId, 'medicine', {
  source: 'confirmed-treatment', eventId: 'server-treatment:unique-id', amount: 25
});
```

XP-Vergabe benötigt einen vertrauenswürdigen Serverabschluss, eine erlaubte Quelle,
positive ganzzahlige XP und eine unverwechselbare `eventId`. Wiederholung derselben
Owner-/Charakter-/Ereignis-Kombination ist ein No-op mit Rückgabe `false`. Andere
Parameter zur selben ID ergeben einen Konflikt. Überschreiten der XP-Obergrenze
wird abgewiesen. Es gibt keinen Client-Pakettyp zum Vergeben von XP oder Rollen.

`setDuty` verlangt beim Einschalten eine bestätigte Online-Sitzung, Mitgliedschaft
und alle Zugangs-/Rangbedingungen. `setPlayerDuty`/`setPlayerPrimary` auf den
Host-Controls sind engere Operationen für den eigenen aktuellen Charakter.
Entfernung eines Jobs beendet seinen Dienst und bestimmt bei Bedarf den nächsten
gespeicherten Job als primären. Deaktivierung erhält den bisherigen primären Job.

## Events und Stop

Events enthalten `apiVersion`, `type`, `at` und gegebenenfalls `characterId`,
`owner`, `jobId`, `professionId`, `revision`, `reason`. Typen:
`job-registered`, `job-unregistered`, `job-enabled`, `profession-registered`,
`profession-unregistered`, `job-assigned`, `job-removed`, `primary-changed`,
`grade-changed`, `specialization-changed`, `profession-learned`, `experience-added`,
`duty-changed`, `duty-time`, `payment`.

Zustandsereignisse folgen auf die Speicherannahme. Registry- und flüchtige
Duty-Start-Events haben keine Zustandsrevision. Diese Events sind weder ein
persistentes Message-Broker-Log noch ein Empfangsnachweis. Consumer müssen nach
Start ihren Zustand lesen und Folgearbeiten mit eigenen eindeutigen IDs sichern.

`await resource.dispose()` entfernt nur eigene Registrierungen/Listener und
beendet den Dienst, erhält aber gespeicherte Daten. `await controls.shutdown()`
sperrt Mutationen, schließt Dienste, leert Registrierungen und wartet auf den
Persistenzadapter. Die Core-Unload-/Commit-Grenzen sind in INSTALLATION beschrieben.
