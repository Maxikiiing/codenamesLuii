// Anbindung an Ollama (Spec 002). Hier vorerst nur die Verfügbarkeitsprüfung:
// Ist der Dienst `ollama` nicht auflösbar, wurde der Container ohne Profil `ki`
// gestartet und der KI-Modus wird gar nicht angeboten.

import { lookup as dnsLookup } from "node:dns/promises";
import type { AiStatus } from "../shared/types.js";

export const DEFAULT_OLLAMA_URL = "http://ollama:11434";
export const DEFAULT_OLLAMA_MODEL = "gemma4:26b-a4b";
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

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/** Schnittstelle zum Sprachmodell, in Tests durch ein Fake ersetzt. */
export interface ChatClient {
  /** Liefert den Text der Antwort. Bricht ab, wenn `signal` auslöst. */
  chat(messages: ChatMessage[], signal: AbortSignal): Promise<string>;
  /** Lädt das Modell vorab in den Speicher, damit der erste KI-Schritt nicht darauf wartet. */
  warmUp?(): Promise<void>;
}

/** So lange bleibt das Modell nach der letzten Anfrage geladen (Ollama-Standard: 5 min). */
export const KEEP_ALIVE = "60m";
/** Kontextfenster: reicht für Prompt plus Antwort, kleiner ist schneller und spart Grafikspeicher. */
const NUM_CTX = 4096;
/** Obergrenze der Antwortlänge, ein Gedanke hat 1 bis 3 Sätze. */
const NUM_PREDICT = 300;
/** Laden von der Platte kann bei großen Modellen dauern, danach gibt das Vorladen auf. */
const WARM_UP_TIMEOUT_MS = 120_000;

/** Client für `POST /api/chat` mit JSON-Format und ohne Streaming. */
export function ollamaChatClient(url: string, model: string, doFetch: typeof fetch = fetch): ChatClient {
  let warming: Promise<void> | undefined;
  return {
    async chat(messages, signal) {
      const res = await doFetch(new URL("/api/chat", url), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model,
          messages,
          format: "json",
          stream: false,
          think: false,
          keep_alive: KEEP_ALIVE,
          options: { temperature: 0.7, num_ctx: NUM_CTX, num_predict: NUM_PREDICT },
        }),
        signal,
      });
      if (!res.ok) throw new Error(`Ollama antwortet mit HTTP ${res.status}`);
      const body = (await res.json()) as { message?: { content?: unknown } };
      if (typeof body.message?.content !== "string") throw new Error("Ollama-Antwort ohne Inhalt");
      return body.message.content;
    },
    warmUp() {
      // Eine Anfrage ohne Nachrichten lädt nur das Modell. Läuft schon eine, wird sie geteilt.
      warming ??= (async () => {
        const res = await doFetch(new URL("/api/chat", url), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ model, messages: [], keep_alive: KEEP_ALIVE, options: { num_ctx: NUM_CTX } }),
          signal: AbortSignal.timeout(WARM_UP_TIMEOUT_MS),
        });
        if (!res.ok) throw new Error(`Ollama antwortet mit HTTP ${res.status}`);
      })().finally(() => (warming = undefined));
      return warming;
    },
  };
}
