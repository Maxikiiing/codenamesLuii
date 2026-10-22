// Kleine DOM-Helfer, Dialoge und das Zahnrad-Menü. Kein Framework.

import { TEAM_IDS, type PublicState, type TeamId } from "../shared/types.js";
import { teamColor } from "./colors.js";
import { sendAction } from "./net.js";

type Child = Node | string | false | null | undefined;
type Props = Record<string, unknown> & { class?: string; style?: Partial<CSSStyleDeclaration> };

/** Erzeugt ein Element: h("button", { class: "x", onclick }, "Text"). */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === "class") el.className = String(value);
    else if (key === "style") Object.assign(el.style, value);
    else if (key.startsWith("on") && typeof value === "function") {
      el.addEventListener(key.slice(2), value as EventListener);
    } else if (key in el) (el as unknown as Record<string, unknown>)[key] = value;
    else el.setAttribute(key, String(value));
  }
  for (const child of children) {
    if (child === false || child === null || child === undefined) continue;
    el.append(child);
  }
  return el;
}

/**
 * Ersetzt den Inhalt von `root`, behält aber Fokus, Wert und Cursor eines gerade
 * bearbeiteten Eingabefelds (erkannt über data-key), damit Live-Updates beim Tippen nicht stören.
 */
export function mount(root: HTMLElement, ...nodes: Node[]): void {
  const active = document.activeElement;
  const key = active instanceof HTMLInputElement ? active.dataset.key : undefined;
  const value = key ? (active as HTMLInputElement).value : undefined;
  const sel = key ? [(active as HTMLInputElement).selectionStart, (active as HTMLInputElement).selectionEnd] : [];
  root.replaceChildren(...nodes);
  if (key) {
    const input = root.querySelector<HTMLInputElement>(`input[data-key="${key}"]`);
    if (input) {
      input.value = value!;
      input.focus();
      input.setSelectionRange(sel[0], sel[1]);
    }
  }
}

let toastTimer: number | undefined;
export function toast(message: string): void {
  let el = document.getElementById("toast");
  if (!el) {
    el = h("div", { id: "toast", class: "toast", role: "status" });
    document.body.append(el);
  }
  el.textContent = message;
  el.classList.add("visible");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el!.classList.remove("visible"), 3500);
}

/** Führt eine Aktion aus und zeigt Fehler als Hinweis an. */
export async function run(action: Parameters<typeof sendAction>[0]): Promise<boolean> {
  const res = await sendAction(action);
  if (!res.ok) toast(res.error);
  return res.ok;
}

interface DialogButton<T> {
  label: string;
  value: T;
  kind?: "primary" | "danger" | "plain";
  disabled?: boolean;
  style?: Partial<CSSStyleDeclaration>;
}

let openDialog: HTMLDialogElement | undefined;

/** Modaler Dialog, der mit dem Wert des gewählten Buttons auflöst (undefined bei Abbruch). */
export function dialog<T>(title: string, body: Child, buttons: DialogButton<T>[]): Promise<T | undefined> {
  openDialog?.close();
  return new Promise((resolve) => {
    const dlg = h("dialog", { class: "dialog" });
    let result: T | undefined;
    const buttonEls = buttons.map((b) =>
      h(
        "button",
        {
          class: `btn ${b.kind ?? "plain"}`,
          disabled: b.disabled,
          style: b.style,
          onclick: () => {
            result = b.value;
            dlg.close();
          },
        },
        b.label,
      ),
    );
    // Der Inhalt füllt den ganzen Dialog, damit nur Klicks auf den Hintergrund ihn schließen.
    dlg.append(
      h(
        "div",
        { class: "dialog-content" },
        h("h2", {}, title),
        body ? h("div", { class: "dialog-body" }, body) : "",
        h("div", { class: "dialog-buttons" }, ...buttonEls),
      ),
    );
    dlg.addEventListener("close", () => {
      dlg.remove();
      if (openDialog === dlg) openDialog = undefined;
      resolve(result);
    });
    dlg.addEventListener("click", (e) => {
      if (e.target === dlg) dlg.close(); // Klick auf den Hintergrund
    });
    document.body.append(dlg);
    openDialog = dlg;
    dlg.showModal();
  });
}

export async function confirmDialog(title: string, body: Child, confirmLabel: string, danger = false): Promise<boolean> {
  const res = await dialog(title, body, [
    { label: "Abbrechen", value: false },
    { label: confirmLabel, value: true, kind: danger ? "danger" : "primary" },
  ]);
  return res === true;
}

/** Schließt einen offenen Dialog, z. B. wenn sich der Spielzustand geändert hat. */
export function closeDialog(): void {
  openDialog?.close();
}

/** Zahnrad-Menü der Spielleitung, auf allen Geräten gleich. */
export function gearButton(getState: () => PublicState | undefined): HTMLElement {
  return h(
    "button",
    {
      class: "gear",
      title: "Spielleitung",
      "aria-label": "Spielleitung",
      onclick: () => {
        const state = getState();
        if (state) void gearMenu(state);
      },
    },
    "⚙",
  );
}

async function gearMenu(state: PublicState): Promise<void> {
  const choice = await dialog("Spielleitung", null, [
    { label: "Neue Runde", value: "newRound" as const, kind: "primary" },
    { label: "Undo (letzte Aufdeckung)", value: "undo" as const, disabled: !state.canUndo },
    { label: "Neue Verbindung erlauben", value: "release" as const },
    { label: "Schließen", value: undefined },
  ]);

  if (choice === "newRound") {
    const ok = await confirmDialog(
      "Neue Runde starten?",
      "Das aktuelle Spielfeld wird verworfen. Alle bleiben verbunden, Teamnamen und Farben bleiben erhalten.",
      "Neue Runde",
    );
    if (ok) await run({ type: "newRound" });
  } else if (choice === "undo") {
    const ok = await confirmDialog(
      "Letzte Aufdeckung rückgängig machen?",
      "Die zuletzt aufgedeckte Karte wird wieder verdeckt, inklusive Zugwechsel oder Spielende.",
      "Rückgängig",
    );
    if (ok) await run({ type: "undo" });
  } else if (choice === "release") {
    const team = await dialog<TeamId>(
      "Neue Verbindung erlauben",
      "Für welches Team soll ein neues Gerät beitreten dürfen?",
      TEAM_IDS.map((t) => ({
        label: state.teams[t].name,
        value: t,
        style: { background: teamColor(state.teams, t).bg, color: teamColor(state.teams, t).fg },
      })),
    );
    if (!team) return;
    const ok = await confirmDialog(
      `Vorgeber von ${state.teams[team].name} trennen?`,
      "Das aktuelle Gerät dieses Teams wird dauerhaft getrennt. Ein laufendes Spiel pausiert, bis ein neues Gerät beigetreten ist.",
      "Trennen",
      true,
    );
    if (ok) await run({ type: "releaseSlot", team });
  }
}

export function teamLabel(state: PublicState, team: TeamId, className = "team-label"): HTMLElement {
  const c = teamColor(state.teams, team);
  return h("span", { class: className, style: { background: c.bg, color: c.fg } }, state.teams[team].name);
}

export function errorPage(root: HTMLElement, title: string, text: string): void {
  mount(
    root,
    h(
      "div",
      { class: "center-page" },
      h("h1", {}, title),
      h("p", {}, text),
      h("a", { class: "btn primary", href: "/" }, "Zur Startseite"),
    ),
  );
}
