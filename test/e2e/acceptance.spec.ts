// Ende-zu-Ende-Abnahme im Browser: ein Screen und zwei Handys, wie im echten Spiel.
// Deckt die Akzeptanzkriterien ab, die sich ohne zweites Betriebssystem prüfen lassen.

import { expect, test, devices, type Browser, type Page } from "@playwright/test";

const phone = devices["iPhone 13"];

interface Setup {
  screen: Page;
  code: string;
  frames: string[];
}

/** Öffnet den Screen, legt einen Raum an und schneidet alle Socket-Nachrichten an den Screen mit. */
async function openScreen(browser: Browser): Promise<Setup> {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  const screen = await ctx.newPage();
  const frames: string[] = [];
  screen.on("websocket", (ws) => ws.on("framereceived", (f) => frames.push(String(f.payload))));
  screen.on("response", async (r) => {
    if (r.url().includes("/socket.io/") && r.request().method() === "GET") {
      frames.push(...(await r.text().catch(() => "")).split("\x1e"));
    }
  });
  await screen.goto("/");
  await screen.getByRole("button", { name: "Neues Spiel" }).click();
  await screen.waitForURL(/\/screen\/[A-Z]{4}$/);
  const code = screen.url().split("/").pop()!;
  await expect(screen.locator(".room-code")).toHaveText(code);
  return { screen, code, frames };
}

async function joinPhone(browser: Browser, code: string, teamIndex: 0 | 1): Promise<Page> {
  const ctx = await browser.newContext({ ...phone });
  const page = await ctx.newPage();
  await page.goto(`/join/${code}`);
  await page.locator(".team-choice").nth(teamIndex).click();
  await expect(page.locator(".player-lobby, .player-game")).toBeVisible();
  return page;
}

const confirm = (page: Page, label: string) => page.locator("dialog").getByRole("button", { name: label, exact: true }).click();

/** Liefert die States aus den mitgeschnittenen Frames. */
function states(frames: string[]): { cards?: { type?: string; revealed: boolean }[]; key?: unknown }[] {
  return frames.flatMap((f) => {
    const m = /^42(\[.*\])$/s.exec(f);
    if (!m) return [];
    const [event, payload] = JSON.parse(m[1]);
    return event === "state" ? [payload] : [];
  });
}

test("komplette Runde mit Screen und zwei Handys", async ({ browser }) => {
  const { screen, code, frames } = await openScreen(browser);

  // AK 3: QR-Code wird ausgeliefert
  const qr = await screen.request.get(`/api/rooms/${code}/qr.svg`);
  expect(qr.headers()["content-type"]).toContain("image/svg+xml");

  // AK 6: Start erst mit beiden Vorgebern
  const start = screen.getByRole("button", { name: "Spiel starten" });
  await expect(start).toBeDisabled();

  // AK 4: zwei Handys treten bei, ein drittes wird abgelehnt
  const a = await joinPhone(browser, code, 0);
  await expect(start).toBeDisabled();
  const b = await joinPhone(browser, code, 1);
  const third = await (await browser.newContext({ ...phone })).newPage();
  await third.goto(`/join/${code}`);
  await expect(third.locator(".team-choice").first()).toBeDisabled();
  await expect(third.locator(".team-choice").nth(1)).toBeDisabled();

  // AK 5: Teamname und Farbe live, gleiche Farben nicht wählbar
  await a.locator(".team-name-input").fill("Füchse");
  await a.locator(".team-name-input").press("Enter");
  await a.getByRole("radio", { name: "Orange" }).click();
  await expect(screen.locator(".team-name-input").first()).toHaveValue("Füchse");
  await expect(b.locator(".team-name-static")).toHaveText("Füchse");
  await expect(b.getByRole("radio", { name: "Orange" })).toBeDisabled();
  await expect(screen.locator(".team-name-input").nth(1)).toHaveValue("Team Blau");

  // AK 6: jetzt startbar
  await expect(start).toBeEnabled();
  await start.click();
  await expect(screen.locator(".screen-grid .card")).toHaveCount(25);
  await expect(a.locator(".player-grid .card")).toHaveCount(25);

  // AK 7: beide Player sehen dieselbe Karte
  const keyOf = (p: Page) => p.locator(".player-grid .card").evaluateAll((cs) => cs.map((c) => c.className));
  expect(await keyOf(a)).toEqual(await keyOf(b));

  // AK 8: nur das aktive Team kann handeln
  const aActive = (await a.locator(".player-status.my-turn").count()) > 0;
  const [active, passive] = aActive ? [a, b] : [b, a];
  const activeType = aActive ? "type-a" : "type-b";
  await expect(passive.locator(".player-grid .card:not([disabled])")).toHaveCount(0);
  await expect(passive.getByRole("button", { name: "Zug beenden" })).toBeDisabled();

  // AK 9: eigene Karte aufdecken, Screen aktualisiert sich in unter 1 s
  const own = active.locator(`.player-grid .card.${activeType}`).first();
  const word = (await own.innerText()).trim();
  await own.click();
  await expect(active.locator("dialog h2")).toHaveText(`„${word}“ aufdecken?`);
  const t0 = Date.now();
  await confirm(active, "Aufdecken");
  await expect(screen.locator(".screen-grid .card.revealed", { hasText: word })).toBeVisible({ timeout: 1000 });
  expect(Date.now() - t0).toBeLessThan(1000);
  await expect(active.locator(".player-status.my-turn")).toBeVisible(); // eigene Farbe: weiter raten

  // AK 11: Neuladen von Handy und Screen behält den Stand
  await active.reload();
  await expect(active.locator(".player-grid .card.revealed")).toHaveCount(1);
  await screen.reload();
  await expect(screen.locator(".screen-grid .card.revealed")).toHaveCount(1);

  // AK 10: Zug beenden wechselt das Team
  await active.getByRole("button", { name: "Zug beenden" }).click();
  await confirm(active, "Zug beenden");
  await expect(passive.locator(".player-status.my-turn")).toBeVisible();
  await passive.getByRole("button", { name: "Zug beenden" }).click();
  await confirm(passive, "Zug beenden");
  await expect(active.locator(".player-status.my-turn")).toBeVisible();

  // AK 12 + 15: Zahnrad am Screen, neue Verbindung für das passive Team
  const passiveIndex = aActive ? 1 : 0;
  await screen.locator(".gear").click();
  await expect(screen.locator("dialog").getByRole("button", { name: "Neue Runde" })).toBeVisible();
  await expect(screen.locator("dialog").getByRole("button", { name: /Undo/ })).toBeVisible();
  await screen.locator("dialog").getByRole("button", { name: "Neue Verbindung erlauben" }).click();
  await screen.locator("dialog .btn").nth(passiveIndex).click();
  await confirm(screen, "Trennen");
  await expect(screen.locator(".overlay")).toContainText("Warte auf Vorgeber");
  await expect(passive.getByText("Verbindung wurde durch die Spielleitung getrennt")).toBeVisible();
  // Pausiert: aktives Team kann nicht aufdecken
  await expect(active.locator(".player-grid .card:not([disabled])")).toHaveCount(0);
  // Altes Gerät kehrt nicht automatisch zurück
  await passive.reload();
  await expect(passive.locator(".team-choice").nth(passiveIndex)).toBeEnabled();
  await passive.locator(".team-choice").nth(passiveIndex).click();
  await expect(screen.locator(".overlay")).toHaveCount(0);
  await expect(screen.locator(".screen-grid .card.revealed")).toHaveCount(1);
  await expect(active.locator(".player-status.my-turn")).toBeVisible();

  // AK 10 + 14: Attentäter beendet das Spiel, Undo vom Handy stellt es wieder her
  await active.locator(".player-grid .card.type-assassin").click();
  await confirm(active, "Aufdecken");
  await expect(screen.locator(".banner.winner")).toContainText("Attentäter");
  await active.locator(".gear").click();
  await active.locator("dialog").getByRole("button", { name: /Undo/ }).click();
  await confirm(active, "Rückgängig");
  await expect(screen.locator(".banner.winner")).toHaveCount(0);
  await expect(screen.locator(".screen-grid .card.revealed")).toHaveCount(1);

  // AK 13: Neue Runde führt in die Lobby, Team-Anpassungen bleiben
  await passive.locator(".gear").click();
  await passive.locator("dialog").getByRole("button", { name: "Neue Runde" }).click();
  await confirm(passive, "Neue Runde");
  await expect(screen.locator(".team-name-input").first()).toHaveValue("Füchse");
  await expect(screen.getByRole("button", { name: "Spiel starten" })).toBeEnabled();

  // AK 7: Screen hat zu keinem Zeitpunkt geheime Typen erhalten
  const screenStates = states(frames);
  expect(screenStates.length).toBeGreaterThan(5);
  for (const s of screenStates) {
    expect(s.key).toBeUndefined();
    for (const card of s.cards ?? []) if (!card.revealed) expect(card.type).toBeUndefined();
  }
});

test("Sieg, wenn alle Karten eines Teams aufgedeckt sind", async ({ browser }) => {
  const { screen, code } = await openScreen(browser);
  const a = await joinPhone(browser, code, 0);
  const b = await joinPhone(browser, code, 1);
  await screen.getByRole("button", { name: "Spiel starten" }).click();
  await expect(a.locator(".player-grid .card")).toHaveCount(25);
  const aActive = (await a.locator(".player-status.my-turn").count()) > 0;
  const [active, type] = aActive ? [a, "type-a"] : [b, "type-b"];
  const own = active.locator(`.player-grid .card.${type}:not(.revealed)`);
  await expect(own).toHaveCount(9);
  for (let i = 0; i < 9; i++) {
    await own.first().click();
    await confirm(active, "Aufdecken");
    await expect(own).toHaveCount(8 - i);
  }
  await expect(screen.locator(".banner.winner")).toContainText("Alle Karten gefunden");
});

test("Beitritt per Raumcode und unbekannte Räume", async ({ page, browser }) => {
  const { code } = await openScreen(browser);
  await page.goto("/join");
  await page.getByRole("textbox", { name: "Raumcode" }).fill(code.toLowerCase());
  await page.getByRole("button", { name: "Beitreten" }).click();
  await expect(page).toHaveURL(new RegExp(`/join/${code}$`));
  await expect(page.locator(".team-choice")).toHaveCount(2);

  await page.goto("/screen/ZZZZ");
  await expect(page.getByText("Raum nicht gefunden")).toBeVisible();
});
