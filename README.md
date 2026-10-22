# Codenames Luii

Codenames für einen gemeinsamen Raum. Ein **Screen** (Fernseher, Laptop, iPad) zeigt das Spielfeld, die beiden **Vorgeber** steuern mit ihren Handys. Alle anderen raten mündlich und brauchen kein Gerät. Die vollständige Beschreibung steht in [`docs/specs/codenames-spec.md`](docs/specs/codenames-spec.md).

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

## Wortlisten

Wortlisten liegen in [`words/`](words/README.md) und werden in den Container gemountet. Eine neue `.txt`-Datei dort ist ohne Neubau sofort in der Lobby auswählbar.

## Entwicklung

Voraussetzung ist Node.js 20 oder neuer.

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
