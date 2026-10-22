# 002 – KI-Rater

- **Status:** Freigegeben <!-- Entwurf | Freigegeben | Umgesetzt -->
- **Erstellt:** 2026-10-22
- **Abhängig von:** 001 (Grundspiel)

## Ziel
Codenames auch dann spielbar machen, wenn zu wenige Leute für zwei Rater-Teams da sind. In einem wählbaren **KI-Modus** treten die beiden Vorgeber gegeneinander an. Jedes Team hat einen KI-Rater, der wie ein menschlicher Mitspieler laut denkt und Karten aufdeckt, ohne die geheime Karte zu kennen.

## Situation
- Spec 001 sieht Hinweise ausschließlich mündlich vor. Das System kennt weder Hinweis noch Zahl und begrenzt die Rateversuche nicht.
- Aufgedeckt wird ausschließlich über das Player-Gerät des Vorgebers (`reveal`), den Zug beendet der Vorgeber (`endTurn`).
- Der Server unterscheidet bereits zwischen öffentlichem State (`PublicState`) und Player-State mit geheimer Karte (`PlayerState`).
- Es gibt keine Abhängigkeit zu externen Diensten. Das Spiel läuft komplett im LAN.

## Umfang
### Im Umfang
- Moduswahl „Klassisch“ / „KI-Rater“ in der Lobby.
- Hinweis-Eingabe (Wort und Zahl) auf dem Player im KI-Modus.
- KI-Rater pro Team auf Basis eines **lokalen Sprachmodells über Ollama** (Modell `qwen2.5:7b`).
- Zuschaltbarer Ollama-Dienst in Docker Compose (Profil `ki`).
- Lautes Denken als Text auf dem Screen.
- Gedächtnis: Die KI kennt alle Hinweise der laufenden Runde und deren Ergebnisse.
- Fehlerbehandlung, wenn Ollama nicht erreichbar ist oder unbrauchbar antwortet.

### Nicht im Umfang
- **Sprachausgabe (Text-to-Speech)** des lauten Denkens. Folgt als eigene Spec 003, die auf dieser aufbaut.
- KI als Vorgeber.
- Gemischter Modus (ein Team mit Menschen, eines mit KI).
- Cloud-Modelle (Claude-API o. ä.).
- Einstellbare Schwierigkeit oder Persönlichkeit der KI.
- Stopp-Knopf für den Vorgeber während des KI-Zugs (das Zeitlimit genügt).
- Hinweiszahl 0 oder „unbegrenzt“.

## Anforderungen

### R1 – Moduswahl in der Lobby
- Die Lobby (Screen und Player) zeigt eine Auswahl **„Modus: Klassisch | KI-Rater“**. Umschalten dürfen der Screen und beide Player. Standard: Klassisch. Die Wahl wird live synchronisiert und bleibt bei „Neue Runde“ erhalten.
- Die Auswahl erscheint **nur**, wenn der Container mit KI-Modus gestartet wurde (siehe R6). Bei einem normalen `docker compose up` ist die Lobby unverändert wie in Spec 001.
- Ist der KI-Modus gestartet, das Modell aber noch nicht bereit (z. B. erster Download läuft), ist „KI-Rater“ sichtbar, aber deaktiviert, mit Hinweis „Modell wird geladen …“ bzw. „Ollama nicht erreichbar“.
- Der Server prüft die Verfügbarkeit beim Öffnen der Lobby, beim Spielstart und, solange die Option deaktiviert ist, alle 5 s erneut. Wird das Modell bereit, wird die Option ohne Neuladen wählbar.
- Im Modus „Klassisch“ verhält sich alles exakt wie in Spec 001.

### R2 – Ablauf eines Zuges im KI-Modus
1. **Hinweis abgeben:** Der Player des aktiven Teams zeigt ein Eingabefeld für das Hinweiswort und eine Zahl (1–9) sowie „Hinweis abgeben“. Der Player des anderen Teams zeigt „Warte auf <Team>“.
2. **Validierung** (serverseitig, Fehlermeldung am Player):
   - Hinweis ist genau ein Wort (keine Leerzeichen), 1–30 Zeichen. Bindestrich-Wörter sind erlaubt.
   - Verglichen wird normalisiert: ohne Groß-/Kleinschreibung, Umlaute ersetzt (ä=ae, ö=oe, ü=ue, ß=ss).
   - Der Hinweis darf keinem noch verdeckten Feldwort gleichen.
   - Wortteile: Ist das kürzere der beiden Wörter mindestens 4 Zeichen lang (gezählt **vor** der Normalisierung, „Tür“ hat also 3 Zeichen) und steht es (normalisiert verglichen) am **Anfang oder Ende** des längeren, wird der Hinweis abgelehnt (z. B. „Haus“ bei „Haustür“, „Tür“ ist zu kurz und erlaubt). Teilwörter in der Mitte („Rad“ in „Paradies“) und kürzere Teile sind erlaubt.
3. **Anzeige:** Der Screen zeigt Hinweis und Zahl des aktiven Teams gut sichtbar an.
4. **KI rät:** Der Server fragt das Modell schrittweise. Jeder Schritt liefert einen Gedanken (1–3 Sätze, deutsch) und entweder ein Wort zum Aufdecken oder die Entscheidung aufzuhören.
   - Der Gedanke erscheint auf dem Screen, **bevor** die Karte aufgedeckt wird. Zwischen Anzeige und Aufdeckung liegt eine Pause, damit man mitlesen kann (Richtwert: 50 ms pro Zeichen, mindestens 2 s, höchstens 10 s).
   - Eigene Farbe: nächster Schritt. Andere Farbe: Zug endet wie bisher automatisch. Attentäter: Team verliert wie bisher.
   - Höchstens **Zahl + 1** Versuche pro Hinweis. Danach endet der Zug automatisch.
   - Die KI darf jederzeit früher aufhören, auch vor dem ersten Versuch. Dann endet der Zug, und der Screen zeigt ihren Begründungs-Gedanken.
5. Während die KI rät, sind am Player „Aufdecken“, „Zug beenden“ und die Hinweis-Eingabe gesperrt. Der Vorgeber sieht dieselben Gedanken wie der Screen.

### R3 – Was die KI weiß
- **Nur öffentliche Information:** verdeckte Wörter, aufgedeckte Wörter mit ihrem Typ, eigenes Team, aktueller Hinweis mit Zahl, bisherige Versuche zu diesem Hinweis.
- **Gedächtnis:** alle Hinweise der laufenden Runde (beider Teams) mit Zahl und den dazu aufgedeckten Wörtern samt Ergebnis. Die KI soll ausdrücklich ermutigt werden, übrige Wörter früherer eigener Hinweise nachzuholen.
- Die geheime Karte (`key`) darf **nie** in den Prompt gelangen. Der Prompt wird ausschließlich aus dem öffentlichen State gebaut.
- Das Gedächtnis wird bei „Neue Runde“ geleert.

### R4 – Verhalten der KI (Prompt-Vorgaben)
- Sie spielt wie ein menschlicher Rater: denkt laut, wägt Kandidaten ab, nennt Unsicherheit offen („Bei ‚Bank‘ bin ich mir nicht sicher, das lasse ich lieber“).
- Sie berücksichtigt das Risiko: Gegnerkarten, neutrale Karten und vor allem den Attentäter.
- Sie spricht Deutsch und duzt.
- Antwortformat ist strukturiert (JSON: `thought`, `guess` als Wort vom Feld oder `null`). Ollama wird mit JSON-Format-Vorgabe aufgerufen.

### R5 – Fehlerbehandlung
- Die Antwort `guess` wird mit derselben Normalisierung wie bei der Hinweis-Validierung (R2) gegen die verdeckten Feldwörter verglichen. Antwortet das Modell danach immer noch mit einem Wort, das nicht verdeckt auf dem Feld liegt, oder mit ungültigem JSON: einmal neu anfragen. Scheitert es erneut, endet der Zug, der Screen zeigt „Die KI ist ratlos und gibt den Zug ab.“
- **Zeitlimit: 45 s pro KI-Schritt** (eine Antwort des Modells). Antwortet das Modell früher, geht es sofort weiter; das Limit ist eine Obergrenze, keine Wartezeit. Bei Überschreitung oder nicht erreichbarem Ollama endet der Zug mit Hinweis auf dem Screen. Das Spiel bleibt spielbar.
- Wird während des Ratens pausiert (Vorgeber getrennt, Spec 001), wird der laufende Schritt verworfen und nach dem Fortsetzen neu gestartet.
- „Rückgängig“ ist im KI-Modus **komplett gesperrt** (Zahnrad-Menü: ausgegraut mit Hinweis „Im KI-Modus nicht verfügbar“). Im Modus „Klassisch“ funktioniert es wie in Spec 001.
- Ein Zug kann im Extremfall (Zahl 9, zehn Versuche) mehrere Minuten dauern. Das ist bewusst so; es gibt kein Gesamtlimit pro Zug.
- „Neue Runde“ bricht laufende KI-Anfragen ab.

### R6 – Start mit und ohne KI
- **Ohne KI:** `docker compose up -d --build` startet wie bisher nur das Spiel. Kein Ollama, keine Moduswahl.
- **Mit KI:** `docker compose --profile ki up -d --build` startet zusätzlich
  - den Dienst `ollama`: eine schlanke TCP-Weiterleitung (z. B. `alpine/socat`) auf Port 11434 des Hosts (`host.docker.internal:11434`, mit `extra_hosts: ["host.docker.internal:host-gateway"]`). Ollama selbst läuft **nativ auf dem Host** (Ollama für Windows bzw. macOS), weil Docker Desktop AMD-Grafikkarten nicht an Container durchreicht,
  - einen einmaligen Dienst, der über die Ollama-API (`POST /api/pull`) `qwen2.5:7b` herunterlädt, falls es noch fehlt (ca. 4,7 GB beim ersten Start).
- Voraussetzung auf dem Host: Ollama ist einmalig installiert und läuft (unter Windows startet es automatisch mit dem System).
- Das Spiel erkennt den KI-Modus daran, dass der Dienst `ollama` erreichbar ist (`OLLAMA_URL`, Standard `http://ollama:11434`). Der Befehl ist auf macOS und Windows identisch.
- Umgebungsvariablen in `.env.example`: `OLLAMA_URL`, `OLLAMA_MODEL` (Standard `qwen2.5:7b`).
- README: Abschnitt „KI-Modus“ mit Ollama-Installation (Windows, macOS), dem Startbefehl, Dauer des ersten Downloads, RAM-Bedarf (ca. 8 GB frei) und Fehlersuche: Ollama läuft nicht; Firewall blockiert Port 11434 zwischen WSL2 und Host; Ollama lauscht standardmäßig nur auf `127.0.0.1`. Erreicht der Container es darüber nicht, auf dem Host die Umgebungsvariable `OLLAMA_HOST=0.0.0.0` setzen und Ollama neu starten, mit dem Hinweis, dass Ollama damit im ganzen LAN erreichbar ist.

### R7 – Datenmodell
- `Room` erhält `mode: "classic" | "ai"`, `clues: Clue[]` (Runde) und den Laufzustand der KI (`aiThinking: boolean`, aktueller Gedanke).
- `Clue`: `team`, `word`, `number`, `guesses: { word, type }[]`, `stopped: "choice" | "limit" | "wrong" | "error"`.
- `PublicState` erhält `mode`, `aiAvailable` (+ Grund), `currentClue`, `aiThought`, `aiThinking`. Der Gedanke ist öffentlich.
- Neue Actions: `setMode`, `giveClue`.

## Akzeptanzkriterien
- [ ] **AK1:** *Gegeben* das Spiel wurde mit `docker compose up` ohne Profil gestartet, *wenn* die Lobby geöffnet wird, *dann* gibt es keine Moduswahl, und alles ist wie in Spec 001.
- [ ] **AK1b:** *Gegeben* Start mit `--profile ki`, das Modell ist aber noch nicht geladen, *wenn* die Lobby geöffnet wird, *dann* ist „KI-Rater“ sichtbar, aber deaktiviert, mit Hinweis auf die Ursache.
- [ ] **AK2:** *Gegeben* Start mit `--profile ki` und das Modell ist geladen, *wenn* der Screen oder ein Vorgeber in der Lobby „KI-Rater“ wählt, *dann* zeigen Screen und beide Player den Modus an.
- [ ] **AK2b:** *Gegeben* Start mit `--profile ki`, die Lobby ist offen und das Modell wird noch geladen, *wenn* der Download fertig ist, *dann* wird „KI-Rater“ innerhalb von 10 s ohne Neuladen wählbar.
- [ ] **AK3:** *Gegeben* Modus „Klassisch“, *wenn* eine Runde gespielt wird, *dann* verhält sich das Spiel wie in Spec 001 (bestehende Tests bleiben grün).
- [ ] **AK4:** *Gegeben* KI-Modus und Team A am Zug, *wenn* Vorgeber A ein Wort eingibt, das einem verdeckten Feldwort gleicht oder nach der Wortteil-Regel aus R2 verboten ist, *dann* wird der Hinweis abgelehnt und am Player eine Fehlermeldung gezeigt.
- [ ] **AK5:** *Gegeben* ein gültiger Hinweis mit Zahl 2, *wenn* die KI drei eigene Karten in Folge wählt, *dann* endet der Zug nach dem dritten Versuch automatisch (Zahl + 1).
- [ ] **AK6:** *Gegeben* die KI liefert `guess: null`, *wenn* das vor dem zweiten Versuch passiert, *dann* endet der Zug, und der Gedanke steht auf dem Screen.
- [ ] **AK7:** *Gegeben* ein KI-Zug läuft, *wenn* ein Gedanke eintrifft, *dann* erscheint er auf dem Screen mindestens 2 s, bevor die zugehörige Karte aufgedeckt wird.
- [ ] **AK8:** *Gegeben* ein KI-Zug, *wenn* der Prompt gebaut wird, *dann* enthält er keine Typen verdeckter Karten (Unit-Test auf die Prompt-Funktion).
- [ ] **AK9:** *Gegeben* Team A hat zuvor „Tier 2“ gegeben und nur ein Wort gefunden, *wenn* Team A einen neuen Hinweis gibt, *dann* enthält der Prompt den früheren Hinweis samt Ergebnis (Unit-Test).
- [ ] **AK10:** *Gegeben* das Modell antwortet zweimal mit einem Wort, das nicht auf dem Feld liegt, *dann* endet der Zug mit der Meldung „Die KI ist ratlos …“ (Test mit Fake-Ollama).
- [ ] **AK11:** *Gegeben* Ollama antwortet nicht innerhalb von 45 s, *dann* endet der Zug mit Hinweis, und das Spiel bleibt bedienbar (Test mit Fake-Ollama und verkürztem Timeout).
- [ ] **AK12:** *Gegeben* die KI rät, *wenn* ein Vorgeber „Aufdecken“ oder „Zug beenden“ auslöst, *dann* lehnt der Server ab.
- [ ] **AK12b:** *Gegeben* KI-Modus, *wenn* „Rückgängig“ ausgelöst wird, *dann* lehnt der Server ab, auch wenn die KI gerade nicht rät.
- [ ] **AK4b:** *Gegeben* „Paradies“ und „Haustür“ liegen verdeckt auf dem Feld, *wenn* die Hinweise „Rad“, „Tür“ und „Haus“ geprüft werden, *dann* sind „Rad“ und „Tür“ gültig und „Haus“ wird abgelehnt (Unit-Test).
- [ ] **AK10b:** *Gegeben* auf dem Feld liegt „MÜHLE“, *wenn* das Modell „muehle“ antwortet, *dann* wird „MÜHLE“ aufgedeckt (Unit-Test).
- [ ] **AK13:** *Gegeben* `docker compose --profile ki up -d --build` auf Max' Windows-PC, *wenn* eine komplette Runde im KI-Modus gespielt wird, *dann* rät die KI nachvollziehbar, äußert in mindestens einem Zug Unsicherheit, keine Antwort reißt das 45-s-Limit, und es ist festgehalten, ob der Container Ollama über `host.docker.internal` ohne `OLLAMA_HOST=0.0.0.0` erreicht (manuelle Abnahme, Ergebnis in `docs/abnahme.md`).

## Technische Hinweise
- Ollama-Aufruf über `POST /api/chat` mit `format: "json"` (oder JSON-Schema), `stream: false`. `GET /api/tags` für die Verfügbarkeitsprüfung. Kein zusätzliches npm-Paket nötig, `fetch` aus Node reicht.
- Die KI-Logik gehört in ein eigenes Modul (z. B. `src/server/ai.ts`) mit injizierbarem Client, damit Tests ohne echtes Modell laufen (Fake-Ollama in Vitest).
- Prompt-Bau als reine Funktion `buildPrompt(publicState, clues, team)` für AK8/AK9.
- Profile in Docker Compose (`profiles: ["ki"]`) blenden Dienste ohne `--profile ki` komplett aus. Der Spiel-Dienst selbst hat kein Profil und startet immer.
- Unterscheidung „nicht gestartet“ und „gestartet, aber nicht bereit“: Hostname `ollama` nicht auflösbar → KI-Modus aus (Option ausgeblendet). Auflösbar, aber Verbindung abgelehnt (Ollama auf dem Host läuft nicht), `/api/tags` ohne Modell oder anderer Fehler → Option deaktiviert mit passendem Hinweis.
- Ollama nativ nutzt unter Windows aktuelle AMD-Radeon-Karten und auf dem Mac Metal. Empfohlener Host für den KI-Modus ist der Windows-PC.
- Erwarteter Umfang über 400 Zeilen. Vorschlag für den Developer: zwei PRs, (a) Modus, Hinweis-Eingabe, Datenmodell, Validierung, (b) Ollama-Anbindung, KI-Zug, Screen-Anzeige.

## Offene Fragen

## Änderungen
- 2026-10-22 (nach Review von PR #6): Undo im KI-Modus gesperrt; Teilwort-Regel gelockert (ab 4 Zeichen, nur Anfang/Ende); KI-Antwort wird normalisiert verglichen; Screen darf den Modus wählen; Verfügbarkeit wird in der Lobby alle 5 s neu geprüft; `OLLAMA_HOST` in Fehlersuche und Abnahme; kein Gesamtlimit pro Zug (bewusst).
