// Fase 17: privacidad. Lo privado de una persona no lo ve nadie mas (ni el admin), los totales de cada quien cambian,
// lo que no ves responde 404 como si no existiera, y la copia sin conexion olvida lo que dejo de ser visible.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import {
  API, abrirLista, almacenLocal, apoyoApi, crearAdmin, crearMiembro, entrarRapido, expect, filaLista, filasLista, gastoApi,
  irA, irAOpcionFamilia, menu, opcionesDelMenu, saldo, sinDesborde, alturaMinima, test, volverEnLinea,
} from "./ayudas";

const CARPETA = join(process.cwd(), "capturas");
mkdirSync(CARPETA, { recursive: true });
async function captura(page: Page, nombre: string) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(250);
  await page.screenshot({ path: join(CARPETA, `${nombre}.png`) });
}

type Req = import("@playwright/test").APIRequestContext;
type Ses = import("./ayudas").Sesion;

const visibilidadApi = async (request: Req, s: Ses, ruta: "movimientos" | "apoyos", id: number, datos: object) => {
  const r = await request.patch(`${API}/${ruta}/${id}/visibilidad`, { headers: s.headers, data: datos });
  expect(r.status(), await r.text()).toBe(200);
};

test.describe("Privacidad", () => {
  test("lo privado de Beto no lo ve el admin: ni en Inicio, ni en la lista, ni en los totales, ni por URL (404)", async ({ page, request, browser }) => {
    const ana = await crearAdmin(request);
    const beto = await crearMiembro(request, ana, { nombre: "Beto Miembro" });
    await gastoApi(request, ana, { nota: "Pan de Ana", monto: 100 });

    // Beto registra un gasto "Solo yo" desde la pantalla Nuevo movimiento
    await entrarRapido(page, beto);
    await page.getByRole("link", { name: "Nuevo movimiento" }).click();
    await expect(page.getByTestId("selector-visibilidad")).toBeVisible();
    await page.getByLabel("Monto").fill("200");
    await page.getByRole("radio", { name: /Comida/ }).click();
    await page.getByLabel("Nota (opcional)").fill("Regalo secreto");
    await page.getByRole("radio", { name: /Solo yo/ }).click();
    await expect(page.getByTestId("resumen-visibilidad")).toHaveText("Solo tú lo ves");
    await captura(page, "37-nuevo-movimiento-quien-lo-ve");
    await sinDesborde(page);
    await alturaMinima(page.getByTestId("selector-visibilidad").getByRole("radio"));
    await page.getByRole("button", { name: "Guardar" }).click();

    // Beto ve su gasto con el candado y su total incluye el privado
    await expect(saldo(page)).toHaveText("-Bs 300.00");
    await expect(page.getByTestId("nota-privados")).toHaveText(/Incluye tu 1 registro privado/);
    await expect(page.getByTestId("fila-inicio").filter({ hasText: "Regalo secreto" }).getByTestId("etiqueta-privacidad")).toHaveText(/Solo tú/);
    await captura(page, "38-inicio-con-privados");
    await sinDesborde(page);

    // Ana (admin) NO lo ve: su saldo es solo lo suyo y no hay rastro en la lista
    const ctxAna = await browser.newContext({ viewport: { width: 390, height: 844 }, baseURL: "http://localhost:5299" });
    const paginaAna = await ctxAna.newPage();
    await entrarRapido(paginaAna, ana);
    await expect(saldo(paginaAna)).toHaveText("-Bs 100.00");
    await expect(paginaAna.getByTestId("nota-privados")).toHaveCount(0);
    await abrirLista(paginaAna);
    await expect(filaLista(paginaAna, "Pan de Ana")).toBeVisible();
    await expect(paginaAna.getByText("Regalo secreto")).toHaveCount(0);
    await expect(filasLista(paginaAna)).toHaveCount(1);
    await ctxAna.close();

    // por la API: 404 identico al de un id que no existe (nunca 403), tambien con las acciones
    const privados = (await (await request.get(`${API}/movimientos`, { headers: beto.headers })).json()) as { id: number; nota: string }[];
    const secreto = privados.find((m) => m.nota === "Regalo secreto")!;
    const inexistente = await request.get(`${API}/movimientos/999999`, { headers: ana.headers });
    for (const [metodo, ruta, datos] of [
      ["get", `/movimientos/${secreto.id}`, undefined],
      ["patch", `/movimientos/${secreto.id}`, { monto: 1 }],
      ["post", `/movimientos/${secreto.id}/anular`, {}],
      ["get", `/historial?entidad=movimiento&entidad_id=${secreto.id}`, undefined],
    ] as const) {
      const r = await request[metodo](`${API}${ruta}`, { headers: ana.headers, ...(datos ? { data: datos } : {}) });
      expect(r.status(), `${metodo} ${ruta}`).toBe(404);
    }
    expect((await request.get(`${API}/movimientos/${secreto.id}`, { headers: ana.headers })).status()).toBe(inexistente.status());
    expect(await (await request.get(`${API}/movimientos/${secreto.id}`, { headers: ana.headers })).json()).toEqual(await inexistente.json());
    // y el historial global del admin tampoco lo menciona
    const global = await (await request.get(`${API}/historial`, { headers: ana.headers })).text();
    expect(global).not.toContain("Regalo secreto");
    const bitacora = await (await request.get(`${API}/bitacora`, { headers: ana.headers })).text();
    expect(bitacora).not.toContain("Regalo secreto");
    const csv = await (await request.get(`${API}/bitacora/exportar.csv`, { headers: ana.headers })).text();
    expect(csv).not.toContain("Regalo secreto");
  });

  test("compartir con una persona: la ve solo esa persona, en solo lectura, y al pasarla a privado desaparece", async ({ page, request, browser }) => {
    const ana = await crearAdmin(request);
    const beto = await crearMiembro(request, ana, { nombre: "Beto Miembro" });
    const carla = await crearMiembro(request, ana, { nombre: "Carla Miembro" });
    const g = await gastoApi(request, beto, { nota: "Para Carla", monto: 70 });

    // Beto lo comparte con Carla desde el menu "..." de la lista
    await entrarRapido(page, beto);
    await abrirLista(page);
    await menu(page, "Acciones de Para Carla", "Compartir...");
    const dialogo = page.getByRole("dialog", { name: "Compartir" });
    await dialogo.getByRole("radio", { name: /Personas/ }).click();
    const elegir = page.getByRole("dialog", { name: "Elegir personas" });
    await expect(elegir.getByRole("checkbox", { name: "Ana Admin" })).toBeVisible();
    await elegir.getByRole("checkbox", { name: "Carla Miembro" }).check();
    await captura(page, "39-elegir-personas");
    await sinDesborde(page);
    await alturaMinima(elegir.getByRole("checkbox"), 24);
    await elegir.getByRole("button", { name: /Listo|Elegir|Aceptar/ }).click();
    await expect(dialogo.getByTestId("resumen-visibilidad")).toContainText("Carla Miembro");
    await dialogo.getByRole("button", { name: "Guardar" }).click();
    await expect(filaLista(page, "Para Carla").getByTestId("etiqueta-privacidad")).toHaveText(/Compartido con 1/);

    // Carla la ve como "Compartido por Beto" y no puede tocarla; Ana no la ve
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, baseURL: "http://localhost:5299" });
    const pc = await ctx.newPage();
    await entrarRapido(pc, carla);
    await abrirLista(pc);
    const fila = filaLista(pc, "Para Carla");
    await expect(fila.getByTestId("etiqueta-privacidad")).toHaveText(/Compartido por Beto Miembro/);
    expect(await opcionesDelMenu(pc, "Acciones de Para Carla")).toEqual(["Ver historial"]);
    await captura(pc, "40-lista-compartido-conmigo");
    await sinDesborde(pc);
    expect((await request.get(`${API}/movimientos/${g.id}`, { headers: ana.headers })).status()).toBe(404);
    expect((await request.patch(`${API}/movimientos/${g.id}`, { headers: carla.headers, data: { monto: 1 } })).status()).toBe(403);

    // Beto lo pasa a "Solo yo": Carla deja de verlo (404) al recargar
    await visibilidadApi(request, beto, "movimientos", g.id, { visibilidad: "solo_yo" });
    await pc.reload();
    await abrirLista(pc);
    await expect(pc.getByText("Para Carla")).toHaveCount(0);
    expect((await request.get(`${API}/movimientos/${g.id}`, { headers: carla.headers })).status()).toBe(404);
    await ctx.close();
  });

  test("un apoyo privado: su beneficiario y su pendiente no aparecen para el admin", async ({ page, request }) => {
    const ana = await crearAdmin(request);
    const beto = await crearMiembro(request, ana, { nombre: "Beto Miembro" });
    const a = await apoyoApi(request, beto, { beneficiario: "Primo Secreto", monto: 500 });
    await visibilidadApi(request, beto, "apoyos", a.id, { visibilidad: "solo_yo" });
    await apoyoApi(request, ana, { beneficiario: "Tia Rosa", monto: 300 });

    await entrarRapido(page, ana);
    await irA(page, "Apoyos");
    await expect(page.getByRole("heading", { name: "Tia Rosa" })).toBeVisible();
    await expect(page.getByText("Primo Secreto")).toHaveCount(0);
    await expect(page.getByText("500.00")).toHaveCount(0);
    const resumen = await (await request.get(`${API}/apoyos/resumen`, { headers: ana.headers })).text();
    expect(resumen).not.toContain("Primo Secreto");
    expect(resumen).not.toContain("500");
    expect((await request.post(`${API}/apoyos/${a.id}/devoluciones`, { headers: ana.headers, data: { monto: 10 } })).status()).toBe(404);

    // Beto si lo ve, con su candado
    const dueno = await (await request.get(`${API}/apoyos/resumen`, { headers: beto.headers })).text();
    expect(dueno).toContain("Primo Secreto");
  });

  test("Mi perfil > Privacidad: preferencia, aplicar a los anteriores con confirmacion y el aviso honesto", async ({ page, request }) => {
    const ana = await crearAdmin(request);
    const beto = await crearMiembro(request, ana, { nombre: "Beto Miembro" });
    const viejo = await gastoApi(request, beto, { nota: "Viejo de Beto", monto: 40 });

    await entrarRapido(page, beto);
    await irAOpcionFamilia(page, "Mi perfil");
    await page.getByRole("link", { name: /Privacidad/ }).click();
    await expect(page.getByRole("heading", { name: "Privacidad", exact: true })).toBeVisible();

    // el aviso dice la verdad: protege entre personas de la app, no del que administra el servidor
    const aviso = page.getByTestId("aviso-privacidad");
    await expect(aviso).toContainText("ni siquiera el administrador de tu familia");
    await expect(aviso).toContainText("Quien administra el servidor puede acceder técnicamente a la base de datos");
    await expect(aviso).toContainText("des-ver");

    // por defecto Familia: no hay nada que cambiar
    await expect(page.getByTestId("cuantos-afecta")).toHaveText("Todos tus registros ya tienen tu preferencia.");
    await page.getByRole("radio", { name: /Solo yo/ }).click();
    await expect(page.getByTestId("cuantos-afecta")).toHaveText(/cambiaría 1 registro tuyo/);
    // elegir la preferencia NO toca lo anterior
    expect((await request.get(`${API}/movimientos/${viejo.id}`, { headers: ana.headers })).status()).toBe(200);
    await captura(page, "41-privacidad");
    await sinDesborde(page);

    // aplicar pide confirmar y dice cuantos
    await page.getByRole("button", { name: "Aplicar a mis registros anteriores" }).click();
    const conf = page.getByRole("dialog", { name: "Confirmar" });
    await expect(conf.getByTestId("confirmar-cuantos")).toContainText("1 registro tuyo");
    await captura(page, "42-privacidad-confirmar");
    await conf.getByRole("button", { name: "Cancelar" }).click();
    expect((await request.get(`${API}/movimientos/${viejo.id}`, { headers: ana.headers })).status()).toBe(200);

    await page.getByRole("button", { name: "Aplicar a mis registros anteriores" }).click();
    await page.getByRole("dialog", { name: "Confirmar" }).getByRole("button", { name: "Cambiar 1" }).click();
    await expect(page.getByTestId("cuantos-afecta")).toHaveText("Todos tus registros ya tienen tu preferencia.");
    expect((await request.get(`${API}/movimientos/${viejo.id}`, { headers: ana.headers })).status()).toBe(404);

    // y lo nuevo, sin elegir nada, ya nace privado
    const nuevo = await gastoApi(request, beto, { nota: "Nuevo de Beto", monto: 5 });
    expect((await request.get(`${API}/movimientos/${nuevo.id}`, { headers: ana.headers })).status()).toBe(404);
  });

  test("sin conexion: la copia del telefono olvida lo que otra persona paso a privado", async ({ page, request, context }) => {
    const ana = await crearAdmin(request);
    const beto = await crearMiembro(request, ana, { nombre: "Beto Miembro" });
    const g = await gastoApi(request, beto, { nota: "Lo de Beto", monto: 90 });
    await gastoApi(request, beto, { nota: "Queda visible", monto: 10 });

    // Ana lo ve y su telefono lo guarda
    await entrarRapido(page, ana);
    await abrirLista(page);
    await expect(filaLista(page, "Lo de Beto")).toBeVisible();
    const guardado = async () => JSON.stringify(await almacenLocal(page, "cache")) + JSON.stringify(await almacenLocal(page, "entidades"));
    await expect.poll(guardado).toContain("Lo de Beto");

    // Beto lo pasa a privado mientras Ana esta sin conexion
    await context.setOffline(true);
    await visibilidadApi(request, beto, "movimientos", g.id, { visibilidad: "solo_yo" });
    await volverEnLinea(context, page);

    // al reconectar el telefono lo OLVIDA, tambien de su copia local, y la pantalla se actualiza
    await expect.poll(guardado, { timeout: 15_000 }).not.toContain("Lo de Beto");
    await expect(page.getByText("Lo de Beto")).toHaveCount(0);
    await expect(filaLista(page, "Queda visible")).toBeVisible();

    // y estando sin conexion no vuelve a aparecer desde la copia: los totales viejos (que sumaban ese gasto) tambien
    // se descartaron, asi que NO se muestran cifras que lo delaten hasta volver a leer con conexion
    await context.setOffline(true);
    await irA(page, "Apoyos"); // en desarrollo no hay service worker: se navega dentro de la app, sin recargar
    await irA(page, "Inicio");
    await expect(page.getByText("Sin datos guardados para este periodo")).toBeVisible();
    await expect(page.getByText("Lo de Beto")).toHaveCount(0);
    await volverEnLinea(context, page);
    await irA(page, "Apoyos"); // al volver la conexion la pantalla se vuelve a leer al navegar
    await irA(page, "Inicio");
    await expect(saldo(page)).toHaveText("-Bs 10.00"); // solo lo que Ana puede ver
  });

  test("dos familias: lo de otra familia tambien responde 404 y no suma", async ({ request }) => {
    const ana = await crearAdmin(request, { familia: "Familia A" });
    const otra = await crearAdmin(request, { nombre: "Otra Admin", familia: "Familia B" });
    const g = await gastoApi(request, otra, { nota: "De la otra familia", monto: 33 });
    const r = await request.get(`${API}/movimientos/${g.id}`, { headers: ana.headers });
    expect(r.status()).toBe(404);
    expect(await r.json()).toEqual(await (await request.get(`${API}/movimientos/999999`, { headers: ana.headers })).json());
  });
});
