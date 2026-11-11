// Cuentas es SOLO EN LÍNEA: ninguna respuesta de /api/cuentas se guarda en el aparato (ni service worker ni IndexedDB).
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const aqui = __dirname;
const fuentes = readdirSync(aqui).filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\./.test(f));

describe("Cuentas no guarda nada en el aparato", () => {
  it("ningún archivo del módulo usa el almacén local, la cola ni el cache de pantallas", () => {
    expect(fuentes.length).toBeGreaterThan(5);
    for (const f of fuentes) {
      const t = readFileSync(join(aqui, f), "utf8");
      expect(t, f).not.toMatch(/modulos\/sync|\.\.\/sync\/|core\/almacen|leerPantalla|conCache|indexedDB|caches\.|sessionStorage/);
    }
  });

  it("solo se usa localStorage en recordar.ts, y ahí solo ids", () => {
    for (const f of fuentes) {
      const t = readFileSync(join(aqui, f), "utf8");
      if (f === "recordar.ts") continue;
      expect(t, f).not.toMatch(/localStorage/);
    }
    const codigo = readFileSync(join(aqui, "recordar.ts"), "utf8")
      .split(/\r?\n/)
      .filter((l) => !l.trim().startsWith("//"))
      .join(" ");
    expect(codigo).not.toMatch(/persona_nombre|\bsaldo\b|\bmonto\b|\bnota\b/);
  });

  it("la API de Cuentas usa api() directo (no la cola)", () => {
    const t = readFileSync(join(aqui, "api.ts"), "utf8");
    expect(t).toMatch(/from "..\/..\/core\/api"/);
    expect(t).not.toMatch(/encolar|operaciones/);
  });

  it("el service worker no tiene reglas de cache para la API", () => {
    const cfg = readFileSync(join(aqui, "..", "..", "..", "vite.config.ts"), "utf8");
    expect(cfg).not.toMatch(/runtimeCaching/);
    expect(cfg).toMatch(/navigateFallbackDenylist:\s*\[\/\^\\\/api\\\//); // /api/ fuera del fallback
    expect(cfg).toMatch(/globPatterns/); // solo archivos de la app
    expect(cfg).not.toMatch(/api\/cuentas/);
  });
});
