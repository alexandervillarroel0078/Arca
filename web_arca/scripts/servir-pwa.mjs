// Para Playwright: compila la version "v1" y la sirve con `vite preview` en el puerto 5298 (app compilada, con service worker).
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const c = spawnSync(process.execPath, [join(raiz, "scripts", "construir-pwa.mjs"), "v1"], { cwd: raiz, stdio: "inherit" });
if (c.status !== 0) process.exit(c.status ?? 1);
const p = spawn(process.execPath, [join(raiz, "node_modules", "vite", "bin", "vite.js"), "preview", "--outDir", "dist-pwa", "--port", "5298", "--strictPort"], {
  cwd: raiz,
  stdio: "inherit",
});
p.on("exit", (code) => process.exit(code ?? 0));
for (const s of ["SIGINT", "SIGTERM"]) process.on(s, () => p.kill());
