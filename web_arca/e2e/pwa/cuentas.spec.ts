// Cuentas es SOLO EN LÍNEA: con la app compilada y su service worker, ninguna respuesta de /api/cuentas queda guardada en
// el aparato (ni en el cache del service worker, ni en IndexedDB, ni en localStorage), y sin conexión no se muestran datos viejos.
import type { Page } from "@playwright/test";
import { API, almacenLocal, crearAdmin, entrarRapido, expect, test } from "../ayudas";
import { decir, instalarVoz } from "../vozSimulada";

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

  test("dictar un movimiento no deja nada en el aparato: localStorage, IndexedDB y caches iguales antes y después, y nada sale a la red", async ({ page, request }) => {
    const ana = await crearAdmin(request);
    const rc = await request.post(`${API}/cuentas`, { headers: ana.headers, data: { nombre: "Caja Dictada", tipo: "efectivo", moneda: "BS", saldo_inicial: "500" } });
    expect(rc.status()).toBe(201);

    await instalarVoz(page); // SpeechRecognition simulado: el real depende del servicio de voz del navegador
    await page.goto("/");
    await esperarServiceWorker(page);
    await entrarRapido(page, ana);
    await page.goto("/cuentas/movimiento");
    const dictar = page.getByRole("button", { name: /Dictar movimiento/ });
    await expect(dictar).toBeEnabled();
    await expect(page.getByLabel(/^Cuenta/)).toHaveValue(/\d+/);

    const antes = await foto(page);
    expect(antes.caches.length).toBeGreaterThan(0); // hay service worker y caché: la comparación mide algo

    const salidas: string[] = [];
    page.on("request", (r) => {
      const u = r.url();
      if ((u.includes("/api/") && r.method() !== "GET") || /cincuenta|retiro de cien/i.test(decodeURIComponent(u))) salidas.push(`${r.method()} ${u}`);
    });

    await dictar.click();
    await decir(page, "Retiro de cien con cincuenta de la caja dictada");
    await expect(page.getByLabel("Monto (Bs)")).toHaveValue("100.50");
    await expect(page.getByTestId("dictado-estado")).toContainText("3 campos rellenados");

    const despues = await foto(page);
    expect(despues.local).toEqual(antes.local);
    expect(despues.sesion).toEqual(antes.sesion);
    expect(despues.caches).toEqual(antes.caches);
    expect(despues.idb).toEqual(antes.idb);
    // ni lo dicho ni el monto dictado aparecen en NINGÚN almacén del aparato
    expect(JSON.stringify(despues)).not.toMatch(/cincuenta|100\.50|retiro de cien|caja dictada/i);
    expect(salidas).toEqual([]);
  });
});

/** Todo lo que la página puede guardar en el aparato: localStorage, sessionStorage, caches (con sus URL) y TODAS las bases IndexedDB. */
async function foto(page: Page) {
  return page.evaluate(async () => {
    const local = Object.entries(localStorage).sort();
    const sesion = Object.entries(sessionStorage).sort();
    const caches_: [string, string[]][] = [];
    for (const k of (await caches.keys()).sort()) caches_.push([k, (await (await caches.open(k)).keys()).map((r) => r.url).sort()]);
    const leer = (nombre: string) =>
      new Promise<Record<string, unknown>>((res) => {
        const r = indexedDB.open(nombre);
        r.onerror = () => res({ error: "no se pudo abrir" });
        r.onsuccess = () => {
          const db = r.result;
          const nombres = Array.from(db.objectStoreNames);
          const salida: Record<string, unknown> = {};
          let faltan = nombres.length;
          if (faltan === 0) {
            db.close();
            return res(salida);
          }
          for (const n of nombres) {
            const q = db.transaction(n, "readonly").objectStore(n).getAll();
            q.onsuccess = () => {
              salida[n] = q.result;
              if (--faltan === 0) {
                db.close();
                res(salida);
              }
            };
            q.onerror = () => {
              salida[n] = "error";
              if (--faltan === 0) {
                db.close();
                res(salida);
              }
            };
          }
        };
      });
    const idb: Record<string, unknown> = {};
    for (const b of await indexedDB.databases()) if (b.name) idb[b.name] = await leer(b.name);
    return { local, sesion, caches: caches_, idb };
  });
}
