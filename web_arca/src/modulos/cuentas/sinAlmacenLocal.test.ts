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

// ---- Dictado por voz: el audio lo procesa el servicio de voz del navegador (externo a Arca); aquí no queda nada.
const sinComentarios = (t: string) =>
  t
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\s\/\/.*$/gm, "");
const dictado = fuentes.filter((f) => /^dictado|^BotonDictar/.test(f));
const codigoDe = (f: string) => sinComentarios(readFileSync(join(aqui, f), "utf8"));

describe("Dictado: nada se guarda ni se envía", () => {
  it("son estos archivos, todos planos en el módulo (así los vigila la prueba de arriba)", () => {
    expect([...dictado].sort()).toEqual(["BotonDictar.tsx", "dictadoInterprete.ts", "dictadoNumeros.ts", "dictadoVoz.ts"]);
  });

  it("sin fetch, api(, console.*, ni ningún almacén, cookie, envío o conexión propia", () => {
    for (const f of dictado) {
      expect(codigoDe(f), f).not.toMatch(
        /\bfetch\b|\bapi\(|console\.|localStorage|sessionStorage|indexedDB|\bcaches\b|XMLHttpRequest|sendBeacon|WebSocket|EventSource|document\.cookie|navigator\.storage/,
      );
    }
  });

  it("no importan la API de cuentas, el cliente de la red, la cola ni el almacén local", () => {
    for (const f of dictado) {
      // los `import type` se borran al compilar: traen tipos, no código
      const imports = codigoDe(f).split(/\r?\n/).filter((l) => /^\s*import\b/.test(l) && !/^\s*import type\b/.test(l)).join("\n");
      expect(imports, f).not.toMatch(/core\/api|\.\/api"|core\/almacen|modulos\/sync|\.\.\/sync\/|historial|bitacora/);
    }
  });

  it("solo dictadoVoz.ts toca el reconocimiento de voz del navegador", () => {
    for (const f of fuentes) {
      const t = codigoDe(f);
      if (f === "dictadoVoz.ts") expect(t).toMatch(/webkitSpeechRecognition/);
      else expect(t, f).not.toMatch(/SpeechRecognition/);
    }
  });

  it("los montos hablados se manejan como texto o BigInt: ni Number, ni float, ni redondeos", () => {
    for (const f of ["dictadoNumeros.ts", "dictadoInterprete.ts"]) {
      expect(codigoDe(f), f).not.toMatch(/\bNumber\b|parseFloat|parseInt|\.toFixed|Math\.(round|floor|ceil|trunc)/);
    }
  });

  it("la pantalla no guarda la transcripción: no la conserva en el estado, solo lo que el intérprete extrae", () => {
    const t = codigoDe("PaginaMovimientoNuevo.tsx");
    expect(t).not.toMatch(/localStorage|sessionStorage|indexedDB|\bcaches\b/);
    // lo único que recibe de la voz es la lista de alternativas, que pasa directo al intérprete
    expect(t).toMatch(/function alDictar\(frases: string\[\]\)/);
    expect(t).not.toMatch(/useState<string\[\]>/);
    expect(t).not.toMatch(/guardarUltimo\([^)]*frases/);
  });
});
