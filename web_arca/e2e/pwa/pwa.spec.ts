// Fase 13: la app COMPILADA (vite build + vite preview): service worker, instalacion, carga sin conexion despues de
// instalar y aviso "Hay una version nueva, actualizar". Se corre con `npm run test:pwa`.
import { execFileSync } from "node:child_process";
import type { Page } from "@playwright/test";
import {
  cambiosPendientes, crearAdmin, entrarRapido, expect, gastoApi, ingresoApi, irA, prepararCategoriasLocales, registrarGasto, saldo,
  test, volverEnLinea,
} from "../ayudas";

/** Espera a que el service worker este activo Y controle la pagina (la primera visita no la controla hasta recargar). */
async function esperarServiceWorker(page: Page) {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
}

const version = (page: Page) => page.getByTestId("version-app");

test.describe("PWA compilada: instalable y sin conexion", () => {
  test("manifest valido y service worker activo (condiciones para instalar la app)", async ({ page }) => {
    await page.goto("/");
    await esperarServiceWorker(page);

    const manifest = await page.evaluate(async () => {
      const href = document.querySelector<HTMLLinkElement>('link[rel="manifest"]')!.href;
      return { href, datos: await (await fetch(href)).json() };
    });
    expect(manifest.href).toMatch(/manifest\.webmanifest$/);
    expect(manifest.datos).toMatchObject({ short_name: "Arca", display: "standalone", start_url: "/", scope: "/", lang: "es" });
    const tamanos = manifest.datos.icons.map((i: { sizes: string }) => i.sizes);
    expect(tamanos).toEqual(expect.arrayContaining(["192x192", "512x512"]));
    expect(manifest.datos.icons.some((i: { purpose?: string }) => i.purpose === "maskable")).toBe(true);

    const sw = await page.evaluate(async () => {
      const r = await navigator.serviceWorker.getRegistration();
      const claves = await caches.keys();
      let entradas = 0;
      for (const k of claves) entradas += (await (await caches.open(k)).keys()).length;
      return { estado: r?.active?.state, alcance: r?.scope, cacheado: entradas };
    });
    expect(sw.estado).toBe("activated");
    expect(sw.alcance).toMatch(/\/$/);
    expect(sw.cacheado).toBeGreaterThan(5); // la app (HTML, JS, CSS, iconos) quedo guardada para abrir sin internet

    // el service worker y el manifest se sirven SIN cache largo (asi una version nueva se detecta)
    for (const ruta of ["/sw.js", "/manifest.webmanifest"]) {
      const r = await page.request.get(ruta);
      expect(r.status(), ruta).toBe(200);
      expect(r.headers()["cache-control"] ?? "", ruta).not.toMatch(/max-age=[1-9]/);
    }
  });

  test("despues de instalar, la app abre y se usa SIN conexion con los ultimos datos; lo hecho sin conexion se sincroniza al volver", async ({ page, request, context }) => {
    const admin = await crearAdmin(request);
    await ingresoApi(request, admin, 1000);
    await gastoApi(request, admin, { monto: 100, nota: "Mercado" });
    await page.goto("/");
    await esperarServiceWorker(page);
    await entrarRapido(page, admin);
    await expect(saldo(page)).toHaveText("Bs 900.00");
    await prepararCategoriasLocales(page);
    await irA(page, "Apoyos");
    await expect(page.getByText(/No hay apoyos pendientes ni apoyos de este periodo/)).toBeVisible();
    await irA(page, "Inicio");

    // se corta Internet y se REABRE la app (recarga completa: la sirve el service worker)
    await context.setOffline(true);
    await page.reload();
    await expect(saldo(page)).toHaveText("Bs 900.00"); // ultimos datos, sin conexion
    await expect(page.getByText("Mercado", { exact: true })).toBeVisible();
    await expect(page.getByTestId("datos-viejos")).toContainText(/Datos de hace .+, sin conexión/);

    // abrir directamente otra ruta de la app (no la raiz) tambien funciona sin conexion
    await page.goto("/apoyos");
    await expect(page.getByRole("heading", { name: "Apoyos" })).toBeVisible();
    await expect(page.getByText(/No hay apoyos pendientes ni apoyos de este periodo/)).toBeVisible();

    // y se puede registrar: queda pendiente y se envia al volver
    await irA(page, "Inicio");
    await registrarGasto(page, "40", /Comida/, "Hecho sin conexion");
    await expect(cambiosPendientes(page)).toHaveText("1 cambio pendiente");
    await expect(saldo(page)).toHaveText("Bs 860.00");

    await volverEnLinea(context, page);
    await expect(cambiosPendientes(page)).toHaveCount(0);
    await expect(saldo(page)).toHaveText("Bs 860.00");
    await expect(page.getByTestId("datos-viejos")).toHaveCount(0);
  });
});

test.describe("PWA compilada: actualizaciones", () => {
  test("al publicar una version nueva avisa 'Hay una versión nueva, actualizar' y, al actualizar, se usa la nueva (tambien sin conexion)", async ({ page, context }) => {
    test.setTimeout(240_000);
    await page.goto("/");
    await esperarServiceWorker(page);
    await expect(version(page)).toHaveText("Versión v1");
    await expect(page.getByTestId("aviso-actualizacion")).toHaveCount(0);

    // se "publica" la version v2 (nueva compilacion en el mismo servidor)
    execFileSync(process.execPath, ["scripts/construir-pwa.mjs", "v2"], { cwd: process.cwd(), stdio: "ignore" });

    // la app pregunta si hay version nueva (lo hace sola cada hora y al volver a abrirla; aqui se fuerza)
    await page.evaluate(async () => {
      const r = await navigator.serviceWorker.getRegistration();
      await r!.update();
    });
    const aviso = page.getByTestId("aviso-actualizacion");
    await expect(aviso).toBeVisible({ timeout: 30_000 });
    await expect(aviso).toContainText("Hay una versión nueva, actualizar");
    await expect(version(page)).toHaveText("Versión v1"); // NO se cambio sola: el usuario decide cuando

    // si recarga sin tocar el aviso, sigue en la vieja y el aviso vuelve a salir (no queda "pegado" sin saberlo)
    await page.reload();
    await expect(version(page)).toHaveText("Versión v1");
    await expect(page.getByTestId("aviso-actualizacion")).toBeVisible({ timeout: 30_000 });

    // actualizar
    await page.getByRole("button", { name: "Actualizar" }).click();
    await expect(version(page)).toHaveText("Versión v2", { timeout: 30_000 });
    await expect(page.getByTestId("aviso-actualizacion")).toHaveCount(0);
    await page.waitForFunction(() => !!navigator.serviceWorker.controller);

    // la version nueva tambien abre sin conexion (quedo instalada completa)
    await context.setOffline(true);
    await page.reload();
    await expect(version(page)).toHaveText("Versión v2");
    await expect(page.getByRole("button", { name: "Entrar" })).toBeVisible();
    await context.setOffline(false);
  });
});
