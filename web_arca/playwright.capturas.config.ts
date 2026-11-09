import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

// Capturas antes/despues de las mejoras de UX (e2e/mejoras-capturas/*.captura.ts). NO forman parte de la suite de pruebas:
// se corren a mano con `CAPTURA_FASE=antes npx playwright test -c playwright.capturas.config.ts`.
// Mismo backend de prueba (arca_test) y mismos puertos que las E2E: no correr a la vez que pytest ni las E2E.
export default defineConfig({
  ...base,
  testDir: "./e2e/mejoras-capturas",
  testMatch: "**/*.captura.ts",
  testIgnore: undefined,
});
