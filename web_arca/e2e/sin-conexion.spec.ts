// Fase 12: crear, editar, anular y reactivar SIN INTERNET (movimientos, apoyos y devoluciones), lecturas desde el cache,
// conflictos entre dos usuarios, rechazos, idempotencia y reintento automatico de la cola.
import type { Page } from "@playwright/test";
import {
  API, abrirLista, almacenLocal, apoyoApi, cambiosPendientes, colaLocal, crearAdmin, crearMiembro, devolucionApi, entrarRapido, expect,
  filaLista, gastoApi, ingresoApi, irA, menu, movimientosApi, prepararCategoriasLocales, registrarGasto, saldo, test, volverEnLinea,
  type Sesion,
  cerrarSesion, irAOpcionFamilia
} from "./ayudas";

const historialApi = async (request: import("@playwright/test").APIRequestContext, s: Sesion, entidad: string, id: number) =>
  ((await (await request.get(`${API}/historial?entidad=${entidad}&entidad_id=${id}`, { headers: s.headers })).json()) as {
    items: { accion: string; usuario_nombre: string; fecha: string; fecha_cliente: string | null; cambios: Record<string, { antes: unknown; despues: unknown }> }[];
  }).items;

const bsApi = async (request: import("@playwright/test").APIRequestContext, s: Sesion, ruta: string) =>
  (await (await request.get(`${API}${ruta}`, { headers: s.headers })).json()) as any;

async function editarMonto(page: Page, etiquetaMenu: string, monto: string) {
  await menu(page, etiquetaMenu, "Editar");
  await page.getByLabel("Monto").fill(monto);
  await page.getByRole("button", { name: "Guardar cambios" }).click();
  await expect(page.getByRole("heading", { name: "Todos los movimientos" })).toBeVisible();
}

async function anularEnLista(page: Page, etiquetaMenu: string, motivo?: string) {
  await menu(page, etiquetaMenu, "Anular");
  const dialogo = page.getByRole("dialog", { name: /^Anular/ });
  if (motivo) await dialogo.getByLabel("Motivo (opcional)").fill(motivo);
  await dialogo.getByRole("button", { name: "Anular", exact: true }).click();
  await expect(dialogo).toHaveCount(0);
}

test.describe("Crear, editar y anular sin conexion", () => {
  test("movimientos: se ve al instante, se fusiona con la creacion pendiente y al reconectar los totales cuadran SIN duplicados", async ({ page, request, context }) => {
    const admin = await crearAdmin(request);
    await ingresoApi(request, admin, 1000);
    const base = await gastoApi(request, admin, { monto: 100, nota: "Base" });
    await entrarRapido(page, admin);
    await expect(saldo(page)).toHaveText("Bs 900.00");
    await prepararCategoriasLocales(page);
    await abrirLista(page); // el telefono guarda la lista (y los registros) para usarla sin internet
    await expect(filaLista(page, "Base")).toBeVisible(); // ya cargo: recien ahi hay copia
    await irA(page, "Inicio");

    await context.setOffline(true);

    // 1) crear
    await registrarGasto(page, "50", /Comida/, "Offline A");
    await expect(cambiosPendientes(page)).toHaveText("1 cambio pendiente");
    await expect(saldo(page)).toHaveText("Bs 850.00"); // el pendiente ya cuenta en pantalla
    await expect(page.getByTestId("fila-inicio").filter({ hasText: "Offline A" })).toContainText("sin enviar");

    // 2) editar lo creado sin internet: se FUSIONA con la creacion (sigue siendo 1 operacion con el valor final)
    await abrirLista(page);
    await editarMonto(page, "Acciones de Offline A", "60");
    await expect(filaLista(page, "Offline A")).toContainText("-Bs 60.00");
    await expect(filaLista(page, "Offline A")).toContainText("sin enviar");
    await expect(cambiosPendientes(page)).toHaveText("1 cambio pendiente");

    // 3) editar un registro que ya estaba en el servidor: operacion aparte
    await editarMonto(page, "Acciones de Base", "80");
    await expect(cambiosPendientes(page)).toHaveText("2 cambios pendientes");
    await irA(page, "Inicio");
    await expect(saldo(page)).toHaveText("Bs 860.00"); // 1000 - 80 - 60

    // 4) anular lo creado sin internet: tambien se fusiona (la creacion sale ya anulada)
    await abrirLista(page);
    await anularEnLista(page, "Acciones de Offline A", "Me equivoque");
    await expect(cambiosPendientes(page)).toHaveText("2 cambios pendientes");

    // 5) anular y reactivar un registro del servidor: dos operaciones encadenadas, en orden
    await anularEnLista(page, "Acciones de Base");
    await page.getByRole("button", { name: "Reactivar", exact: true }).click(); // el aviso "Anulado. Reactivar"
    await expect(cambiosPendientes(page)).toHaveText("4 cambios pendientes");
    await irA(page, "Inicio");
    await expect(saldo(page)).toHaveText("Bs 920.00"); // 1000 - 80 (Offline A anulado no cuenta)

    const cola = await colaLocal(page);
    expect(cola.map((o) => `${o.entidad}:${o.accion}`)).toEqual(["movimiento:crear", "movimiento:editar", "movimiento:anular", "movimiento:reactivar"]);
    expect(cola[0].datos).toMatchObject({ monto: 60, anulado: true, motivo_anulacion: "Me equivoque" }); // una sola creacion, ya anulada
    expect(new Set(cola.map((o) => o.id)).size).toBe(4); // cada operacion con su propio UUID
    expect(cola.map((o) => o.encadenada)).toEqual([false, false, true, true]);
    expect(await movimientosApi(request, admin)).toHaveLength(2); // el servidor no sabe nada aun

    // reconectar (pasa un rato sin conexion: la fecha real de la accion queda claramente antes de la de sincronizacion)
    await page.waitForTimeout(1500);
    await volverEnLinea(context, page);
    await expect(cambiosPendientes(page)).toHaveCount(0);
    await expect.poll(async () => (await colaLocal(page)).length).toBe(0);
    await expect(saldo(page)).toHaveText("Bs 920.00"); // ahora lo calcula el servidor: coincide

    const movs = await movimientosApi(request, admin);
    expect(movs).toHaveLength(3); // Sueldo, Base y Offline A: nada duplicado
    expect(movs.find((m) => m.nota === "Base")).toMatchObject({ monto: 80, anulado: false });
    const a = movs.find((m) => m.nota === "Offline A")!;
    expect(a).toMatchObject({ monto: 60, anulado: true });
    const resumen = await bsApi(request, admin, `/reportes/resumen?mes=${new Date().toISOString().slice(0, 7)}`);
    expect(resumen).toMatchObject({ ingresos: 1000, gastos: 80, saldo: 920 });

    // historial: cada paso con la fecha en que lo hizo el usuario (aparte de la de sincronizacion)
    const hBase = await historialApi(request, admin, "movimiento", base.id);
    expect(hBase.map((e) => e.accion)).toEqual(["crear", "editar", "anular", "reactivar"]);
    const hA = await historialApi(request, admin, "movimiento", a.id);
    expect(hA.map((e) => e.accion)).toEqual(["crear", "anular"]);
    expect(hA[0].fecha_cliente).not.toBeNull();
    expect(hA[1].fecha_cliente).not.toBeNull();
    // la fecha real de la accion es anterior a la de sincronizacion (el usuario creo el registro varios segundos antes de reconectar)
    expect(new Date(hA[0].fecha).getTime() - new Date(hA[0].fecha_cliente!).getTime()).toBeGreaterThan(1000);
    expect(hBase[0].fecha_cliente).toBeNull(); // el registro "Base" se creo por API, sin cola
    expect(hBase[1].fecha_cliente).not.toBeNull();
    expect(new Date(hBase[1].fecha_cliente!).getTime()).toBeLessThanOrEqual(new Date(hBase[1].fecha).getTime());
  });

  test("apoyos y devoluciones: un apoyo creado sin internet admite devolucion y edicion; al reconectar queda todo igual en el servidor", async ({ page, request, context }) => {
    const admin = await crearAdmin(request);
    await ingresoApi(request, admin, 1000);
    await entrarRapido(page, admin);
    await prepararCategoriasLocales(page);
    await irA(page, "Apoyos");
    await expect(page.getByText(/No hay apoyos pendientes ni apoyos de este periodo/)).toBeVisible();
    await irA(page, "Inicio");

    await context.setOffline(true);
    await page.getByRole("link", { name: "Nuevo movimiento" }).click();
    await page.getByRole("tab", { name: "Apoyo" }).click();
    await page.getByLabel("Monto").fill("200");
    await page.getByLabel(/Beneficiario/).fill("Primo");
    await page.getByRole("button", { name: "Guardar" }).click();
    await expect(cambiosPendientes(page)).toHaveText("1 cambio pendiente");
    await expect(saldo(page)).toHaveText("Bs 800.00");

    await irA(page, "Apoyos");
    const tarjeta = page.getByRole("heading", { name: "Primo" }).locator("xpath=ancestor::div[contains(@class,'rounded-tarjeta')][1]");
    await expect(tarjeta).toContainText("Pendiente Bs 200.00");
    await expect(tarjeta).toContainText("sin enviar");

    // devolucion de un apoyo que todavia no existe en el servidor (el UUID lo genero el telefono)
    await tarjeta.getByRole("button", { name: "Registrar devolución" }).click();
    await tarjeta.getByLabel("Monto devuelto (Bs)").fill("50");
    await tarjeta.getByRole("button", { name: "Guardar", exact: true }).click();
    await expect(tarjeta).toContainText("Pendiente Bs 150.00");
    await expect(cambiosPendientes(page)).toHaveText("2 cambios pendientes");

    // editar esa devolucion: se fusiona con su creacion
    await menu(page, "Acciones de la devolución Bs 50.00", "Editar devolución");
    const dialogo = page.getByRole("dialog", { name: "Editar devolución" });
    await dialogo.getByLabel("Monto (Bs)").fill("70");
    await dialogo.getByRole("button", { name: "Guardar" }).click();
    await expect(tarjeta).toContainText("Pendiente Bs 130.00");
    await expect(cambiosPendientes(page)).toHaveText("2 cambios pendientes");
    await irA(page, "Inicio");
    await expect(saldo(page)).toHaveText("Bs 870.00"); // 1000 - 200 + 70

    const cola = await colaLocal(page);
    expect(cola.map((o) => `${o.entidad}:${o.accion}`)).toEqual(["apoyo:crear", "devolucion:crear"]);
    expect(cola[1].datos.monto).toBe(70);

    await volverEnLinea(context, page);
    await expect(cambiosPendientes(page)).toHaveCount(0);
    await expect(saldo(page)).toHaveText("Bs 870.00");

    const apoyos = (await bsApi(request, admin, "/apoyos")) as { id: number; monto: number; devuelto: number; pendiente: number; devoluciones: { monto: number }[] }[];
    expect(apoyos).toHaveLength(1); // sin duplicados
    expect(apoyos[0]).toMatchObject({ monto: 200, devuelto: 70, pendiente: 130 });
    expect(apoyos[0].devoluciones).toHaveLength(1);
    expect(await bsApi(request, admin, "/apoyos/resumen")).toMatchObject({ total_entregado: 200, total_devuelto: 70, total_pendiente: 130 });
  });

  test("anular un apoyo del servidor (con su devolucion) sin internet y reactivarlo: la cascada se aplica en orden al reconectar", async ({ page, request, context }) => {
    const admin = await crearAdmin(request);
    await ingresoApi(request, admin, 1000);
    const ap = await apoyoApi(request, admin, { beneficiario: "Tia Rosa", monto: 300 });
    await devolucionApi(request, admin, ap.id, 100);
    await entrarRapido(page, admin);
    await irA(page, "Apoyos");
    const tarjeta = page.getByRole("heading", { name: "Tia Rosa" }).locator("xpath=ancestor::div[contains(@class,'rounded-tarjeta')][1]");
    await expect(tarjeta).toContainText("Pendiente Bs 200.00");
    await irA(page, "Inicio");
    await expect(saldo(page)).toHaveText("Bs 800.00"); // 1000 - 300 + 100

    await context.setOffline(true);
    await irA(page, "Apoyos");
    await menu(page, "Acciones del apoyo Bs 300.00", "Anular apoyo");
    await page.getByRole("dialog", { name: "Anular apoyo" }).getByRole("button", { name: "Anular", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Tia Rosa" })).toHaveCount(0); // ya no cuenta
    await irA(page, "Inicio");
    await expect(saldo(page)).toHaveText("Bs 1,000.00");

    await volverEnLinea(context, page);
    await expect(cambiosPendientes(page)).toHaveCount(0);
    await expect(saldo(page)).toHaveText("Bs 1,000.00");
    const a = await bsApi(request, admin, `/apoyos/${ap.id}`);
    expect(a).toMatchObject({ anulado: true, estado: "Anulado" });
    expect(a.devoluciones[0].anulado).toBe(true); // la devolucion se anulo con el
    expect((await historialApi(request, admin, "apoyo", ap.id)).map((e) => e.accion)).toEqual(["crear", "anular"]);
  });
});

test.describe("Las pantallas cargan sin internet con los ultimos datos", () => {
  test("Inicio, Apoyos, Lista, Reportes y Familia se ven sin conexion con el aviso 'Datos de hace X, sin conexión'", async ({ page, request, context }) => {
    const admin = await crearAdmin(request, { nombre: "Ana Admin" });
    await crearMiembro(request, admin, { nombre: "Beto Miembro" });
    await ingresoApi(request, admin, 1000);
    await gastoApi(request, admin, { monto: 120, nota: "Mercado" });
    const ap = await apoyoApi(request, admin, { beneficiario: "Tia Rosa", monto: 300 });
    await devolucionApi(request, admin, ap.id, 100);
    await entrarRapido(page, admin);

    // con conexion: se visita cada pantalla una vez
    await expect(saldo(page)).toHaveText("Bs 680.00"); // 1000 - 120 - 300 + 100
    await irA(page, "Apoyos");
    await expect(page.getByRole("heading", { name: "Tia Rosa" })).toBeVisible();
    await abrirLista(page);
    await expect(filaLista(page, "Mercado")).toBeVisible();
    await irA(page, "Reportes");
    await expect(page.getByRole("heading", { name: "Resumen" })).toBeVisible();
    await irAOpcionFamilia(page, "Miembros");
    await expect(page.getByTestId("fila-miembro")).toHaveCount(2);
    await irAOpcionFamilia(page, "Categorías");
    await expect(page.getByTestId("fila-categoria")).toHaveCount(6);
    await expect(page.getByTestId("datos-viejos")).toHaveCount(0); // en linea no hay aviso
    expect((await almacenLocal(page, "cache")).length).toBeGreaterThan(5);

    await context.setOffline(true);

    await irA(page, "Inicio");
    await expect(saldo(page)).toHaveText("Bs 680.00");
    await expect(page.getByText("Mercado", { exact: true })).toBeVisible();
    await expect(page.getByTestId("datos-viejos")).toContainText(/^📴 Datos de hace .+, sin conexión$/);

    await irA(page, "Apoyos");
    await expect(page.getByRole("heading", { name: "Tia Rosa" })).toBeVisible();
    await expect(page.getByText("Pendiente Bs 200.00")).toBeVisible();
    await expect(page.getByTestId("datos-viejos")).toContainText("Datos de hace");

    await abrirLista(page);
    await expect(filaLista(page, "Mercado")).toBeVisible();
    await expect(page.getByTestId("datos-viejos")).toContainText("Datos de hace");

    await irA(page, "Reportes");
    await expect(page.getByRole("heading", { name: "Resumen" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Gastos por categoría" })).toBeVisible();
    await expect(page.getByTestId("fila-mes").first()).toBeVisible();
    await expect(page.getByTestId("datos-viejos")).toContainText("Datos de hace");

    await irAOpcionFamilia(page, "Miembros");
    await expect(page.getByTestId("fila-miembro")).toHaveCount(2);
    await expect(page.getByTestId("datos-viejos")).toContainText("Datos de hace");
    await irAOpcionFamilia(page, "Categorías");
    await expect(page.getByTestId("fila-categoria")).toHaveCount(6);
    await expect(page.getByTestId("datos-viejos")).toContainText("Datos de hace");

    // al volver la conexion el aviso desaparece solo
    await volverEnLinea(context, page);
    await irA(page, "Inicio");
    await expect(page.getByTestId("datos-viejos")).toHaveCount(0);
  });

  test("cerrar sesion borra el cache y la cola del telefono", async ({ page, request }) => {
    const admin = await crearAdmin(request);
    await ingresoApi(request, admin, 500);
    await entrarRapido(page, admin);
    await irA(page, "Apoyos");
    await expect(page.getByText(/No hay apoyos pendientes ni apoyos de este periodo/)).toBeVisible();
    await irA(page, "Inicio");
    expect((await almacenLocal(page, "cache")).length).toBeGreaterThan(0);
    expect((await almacenLocal(page, "entidades")).length + (await almacenLocal(page, "meta")).length).toBeGreaterThan(0);

    await cerrarSesion(page);
    await expect(page.getByRole("button", { name: "Entrar" })).toBeVisible();
    await expect.poll(async () => (await almacenLocal(page, "cache")).length).toBe(0);
    for (const nombre of ["cola", "rechazos", "entidades", "meta"] as const) expect(await almacenLocal(page, nombre), nombre).toHaveLength(0);
  });
});

test.describe("Conflictos entre dos usuarios", () => {
  /** Ana (admin) edita sin conexion; mientras tanto Beto edita lo mismo (en linea, desde su propio aparato). */
  async function prepararConflicto(page: Page, request: import("@playwright/test").APIRequestContext, context: import("@playwright/test").BrowserContext, browser: import("@playwright/test").Browser) {
    const admin = await crearAdmin(request, { nombre: "Ana Admin" });
    const beto = await crearMiembro(request, admin, { nombre: "Beto Miembro" });
    const cena = await gastoApi(request, beto, { monto: 40, nota: "Cena" }); // la registro Beto
    await entrarRapido(page, admin);
    await abrirLista(page);
    await expect(filaLista(page, "Cena")).toContainText("-Bs 40.00");

    await context.setOffline(true);
    await editarMonto(page, "Acciones de Cena", "70"); // Ana: de 40 a 70, sin internet
    await expect(cambiosPendientes(page)).toHaveText("1 cambio pendiente");

    const ctxBeto = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const paginaBeto = await ctxBeto.newPage();
    await entrarRapido(paginaBeto, beto);
    await abrirLista(paginaBeto);
    await editarMonto(paginaBeto, "Acciones de Cena", "55"); // Beto: de 40 a 55, en linea
    await expect(filaLista(paginaBeto, "Cena")).toContainText("-Bs 55.00");
    await ctxBeto.close();
    expect((await bsApi(request, admin, `/movimientos/${cena.id}`)).version).toBe(2);
    return { admin, beto, cena };
  }

  test("al reconectar Ana ve ambas versiones y elige 'Usar la mía': se aplica sobre la version actual y no se pierde nada", async ({ page, request, context, browser }) => {
    const { admin, cena } = await prepararConflicto(page, request, context, browser);

    await volverEnLinea(context, page);
    await expect(page.getByText("1 cambio(s) en conflicto: elige cuál conservar")).toBeVisible();
    await expect(cambiosPendientes(page)).toHaveText("1 cambio pendiente · 1 en conflicto");
    expect((await bsApi(request, admin, `/movimientos/${cena.id}`)).monto).toBe(55); // el servidor sigue con lo de Beto
    expect((await colaLocal(page))[0].estado).toBe("conflicto"); // lo de Ana se conserva

    await page.getByRole("button", { name: "Ver detalle" }).click();
    const c = page.getByTestId("conflicto");
    await expect(c).toContainText("La mía");
    await expect(c).toContainText("La del servidor");
    await expect(c).toContainText("Bs 70.00"); // lo de Ana
    await expect(c).toContainText("Bs 55.00"); // lo de Beto
    await expect(c.getByRole("button", { name: "Usar la mía" })).toBeVisible();
    await expect(c.getByRole("button", { name: "Usar la del servidor" })).toBeVisible();

    await c.getByRole("button", { name: "Usar la mía" }).click();
    await expect(cambiosPendientes(page)).toHaveCount(0);
    const final = await bsApi(request, admin, `/movimientos/${cena.id}`);
    expect(final).toMatchObject({ monto: 70, version: 3 });
    // las dos ediciones quedan en el historial, cada una de su autor
    const h = await historialApi(request, admin, "movimiento", cena.id);
    expect(h.map((e) => [e.accion, e.usuario_nombre])).toEqual([["crear", "Beto Miembro"], ["editar", "Beto Miembro"], ["editar", "Ana Admin"]]);
    expect(h[2].cambios.monto).toEqual({ antes: "55.00", despues: "70.00" });
    expect(h[2].fecha_cliente).not.toBeNull();
  });

  test("'Usar la del servidor': Ana se queda con lo de Beto, no se manda nada y lo de Beto no se pierde", async ({ page, request, context, browser }) => {
    const { admin, cena } = await prepararConflicto(page, request, context, browser);
    await volverEnLinea(context, page);
    await expect(cambiosPendientes(page)).toHaveText("1 cambio pendiente · 1 en conflicto");
    await page.getByRole("button", { name: "Ver detalle" }).click();
    await page.getByRole("button", { name: "Usar la del servidor" }).click();
    await expect(cambiosPendientes(page)).toHaveCount(0);
    await page.getByRole("dialog").getByRole("button", { name: "Cerrar" }).first().click().catch(() => {});

    const final = await bsApi(request, admin, `/movimientos/${cena.id}`);
    expect(final).toMatchObject({ monto: 55, version: 2 });
    expect((await historialApi(request, admin, "movimiento", cena.id)).map((e) => e.usuario_nombre)).toEqual(["Beto Miembro", "Beto Miembro"]);
    await abrirLista(page);
    await expect(filaLista(page, "Cena")).toContainText("-Bs 55.00"); // Ana ya ve lo del servidor
  });

  test("anular algo que otro cambio mientras tanto tambien es conflicto", async ({ page, request, context }) => {
    const admin = await crearAdmin(request);
    const g = await gastoApi(request, admin, { monto: 30, nota: "Taxi" });
    await entrarRapido(page, admin);
    await abrirLista(page);
    await expect(filaLista(page, "Taxi")).toBeVisible();
    await context.setOffline(true);
    await anularEnLista(page, "Acciones de Taxi", "Duplicado");
    await expect(cambiosPendientes(page)).toHaveText("1 cambio pendiente");
    // otro aparato edita lo mismo
    const r = await request.patch(`${API}/movimientos/${g.id}`, { headers: admin.headers, data: { monto: 35 } });
    expect(r.status()).toBe(200);
    await volverEnLinea(context, page);
    await expect(cambiosPendientes(page)).toHaveText("1 cambio pendiente · 1 en conflicto");
    await page.getByRole("button", { name: "Ver detalle" }).click();
    const c = page.getByTestId("conflicto");
    await expect(c).toContainText("Anular gasto");
    await expect(c).toContainText("Anulado");
    await expect(c).toContainText("Activo");
    expect((await bsApi(request, admin, `/movimientos/${g.id}`)).anulado).toBe(false); // nada se aplico en silencio
  });
});

test.describe("Rechazos del servidor", () => {
  test("una devolucion superior a lo pendiente se rechaza al sincronizar: se revierte y aparece en 'No se pudo sincronizar' con el motivo", async ({ page, request, context }) => {
    const admin = await crearAdmin(request);
    const ap = await apoyoApi(request, admin, { beneficiario: "Tia Rosa", monto: 300 });
    await entrarRapido(page, admin);
    await irA(page, "Apoyos");
    const tarjeta = page.getByRole("heading", { name: "Tia Rosa" }).locator("xpath=ancestor::div[contains(@class,'rounded-tarjeta')][1]");
    await expect(tarjeta).toContainText("Pendiente Bs 300.00");

    await context.setOffline(true);
    await tarjeta.getByRole("button", { name: "Registrar devolución" }).click();
    await tarjeta.getByLabel("Monto devuelto (Bs)").fill("250");
    await tarjeta.getByRole("button", { name: "Guardar", exact: true }).click();
    await expect(tarjeta).toContainText("Pendiente Bs 50.00"); // se ve de inmediato
    await expect(cambiosPendientes(page)).toHaveText("1 cambio pendiente");

    // mientras tanto otra persona registra una devolucion de 200
    await devolucionApi(request, admin, ap.id, 200);

    await volverEnLinea(context, page);
    await expect(cambiosPendientes(page)).toHaveCount(0);
    await expect(page.getByText("1 registro(s) fueron rechazados por el servidor")).toBeVisible();
    // se revirtio: la pantalla muestra lo que de verdad hay en el servidor
    await expect(tarjeta).toContainText("Pendiente Bs 100.00");
    const aviso = page.getByTestId("aviso-rechazos");
    await expect(aviso).toContainText("No se pudo sincronizar 1 cambio");
    await aviso.click();
    const r = page.getByTestId("rechazo");
    await expect(r).toContainText("Devolución nueva de Bs 250.00");
    await expect(r).toContainText("La devolución supera lo pendiente (Bs 100.00)");
    expect((await bsApi(request, admin, `/apoyos/${ap.id}`)).devoluciones).toHaveLength(1); // solo la de 200

    // el aviso queda hasta que el usuario lo marca como visto; nunca se descarta solo
    await page.reload();
    await expect(page.getByTestId("aviso-rechazos")).toBeVisible();
    await page.getByTestId("aviso-rechazos").click();
    await page.getByTestId("rechazo").getByRole("button", { name: "Entendido" }).click();
    await expect(page.getByTestId("aviso-rechazos")).toHaveCount(0);
  });
});

test.describe("Idempotencia y reintento automatico", () => {
  test("si el servidor aplico una EDICION pero la respuesta se perdio, el reintento no la aplica dos veces (UUID de operacion)", async ({ page, request, context }) => {
    const admin = await crearAdmin(request);
    const g = await gastoApi(request, admin, { monto: 100, nota: "Cuenta" });
    await entrarRapido(page, admin);
    await abrirLista(page);
    await expect(filaLista(page, "Cuenta")).toBeVisible();

    let perdidas = 0;
    await page.route("**/api/movimientos/*", async (route) => {
      if (route.request().method() === "PATCH" && perdidas === 0) {
        perdidas++;
        await route.fetch(); // el servidor aplica la edicion...
        await route.abort("failed"); // ...pero la app nunca se entera
      } else {
        await route.continue();
      }
    });
    await editarMonto(page, "Acciones de Cuenta", "150");
    expect(perdidas).toBe(1);
    await expect(cambiosPendientes(page)).toHaveText("1 cambio pendiente"); // para la app sigue pendiente
    expect((await bsApi(request, admin, `/movimientos/${g.id}`)).version).toBe(2); // pero el servidor ya la aplico

    await volverEnLinea(context, page); // la app reintenta la MISMA operacion (la version base ya no coincide, pero no es un conflicto)
    await expect(cambiosPendientes(page)).toHaveCount(0);
    await expect(page.getByTestId("aviso-rechazos")).toHaveCount(0);
    const final = await bsApi(request, admin, `/movimientos/${g.id}`);
    expect(final).toMatchObject({ monto: 150, version: 2 }); // un solo efecto
    expect((await historialApi(request, admin, "movimiento", g.id)).map((e) => e.accion)).toEqual(["crear", "editar"]);
  });

  test("REINTENTO AUTOMATICO: sin ningun evento de red, la cola se reintenta sola cada 30 s hasta que el servidor responde", async ({ page, request }) => {
    await page.clock.install();
    const admin = await crearAdmin(request);
    await entrarRapido(page, admin);
    await prepararCategoriasLocales(page);

    // el servidor "no responde" a los POST (sin tocar el estado de red del navegador: no habra evento 'online')
    let intentos = 0;
    let caido = true;
    await page.route("**/api/movimientos", async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      intentos++;
      if (caido) return route.abort("failed");
      return route.continue();
    });

    await registrarGasto(page, "42", /Comida/, "Reintento solo");
    await expect(cambiosPendientes(page)).toHaveText("1 cambio pendiente");
    await expect.poll(() => intentos).toBe(1); // el intento al guardar (sale un instante despues de que aparece el pendiente)

    await page.clock.fastForward(31_000); // 30 s despues: segundo intento (sigue caido)
    await expect.poll(() => intentos).toBe(2);
    await expect(cambiosPendientes(page)).toHaveText("1 cambio pendiente");

    await page.clock.fastForward(31_000); // tercer intento
    await expect.poll(() => intentos).toBe(3);
    expect(await movimientosApi(request, admin)).toHaveLength(0);

    caido = false; // vuelve el servidor
    await page.clock.fastForward(31_000); // cuarto intento: llega
    await expect.poll(() => intentos).toBe(4);
    await expect(cambiosPendientes(page)).toHaveCount(0);
    await expect.poll(async () => (await colaLocal(page)).length).toBe(0);
    await expect(page.getByText("Se sincronizaron 1 registro")).toBeVisible();

    const guardados = await movimientosApi(request, admin);
    expect(guardados).toHaveLength(1); // exactamente uno, aunque hubo 4 intentos
    expect(guardados[0]).toMatchObject({ monto: 42, nota: "Reintento solo" });

    const antes = intentos;
    await page.clock.fastForward(120_000);
    expect(intentos).toBe(antes); // sin pendientes ya no vuelve a intentar
  });

  test("'Sincronizar ahora' envia la cola al momento, sin esperar los 30 s", async ({ page, request, context }) => {
    const admin = await crearAdmin(request);
    await entrarRapido(page, admin);
    await prepararCategoriasLocales(page);
    await context.setOffline(true);
    await registrarGasto(page, "12", /Comida/, "Boton manual");
    await expect(cambiosPendientes(page)).toHaveText("1 cambio pendiente");
    await expect(page.getByTestId("estado-sync")).toContainText("Sin conexión");

    await page.getByRole("button", { name: "Sincronizar ahora" }).click(); // sigue sin red: avisa y conserva
    await expect(page.getByText(/Sin conexión: no se pudo enviar/)).toBeVisible();
    await expect(cambiosPendientes(page)).toHaveText("1 cambio pendiente");

    // vuelve la red, pero el servidor todavia no responde (el aviso 'online' del navegador dispara un intento que falla)
    let caido = true;
    await page.route("**/api/movimientos", (route) => (caido && route.request().method() === "POST" ? route.abort("failed") : route.continue()));
    await context.setOffline(false);
    await expect(cambiosPendientes(page)).toHaveText("1 cambio pendiente");
    caido = false; // el servidor responde de nuevo; el usuario no espera los 30 s: toca el boton
    await page.getByRole("button", { name: "Sincronizar ahora" }).click();
    await expect(cambiosPendientes(page)).toHaveCount(0);
    expect(await movimientosApi(request, admin)).toHaveLength(1);
  });
});
