/**
 * Sync server/data/bodies.json → src/data/bodies.catalog.json.
 *
 * The server JSON is the source of truth for catalog metadata (texture fields
 * are asset basenames). Edit server/data/bodies.json, then run this script.
 */
import { copyFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const serverJson = path.join(root, "server/data/bodies.json");
const clientJson = path.join(root, "src/data/bodies.catalog.json");

mkdirSync(path.dirname(clientJson), { recursive: true });
copyFileSync(serverJson, clientJson);
console.log(`Synced ${serverJson} → ${clientJson}`);
