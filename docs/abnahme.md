# Abnahme

Zuordnung der Akzeptanzkriterien aus [`specs/001-codenames.md`](specs/001-codenames.md) (Abschnitt 10) zu den automatischen Tests und den Prüfungen, die nur auf echter Hardware gehen.

- **Unit/Integration:** `npm test` (vitest, `test/*.test.ts`)
- **E2E:** `npm run test:e2e` (Playwright, `test/e2e/acceptance.spec.ts`, ein Screen und zwei simulierte iPhones)
- **CI:** Bei jedem PR laufen Typecheck, beide Testarten und ein Docker-Build für `linux/amd64` und `linux/arm64`.

| # | Kriterium | Automatisch geprüft | Manuell |
|---|---|---|---|
| 1 | `docker compose up -d --build` auf macOS (Apple Silicon) und Windows | CI baut das Image für amd64 und arm64 | Auf Max' Mac und Windows-PC starten, Screen über LAN-IP öffnen |
| 2 | LF-Zeilenenden unter Windows, Container baut | `.gitattributes` mit `* text=auto eol=lf` | Frischer Clone unter Windows, dann `docker compose up -d --build` |
| 3 | Raumcode und QR-Code mit LAN-Adresse | E2E (Raumcode, QR-Endpunkt liefert SVG); `sockets.test.ts` prüft, dass die Join-URL die LAN-Adresse enthält und bei localhost gewarnt wird | QR-Code mit echtem Handy scannen |
| 4 | Zwei Handys treten bei, drittes wird abgelehnt | E2E, `sockets.test.ts` | |
| 5 | Teamname/-farbe live, keine gleichen Farben | E2E, `game.test.ts`, `sockets.test.ts` | |
| 6 | „Spiel starten“ erst mit beiden Vorgebern | E2E, `sockets.test.ts` | |
| 7 | Gleiche Karte auf beiden Playern, Screen ohne geheime Typen | E2E (alle Events und Acks an den Screen geprüft), `sockets.test.ts` | Optional in den DevTools → Netzwerk → WS nachsehen |
| 8 | Nur das aktive Team kann handeln | E2E, `game.test.ts`, `sockets.test.ts` | |
| 9 | Aufdecken erreicht alle Geräte in < 1 s | E2E, `sockets.test.ts` | Im echten WLAN gegenprüfen |
| 10 | Zugende, Sieg durch alle Karten, Niederlage durch Attentäter | E2E, `game.test.ts` | |
| 11 | Neuladen von Handy/Screen stellt den Stand wieder her | E2E, `sockets.test.ts` | |
| 12 | Zahnrad auf allen Geräten mit Neue Runde, Undo, Neue Verbindung | E2E | |
| 13 | Neue Runde: Lobby mit neuem Grid, Player und Teams bleiben | E2E, `game.test.ts`, `sockets.test.ts` | |
| 14 | Undo stellt exakt wieder her, auch nach Spielende | E2E, `game.test.ts` | |
| 15 | Neue Verbindung erlauben: trennt, pausiert, setzt fort | E2E, `game.test.ts`, `sockets.test.ts` | |
| 16 | Spiellogik mit Unit-Tests abgedeckt | `game.test.ts` | |

## Manuelle Checkliste für den ersten echten Spieleabend

1. Auf dem Mac: `git pull`, dann `docker compose up -d --build`.
2. Screen (Fernseher/Laptop) öffnet `http://<Mac-IP>:8080`. Es darf kein Warnhinweis zu localhost erscheinen.
3. Zwei Handys scannen den QR-Code, jedes wählt ein Team.
4. Eine Runde spielen, dabei einmal ein Handy neu laden und einmal ⚙ → Undo testen.
5. Dasselbe einmal auf dem Windows-PC (Firewall-Abfrage bestätigen).
