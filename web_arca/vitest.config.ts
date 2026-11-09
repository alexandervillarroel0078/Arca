import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Pruebas unitarias y de componentes (Vitest + Testing Library). No carga el plugin PWA.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    css: false,
    restoreMocks: true,
  },
});
