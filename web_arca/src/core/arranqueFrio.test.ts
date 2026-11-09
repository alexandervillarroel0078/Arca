// Fase 13: arranque en frio del servidor (hasta 1 minuto), URL de la API y aviso de version nueva.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { ErrorApi, ErrorConfiguracion, ErrorRed, ErrorTiempo, api, apiConfigurada, urlApi } from "./api";
import {
  ESPERA_NORMAL_MS, ESPERA_PRIMERA_PETICION_MS, OLVIDO_DESPIERTO_MS, UMBRAL_DESPERTANDO_MS, esperaMaxima, reiniciarServidor,
  servidorDespertando,
} from "./servidor";

/** fetch que NO contesta nunca, salvo que se aborte (como un servidor dormido). */
function fetchColgado() {
  return vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_ok, mal) => {
    init.signal?.addEventListener("abort", () => mal(new DOMException("Aborted", "AbortError")));
  }));
}
const ok = (cuerpo: unknown = {}, estado = 200) => new Response(JSON.stringify(cuerpo), { status: estado, headers: { "Content-Type": "application/json" } });

beforeEach(() => {
  reiniciarServidor();
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("arranque en frio: tiempo de espera", () => {
  it("la primera peticion espera unos 90 s antes de rendirse (no 30)", async () => {
    vi.stubGlobal("fetch", fetchColgado());
    let resultado: unknown = "pendiente";
    api("/x").catch((e) => (resultado = e));
    await vi.advanceTimersByTimeAsync(ESPERA_PRIMERA_PETICION_MS - 1_000);
    expect(resultado).toBe("pendiente"); // a los 89 s sigue esperando
    await vi.advanceTimersByTimeAsync(1_500);
    expect(resultado).toBeInstanceOf(ErrorTiempo);
  });

  it("agotar el tiempo es un error de RED (la cola lo reintenta), no un error de la API", async () => {
    vi.stubGlobal("fetch", fetchColgado());
    const p = api("/x").catch((e) => e);
    await vi.advanceTimersByTimeAsync(ESPERA_PRIMERA_PETICION_MS + 100);
    const e = await p;
    expect(e).toBeInstanceOf(ErrorRed);
    expect(e).not.toBeInstanceOf(ErrorApi);
    expect((e as Error).message).toContain("tarda demasiado");
  });

  it("una vez que el servidor respondio, las siguientes esperan 30 s", async () => {
    expect(esperaMaxima()).toBe(ESPERA_PRIMERA_PETICION_MS);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ok()));
    await api("/x"); // el servidor esta despierto
    expect(esperaMaxima()).toBe(ESPERA_NORMAL_MS);
    vi.stubGlobal("fetch", fetchColgado());
    let resultado: unknown = "pendiente";
    api("/y").catch((e) => (resultado = e));
    await vi.advanceTimersByTimeAsync(ESPERA_NORMAL_MS - 1_000);
    expect(resultado).toBe("pendiente");
    await vi.advanceTimersByTimeAsync(1_500);
    expect(resultado).toBeInstanceOf(ErrorTiempo);
  });

  it("un error HTTP (401, 500...) tambien prueba que el servidor esta despierto", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ok({ detail: "x" }, 500)));
    await expect(api("/x")).rejects.toBeInstanceOf(ErrorApi);
    expect(esperaMaxima()).toBe(ESPERA_NORMAL_MS);
  });

  it("si pasan 10 minutos sin respuesta se vuelve a esperar 90 s (Render lo duerme a los ~15)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ok()));
    await api("/x");
    expect(esperaMaxima()).toBe(ESPERA_NORMAL_MS);
    await vi.advanceTimersByTimeAsync(OLVIDO_DESPIERTO_MS + 1_000);
    expect(esperaMaxima()).toBe(ESPERA_PRIMERA_PETICION_MS);
  });

  it("sin conexion real (fetch falla al instante) sigue siendo ErrorRed, sin esperar", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    const e = await api("/x").catch((x) => x);
    expect(e).toBeInstanceOf(ErrorRed);
    expect(e).not.toBeInstanceOf(ErrorTiempo);
  });

  it("una respuesta 502/503/504 del proveedor mientras despierta (con HTML) es un error de servidor, no de datos", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<html>Bad Gateway</html>", { status: 502 })));
    const e = await api("/x").catch((x) => x);
    expect(e).toBeInstanceOf(ErrorApi);
    expect((e as ErrorApi).estado).toBe(502);
  });
});

describe("arranque en frio: aviso 'Despertando el servidor...'", () => {
  it("no aparece si responde rapido", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ok()));
    await api("/x");
    expect(servidorDespertando()).toBe(false);
  });

  it("aparece cuando una peticion pasa de 5 s y desaparece al responder", async () => {
    let responder: (r: Response) => void = () => {};
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((res) => (responder = res))));
    const p = api("/x");
    await vi.advanceTimersByTimeAsync(UMBRAL_DESPERTANDO_MS - 500);
    expect(servidorDespertando()).toBe(false); // a los 4,5 s todavia no
    await vi.advanceTimersByTimeAsync(1_000);
    expect(servidorDespertando()).toBe(true); // pasaron los 5 s
    await vi.advanceTimersByTimeAsync(40_000);
    expect(servidorDespertando()).toBe(true);
    responder(ok({ hola: 1 }));
    await expect(p).resolves.toEqual({ hola: 1 });
    expect(servidorDespertando()).toBe(false);
  });

  it("tambien se apaga cuando la peticion se rinde (sin tiempo o sin red)", async () => {
    vi.stubGlobal("fetch", fetchColgado());
    const p = api("/x").catch(() => {});
    await vi.advanceTimersByTimeAsync(10_000);
    expect(servidorDespertando()).toBe(true);
    await vi.advanceTimersByTimeAsync(ESPERA_PRIMERA_PETICION_MS);
    await p;
    expect(servidorDespertando()).toBe(false);
  });

  it("varias peticiones lentas a la vez: sigue encendido hasta que terminan todas", async () => {
    const resolvers: ((r: Response) => void)[] = [];
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((res) => resolvers.push(res))));
    const a = api("/a");
    const b = api("/b");
    await vi.advanceTimersByTimeAsync(6_000);
    expect(servidorDespertando()).toBe(true);
    resolvers[0](ok());
    await a;
    expect(servidorDespertando()).toBe(true); // la otra sigue esperando
    resolvers[1](ok());
    await b;
    expect(servidorDespertando()).toBe(false);
  });
});

describe("URL de la API", () => {
  it("sale de VITE_API_URL y se le quita la barra final", () => {
    vi.stubEnv("VITE_API_URL", "https://mi-api.onrender.com/");
    expect(urlApi()).toBe("https://mi-api.onrender.com");
    expect(apiConfigurada()).toBe(true);
  });

  it("las peticiones van a esa URL", async () => {
    vi.stubEnv("VITE_API_URL", "https://mi-api.onrender.com");
    const f = vi.fn().mockResolvedValue(ok());
    vi.stubGlobal("fetch", f);
    await api("/movimientos");
    expect(f.mock.calls[0][0]).toBe("https://mi-api.onrender.com/api/movimientos");
  });

  it("en una app COMPILADA sin VITE_API_URL no adivina nada: error de configuracion claro", async () => {
    vi.stubEnv("VITE_API_URL", "");
    vi.stubEnv("DEV", false);
    expect(apiConfigurada()).toBe(false);
    expect(() => urlApi()).toThrow(ErrorConfiguracion);
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    await expect(api("/x")).rejects.toThrow("VITE_API_URL");
    expect(f).not.toHaveBeenCalled(); // nunca sale a una URL inventada
  });

  it("un error de configuracion NO es un error de red (no se encola como pendiente)", async () => {
    vi.stubEnv("VITE_API_URL", "");
    vi.stubEnv("DEV", false);
    const e = await api("/x").catch((x) => x);
    expect(e).not.toBeInstanceOf(ErrorRed);
  });

  it("solo en desarrollo (npm run dev) usa el puerto 8000 del mismo equipo", () => {
    vi.stubEnv("VITE_API_URL", "");
    vi.stubEnv("DEV", true);
    expect(urlApi()).toBe(`http://${window.location.hostname}:8000`);
  });

  it("el codigo de la app no tiene ninguna URL fija a localhost", () => {
    const culpables: string[] = [];
    const recorrer = (dir: string) => {
      for (const n of readdirSync(dir)) {
        const ruta = join(dir, n);
        if (statSync(ruta).isDirectory()) recorrer(ruta);
        else if (/\.(ts|tsx)$/.test(n) && !/\.test\.tsx?$/.test(n) && !ruta.includes(join("src", "test"))) {
          if (/https?:\/\/(localhost|127\.0\.0\.1)/.test(readFileSync(ruta, "utf-8"))) culpables.push(ruta);
        }
      }
    };
    recorrer(join(process.cwd(), "src"));
    expect(culpables).toEqual([]);
  });
});
