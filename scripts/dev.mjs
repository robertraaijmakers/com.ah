#!/usr/bin/env node
// npm run dev: (re)build and start the whole suite (db, api, scraper, frontend) locally.
// Data in the postgres volume is kept; only images and containers are rebuilt.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const run = (cmd, args, opts = {}) => spawnSync(cmd, args, { cwd: root, stdio: "inherit", ...opts });
const fail = (msg) => { console.error(`\n✖ ${msg}\n`); process.exit(1); };

// 1. Docker available?
const docker = spawnSync("docker", ["compose", "version"], { cwd: root, stdio: "ignore" });
if (docker.status !== 0) fail("Docker Compose niet gevonden. Start OrbStack/Docker Desktop en probeer opnieuw.");
if (spawnSync("docker", ["info"], { cwd: root, stdio: "ignore" }).status !== 0) {
  fail("De Docker-daemon draait niet. Start OrbStack/Docker Desktop en probeer opnieuw.");
}

// 2. .env present with a real DB password? (compose refuses to start without one, and the
//    postgres volume keeps the password it was first created with)
const envPath = join(root, ".env");
if (!existsSync(envPath)) {
  fail("Geen .env gevonden. Maak er een met:  cp .env.example .env  en vul DB_PASSWORD in.");
}
const env = Object.fromEntries(
  readFileSync(envPath, "utf8").split(/\r?\n/)
    .filter((l) => l.trim() && !l.trim().startsWith("#") && l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
if (!env.DB_PASSWORD) fail("DB_PASSWORD ontbreekt in .env.");
if (env.DB_PASSWORD === "changeme_secure_password") {
  console.warn("⚠ DB_PASSWORD heeft nog de voorbeeldwaarde. Wijzig dit alleen als je database nog nieuw is;");
  console.warn("  een bestaande database behoudt het wachtwoord waarmee hij is aangemaakt.\n");
}

// 3. Rebuild images and (re)create changed containers
console.log("▶ Bouwen en starten: db, api, scraper, frontend …\n");
const up = run("docker", ["compose", "up", "-d", "--build", "--remove-orphans"]);
if (up.status !== 0) fail("docker compose up is mislukt (zie boven).");

// 4. Wait until the API and the frontend answer
async function waitFor(name, url, timeoutMs = 120_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(3000) });
      if (r.ok) return true;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 2000));
  }
  console.warn(`⚠ ${name} reageert nog niet op ${url}. Bekijk de logs:  npm run dev:logs`);
  return false;
}
process.stdout.write("\n⏳ Wachten tot de services reageren …\n");
const apiOk = await waitFor("API", "http://localhost:8000/health");
const webOk = await waitFor("Frontend", "http://localhost:3000/");

console.log(`
${apiOk && webOk ? "✔ Alles draait" : "✖ Niet alles draait"}
  Frontend  http://localhost:3000
  API docs  http://localhost:8000/docs

  Logs volgen:  npm run dev:logs     Stoppen:  npm run dev:stop
  Ollama (AI-chat) draait buiten Docker:  ollama serve
`);
process.exit(apiOk && webOk ? 0 : 1);
