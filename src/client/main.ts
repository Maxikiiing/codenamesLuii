import { startHome, startJoinForm } from "./home.js";
import { startPlayer } from "./player.js";
import { startScreen } from "./screen.js";

const root = document.getElementById("app")!;
const path = location.pathname.replace(/\/+$/, "");

const screenMatch = /^\/screen\/([A-Za-z]{4})$/.exec(path);
const joinMatch = /^\/join\/([A-Za-z]{4})$/.exec(path);

if (screenMatch) startScreen(root, screenMatch[1].toUpperCase());
else if (joinMatch) startPlayer(root, joinMatch[1].toUpperCase());
else if (path === "/join") startJoinForm(root);
else startHome(root);
