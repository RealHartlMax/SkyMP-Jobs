# Lokaler Audit und Core-Integrationsvorschläge

Quellprüfung begonnen am 2026-11-04, Abschluss/Loaderprüfung am 2026-11-05.
Maßgeblich sind lokale Arbeitsbäume, einschließlich ihrer Änderungen, nicht das
möglicherweise leere öffentliche GitHub-Repository.

## Ausgangslage und Grenzen

`SkyMP-Jobs` hatte vor der Implementierung nur `README.md` und `LICENSE`, einen
sauberen Arbeitsbaum und HEAD `2ef5607` (Initial commit). Keine vorhandene
Implementierung oder lokale Änderung wurde verworfen. Keine übergeordneten
AGENTS-Anweisungen lagen unter `D:/` oder `D:/GitHub/` vor. Neue AGENTS.md ergänzt
die projektspezifischen Regeln. Ausschließlich dieses Repository wurde bearbeitet.

Die vorhandene Lizenz ist der GNU-GPLv3-Text; unveränderter SHA-256:
`230184f60bae2feaf244f10a8bac053c8ff33a183bcc365b4d8b876d2b7f4809`.
Neue Quellen/Metadaten verwenden GPL-3.0-only wie das lokale SDK. Es wurden weder
Commits noch Pushes, Releases, Deployments oder Serverbuilds ausgeführt.

Die Referenzprojekte `skymp`, Plugin-Template, UI Core, Chat, Metabolism und
Character-Creator enthielten teilweise umfangreiche lokale Änderungen.
`skymp` hatte HEAD `0bb7697d`, das Template `b29dc0a`. Diese HEADs allein sind
kein vollständiger Snapshot. Der erfolgreiche `verify:fork`-Bericht enthält
Hashes der maßgeblichen tatsächlich gelesenen Loader-/Providerquellen und des
Jobs-Entries unter `artifacts/fork-validation.json`.

## Geprüfte lokale Verträge

| Bereich | Tatsächlich geprüfte Quelle | Konsequenz für Jobs |
| --- | --- | --- |
| Loader/Manifest | `skymp/skymp5-server/ts/index.ts`: `readPluginManifest`, `discoverPlugins`, `requireTemp`, `bootstrapPlugins` | Direkte `Plugins/*/plugin.json`, `kind=gamemode`; nur Entry wird temporär kopiert. Ein CJS-Bundle, keine Sibling-requires oder __dirname-Konfiguration. |
| Start/Deaktivierung | `pluginDiscoveryState.ts`, `pluginLoadOrder.ts`, `index.ts` | Safe-Mode deaktiviert neue Plugins. Aktivierung und Reihenfolge gelten nach Gameserver-Neustart; keine allgemeine Unload-API. `requireTemp` fängt Fehler ab, Dashboard „running“ beweist daher keine erfolgreiche Initialisierung. |
| Dashboard | `skymp5-front/src/features/adminDashboard/PluginsPanel.tsx`, Server `ui.ts` und `pluginLoadOrder.ts` | Bestehende sichtbare Aktivierungs-/Sortieroberfläche und revisionierte GET/PUT-API verwenden; keine Dashboard-Quelldatei ändern. Kein erfundenes Jobs-Admin-Backend. |
| Identität | `cpp/addon/ScampServer.cpp`, `property_bindings/ProfileIdBinding.cpp` | Native Connection-/Actor-Rückbindung, Profil und FormDesc vorhanden. Kein zentraler Character-UUID-/Slot-Service für Plugins. Native Jobs-Bindung verwendet den bestehenden gespeicherten Datensatz. |
| Rollen/Rechte | `ts/consoleSecurity.ts`, Veröffentlichung in `index.ts` | Tatsächlicher Global-Service `skympConsoleSecurity`, API 1, `hasPermission`. Ein einzelner Resolver darf nicht vom Consumer übernommen werden. |
| Native Persistenz | `MpChangeForms.cpp`, `ScampServer.cpp`, SDK `sdk/persistence.ts` | Private dynamische Felder werden über ChangeForms gespeichert. Keine JS-Flush-/Commit-Bestätigung. |
| MariaDB-Entwicklung | `cpp/server_guest_lib/database_drivers/MariaDbDatabase.cpp`, `DatabaseFactory.cpp`, `ts/databaseSettings.ts`, `ts/playerUsers.ts`, `systems/usersSystem.ts` | MariaDB als lokaler Core-Treiber bereits implementiert; `characters` nach `form_desc` mit `profile_id` und `dynamic_fields`, `users.max_characters` vorbereitet. Keine universelle zentrale JS-Plugin-Persistenz-API und keine fertige Slot-Auswahl. |
| Character-Creator | `SkyMP-Character-Creator/README.md` und Projektstruktur | Noch geplantes Projekt, keine implementierte Plugin-Runtime oder verwendbare Charakterauswahl-API. |
| UI Core | `shared/contracts.ts`, `src/runtime.ts`, SDK `api/ui.d.ts` | API/Protokoll 1, Owner-Präfix, Statusprüfung, reale Zustandslimits, explizite Aktionsautorisierung und Cleanup. Zustand vor Sichtbarkeit setzen. Kein eigenes CEF. |
| Chat | `Plugins/SkyMPChat/api.d.ts`, `src/runtime.cjs` und `registry.cjs` | API 1 plus Commands-Erweiterung, typisierte Parameter, `isCurrent()`/AbortSignal, ownerbezogener Cleanup. Kein eigener Parser/Chat. |
| Metabolism | `src/integrations/skymp/adapter.ts`, `src/persistence/native.ts`, vorhandene Integrationsstruktur | Native Muster bestätigt; seine private UUID nicht zu einer zentralen Charakter-ID umdeuten. Vorhandene Gameplayhandler nicht überschreiben. |
| Plugin-Template | `sdk/server.ts`, `sdk/api/*.d.ts`, `sdk/tools/project.cjs`, Simple-/UI-/Chat-/Persistence-Starter | GPL-SDK-Quellen lokal vendort; Lifecycle-/Dependency-Prüfung wiederverwenden, CJS-Build und Deklarationen lokal erzeugen. |

`skymp-client-launcher` benötigt keine Änderung: Jobs besitzt keine eigenen
Client-/CEF-Dateien. UI-Core-/Chat-Runtime-Verteilung bleibt bei den vorhandenen
Projekten; ihr Vorhandensein auf einem echten Client wurde hier nicht bestätigt.

## Separate Core-Integrationsvorschläge

1. **Zentrale Charakteridentität/Lifecycle:** Core veröffentlicht versionierte,
   stabile Slot-/Charakter-IDs und Aktivierungsgenerationen. Ereignisse für
   Auswahlwechsel, auch bei Wiederverwendung desselben Actors/Records, invalidieren
   die alte Sitzung synchron. Der Jobs-Host-Identitätsadapter bindet diesen Dienst.
2. **Zentrale Plugin-Persistenz:** Host-owned Namespace mit atomarem CAS auf
   Charakter-ID/Revision, Besitzprüfung, Schema-Migration und bestätigtem Flush.
   Vorhandenen MariaDB-Pool/Treiber weiterverwenden, keinen zweiten Accountbestand.
   Mehrprozessbetrieb benötigt transaktionales Session-Fencing.
3. **Plugin-Lifecycle/Startfehler:** Authoritative Erfolgsmeldung und awaitbarer
   Stop-/Flush-Hook, abmeldbare native Events, ownerbezogene Ressourcenfreigabe.
   Aktuellen `requireTemp`-Fehlerpfad nicht als Startbestätigung behandeln.
4. **Begrenzte Host-Capabilities:** Ein vertrauenswürdiger Bootstrap soll Handles
   an genehmigte Servermodule übergeben; spätere Core-Ownerinformationen können
   versehentliche Namensverwechslungen verhindern. Das ist keine Sandbox für
   beliebigen Node-Code. Unvertrauenswürdiger Code braucht Prozessisolation.
5. **Langfristige Journale:** Dauerhafte, transaktional deduplizierte Jobs-/Economy-
   Ereignisjournale und sicheres Archivieren für mehr als die bewusst begrenzten
   nativen Quittungslisten. Keine automatischen Löschungen idempotenter IDs.

Diese Vorschläge wurden ausschließlich dokumentiert. Kein Fremdrepository wurde
gepatcht und keiner dieser neuen Dienste wird als bereits vorhandene Core-API
ausgegeben.
