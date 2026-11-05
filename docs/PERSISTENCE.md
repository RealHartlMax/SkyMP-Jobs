# Charakterpersistenz

## Vorhandener nativer Pfad

Der native Adapter verwendet den vom Core bereits gespeicherten FormDesc und
`profileId`. Schlüssel: `native:<profileId>:<FormDesc>`. `userId`, Actor-ID oder
Spielername allein sind ausdrücklich kein Primärschlüssel. Der Actor wird beim
Zugriff aus dem FormDesc aufgelöst und gegen Profil und Rückbeschreibung geprüft.
Jobs erzeugt keine Accounts, Slots oder konkurrierenden Charakter-UUIDs.
Der native Adapter setzt voraus, dass der Core den Datensatz auflösen und lesen
kann. Er umgeht keine Core-Ladegrenze durch eigene direkte Offline-SQL-Abfragen.

`private.skympJobs` enthält einen Envelope mit `formatVersion: 1`, Charakter-ID,
Profil, FormDesc und dem Jobs-Zustand. Der Core serialisiert dynamische Felder in
ChangeForms; der lokale MariaDB-Treiber führt dafür bereits `dynamic_fields` an
seinen Charakterdatensätzen. Die native Speicherung wird deshalb mit dem
eingestellten Core-Treiber fortgesetzt. Keine direkte MariaDB-Verbindung im Plugin.

Annahme durch `mp.set` ist nicht gleich dauerhafter DB-Commit. Der Adapter meldet
`durableCommitAcknowledged=false`; `flush()` kann nur mangels Core-Methode leer
zurückkehren. Ein produktiver Host, der stärkere Garantien benötigt, muss den
untenstehenden Vertrag durch eine zentrale Transaktions-/Flush-API erfüllen.
Ein aktueller nativer Save-/Restart-/MariaDB-Lauf wurde hier nicht durchgeführt.

## Vertrag `JobsPersistenceV1`

```ts
interface JobsPersistenceV1 {
  readonly apiVersion: 1;
  readonly mode: string;
  readonly durableCommitAcknowledged: boolean;
  load(characterId: string): Promise<unknown | null>;
  compareAndSet(characterId: string, expectedRevision: number | null,
                next: CharacterState): Promise<void>;
  flush(): Promise<void>;
}
```

`null` bedeutet fehlender **Jobs-Namensraum eines existierenden Charakters**, nicht
einen neuen Charakter. `expectedRevision=null` erlaubt nur die erstmalige Anlage
dieses Namensraums. Sonst muss die Revision atomar übereinstimmen; neue Revision
ist immer `previous + 1` (bei erstmaliger Anlage `1`). Der Host muss Charakterbesitz
und Namespace autoritativ prüfen und darf keinen zweiten Account-/Charakterbestand
erzeugen. Adapter sind vom Host verwaltet; Jobs schließt keinen fremden DB-Pool.

`durableCommitAcknowledged=true` darf nur bestätigt werden, wenn erfolgreicher
CAS/Flush tatsächlich die vereinbarte dauerhafte Transaktion bestätigt. Mehrere
Prozesse brauchen DB-weites CAS und Session-Fencing; die lokale Queue allein
koordiniert nur diese Jobs-Instanz. Sie darf nicht durch unabhängige direkte
Schreiber umgangen werden. Fehlgeschlagene/mehrdeutige Writes werden nicht als
Erfolgsereignisse dargestellt; XP-/Zahlungs-/Duty-IDs erlauben sichere Wiederholung.

## Schema und Migration

Aktuell: `CharacterState.schemaVersion=2`, getrennt von API 1, Envelope 1 und den
Versionsnummern jeder Ressourcen-Definition. Zustand enthält Mitgliedschaften
mit Owner/Definitionsversion/Rang/Spezialisierung/Dienstgesamtzeit, primären Job,
unabhängige Professionen mit XP sowie XP-Quittungen, Zahlungen und Duty-Journal.

Der dokumentierte V1-Vorläufer besteht aus `schemaVersion`, `characterId`,
`revision`, `jobs`, `professions` und `primaryJobId`; Membership-/Profession-
Strukturen entsprechen V2. `migrateState` übernimmt diese Werte unverändert und
ergänzt in V2 leere `experienceReceipts`, `payments`, `dutyLog`. Dies ist ein
vorbereiteter Migrationspfad, keine Behauptung über ältere veröffentlichte Releases.
Migration wird beim nächsten erfolgreichen CAS mit höherer Revision gespeichert.

Unbekannte Versionen, falscher Charakterbesitz, negative Werte, doppelte
Mitgliedschaften oder beschädigte Journale schlagen fehl. Es gibt keinen
stillen Reset auf leere Daten. Betreiber müssen vor späteren Schemaänderungen
den zentralen Core-Speicher sichern und Migrationen gezielt testen.
Definitionsänderungen entfernen keine gespeicherten Daten. Das Entfernen oder
Umbenennen eines Rangs benötigt einen ausdrücklich autorisierten Migrationsplan;
ein fehlender Rang erhält bis dahin keine Rechte.
Ein für diesen Job autorisierter Verwaltungs-Handle kann mit `setGrade` einen
expliziten gültigen neuen Rang setzen oder mit `setSpecialization(..., null)`
eine entfernte Spezialisierung aufheben. Mitgliedschaft und Dienstgesamtzeit
bleiben dabei erhalten; Owner- und Versionswechsel werden weiterhin geprüft.

## Grenzen der lokalen Journale

Pro Charakter maximal 4.096 XP-Ereignisquittungen, 2.048 Zahlungsanforderungen und
256 jüngste Duty-Intervalle; gesamter Zustand maximal 2 MiB. `totalDutyMs` bleibt
beim Kürzen des Duty-Journals vollständig erhalten. XP-/Zahlungsquittungen werden
**niemals automatisch gelöscht**, weil alte IDs sonst erneut wirken könnten.
Bei voller Quittungsliste verweigert die jeweilige Operation weitere Einträge.

Für langfristigen größeren Produktivbetrieb muss ein zentraler Host diese
Deduplizierung atomar in einem eigenen Jobs-**Namensraum des Core-Speichers**
archivieren und den Adaptervertrag dafür versioniert erweitern. Bloßes manuelles
Leeren der Quittungen ist keine sichere Kompaktierung. Das begrenzte Duty-Journal
ist ein Betriebsprotokoll, kein unbegrenzt revisionssicheres Lohn-/Audit-Archiv.

## In-Memory

`InMemoryJobsPersistence` ist ein isolierter, testbarer CAS-Adapter. Snapshots
sind Kopien. Nur das Wiederverwenden derselben Adapterinstanz erhält den
Testzustand; ein neuer Prozess/Adapter verliert alles. Dieser Modus wird beim
Pluginstart deutlich als Testbetrieb protokolliert und niemals als produktive
dauerhafte MariaDB-Speicherung ausgewiesen.
