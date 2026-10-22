import { describe, expect, it } from "vitest";
import { probeOllama, REASON_LOADING, REASON_UNREACHABLE } from "../src/server/ollama.js";

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
