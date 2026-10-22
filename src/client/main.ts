import { io } from "socket.io-client";

interface WordListInfo {
  name: string;
  count: number;
}

const app = document.getElementById("app")!;
const status = document.createElement("p");
status.textContent = "Verbinde …";
app.append(status);

const socket = io();
socket.on("connect", () => {
  status.textContent = "Verbunden mit dem Server.";
});
socket.on("disconnect", () => {
  status.textContent = "Verbindung getrennt.";
});

fetch("/api/wordlists")
  .then((res) => res.json() as Promise<WordListInfo[]>)
  .then((lists) => {
    const ul = document.createElement("ul");
    for (const list of lists) {
      const li = document.createElement("li");
      li.textContent = `${list.name}: ${list.count} Wörter`;
      ul.append(li);
    }
    app.append(ul);
  })
  .catch(() => {
    status.textContent = "Wortlisten konnten nicht geladen werden.";
  });
