// Cuentas es SOLO EN LÍNEA: con la app compilada y su service worker, ninguna respuesta de /api/cuentas queda guardada en
// el aparato (ni en el cache del service worker, ni en IndexedDB, ni en localStorage), y sin conexión no se muestran datos viejos.
import type { Page } from "@playwright/test";
import { API, almacenLocal, crearAdmin, entrarRapido, expect, test } from "../ayudas";

async function esperarServiceWorker(page: Page) {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
}

test.describe("PWA compilada: Cuentas no se guarda en el aparato", () => {
  test("ni el cache del service worker, ni IndexedDB, ni localStorage guardan cuentas; sin conexión no se ven datos viejos", async ({ page, request, context }) => {
    const ana = await crearAdmin(request);
    const rc = await request.post(`${API}/cuentas`, {
      headers: ana.headers, data: { nombre: "Cuenta Muy Secreta", tipo: "efectivo", moneda: "BS", saldo_inicial: "7654.32" },
    });
    expect(rc.status()).toBe(201);
    const cuenta = (await rc.json()) as { id: number };
    const rd = await request.post(`${API}/cuentas/${cuenta.id}/depositos`, { headers: ana.headers, data: { monto: "111.11", nota: "Nota Unica 987" } });
    expect(rd.status()).toBe(201);

    await page.goto("/");
    await esperarServiceWorker(page);
    await entrarRapido(page, ana);

    // se usan las pantallas de Cuentas con internet
    await page.goto("/cuentas");
    await expect(page.getByTestId("fila-cuenta").filter({ hasText: "Cuenta Muy Secreta" })).toBeVisible();
    await page.getByTestId("fila-cuenta").click();
    await expect(page.getByTestId("saldo-cuenta").first()).toContainText("Bs 7,765.43");
    await page.goto("/cuentas/movimiento");
    await expect(page.getByTestId("aviso-nota")).toBeVisible();

    // 1) cache del service worker: ninguna URL de la API
    const urls = await page.evaluate(async () => {
      const salida: string[] = [];
      for (const k of await caches.keys()) for (const r of await (await caches.open(k)).keys()) salida.push(r.url);
      return salida;
    });
    expect(urls.length).toBeGreaterThan(5);
    expect(urls.filter((u) => /\/api\//.test(u))).toEqual([]);

    // 2) IndexedDB (cola, cache de pantallas, registros conocidos): nada de Cuentas
    for (const nombre of ["cola", "rechazos", "cache", "entidades", "meta"] as const) {
      const texto = JSON.stringify(await almacenLocal(page, nombre));
      for (const marca of ["Cuenta Muy Secreta", "7654", "7765", "111.11", "Nota Unica 987", "/cuentas"]) expect(texto, `${nombre} contiene ${marca}`).not.toContain(marca);
    }

    // 3) localStorage: a lo sumo ids de «lo último usado», nunca nombres ni montos
    const local = await page.evaluate(() => JSON.stringify(Object.entries(localStorage).filter(([k]) => k !== "arca-token")));
    for (const marca of ["Cuenta Muy Secreta", "7654", "111.11", "Nota Unica 987"]) expect(local).not.toContain(marca);

    // 4) sin conexión no se ven datos viejos: hay un error, no la cuenta
    await context.setOffline(true);
    await page.goto("/cuentas").catch(() => {});
    await page.reload().catch(() => {});
    await expect(page.getByText("Cuenta Muy Secreta")).toHaveCount(0);
    await expect(page.getByText("Bs 7,765.43")).toHaveCount(0);
    await context.setOffline(false);
  });
});
