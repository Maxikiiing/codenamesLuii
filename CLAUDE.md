# Codenames Luii

Browserbasiertes Codenames für gemeinsames Spielen im selben Raum. Ein **Screen** (Fernseher, Laptop, iPad) zeigt das öffentliche Spielfeld, die beiden **Vorgeber** steuern mit ihren Handys und sehen dort die geheime Karte. Alle anderen raten mündlich. Grundspec: [`docs/specs/001-codenames.md`](docs/specs/001-codenames.md).

## Rahmenbedingungen
- Läuft als Docker-Container im lokalen Netz (Port 8080), identisch auf macOS (inkl. Apple Silicon) und Windows (WSL2).
- Gehostet primär auf Max' Mac, entwickelt auf dem Windows-PC.
- Keine Accounts, keine Datenbank: Räume leben im Arbeitsspeicher des Servers.
- Oberfläche und Wortlisten auf Deutsch.

## Arbeitsweise: drei Rollen

| Rolle | Aufruf | Ordner | darf |
|---|---|---|---|
| Consultant | `/consultant-<name>` (z. B. `/consultant-tyrion`) | `consultant/` | Specs, ADRs, `docs/`, Rahmenbedingungen |
| Developer | `/developer-<name> <Spec-Nr>` (z. B. `/developer-q 002`) oder `/developer <Spec-Nr>` | `developer/` | Code, Tests, `feat/`- und `fix/`-Branches, PRs |
| Reviewer | `/reviewer <PR-Nr>` oder `/reviewer-<name> <PR-Nr>` | `reviewer/` | Review-Kommentare, kein Code |

Den Merge nach `main` macht ausschließlich Max.

Persönlichkeits-Skills (`consultant-*`, `developer-*`, `reviewer-*`) ändern nur den Ton im Gespräch, nie die Regeln. Ablauf: [`docs/WORKFLOW.md`](docs/WORKFLOW.md), Regeln pro Rolle: [`docs/rollen/`](docs/rollen/).

## Regeln für alle Rollen
- Nie direkt auf `main` pushen, nie mergen, nie force-pushen.
- Keine Secrets oder persönlichen Daten ins Repo (`.env` ist nicht versioniert).
- Specs sind die Quelle der Wahrheit.
- Kleine PRs (unter ca. 400 Zeilen).
- **Nach jeder abgeschlossenen Aufgabe eine Abschluss-Zusammenfassung für Max (Format in `docs/rollen/`).**
- Code, Commits, Specs und PR-Texte bleiben sachlich, auch bei Rollen mit Persönlichkeit.
- Sprache: Deutsch für Doku, Specs und PR-Texte. Code-Bezeichner Englisch.
- Conventional Commits (Präfix englisch, Beschreibung deutsch).
- Branches `spec/NNN-name`, `feat/NNN-name`, `fix/NNN-name`.

## Stack und Befehle
Node.js 20+, TypeScript (Vanilla, kein Framework), Express + Socket.IO, esbuild für den Client, Vitest für Unit-Tests, Playwright für Abnahmetests, Docker.

| Zweck | Befehl |
|---|---|
| Starten (Docker) | `docker compose up -d --build` |
| Entwicklung | `npm run dev` |
| Typecheck (Lint) | `npm run typecheck` |
| Unit-Tests | `npm test` |
| Abnahmetests | `npm run test:e2e` |
| Build | `npm run build` |

Hinweis: Abhängigkeiten mit `npx npm@11 install` ändern (npm 10 scheitert an den vitest-4-Peers), `npm ci` funktioniert normal.

## Struktur
```
src/
  server/   Express, Socket.IO, Spiellogik (game.ts), Räume, Wortlisten
  client/   Screen-, Player-, Lobby-UI (Vanilla TS)
  shared/   gemeinsame Typen
public/     HTML, CSS, Favicon
words/      Wortlisten (de-standard.txt, de-popkultur.txt)
test/       Vitest-Tests, test/e2e/ Playwright
docs/       specs/, decisions/, rollen/, WORKFLOW.md, ideen.md, abnahme.md
```
