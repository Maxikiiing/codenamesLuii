# Codenames Luii

Browserbasiertes Codenames für einen gemeinsamen Raum: Ein Screen zeigt das Spielfeld, die beiden Vorgeber steuern das Spiel mit ihren Handys. Die vollständige Beschreibung steht in [`docs/specs/codenames-spec.md`](docs/specs/codenames-spec.md).

## Starten (macOS und Windows)

Voraussetzung ist [Docker Desktop](https://www.docker.com/products/docker-desktop/), unter Windows mit WSL2-Backend.

```sh
docker compose up -d --build
```

Danach ist das Spiel unter `http://<LAN-IP>:8080` erreichbar. Stoppen mit `docker compose down`.

## Entwicklung

Voraussetzung ist Node.js 20 oder neuer.

```sh
npm install
npm run dev        # Server mit Auto-Reload auf Port 8080
npm test           # Unit-Tests
npm run typecheck  # TypeScript prüfen
```

## Wortlisten

Wortlisten liegen in [`words/`](words/README.md) und werden in den Container gemountet. Eine neue `.txt`-Datei dort ist ohne Neubau sofort auswählbar.
