# Codenames Luii

Codenames für einen gemeinsamen Raum. Ein **Screen** (Fernseher, Laptop, iPad) zeigt das Spielfeld, die beiden **Vorgeber** steuern mit ihren Handys. Alle anderen raten mündlich und brauchen kein Gerät. Die vollständige Beschreibung steht in [`docs/specs/001-codenames.md`](docs/specs/001-codenames.md). Zur Arbeitsweise siehe [`CLAUDE.md`](CLAUDE.md), [`docs/WORKFLOW.md`](docs/WORKFLOW.md) und [`docs/specs/`](docs/specs/).

## Entwickeln

Nach dem Klonen einmal `git config core.hooksPath .githooks` ausführen. Das aktiviert den Hook, der direkte Pushes auf `main` blockiert. Details in [`CLAUDE.md`](CLAUDE.md).

## Voraussetzungen

- [Docker Desktop](https://www.docker.com/products/docker-desktop/)
  - **macOS:** Intel und Apple Silicon werden beide unterstützt.
  - **Windows:** mit WSL2-Backend (Standard bei aktuellen Installationen).
- Alle Geräte (Host, Screen, Handys) im selben WLAN bzw. Netzwerk.

## Starten

Im Projektordner, auf macOS (Terminal) und Windows (PowerShell) identisch:

```sh
docker compose up -d --build
```

Stoppen mit `docker compose down`. Nach einem `git pull` startet derselbe Befehl die neue Version.

## Spielen

1. **LAN-IP des Hosts herausfinden** (siehe unten), z. B. `192.168.1.20`.
2. Auf dem Screen `http://192.168.1.20:8080` öffnen, **nicht** `localhost`. Der QR-Code enthält die Adresse, mit der der Screen die Seite geöffnet hat, und `localhost` würde auf den Handys ins Leere zeigen. In dem Fall erscheint in der Lobby ein Warnhinweis.
3. „Neues Spiel“ antippen.
4. Beide Vorgeber scannen den QR-Code und wählen ihr Team. Alternativ öffnen sie `http://192.168.1.20:8080/join` und geben den Raumcode ein.
5. Teamnamen und -farben anpassen, Wortliste wählen, „Spiel starten“.

Über das Zahnrad (⚙) auf jedem Gerät lassen sich eine neue Runde starten, die letzte Aufdeckung rückgängig machen oder ein Vorgeber-Handy austauschen („Neue Verbindung erlauben“).

### LAN-IP herausfinden

- **macOS:** Systemeinstellungen → Netzwerk → WLAN (oder Ethernet) → Details. Die Adresse steht unter „IP-Adresse“. Im Terminal geht auch `ipconfig getifaddr en0`.
- **Windows:** In PowerShell `ipconfig` eingeben und beim aktiven Adapter (WLAN oder Ethernet) die „IPv4-Adresse“ ablesen. Adressen von `vEthernet (WSL)` oder anderen virtuellen Adaptern ignorieren.

### Feste Adresse für den QR-Code (optional)

Wenn der Screen die Seite lieber über `localhost` öffnen soll, die LAN-Adresse fest hinterlegen. Dazu `.env.example` nach `.env` kopieren und eintragen:

```sh
PUBLIC_URL=http://192.168.1.20:8080
```

Danach `docker compose up -d` erneut ausführen.

### Firewall

Die Handys müssen Port **8080** auf dem Host erreichen.

- **Windows:** Beim ersten Start fragt die Windows-Firewall meist nach, ob Docker Desktop im Netzwerk kommunizieren darf. „Private Netzwerke“ erlauben. Falls die Frage nicht kam und die Handys nicht verbinden: Windows-Sicherheit → Firewall- & Netzwerkschutz → „Zugriff von App durch Firewall zulassen“ → Docker Desktop Backend für „Privat“ freigeben. Außerdem muss das WLAN in Windows als **privates** Netzwerk eingestuft sein.
- **macOS:** Ist die Firewall aktiv (Systemeinstellungen → Netzwerk → Firewall), beim ersten Start eingehende Verbindungen für Docker erlauben.

### Fehlersuche

| Problem | Lösung |
|---|---|
| Handy lädt die Seite nicht | Gleiches WLAN? Richtige IP? Firewall (siehe oben)? Gäste-WLANs blockieren oft Verbindungen zwischen Geräten. |
| QR-Code zeigt `localhost` | Screen über die LAN-IP öffnen oder `PUBLIC_URL` setzen. |
| Altes Handy hängt im Spiel | ⚙ → „Neue Verbindung erlauben“ → Team wählen, dann mit dem neuen Gerät beitreten. |
| Raum nicht gefunden | Nach einem Neustart des Containers sind alle Räume weg (kein Speicher auf der Platte). Neues Spiel starten. |
| Logs ansehen | `docker compose logs -f` |

## KI-Modus

Für Runden mit nur zwei Leuten: Jedes Team bekommt einen KI-Rater. Der Vorgeber tippt Hinweis und Zahl ins Handy, die KI denkt laut auf dem Screen nach und deckt Karten auf, ohne die geheime Karte zu kennen. Das Sprachmodell (Standard `gemma4:26b-a4b`) läuft lokal über [Ollama](https://ollama.com), es geht nichts ins Internet außer dem einmaligen Download.

**Einmalig auf dem Host:** Ollama installieren.
- Windows: Installer von ollama.com/download. Ollama startet danach automatisch mit Windows und nutzt aktuelle AMD-Radeon- und NVIDIA-Karten.
- macOS: App von ollama.com/download installieren und einmal starten (nutzt Metal).

**Starten:**
```sh
docker compose --profile ki up -d --build
```
Das startet zusätzlich eine Weiterleitung `ollama` zum Ollama auf dem Host und lädt beim ersten Mal das Modell (ca. 15–17 GB, je nach Leitung 20 bis 90 Minuten, Fortschritt mit `docker compose logs -f ollama-pull`). Bis dahin ist „KI-Rater“ in der Lobby ausgegraut mit „Modell wird geladen …“ und wird von selbst wählbar. Ohne `--profile ki` gibt es keine Moduswahl.

Bedarf: ca. 18 GB freier Arbeitsspeicher. Bei weniger als 16 GB Grafikspeicher teilt Ollama das Modell zwischen GPU und CPU auf, das geht dank der Bauart (nur ca. 4 Mrd. aktive Parameter) noch ordentlich, ist aber langsamer. Ist es zu langsam (Meldung „zu lange überlegt“), in `.env` `OLLAMA_MODEL=qwen2.5:7b` setzen (ca. 4,7 GB, 8 GB RAM) und neu starten. Ein KI-Schritt darf höchstens 45 s dauern, danach gibt die KI den Zug ab. „Rückgängig“ ist im KI-Modus gesperrt.

| Problem | Lösung |
|---|---|
| „Ollama nicht erreichbar“ | Läuft Ollama auf dem Host? Test im Browser des Hosts: `http://localhost:11434` muss „Ollama is running“ zeigen. |
| Läuft, aber der Container erreicht es nicht | Ollama lauscht standardmäßig nur auf `127.0.0.1`. Auf dem Host die Umgebungsvariable `OLLAMA_HOST=0.0.0.0` setzen (Windows: Systemsteuerung → Umgebungsvariablen) und Ollama neu starten. Achtung: Damit ist Ollama im ganzen LAN erreichbar. |
| Windows-Firewall | Port 11434 zwischen WSL2/Docker und Host freigeben (eingehende Regel für `ollama.exe` erlauben). |
| Bleibt bei „Modell wird geladen …“ | `docker compose logs ollama-pull` ansehen, ggf. `docker compose --profile ki up -d ollama-pull` erneut starten. |
| KI gibt oft mit „zu lange überlegt“ ab | Während die KI rät, in PowerShell `ollama ps` aufrufen. Steht unter PROCESSOR nicht `100% GPU`, passt das Modell nicht in den Grafikspeicher und rechnet teilweise auf der CPU. Dann andere Programme mit GPU-Last schließen oder ein kleineres Modell nehmen (`OLLAMA_MODEL=qwen2.5:7b`). Das Spiel lädt das Modell beim Wählen von „KI-Rater“ vor und hält es 60 min im Speicher. |
| Anderes Modell | `OLLAMA_MODEL` in `.env` setzen (siehe `.env.example`). |

## Wortlisten

Wortlisten liegen in [`words/`](words/README.md) und werden in den Container gemountet. Eine neue `.txt`-Datei dort ist ohne Neubau sofort in der Lobby auswählbar.

## Entwicklung

Voraussetzung ist Node.js 20.19 oder neuer (bzw. 22.12 oder neuer bei Node 22).

```sh
npm install
npm run dev        # Server mit Auto-Reload auf Port 8080 (Client vorher einmal gebaut)
npm test           # Unit- und Integrationstests (vitest)
npm run test:e2e   # Browser-Abnahme mit Screen und zwei Handys (Playwright)
npm run typecheck  # TypeScript prüfen
```

Für `npm run test:e2e` einmalig `npx playwright install chromium` ausführen.

Die Zuordnung der Akzeptanzkriterien zu den Tests steht in [`docs/abnahme.md`](docs/abnahme.md).

### Aufbau

| Pfad | Inhalt |
|---|---|
| `src/server/game.ts` | Spielregeln als reine Funktionen |
| `src/server/rooms.ts` | Räume, Verbindungsstatus, öffentlicher und geheimer State |
| `src/server/sockets.ts` | socket.io-Protokoll und Validierung |
| `src/server/words.ts` | Wortlisten laden und bereinigen |
| `src/shared/types.ts` | Typen für Server und Client |
| `src/client/` | Oberflächen (Vanilla TypeScript, gebündelt mit esbuild) |
| `test/` | vitest-Tests, `test/e2e/` Playwright-Abnahme |
