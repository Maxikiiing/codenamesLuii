// Anbindung an Ollama (Spec 002). Hier vorerst nur die Verfügbarkeitsprüfung:
// Ist der Dienst `ollama` nicht auflösbar, wurde der Container ohne Profil `ki`
// gestartet und der KI-Modus wird gar nicht angeboten.

import { lookup as dnsLookup } from "node:dns/promises";
import type { AiStatus } from "../shared/types.js";

export const DEFAULT_OLLAMA_URL = "http://ollama:11434";
export const DEFAULT_OLLAMA_MODEL = "qwen2.5:7b";
const PROBE_TIMEOUT_MS = 3000;

export const REASON_UNREACHABLE = "Ollama nicht erreichbar";
export const REASON_LOADING = "Modell wird geladen …";

export interface ProbeDeps {
  lookup?: (hostname: string) => Promise<unknown>;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

/** Vergleicht Modellnamen, `qwen2.5` und `qwen2.5:latest` gelten als gleich. */
function sameModel(a: string, b: string): boolean {
  const withTag = (name: string) => (name.includes(":") ? name : `${name}:latest`);
  return withTag(a) === withTag(b);
}

/** Prüft, ob Ollama erreichbar ist und das Modell bereitliegt. Wirft nie. */
export async function probeOllama(url: string, model: string, deps: ProbeDeps = {}): Promise<AiStatus> {
  const lookup = deps.lookup ?? dnsLookup;
  const doFetch = deps.fetch ?? fetch;
  let base: URL;
  try {
    base = new URL(url);
  } catch {
    return { enabled: false, ready: false };
  }

  const host = base.hostname.replace(/^\[|\]$/g, "");
  try {
    await lookup(host);
  } catch {
    return { enabled: false, ready: false };
  }

  try {
    const res = await doFetch(new URL("/api/tags", base), {
      signal: AbortSignal.timeout(deps.timeoutMs ?? PROBE_TIMEOUT_MS),
    });
    if (!res.ok) return { enabled: true, ready: false, reason: REASON_UNREACHABLE };
    const body = (await res.json()) as { models?: { name?: unknown; model?: unknown }[] };
    const names = (body.models ?? []).flatMap((m) => [m.name, m.model]).filter((n): n is string => typeof n === "string");
    return names.some((name) => sameModel(name, model))
      ? { enabled: true, ready: true }
      : { enabled: true, ready: false, reason: REASON_LOADING };
  } catch {
    return { enabled: true, ready: false, reason: REASON_UNREACHABLE };
  }
}
