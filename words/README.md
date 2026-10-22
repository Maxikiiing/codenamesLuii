# Wortlisten

Jede `.txt`-Datei in diesem Ordner ist eine Wortliste: ein Wort pro Zeile, UTF-8. Der Dateiname ohne `.txt` ist der Name, der in der Lobby angezeigt wird. Der Ordner wird in den Container gemountet, neue Listen sind also ohne Neubau verfügbar.

Beim Laden bereinigt der Server jede Liste: Leerzeilen und Zeilen mit `#` am Anfang werden ignoriert, alles wird in Großbuchstaben umgewandelt, Wörter über 12 Zeichen und Duplikate fliegen raus. Eine Liste braucht mindestens 25 Wörter. Mit `npm run words:clean` lassen sich die Dateien selbst auch bereinigen und sortieren.

| Datei | Inhalt | Quelle |
|---|---|---|
| `de-standard.txt` | Konkrete, mehrdeutige Substantive (Standardliste) | Selbst erstellt für dieses Projekt |
| `de-popkultur.txt` | Figuren, Personen, Marken, Spiele | [`dokick/wordlist`](https://github.com/dokick/wordlist) (Commit `ba52f54`), MIT-Lizenz, siehe `LICENSE-dokick.txt` |

`dokick/wordlist` enthält nur Eigennamen aus Popkultur und keine allgemeinen Substantive. Deshalb ist die Standardliste die selbst erstellte Fallback-Liste aus der Spec, und die dokick-Wörter stehen als eigene Themenliste zur Auswahl.
