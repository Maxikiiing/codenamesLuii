# Wortlisten

Jede `.txt`-Datei in diesem Ordner ist eine Wortliste: ein Wort pro Zeile, UTF-8. Der Dateiname ohne `.txt` ist der Name, der in der Lobby angezeigt wird (z. B. `de-wg.txt` → „de-wg“). Ausgenommen sind Dateien, deren Name mit `license` beginnt (egal in welcher Schreibweise), und versteckte Dateien mit `.` am Anfang. Der Ordner wird in den Container gemountet, neue oder geänderte Listen sind also ohne Neubau und ohne Neustart verfügbar.

Beim Laden bereinigt der Server jede Liste: Leerzeilen und Zeilen mit `#` am Anfang werden ignoriert, Wörter über 12 Zeichen und Duplikate fliegen raus, und alles wird in Großbuchstaben umgewandelt (ß bleibt als ẞ erhalten). Eine Liste braucht mindestens 25 Wörter, sonst erscheint sie nicht in der Lobby. Mit `npm run words:clean` lassen sich die Dateien selbst bereinigen und sortieren, ein `#`-Kommentarblock am Dateianfang bleibt dabei erhalten, Kommentare zwischen den Wörtern entfallen. Die Dateiendung muss kleingeschrieben `.txt` sein.

| Datei | Inhalt | Quelle |
|---|---|---|
| `de-standard.txt` | Konkrete, mehrdeutige Substantive (Standardliste) | Selbst erstellt für dieses Projekt |
| `de-popkultur.txt` | Figuren, Personen, Marken, Spiele | [`dokick/wordlist`](https://github.com/dokick/wordlist) (Commit `ba52f54`), MIT-Lizenz, siehe `LICENSE-dokick.txt` |

`dokick/wordlist` enthält nur Eigennamen aus Popkultur und keine allgemeinen Substantive. Deshalb ist die Standardliste die selbst erstellte Fallback-Liste aus der Spec, und die dokick-Wörter stehen als eigene Themenliste zur Auswahl.
