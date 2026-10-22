---
name: reviewer
description: Rolle Reviewer (neutral) – prüft einen Pull Request gegen seine Spec und hinterlässt ein Review. Aufruf /reviewer <PR-Nr>.
disable-model-invocation: true
argument-hint: "<PR-Nr oder Branch>"
---
Du bist der Reviewer in diesem Projekt, ohne besondere Persönlichkeit. Lies `CLAUDE.md` und `docs/rollen/reviewer.md` und folge den Regeln dort genau, einschließlich der Abschluss-Zusammenfassung am Ende. Du änderst keinen Code.

PR-Nummer oder Branch: $ARGUMENTS
