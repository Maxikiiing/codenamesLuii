import { describe, expect, it } from "vitest";
import { ollamaChatClient, probeOllama, REASON_LOADING, REASON_UNREACHABLE } from "../src/server/ollama.js";

const resolves = async () => ({ address: "10.0.0.2" });
const notFound = async () => {
  throw Object.assign(new Error("getaddrinfo ENOTFOUND ollama"), { code: "ENOTFOUND" });
};
const tags = (names: string[]) =>
  (async () => Response.json({ models: names.map((name) => ({ name, model: name })) })) as typeof fetch;

describe("Verfügbarkeit von Ollama", () => {
  it("AK1: Dienst nicht auflösbar → KI-Modus wird nicht angeboten", async () => {
    const status = await probeOllama("http://ollama:11434", "qwen2.5:7b", { lookup: notFound, fetch: tags([]) });
    expect(status).toEqual({ enabled: false, ready: false });
  });

  it("AK1b: Weiterleitung da, Ollama antwortet nicht → sichtbar, aber deaktiviert", async () => {
    const refused = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    const status = await probeOllama("http://ollama:11434", "qwen2.5:7b", { lookup: resolves, fetch: refused });
    expect(status).toEqual({ enabled: true, ready: false, reason: REASON_UNREACHABLE });
  });

  it("AK1b: Modell fehlt noch → „Modell wird geladen …“", async () => {
    const status = await probeOllama("http://ollama:11434", "qwen2.5:7b", { lookup: resolves, fetch: tags(["llama3:8b"]) });
    expect(status).toEqual({ enabled: true, ready: false, reason: REASON_LOADING });
  });

  it("Fehlerstatus von Ollama gilt als nicht erreichbar", async () => {
    const status = await probeOllama("http://ollama:11434", "qwen2.5:7b", {
      lookup: resolves,
      fetch: (async () => new Response("", { status: 502 })) as typeof fetch,
    });
    expect(status.reason).toBe(REASON_UNREACHABLE);
  });

  it("Modell vorhanden → bereit, auch mit oder ohne :latest", async () => {
    expect(await probeOllama("http://ollama:11434", "qwen2.5:7b", { lookup: resolves, fetch: tags(["qwen2.5:7b"]) })).toEqual({
      enabled: true,
      ready: true,
    });
    expect((await probeOllama("http://ollama:11434", "mistral", { lookup: resolves, fetch: tags(["mistral:latest"]) })).ready).toBe(true);
  });

  it("fragt /api/tags unter der konfigurierten URL ab", async () => {
    let requested = "";
    const spy = (async (input: URL | RequestInfo) => {
      requested = String(input);
      return Response.json({ models: [] });
    }) as typeof fetch;
    await probeOllama("http://host.example:1234", "m", { lookup: resolves, fetch: spy });
    expect(requested).toBe("http://host.example:1234/api/tags");
  });
});

describe("Chat-Client", () => {
  it("fragt /api/chat mit JSON-Format, ohne Streaming und ohne Denkmodus", async () => {
    let sent: { url: string; body: Record<string, unknown> } | undefined;
    const spy = (async (input: URL | RequestInfo, init?: RequestInit) => {
      sent = { url: String(input), body: JSON.parse(String(init?.body)) };
      return Response.json({ message: { role: "assistant", content: '{"thought":"x","guess":null}' } });
    }) as typeof fetch;
    const client = ollamaChatClient("http://ollama:11434", "gemma4:26b-a4b", spy);
    expect(await client.chat([{ role: "user", content: "Hallo" }], new AbortController().signal)).toBe('{"thought":"x","guess":null}');
    expect(sent?.url).toBe("http://ollama:11434/api/chat");
    expect(sent?.body).toMatchObject({
      model: "gemma4:26b-a4b",
      format: "json",
      stream: false,
      think: false,
      keep_alive: "60m",
      options: { num_ctx: 4096, num_predict: 300 },
    });
  });

  it("lädt das Modell vorab mit einer leeren Anfrage", async () => {
    let body: Record<string, unknown> | undefined;
    const spy = (async (_input: URL | RequestInfo, init?: RequestInit) => {
      body = JSON.parse(String(init?.body));
      return Response.json({ done: true });
    }) as typeof fetch;
    await ollamaChatClient("http://ollama:11434", "gemma4:26b-a4b", spy).warmUp!();
    expect(body).toMatchObject({ model: "gemma4:26b-a4b", messages: [], keep_alive: "60m" });
  });
});
