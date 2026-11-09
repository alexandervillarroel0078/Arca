import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  INTERVALO_BUSCAR_VERSION_MS, MINIMO_ENTRE_BUSQUEDAS_MS, buscarVersionesNuevas, marcarVersionNueva, reiniciarActualizacion,
} from "./actualizacion";
import { AvisoActualizacion, AvisoServidor, ErrorConfiguracionPantalla } from "./AvisosGlobales";
import { UMBRAL_DESPERTANDO_MS, reiniciarServidor, seguirPeticion } from "./servidor";

beforeEach(() => {
  reiniciarServidor();
  reiniciarActualizacion();
});
afterEach(() => vi.useRealTimers());

describe("AvisoServidor", () => {
  it("muestra 'Despertando el servidor...' cuando una peticion pasa de 5 s y lo quita al responder", async () => {
    vi.useFakeTimers();
    render(<AvisoServidor />);
    expect(screen.queryByTestId("aviso-servidor")).not.toBeInTheDocument();
    const seg = seguirPeticion();
    await act(async () => { await vi.advanceTimersByTimeAsync(UMBRAL_DESPERTANDO_MS - 100); });
    expect(screen.queryByTestId("aviso-servidor")).not.toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    expect(screen.getByTestId("aviso-servidor")).toHaveTextContent("Despertando el servidor...");
    act(() => seg.respondio());
    expect(screen.queryByTestId("aviso-servidor")).not.toBeInTheDocument();
  });

  it("no aparece si la peticion termina antes de 5 s", async () => {
    vi.useFakeTimers();
    render(<AvisoServidor />);
    const seg = seguirPeticion();
    await act(async () => { await vi.advanceTimersByTimeAsync(3_000); });
    act(() => seg.respondio());
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(screen.queryByTestId("aviso-servidor")).not.toBeInTheDocument();
  });
});

describe("AvisoActualizacion", () => {
  it("sin version nueva no se ve nada", () => {
    render(<AvisoActualizacion />);
    expect(screen.queryByTestId("aviso-actualizacion")).not.toBeInTheDocument();
  });

  it("al publicarse una version nueva aparece 'Hay una versión nueva, actualizar' y el boton la activa", async () => {
    const u = userEvent.setup();
    const activar = vi.fn().mockResolvedValue(undefined);
    render(<AvisoActualizacion />);
    act(() => marcarVersionNueva(activar));
    const aviso = await screen.findByTestId("aviso-actualizacion");
    expect(aviso).toHaveTextContent("Hay una versión nueva, actualizar");
    expect(activar).not.toHaveBeenCalled(); // no se aplica sola
    await u.click(screen.getByRole("button", { name: "Actualizar" }));
    expect(activar).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByRole("button", { name: "Actualizando..." })).toBeDisabled());
  });

  it("el boton mide 44 px o mas de alto", () => {
    render(<AvisoActualizacion />);
    act(() => marcarVersionNueva(() => {}));
    expect(screen.getByRole("button", { name: "Actualizar" }).className).toContain("min-h-[44px]");
  });
});

describe("busqueda de versiones nuevas", () => {
  it("pregunta cada hora, al volver la conexion y al volver a la app (sin abusar), y un fallo no rompe nada", () => {
    vi.useFakeTimers();
    const registro = { update: vi.fn().mockRejectedValue(new Error("sin red")) };
    const parar = buscarVersionesNuevas(registro);
    vi.advanceTimersByTime(INTERVALO_BUSCAR_VERSION_MS);
    expect(registro.update).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(INTERVALO_BUSCAR_VERSION_MS);
    expect(registro.update).toHaveBeenCalledTimes(2);

    // volver a la app: solo si pasaron 5 minutos desde la ultima busqueda
    document.dispatchEvent(new Event("visibilitychange"));
    expect(registro.update).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(MINIMO_ENTRE_BUSQUEDAS_MS + 1_000);
    document.dispatchEvent(new Event("visibilitychange"));
    expect(registro.update).toHaveBeenCalledTimes(3);

    window.dispatchEvent(new Event("online"));
    expect(registro.update).toHaveBeenCalledTimes(4);

    parar();
    vi.advanceTimersByTime(INTERVALO_BUSCAR_VERSION_MS * 2);
    window.dispatchEvent(new Event("online"));
    expect(registro.update).toHaveBeenCalledTimes(4); // detenido
  });
});

describe("ErrorConfiguracionPantalla", () => {
  it("dice exactamente que falta", () => {
    render(<ErrorConfiguracionPantalla />);
    expect(screen.getByRole("alert")).toHaveTextContent("VITE_API_URL");
  });
});

describe("vercel.json", () => {
  const cfg = JSON.parse(readFileSync(join(process.cwd(), "vercel.json"), "utf-8")) as {
    rewrites: { source: string; destination: string }[];
    headers: { source: string; headers: { key: string; value: string }[] }[];
  };
  const cabecera = (fuente: string, clave: string) =>
    cfg.headers.find((h) => h.source === fuente)?.headers.find((x) => x.key.toLowerCase() === clave.toLowerCase())?.value;

  it("las rutas de la SPA se reescriben a index.html (recargar /apoyos funciona), pero no los archivos de /assets", () => {
    const r = cfg.rewrites[0];
    expect(r.destination).toBe("/index.html");
    const re = new RegExp(`^${r.source.replace(/\//g, "\\/")}$`);
    for (const ruta of ["/", "/apoyos", "/familia/actividad", "/editar/movimiento/12", "/reportes"]) expect(re.test(ruta), ruta).toBe(true);
    expect(re.test("/assets/index-abc123.js")).toBe(false); // un archivo viejo que ya no existe debe dar 404, no index.html
  });

  it("el service worker y el manifest NO se guardan en cache por mucho tiempo (siempre se revalidan)", () => {
    for (const f of ["/sw.js", "/manifest.webmanifest", "/index.html"]) {
      const v = cabecera(f, "Cache-Control")!;
      expect(v, f).toContain("max-age=0");
      expect(v, f).toContain("must-revalidate");
      expect(v, f).not.toMatch(/immutable|max-age=[1-9]/);
    }
    expect(cabecera("/sw.js", "Service-Worker-Allowed")).toBe("/");
    expect(cabecera("/manifest.webmanifest", "Content-Type")).toBe("application/manifest+json");
  });

  it("los archivos con hash si se guardan un ano (inmutables)", () => {
    expect(cabecera("/assets/(.*)", "Cache-Control")).toBe("public, max-age=31536000, immutable");
    expect(cabecera("/workbox-(.*).js", "Cache-Control")).toContain("immutable");
  });

  it("ninguna regla de cache largo alcanza al service worker ni al manifest", () => {
    const largas = cfg.headers.filter((h) => h.headers.some((x) => x.key === "Cache-Control" && /max-age=[1-9]/.test(x.value))).map((h) => h.source);
    for (const fuente of largas) {
      const re = new RegExp(`^${fuente.replace(/\./g, "\\.").replace(/\(\.\*\)/g, ".*")}$`);
      for (const ruta of ["/sw.js", "/manifest.webmanifest", "/index.html", "/"]) expect(re.test(ruta), `${fuente} vs ${ruta}`).toBe(false);
    }
  });

  it("cabeceras de seguridad basicas en todo", () => {
    expect(cabecera("/(.*)", "X-Content-Type-Options")).toBe("nosniff");
    expect(cabecera("/(.*)", "X-Frame-Options")).toBe("DENY");
  });
});
