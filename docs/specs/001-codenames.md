# Spec: Codenames Luii

**Status:** Umgesetzt (v1.0, PRs #1 bis #4)
**Projektname:** Codenames Luii (Repo: `codenames-luii`)

---

## 1. Ziel

Ein browserbasiertes Codenames-Spiel für gemeinsames Spielen im selben Raum.
Ein **Screen** (Fernseher, Laptop, iPad) zeigt das öffentliche Spielfeld.
Die beiden **Vorgeber** verbinden sich mit ihren Handys als **Player**-Gerät, sehen dort die geheime Farbzuordnung und tippen die von ihrem Team geratenen Wörter ein.
Alle anderen Mitspieler brauchen kein Gerät, sie raten mündlich. Hinweise werden ebenfalls **mündlich** gegeben.

Das Spiel läuft als Docker-Container im lokalen Netz und muss auf **macOS (inkl. Apple Silicon) und Windows** identisch laufen. Gehostet wird primär auf Max' Mac, entwickelt aktuell auf dem Windows-PC.

## 2. Begriffe

| Begriff | Bedeutung |
|---|---|
| **Screen** | Zentrales Anzeigegerät, öffentliche Ansicht |
| **Player** | Steuergerät eines Vorgebers (Handy), zeigt die geheime Karte |
| **Vorgeber** | Gibt mündlich Hinweise, pro Team genau einer |
| **Rater** | Restliche Teammitglieder, ohne Gerät |
| **Raum** | Eine laufende Spielinstanz mit eigenem Raumcode |
| **Karte / Key** | Geheime Zuordnung der 25 Felder zu Team A, Team B, Neutral und Attentäter |

## 3. Spielregeln

- 5×5-Grid mit 25 Wörtern.
- Verteilung: Startteam 9 Karten, anderes Team 8, 7 neutrale Karten, 1 Attentäter.
- Das Startteam wird zufällig bestimmt und auf dem Screen angezeigt.
- Ablauf eines Zuges:
  1. Der Vorgeber nennt mündlich einen Hinweis und eine Zahl. **Keine Eingabe im System.**
  2. Die Rater nennen ein Wort, der Vorgeber tippt es am Player an und bestätigt.
  3. Die Karte wird auf dem Screen aufgedeckt.
     - **Eigene Farbe:** Das Team darf weiter raten.
     - **Gegnerfarbe oder neutral:** Der Zug endet automatisch.
     - **Attentäter:** Das Team verliert sofort.
  4. Der Vorgeber kann den Zug jederzeit per Button „Zug beenden“ abgeben.
- Die Anzahl der Rateversuche wird **nicht** vom System begrenzt (das System kennt die genannte Zahl nicht).
- Ein Team gewinnt, wenn alle seine Karten aufgedeckt sind, auch dann, wenn das gegnerische Team sie aufgedeckt hat.
- **Kein Timer, keine Sounds.**

## 4. Ablauf und Ansichten

### 4.1 Lobby
- Der Screen öffnet `http://<host>:8080/` und klickt auf „Neues Spiel“.
- Die Lobby auf dem Screen zeigt:
  - Raumcode (4 Buchstaben) und **QR-Code** zum Beitreten.
  - Status der beiden Vorgeber-Slots (verbunden oder offen).
  - **Team-Anpassung** je Team:
    - Name (Standard: „Team Rot“ bzw. „Team Blau“), maximal 20 Zeichen.
    - Farbe aus einer festen Palette (Standard: Rot bzw. Blau). Palette: Rot, Blau, Grün, Lila, Orange, Pink, Türkis, Gelb. Beide Teams dürfen nicht dieselbe Farbe wählen.
    - Die Farben für Neutral (Beige) und Attentäter (Schwarz) sind fest und nicht wählbar.
  - Auswahl der Wortliste (siehe 5).
  - Button **„Spiel starten“**, nur aktiv, wenn beide Vorgeber verbunden sind.
- Team-Anpassungen können auch auf den Playern vorgenommen werden (jeweils fürs eigene Team) und werden live synchronisiert.
- Teamname und -farbe bleiben bei „Neue Runde“ erhalten.

### 4.2 Screen (im Spiel)
- Zeigt das Grid, das aktive Team (Name in Teamfarbe), verbleibende Karten pro Team und am Ende den Gewinner mit Grund.
- Zeigt **niemals** die geheime Karte, weder im HTML noch in WebSocket-Payloads (siehe 7).
- Ausgelegt für Querformat und Lesbarkeit aus 3 bis 4 m Entfernung.

### 4.3 Player (Vorgeber)
- Beitritt über QR-Code oder `/join` mit Raumcode, danach Auswahl des Teams.
- Pro Team nur ein Player-Slot. Ein belegter Slot lehnt neue Geräte ab, außer bei Wiederverbindung mit gültigem Token (6.3) oder nach „Neue Verbindung erlauben“ (4.4).
- Zeigt das Grid mit Farbmarkierung aller Felder, aufgedeckte Felder abgedunkelt, sowie ob das eigene Team am Zug ist.
- Aktionen, nur wenn das eigene Team am Zug ist:
  - Wort antippen → Bestätigungsdialog („‚MOND‘ aufdecken?“) → aufdecken.
  - „Zug beenden“.
- Beide Vorgeber sehen die komplette Karte (entspricht dem Original).
- Hochformat-optimiert, Touch-Ziele mindestens 44 px.

### 4.4 Spielleitung (Zahnrad-Menü)
- Ein **Zahnrad-Icon (⚙)** ist auf **allen Geräten** verfügbar: Screen und beide Player, in Lobby und Spiel.
- Jede Aktion verlangt einen Bestätigungsdialog.
- **Neue Runde:** Neues Grid, zurück in die Lobby. Player bleiben verbunden, Team-Anpassungen bleiben erhalten.
- **Undo:** Macht die letzte Aufdeckung rückgängig, inklusive des dadurch ausgelösten Zugwechsels oder Spielendes. Mehrfaches Undo ist möglich, bis die Historie der Runde leer ist.
- **Neue Verbindung erlauben:**
  1. Auswahl des Teams.
  2. Das aktuell verbundene Gerät dieses Teams wird getrennt, sein Token wird ungültig. Das alte Gerät zeigt „Verbindung wurde durch die Spielleitung getrennt“ und kehrt nicht automatisch zurück.
  3. Der Slot wird frei. Der Screen zeigt ein Overlay mit Raumcode, QR-Code und „Warte auf Vorgeber <Teamname>“.
  4. Das Spiel ist **pausiert**: keine Aufdeckungen, kein Zugende, bis ein neues Gerät beigetreten ist. Danach geht es mit unverändertem Stand weiter.
  - Zweck: Verbindungsleichen beheben oder den Vorgeber wechseln.

## 5. Wortlisten

- Wortlisten liegen als Textdateien (ein Wort pro Zeile, UTF-8) im Ordner `words/`, z. B. `words/de-standard.txt`.
- Die Startliste wird **nicht** aus dem Original-Spiel übernommen. Es gibt Repos, die die Original-Kartenwörter sammeln. Diese werden bewusst nicht genutzt.
- **Quelle für die Startliste:** Das Repo `dokick/wordlist` (MIT-Lizenz), das deutsche Wortlisten speziell für Spiele wie Codenames erzeugt. Lizenzhinweis kommt in `words/LICENSE-dokick.txt`.
- Beim Import wird die Liste bereinigt: Duplikate entfernen, Wörter über 12 Zeichen entfernen, Großschreibung vereinheitlichen. Ziel: mindestens 400 Wörter.
- Fallback, falls die Liste unbrauchbar ist: Eine selbst erstellte Liste mit konkreten, mehrdeutigen Substantiven (die Art Wörter, die bei Codenames gut funktionieren).
- Weitere Listen (z. B. `de-wg.txt`) können ohne Neubau hinzugefügt werden. Der Ordner wird als Volume gemountet.
- Eine Runde zieht 25 zufällige, unterschiedliche Wörter aus der gewählten Liste.

## 6. Technik

### 6.1 Stack
- **Backend:** Node.js 20 LTS mit TypeScript, Express und `socket.io`.
- **Frontend:** Vom Backend ausgeliefert, kein separater Frontend-Container. Vanilla TS oder Svelte, Build im Docker-Image.
- **State:** In-Memory, keine Datenbank.
- **QR-Code:** Bibliothek `qrcode`.

### 6.2 Kommunikation
- WebSocket je Gerät, Räume als socket.io-Rooms.
- Der Server ist die einzige Quelle der Wahrheit. Clients senden nur Aktionen (`updateTeam`, `startGame`, `reveal`, `endTurn`, `newRound`, `undo`, `releaseSlot`) und erhalten den resultierenden State.
- Der Server validiert jede Aktion: richtiges Team am Zug, Karte verdeckt, Spiel nicht pausiert und nicht beendet.

### 6.3 Wiederverbindung
- Beim Beitritt bekommt der Player ein Token, gespeichert in `localStorage`.
- Bei Verbindungsabbruch stellt das Token beim Neuladen denselben Slot wieder her, solange er nicht per „Neue Verbindung erlauben“ freigegeben wurde.
- Der Screen lädt einen laufenden Raum über die URL `/screen/<CODE>` neu.

### 6.4 Raum-Lebensdauer
- Räume ohne verbundenes Gerät werden nach 2 Stunden gelöscht.
- Mehrere Räume gleichzeitig sind erlaubt.

## 7. Sicherheit und Datentrennung

- Screen und nicht authentifizierte Clients erhalten **nur öffentlichen State**: Wörter, aufgedeckte Felder mit Typ, Zugstatus, Teamnamen und -farben.
- Nur Sockets mit gültigem Player-Token erhalten die vollständige Karte.
- Kein Login. Nur für das lokale Netz gedacht, nicht für den Betrieb im Internet.

## 8. Repository und Plattformen

### 8.1 Git
- Neues Git-Repo `codenames-luii` mit GitHub-Remote. Einrichtung über den bestehenden Agenten-Workflow (Spec in `docs/specs/`, Feature-Branches, PRs).
- `.gitattributes` mit `* text=auto eol=lf`, damit Windows keine CRLF-Zeilenenden in Shell-Skripte und Dockerfiles schreibt (die sonst im Linux-Container brechen).
- `.gitignore` für `node_modules/`, `dist/`, `.env`.
- `README.md` mit Startanleitung für macOS und Windows.

### 8.2 Docker
- `Dockerfile` als Multi-Stage-Build auf `node:20-alpine`. Das Image ist offiziell für `amd64` (Windows-PC) und `arm64` (Apple Silicon) verfügbar. Keine nativen Abhängigkeiten, die nur auf einer Architektur bauen.
- `docker-compose.yml`:
  ```yaml
  services:
    codenames-luii:
      build: .
      ports:
        - "8080:8080"
      volumes:
        - ./words:/app/words:ro
      environment:
        - PORT=8080
        - PUBLIC_URL=${PUBLIC_URL:-}
      restart: unless-stopped
  ```
- Voraussetzung auf beiden Systemen: Docker Desktop (unter Windows mit WSL2-Backend).
- Start auf beiden Systemen identisch: `docker compose up -d --build`.
- Keine OS-spezifischen Pfade oder Skripte. Falls Hilfsskripte nötig sind, laufen sie im Container oder als npm-Scripts.

### 8.3 Erreichbarkeit im LAN
- Der QR-Code muss die **LAN-IP des Hosts** enthalten, nicht `localhost`. Docker kennt die Host-IP nicht zuverlässig, daher:
  1. Ist `PUBLIC_URL` gesetzt (in `.env`, z. B. `PUBLIC_URL=http://192.168.1.20:8080`), wird diese verwendet.
  2. Sonst wird die URL aus dem Host-Header abgeleitet, mit dem der Screen die Seite aufgerufen hat. Daher den Screen über die LAN-IP öffnen, nicht über `localhost`.
  3. Ruft der Screen über `localhost` auf und ist `PUBLIC_URL` nicht gesetzt, zeigt die Lobby einen Warnhinweis.
- README erklärt, wie man die LAN-IP findet (macOS: Systemeinstellungen → Netzwerk; Windows: `ipconfig`) und dass die Firewall Port 8080 freigeben muss (Windows fragt beim ersten Start, macOS ggf. ebenfalls).

## 9. Datenmodell (Server)

```ts
type TeamId = "a" | "b";
type CardType = TeamId | "neutral" | "assassin";

interface TeamConfig {
  name: string;        // Standard "Team Rot" / "Team Blau"
  color: PaletteColor; // Standard "red" / "blue"
}

interface Card {
  word: string;
  type: CardType;      // geheim
  revealed: boolean;
}

interface Room {
  code: string;
  phase: "lobby" | "playing" | "paused" | "finished";
  teams: Record<TeamId, TeamConfig>;
  cards: Card[];                     // 25
  startingTeam: TeamId;
  currentTeam: TeamId;
  winner?: TeamId;
  winReason?: "allFound" | "assassin";
  players: Partial<Record<TeamId, string>>;  // Player-Tokens
  history: RevealAction[];           // für Undo
  wordList: string;
}
```

Die Teams heißen intern `a` und `b`, weil Name und Farbe frei wählbar sind.

## 10. Akzeptanzkriterien

1. `docker compose up -d --build` startet das Spiel auf **macOS (Apple Silicon) und Windows** ohne Änderungen am Code. Der Screen ist unter `http://<LAN-IP>:8080` erreichbar.
2. Ein frischer Clone unter Windows enthält LF-Zeilenenden, und der Container baut fehlerfrei.
3. Der Screen erstellt einen Raum und zeigt Raumcode und einen QR-Code mit LAN-Adresse.
4. Zwei Handys treten per QR-Code bei, eines pro Team. Ein drittes Gerät wird für ein belegtes Team abgelehnt.
5. In der Lobby lassen sich Teamname und -farbe ändern. Gleiche Farben für beide Teams sind nicht möglich. Die Änderungen erscheinen live auf allen Geräten.
6. „Spiel starten“ ist erst aktiv, wenn beide Vorgeber verbunden sind.
7. Beide Player sehen dieselbe korrekte Karte. Der Screen erhält nachweislich keine geheimen Typen (geprüft per WebSocket-Payload in den DevTools).
8. Nur der Player des aktiven Teams kann aufdecken oder den Zug beenden.
9. Aufdecken aktualisiert alle Geräte in unter 1 Sekunde.
10. Zugende, Sieg durch alle Karten und Niederlage durch den Attentäter funktionieren korrekt.
11. Neuladen von Handy oder Screen mitten im Spiel stellt den Zustand ohne Datenverlust wieder her.
12. Das Zahnrad-Menü ist auf Screen und beiden Playern verfügbar und enthält Neue Runde, Undo und Neue Verbindung erlauben, jeweils mit Bestätigung.
13. „Neue Runde“ führt in die Lobby mit neuem Grid, Player und Team-Anpassungen bleiben erhalten.
14. Undo stellt den Zustand vor der letzten Aufdeckung exakt wieder her, auch nach Spielende.
15. „Neue Verbindung erlauben“ trennt das alte Gerät dauerhaft, pausiert das Spiel und setzt es nach Beitritt eines neuen Geräts mit unverändertem Stand fort.
16. Die Spiellogik (Verteilung, Zugwechsel, Sieg, Undo, Pause) ist mit Unit-Tests abgedeckt.

## 11. Offene Punkte

Keine. Alle Punkte sind durch Max entschieden.

## 12. Priorität

- **Must:** Abschnitte 3 bis 8, Akzeptanzkriterien 1–16
- **Should:** mehrere Wortlisten zur Auswahl, Animation beim Aufdecken
- **Won't (v1):** Timer, Sounds, Hinweis-Eingabe, Online-Betrieb, Accounts, Statistiken, weitere Spielmodi (Duett, Bilder)
