import { createServer } from "node:http";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "./app.ts";
import { Store } from "./store.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const port = Number(process.env.PORT ?? 3000);
const publicUrl = process.env.PUBLIC_URL ?? `http://localhost:${port}`;
const store = new Store(process.env.DATA_DIR ?? join(root, "data"));

const fortnox =
  process.env.FORTNOX_CLIENT_ID && process.env.FORTNOX_CLIENT_SECRET
    ? { clientId: process.env.FORTNOX_CLIENT_ID, clientSecret: process.env.FORTNOX_CLIENT_SECRET, redirectUri: `${publicUrl}/api/fortnox/callback` }
    : undefined;

const server = createServer(createApp(store, { publicDir: join(root, "public"), ...(fortnox ? { fortnox } : {}) }));
server.listen(port, () => {
  console.log(`Kvitto & Resa (reverse) kör på ${publicUrl}`);
  if (!fortnox) console.log("Fortnox ej konfigurerat – export sker som SIE-fil och lönefil (CSV).");
});
