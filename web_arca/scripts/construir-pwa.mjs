// Compila la app (como en produccion) para las E2E de la PWA: node scripts/construir-pwa.mjs <id-de-version>
// Sale en web_arca/dist-pwa (esta carpeta esta en .gitignore) y apunta al backend de pruebas (puerto 8199).
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const id = process.argv[2] ?? "v1";
const r = spawnSync(process.execPath, [join(raiz, "node_modules", "vite", "bin", "vite.js"), "build", "--outDir", "dist-pwa", "--emptyOutDir"], {
  cwd: raiz,
  stdio: "inherit",
  env: { ...process.env, VITE_API_URL: "http://localhost:8199", VITE_BUILD_ID: id },
});
process.exit(r.status ?? 1);
