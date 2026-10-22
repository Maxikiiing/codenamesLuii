import { request } from "./net.js";
import { h, mount, toast } from "./ui.js";

export function startHome(root: HTMLElement): void {
  const create = async () => {
    const res = await request<{ code: string }>("createRoom");
    if (res.ok) location.assign(`/screen/${res.code}`);
    else toast(res.error);
  };
  mount(
    root,
    h(
      "div",
      { class: "center-page" },
      h("h1", { class: "title" }, "Codenames Luii"),
      h("p", {}, "Dieses Gerät wird der Screen mit dem Spielfeld."),
      h("button", { class: "btn primary big", onclick: () => void create() }, "Neues Spiel"),
      h("p", { class: "muted" }, "Vorgeber? ", h("a", { href: "/join" }, "Mit Raumcode beitreten")),
    ),
  );
}

export function startJoinForm(root: HTMLElement): void {
  const input = h("input", {
    class: "code-input",
    type: "text",
    maxLength: 4,
    autocomplete: "off",
    autocapitalize: "characters",
    placeholder: "ABCD",
    "aria-label": "Raumcode",
  });
  const form = h(
    "form",
    {
      class: "center-page",
      onsubmit: (e: Event) => {
        e.preventDefault();
        const code = input.value.trim().toUpperCase();
        if (/^[A-Z]{4}$/.test(code)) location.assign(`/join/${code}`);
        else toast("Der Raumcode hat 4 Buchstaben.");
      },
    },
    h("h1", {}, "Als Vorgeber beitreten"),
    h("p", {}, "Raumcode vom Screen eingeben"),
    input,
    h("button", { class: "btn primary big", type: "submit" }, "Beitreten"),
  );
  mount(root, form);
  input.focus();
}
