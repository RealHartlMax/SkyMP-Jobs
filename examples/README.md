# Separate Ressourcen

`SkyMPJobsExample` und `SkyMPJobsConsumer` sind jeweils direkt kopierbare,
selbstständige `gamemode`-Plugins ohne `node_modules` oder Buildpflicht.
Nach `<Server>/Plugins/` kopieren, separat im Dashboard aktivieren, nach
`skymp-jobs` laden und Gameserver neu starten. Der Consumer ist unabhängig vom
Registrierungsbeispiel lauffähig und verweigert dann einfach die Beispielberechtigung.

Die Registrierung erzeugt `example-worker` und `example-trade`, keine
Charakterzuweisung, XP oder Zahlungen. Beide Ressourcen besitzen `stop()`-Cleanup
über ihre dokumentierten `Symbol.for`-Handles; der aktuelle Core ruft sie beim
Deaktivieren nicht automatisch auf. Deaktivierung erfolgt beim nächsten Neustart.

`host-bootstrap.ts` zeigt die **vorgeschlagene** Host-Integration und bewusste
Übergabe eines begrenzten Verwaltungs-Handles. Der Bootstrap erhält echte
zentrale Identitäts-/Persistenzadapter; diese Datei ist kein fertiger Core-Service.
Ein vertrauenswürdiger Servercontroller kann nach der Registrierung zum Beispiel
Folgendes ausführen (mit dem vom Host übergebenen `controller`):

```ts
await controller.learnProfession(characterId, 'example-trade');
await controller.assignJob(characterId, 'example-worker', 'apprentice');
await controller.addExperience(characterId, 'example-trade', {
  source: 'verified-task', eventId: 'server-task:unique-completion-id', amount: 100
});
await controller.setDuty(characterId, 'example-worker', true); // nur mit aktueller Online-Sitzung
```

Eine Ereignis-ID gehört zu genau einem autoritativ bestätigten Abschluss. Die
Wiederholung derselben ID verändert XP nicht; andere Parameter werden abgewiesen.
Ein vom Client behaupteter Abschluss ist kein solcher Servernachweis.
Der externe Consumer fragt `canUseWorkshop(characterId)` ab. Dieser Check erfordert
Mitgliedschaft, Qualifikation und aktiven Dienst. Es wird keine Handwerksmechanik
im Framework oder Beispiel implementiert.
