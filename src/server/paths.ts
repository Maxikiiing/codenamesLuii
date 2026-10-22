import path from "node:path";
import { fileURLToPath } from "node:url";

/** Projektordner. src/server (Dev) und dist/server (Build) liegen beide zwei Ebenen darunter. */
export const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
