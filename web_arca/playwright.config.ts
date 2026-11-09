import { defineConfig } from "@playwright/test";

// Pruebas de extremo a extremo (Playwright) a 390px de ancho.
// Levantan SOLAS un backend de prueba (conectado a la base arca_test, nunca a arca2 ni arca) y el frontend.
// Puertos propios (8199 y 5299) para no chocar con `npm run dev` ni con el backend normal.
const PUERTO_API = 8199;
const PUERTO_WEB = 5299;

// Navegador: por defecto Microsoft Edge instalado en el equipo. Con PW_CHANNEL=chrome usa Chrome, y con
// PW_CHANNEL=chromium usa el Chromium propio de Playwright (requiere `npx playwright install chromium`).
const canal = process.env.PW_CHANNEL ?? "msedge";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",
  testIgnore: "**/pwa/**", // las de la app compilada tienen su propia config: playwright.pwa.config.ts
  fullyParallel: false,
  workers: 1, // una sola base de pruebas compartida: los tests corren uno tras otro
  retries: 0, // sin reintentos: una prueba inestable se arregla, no se esconde
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"]],
  outputDir: "test-results",
  use: {
    baseURL: `http://localhost:${PUERTO_WEB}`,
    viewport: { width: 390, height: 844 },
    channel: canal === "chromium" ? undefined : canal,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: [
    {
      // Backend de prueba: misma app, conectada a arca_test (ver backend_arca/e2e/servidor.py)
      command: `.venv\\Scripts\\python.exe -m uvicorn e2e.servidor:app --port ${PUERTO_API} --log-level warning`,
      cwd: "../backend_arca",
      url: `http://localhost:${PUERTO_API}/__e2e__/base`,
      reuseExistingServer: false,
      timeout: 90_000,
      stdout: "ignore",
      stderr: "pipe",
    },
    {
      command: `npx vite --port ${PUERTO_WEB} --strictPort`,
      url: `http://localhost:${PUERTO_WEB}`,
      env: { VITE_API_URL: `http://localhost:${PUERTO_API}` },
      reuseExistingServer: false,
      timeout: 90_000,
    },
  ],
});
