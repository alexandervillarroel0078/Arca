import { defineConfig } from "@playwright/test";

// E2E de la PWA con la app COMPILADA (npm run build + npm run preview): service worker, instalacion, carga sin conexion
// despues de instalar y aviso de version nueva. Backend de prueba igual que en playwright.config.ts (arca_test, puerto 8199).
// La app compilada se sirve en el puerto 5298 (la de desarrollo usa 5299): no choca con `npm run dev` ni con las otras E2E.
const PUERTO_API = 8199;
const PUERTO_WEB = 5298;
const canal = process.env.PW_CHANNEL ?? "msedge";

export default defineConfig({
  testDir: "./e2e/pwa",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 10_000 },
  reporter: [["list"]],
  outputDir: "test-results",
  use: {
    baseURL: `http://localhost:${PUERTO_WEB}`,
    viewport: { width: 390, height: 844 },
    channel: canal === "chromium" ? undefined : canal,
    serviceWorkers: "allow",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: [
    {
      command: `.venv\\Scripts\\python.exe -m uvicorn e2e.servidor:app --port ${PUERTO_API} --log-level warning`,
      cwd: "../backend_arca",
      url: `http://localhost:${PUERTO_API}/__e2e__/base`,
      reuseExistingServer: false,
      timeout: 90_000,
      stdout: "ignore",
      stderr: "pipe",
    },
    {
      // compila la version "v1" y la sirve compilada (vite preview)
      command: "node scripts/servir-pwa.mjs",
      url: `http://localhost:${PUERTO_WEB}`,
      reuseExistingServer: false,
      timeout: 180_000,
    },
  ],
});
