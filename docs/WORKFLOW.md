# Workflow

## Ablauf
1. **Consultant und Max** klären ein Feature und schreiben die Spec (`docs/specs/NNN-name.md`).
2. Der Consultant öffnet einen **Spec-PR**, Max merged ihn.
3. **Developer:** `/developer-<name> NNN` (oder `/developer NNN`) setzt die Spec um und öffnet einen PR.
4. **Reviewer:** in einer neuen Sitzung `/reviewer <PR-Nr>`.
5. Bei ❌ startet Max den Developer erneut und danach ein neues Review. Bei ✅ merged Max per Squash, der Consultant zieht `main`.

Jede Rolle meldet sich am Ende mit einer Abschluss-Zusammenfassung, die den nächsten Schritt für Max nennt.

## Spec-Status

| Status | gesetzt von |
|---|---|
| Entwurf | Consultant |
| Freigegeben | Consultant nach OK von Max |
| Umgesetzt | Developer im Feature-PR |

## Tipps
- Für jedes Review eine frische Sitzung.
- Specs klein halten: ein Feature, ein PR.
- Regeln über `docs/rollen/` anpassen.
- Persönlichkeiten über die Konto-Skills wählen (`consultant-*`, `developer-*`, `reviewer-*`).

## Lokaler Modus (ohne GitHub)
- Der Developer nennt den Branch statt einer PR-Nummer.
- Der Reviewer prüft `git diff main...<branch>` und schreibt nach `.reviews/<branch>.md`.
- Max merged mit `git switch main`, `git merge --squash <branch>` und `git commit`.
