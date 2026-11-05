# Integrationsverträge

## Core-Host

`JobsHostAdapterV1` und `globalThis.skympJobsHost` sind von Jobs definierte,
vorbereitete Verträge, **keine derzeit existierenden SkyMP-Core-Services**.
Ein vertrauenswürdiger Bootstrap kann vor Jobs folgende Instanzen bereitstellen:
Identität, Persistenz, Core-Permissions, Economy, Factions und `onReady(controls)`.
`identity=host`/`persistence=host` verlangen die entsprechenden Adapter. Das
vollständige Beispiel liegt in `examples/host-bootstrap.ts` im Quellrepository.

Die Identität liefert `getSession(userId)` und `isCurrent(binding)`. Bindings
enthalten stabilen `characterId`, `accountId`, User/Actor und `sessionId`, die sich
bei jeder Charakteraktivierung ändert. Die Charakterauswahl muss sofortige
Invalidierung/Disconnect signalisieren und Jobs binden, bevor neue Aktionen
zugelassen werden. Ein einmaliger Poll reicht nicht als Definition einer echten
Core-Charakterwechsel-API. Der native Fallback ist auf vorhandene gespeicherte
Core-Datensätze beschränkt, siehe PERSISTENCE.

Der vorhandene Core-Service `skympConsoleSecurity` wird im nativen Adapter nur
über `apiVersion=1` und `hasPermission(userId,permission)` gelesen. Jobs übernimmt
keinen globalen Resolver. Fehlender Service, falsche Version, Fehler und Ablehnung
erlauben keine angeforderten übergeordneten Rollen. Ohne explizite Core-Bedingung
gelten die fachlichen Job-/Rang-/Qualifikations-/Dienstregeln von Jobs.

## Economy

`EconomyAdapterV1` bietet `request({characterId,owner,idempotencyKey,eventId,
jobId,kind,amount,currency,reason})`. `kind` ist `salary`, `reward`, `bonus` oder
`fee`; `amount` ist positiv in der kleinsten Währungseinheit. Economy entscheidet
über Konten, Guthaben, Währungsvalidierung, Gebührenrichtung und Ablehnung.
Jobs besitzt weder Kontostand noch eigenes Währungssystem oder Gehaltstimer.
Eine externe Berufs-/Lohnressource erzeugt einen bestätigten Anspruch.

Jobs speichert vor dem Aufruf eine `pending`-Anforderung mit einem SHA-256-Schlüssel
aus Owner, Charakter und Ereignis-ID. Eine abweichende Nutzlast derselben ID ist
ein Konflikt. `settled` wird bei Wiederholung aus dem Journal beantwortet;
`pending`/mehrdeutige Fehler werden mit exakt demselben Schlüssel erneut gesendet.
Der externe Economy-Aufruf hält dabei keine Charakterqueue offen; langsame
Zahlungsantworten blockieren keine Rangwechsel oder Duty-Checkpoints.
Economy muss diesen Schlüssel **dauerhaft und atomar** deduplizieren. Eine
prozesstransiente Map bei Economy genügt für echte Zahlungen nicht. Die schwächere
native Jobs-Commit-Garantie wird dadurch nicht zu einer stärkeren Garantie.
Fehlt Economy, liefert die Operation `unavailable`; übrige Jobs-Funktionen bleiben
voll nutzbar. Keine Dummy-Gutschrift und kein stiller Erfolg.

## Factions

`FactionsAdapterV1.isMember(characterId,factionId)` ist eine optionale Abfrage,
zum Beispiel für `access.factionId`. Jobs kopiert keine Fraktionszugehörigkeit,
Organisationsränge, Fraktionsrechte oder Gebiete. Eine Stadtwachen-Fraktion und
der Job `law` bleiben unabhängig. Räumliche Zuständigkeiten/Fraktionsrechte muss
die Law-Ressource über den späteren Factions-Service selbst prüfen.

## Geplante Job-Ressourcen

| Eigenständiges zukünftiges Plugin | Nutzung von Jobs und anderen Services |
| --- | --- |
| `SkyMP-Job-Medic` | Jobs: Qualifikation/Duty; DeathRules: Verletzung/Behandlung; Metabolism: Krankheiten |
| `SkyMP-Job-Law` | Jobs: berufliche Rechte/Duty; Justice: Festnahmen/Strafmechaniken; Factions: örtliche Zuständigkeit |
| `SkyMP-Job-Blacksmith` | Profession-XP/Qualifikationen, Schmiedemitarbeit; eigenes Handwerks-Gameplay |
| `SkyMP-Job-Merchant` | Beschäftigung/Ränge/Rechte; eigenes Handels-Gameplay und Economy-Anbindung |
| `SkyMP-Job-Hunter` | Jagdkenntnisse/Qualifikationen, optionaler Job; eigene Jagdmechaniken |
| `SkyMP-Job-Miner` | Bergbaukenntnisse/Qualifikationen, optionaler Job; eigene Abbaumechaniken |

Diese APIs von DeathRules/Justice/Economy/Factions werden hier weder angenommen
noch implementiert. Die Ressourcen sind Planung, keine automatisch geladenen
Berufe. Funktionierende harmlose Registrierung und Consumer sind unter
`examples/SkyMPJobsExample` und `examples/SkyMPJobsConsumer` vorbereitet.

## UI Core und Chat

UI nutzt öffentliche API/Frontend-Protokoll 1, Owner `skymp-jobs`, Widget
`skymp-jobs:status`, Menü `skymp-jobs:overview` und `core:dialog-v1`.
Das Widget begrenzt seine Zeilen auf den tatsächlichen UI-Core-Vertrag; das Menü
erreicht per Vor/Zurück alle Mitgliedschaften und Professionen. Es öffnet sich
einmal pro Sitzung und ist über `/job` erneut erreichbar. Berufsränge, Dienstzeit,
XP, Level, Unlocks und Qualifikationen werden aus Serverzustand dargestellt.
Nur angebotene Aktionen mit leerer Nutzlast und passender aktueller Sitzung sind
zulässig. Die ausgewählte Job-ID wird serverseitig gehalten, niemals im Client
als Mitgliedschaft oder Recht vertraut.

Chat verlangt zusätzlich `extensions.commands===1`, registriert konfigurierbare
typisierte Commands und nutzt private sitzungsgebundene Antworten. Kollisionen
werden je Command diagnostiziert und ausgelassen, nicht überschrieben. Cleanup
entfernt nur erfolgreich angelegte Jobs-Registrierungen. Adapter ersetzen keine
Chat-/UI-Identitätsresolver. Die Präsentation ist derzeit deutschsprachig.

Weder die Character-Creator-Grundstruktur noch eine MariaDB-Treiberkonfiguration
beweisen, dass eine zentrale Charakter-/Plugin-Persistenz-API bereits existiert.
