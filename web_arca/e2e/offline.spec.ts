import {
  API, AVISO_SIN_INTERNET, cambiosPendientes, categoriaId, colaLocal, crearAdmin, entrarRapido, expect, movimientosApi,
  cerrarSesion, prepararCategoriasLocales, registrarGasto, saldo, test, volverEnLinea,
} from "./ayudas";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

test.describe("Registro sin internet y sincronizacion", () => {
  test("sin internet se guarda en el telefono con un UUID; al volver la conexion se envia UNA sola vez", async ({ page, request, context }) => {
    const admin = await crearAdmin(request);
    await entrarRapido(page, admin);
    await prepararCategoriasLocales(page);

    await context.setOffline(true);
    await registrarGasto(page, "33.30", /Comida/, "Sin red");
    await expect(page.getByText(AVISO_SIN_INTERNET)).toBeVisible();
    await expect(cambiosPendientes(page)).toHaveText("1 cambio pendiente");
    const cola = await colaLocal(page);
    expect(cola).toHaveLength(1);
    expect(cola[0].uuid).toMatch(UUID); // UUID del registro
    expect(cola[0].id).toMatch(UUID); // y UUID propio de la operacion
    expect(cola[0].datos.monto).toBe(33.3);
    expect(await movimientosApi(request, admin)).toHaveLength(0); // el servidor aun no sabe nada

    await volverEnLinea(context, page);
    await expect(cambiosPendientes(page)).toHaveCount(0);
    await expect.poll(async () => (await colaLocal(page)).length).toBe(0);
    await expect(saldo(page)).toHaveText("-Bs 33.30");
    await expect(page.getByText("Sin red", { exact: true })).toBeVisible();

    const guardados = await movimientosApi(request, admin);
    expect(guardados).toHaveLength(1); // sin duplicados
    expect(guardados[0]).toMatchObject({ monto: 33.3, nota: "Sin red", anulado: false });
  });

  test("si el servidor guardo pero la respuesta se perdio, el reintento NO duplica (mismo UUID)", async ({ page, request, context }) => {
    const admin = await crearAdmin(request);
    await entrarRapido(page, admin);
    await prepararCategoriasLocales(page);

    // la primera vez, el servidor recibe y guarda el movimiento pero la respuesta nunca llega a la app
    let perdidas = 0;
    await page.route("**/api/movimientos", async (route) => {
      if (route.request().method() === "POST" && perdidas === 0) {
        perdidas++;
        await route.fetch(); // el backend lo procesa y lo guarda
        await route.abort("failed"); // pero la app ve un error de red
      } else {
        await route.continue();
      }
    });

    await registrarGasto(page, "50", /Transporte/, "Respuesta perdida");
    await expect(page.getByText(AVISO_SIN_INTERNET)).toBeVisible(); // para la app no hubo conexion
    expect(perdidas).toBe(1);
    expect(await colaLocal(page)).toHaveLength(1);
    expect(await movimientosApi(request, admin)).toHaveLength(1); // pero el servidor SI lo guardo

    await page.evaluate(() => window.dispatchEvent(new Event("online"))); // la app reintenta
    await expect.poll(async () => (await colaLocal(page)).length).toBe(0);
    await expect(page.getByText(/sin enviar/)).toHaveCount(0);
    const guardados = await movimientosApi(request, admin);
    expect(guardados).toHaveLength(1); // el servidor devolvio el existente en vez de crear otro
    expect(guardados[0]).toMatchObject({ monto: 50, nota: "Respuesta perdida" });
    await expect(saldo(page)).toHaveText("-Bs 50.00");
    void context;
  });

  test("varios registros sin internet (gasto, ingreso y apoyo) se sincronizan todos, sin duplicar, aunque se dispare la sincronizacion dos veces", async ({ page, request, context }) => {
    const admin = await crearAdmin(request);
    await entrarRapido(page, admin);
    await prepararCategoriasLocales(page);
    await context.setOffline(true);

    await registrarGasto(page, "10", /Comida/, "Gasto offline");
    await expect(page.getByText(AVISO_SIN_INTERNET)).toBeVisible();
    await page.getByRole("link", { name: "Nuevo movimiento" }).click();
    await page.getByRole("tab", { name: "Ingreso" }).click();
    await page.getByLabel("Monto").fill("200");
    await page.getByLabel("Nota (opcional)").fill("Ingreso offline");
    await page.getByRole("button", { name: "Guardar" }).click();
    await expect(cambiosPendientes(page)).toHaveText("2 cambios pendientes");
    await page.getByRole("link", { name: "Nuevo movimiento" }).click();
    await page.getByRole("tab", { name: "Apoyo" }).click();
    await page.getByLabel("Monto").fill("80");
    await page.getByLabel(/Beneficiario/).fill("Tia Rosa");
    await page.getByRole("button", { name: "Guardar" }).click();
    await expect(cambiosPendientes(page)).toHaveText("3 cambios pendientes");
    const cola = await colaLocal(page);
    expect(cola.map((c) => c.entidad)).toEqual(["movimiento", "movimiento", "apoyo"]); // en el orden en que se hicieron
    expect(new Set(cola.map((c) => c.uuid)).size).toBe(3);
    expect(new Set(cola.map((c) => c.id)).size).toBe(3); // cada uno con su propio UUID

    await context.setOffline(false);
    await page.evaluate(() => {
      window.dispatchEvent(new Event("online"));
      window.dispatchEvent(new Event("online")); // dos disparos seguidos: no debe enviar dos veces
    });
    await expect.poll(async () => (await colaLocal(page)).length).toBe(0);
    await expect(cambiosPendientes(page)).toHaveCount(0);
    await expect(saldo(page)).toHaveText("Bs 110.00"); // -10 + 200 - 80

    const movs = await movimientosApi(request, admin);
    expect(movs.map((m) => m.nota).sort()).toEqual(["Gasto offline", "Ingreso offline"]);
    const apoyos = (await (await request.get(`${API}/apoyos`, { headers: admin.headers })).json()) as unknown[];
    expect(apoyos).toHaveLength(1);
  });

  test("al abrir la app con registros pendientes los envia solo", async ({ page, request, context }) => {
    const admin = await crearAdmin(request);
    await entrarRapido(page, admin);
    await prepararCategoriasLocales(page);
    await context.setOffline(true);
    await registrarGasto(page, "15", /Comida/, "Pendiente al abrir");
    await expect(page.getByText(AVISO_SIN_INTERNET)).toBeVisible();
    expect(await colaLocal(page)).toHaveLength(1);

    await context.setOffline(false);
    await page.reload(); // reabrir la app (la cola vive en el telefono)
    await expect(saldo(page)).toHaveText("-Bs 15.00");
    await expect.poll(async () => (await colaLocal(page)).length).toBe(0);
    expect(await movimientosApi(request, admin)).toHaveLength(1);
  });

  test("si al sincronizar el servidor rechaza el registro (categoria desactivada), se descarta con aviso y no se reintenta para siempre", async ({ page, request, context }) => {
    const admin = await crearAdmin(request);
    await entrarRapido(page, admin);
    await prepararCategoriasLocales(page);
    await context.setOffline(true);
    await registrarGasto(page, "20", /Antojos/, "Categoria que se desactiva");
    await expect(page.getByText(AVISO_SIN_INTERNET)).toBeVisible();

    // mientras no habia conexion, el admin (desde otro lado) desactiva esa categoria
    const antojos = await categoriaId(request, admin, "Antojos");
    const r = await request.patch(`${API}/categorias/${antojos}`, { headers: admin.headers, data: { activa: false } });
    expect(r.status()).toBe(200);

    await volverEnLinea(context, page);
    await expect(page.getByText("1 registro(s) fueron rechazados por el servidor")).toBeVisible();
    await expect.poll(async () => (await colaLocal(page)).length).toBe(0);
    expect(await movimientosApi(request, admin)).toHaveLength(0);
    // y NO se pierde en silencio: queda en la lista "No se pudo sincronizar" con el motivo
    await page.getByTestId("aviso-rechazos").click();
    const rechazo = page.getByTestId("rechazo");
    await expect(rechazo).toContainText("Gasto nuevo de Bs 20.00 · Categoria que se desactiva");
    await expect(rechazo).toContainText("La categoria esta desactivada");
  });

  test("al salir con registros sin enviar pide confirmar: si se cancela no se pierde nada; si se acepta se descartan", async ({ page, request }) => {
    const admin = await crearAdmin(request);
    await entrarRapido(page, admin);
    await prepararCategoriasLocales(page);

    // Los ENVIOS fallan (el servidor "no responde" a los POST) pero la lectura sigue andando: asi Inicio carga y se puede salir.
    await page.route("**/api/movimientos", (route) => (route.request().method() === "POST" ? route.abort("failed") : route.continue()));
    await registrarGasto(page, "9", /Comida/, "No perder");
    await expect(page.getByText(AVISO_SIN_INTERNET)).toBeVisible();
    await expect(cambiosPendientes(page)).toHaveText("1 cambio pendiente");
    expect(await colaLocal(page)).toHaveLength(1);

    // 1) cancelar: el aviso lo advierte; sigue dentro y la cola intacta
    const dialogo = await cerrarSesion(page, false);
    await expect(dialogo.getByRole("alert")).toContainText("Hay 1 registro(s) sin enviar. Si sales ahora se perderán.");
    await dialogo.getByRole("button", { name: "Cancelar" }).click();
    await expect(cambiosPendientes(page)).toHaveText("1 cambio pendiente");
    expect(await colaLocal(page)).toHaveLength(1);

    // 2) aceptar: sale y descarta la cola (no se mandaria a otra cuenta)
    await cerrarSesion(page);
    await expect(page.getByRole("button", { name: "Entrar" })).toBeVisible();
    expect(await colaLocal(page)).toHaveLength(0);
    expect(await movimientosApi(request, admin)).toHaveLength(0); // nunca llego al servidor
  });

  test("una pantalla que nunca se abrio con conexion explica que falta internet; Inicio ya visto sigue mostrandose", async ({ page, request, context }) => {
    const admin = await crearAdmin(request);
    await entrarRapido(page, admin);
    await context.setOffline(true);
    await page.getByRole("navigation", { name: "Navegación principal" }).getByRole("link", { name: "Apoyos", exact: true }).click();
    await expect(page.getByTestId("sin-datos-periodo")).toContainText("Sin datos guardados para este periodo"); // nunca se vio: no hay copia
    await page.getByRole("navigation", { name: "Navegación principal" }).getByRole("link", { name: "Inicio", exact: true }).click();
    await expect(saldo(page)).toBeVisible(); // Inicio si: se ve lo ultimo guardado
    await expect(page.getByTestId("datos-viejos")).toContainText(/Datos de hace .*, sin conexión/);
    await expect(page.getByRole("link", { name: "Nuevo movimiento" })).toBeVisible();
  });
});
