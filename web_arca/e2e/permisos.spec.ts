import {
  API, abrirLista, apoyoApi, crearAdmin, crearMiembro, devolucionApi, entrar, entrarRapido, expect, filaLista, gastoApi, irA,
  menu, opcionesDelMenu, test,
  irAFamilia, irAOpcionFamilia
} from "./ayudas";

const tarjeta = (page: import("@playwright/test").Page, nombre: string) =>
  page.getByRole("heading", { name: nombre }).locator("xpath=ancestor::div[contains(@class,'rounded-tarjeta')][1]");

test.describe("Un miembro sin permiso sobre lo del admin", () => {
  test("en la lista completa solo puede ver el historial de lo del admin; lo suyo si lo gestiona", async ({ page, request }) => {
    const admin = await crearAdmin(request);
    const beto = await crearMiembro(request, admin, { nombre: "Beto Miembro" });
    await gastoApi(request, admin, { nota: "Del admin", monto: 80 });
    await gastoApi(request, beto, { nota: "Del miembro", monto: 30 });
    await entrarRapido(page, beto);
    await abrirLista(page);

    // todos ven todo...
    await expect(filaLista(page, "Del admin")).toContainText("Ana Admin");
    await expect(filaLista(page, "Del miembro")).toContainText("Beto Miembro");
    // ...pero el menu "..." solo ofrece lo permitido
    expect(await opcionesDelMenu(page, "Acciones de Del admin")).toEqual(["Ver historial"]);
    expect(await opcionesDelMenu(page, "Acciones de Del miembro")).toEqual(["Editar", "Compartir...", "Ver historial", "Anular"]);
  });

  test("el backend lo rechaza aunque se salte la interfaz (403) y no cambia nada", async ({ request }) => {
    const admin = await crearAdmin(request);
    const beto = await crearMiembro(request, admin);
    const gasto = await gastoApi(request, admin, { monto: 80 });
    const apoyo = await apoyoApi(request, admin, { monto: 300 });
    const dev = await devolucionApi(request, admin, apoyo.id, 100);

    const intentos = [
      request.patch(`${API}/movimientos/${gasto.id}`, { headers: beto.headers, data: { monto: 1 } }),
      request.post(`${API}/movimientos/${gasto.id}/anular`, { headers: beto.headers, data: {} }),
      request.patch(`${API}/apoyos/${apoyo.id}`, { headers: beto.headers, data: { monto: 999 } }),
      request.post(`${API}/apoyos/${apoyo.id}/anular`, { headers: beto.headers, data: {} }),
      request.post(`${API}/apoyos/${apoyo.id}/consumir`, { headers: beto.headers, data: {} }),
      request.patch(`${API}/apoyos/${apoyo.id}/devoluciones/${dev}`, { headers: beto.headers, data: { monto: 1 } }),
      request.post(`${API}/apoyos/${apoyo.id}/devoluciones/${dev}/anular`, { headers: beto.headers, data: {} }),
      request.post(`${API}/categorias`, { headers: beto.headers, data: { nombre: "Ropa" } }),
      request.post(`${API}/familia/invitar`, { headers: beto.headers, data: { nombre: "X", email: "x@arca.test", password: "Temporal123" } }),
      request.get(`${API}/historial`, { headers: beto.headers }),
    ];
    for (const r of await Promise.all(intentos)) expect(r.status()).toBe(403);

    const m = await (await request.get(`${API}/movimientos`, { headers: admin.headers })).json();
    expect(m[0]).toMatchObject({ monto: 80, anulado: false });
    const a = await (await request.get(`${API}/apoyos`, { headers: admin.headers })).json();
    expect(a[0]).toMatchObject({ monto: 300, anulado: false, consumido: 0 });
  });

  test("en Apoyos: no ve acciones sobre el apoyo del admin, pero si puede registrar una devolucion y gestionar la suya", async ({ page, request }) => {
    const admin = await crearAdmin(request);
    const beto = await crearMiembro(request, admin);
    const apoyo = await apoyoApi(request, admin, { monto: 300 });
    await devolucionApi(request, admin, apoyo.id, 100); // del admin
    await entrarRapido(page, beto);
    await irA(page, "Apoyos");
    const t = tarjeta(page, "Tia Rosa");

    expect(await opcionesDelMenu(page, "Acciones del apoyo Bs 300.00")).toEqual(["Ver historial del apoyo"]);
    expect(await opcionesDelMenu(page, "Acciones de la devolución Bs 100.00")).toEqual(["Ver historial de la devolución"]);
    await expect(t.getByRole("button", { name: "Marcar consumido" })).toHaveCount(0); // consumir es del dueno del apoyo
    await expect(t.getByRole("button", { name: "Registrar devolución" })).toBeVisible();

    // cualquier miembro puede registrar una devolucion...
    await t.getByRole("button", { name: "Registrar devolución" }).click();
    await t.getByLabel("Monto devuelto (Bs)").fill("40");
    await t.getByRole("button", { name: "Guardar" }).click();
    await expect(t).toContainText("Pendiente Bs 160.00");
    // ...y gestiona la suya, pero no la del admin
    expect(await opcionesDelMenu(page, "Acciones de la devolución Bs 40.00")).toEqual(["Editar devolución", "Ver historial de la devolución", "Anular devolución"]);
    expect(await opcionesDelMenu(page, "Acciones de la devolución Bs 100.00")).toEqual(["Ver historial de la devolución"]);
  });

  test("el admin si puede editar y anular lo del miembro", async ({ page, request }) => {
    const admin = await crearAdmin(request);
    const beto = await crearMiembro(request, admin);
    await gastoApi(request, beto, { nota: "Del miembro", monto: 30 });
    await entrarRapido(page, admin);
    await abrirLista(page);
    expect(await opcionesDelMenu(page, "Acciones de Del miembro")).toEqual(["Editar", "Ver historial", "Anular"]);
    await menu(page, "Acciones de Del miembro", "Anular");
    await page.getByRole("dialog", { name: "Anular gasto" }).getByRole("button", { name: "Anular", exact: true }).click();
    await expect(page.getByText("Anulado", { exact: true })).toBeVisible();
  });

  test("en Familia el miembro solo mira: sin botones de agregar, sin menus, sin actividad global (ni por direccion directa)", async ({ page, request }) => {
    const admin = await crearAdmin(request);
    const beto = await crearMiembro(request, admin, { nombre: "Beto Miembro" });
    await entrarRapido(page, beto);
    await irAFamilia(page);
    await expect(page.getByText("solo un administrador puede cambiar categorías y miembros")).toBeVisible();
    await expect(page.getByTestId("opcion-familia-actividad")).toHaveCount(0); // la opcion ni aparece
    await expect(page.getByRole("link", { name: /Actividad de la familia/ })).toHaveCount(0);
    await expect(page.getByTestId("opcion-familia-perfil")).toBeVisible(); // su perfil si

    await irAOpcionFamilia(page, "Miembros");
    await expect(page.getByTestId("fila-miembro")).toHaveCount(2);
    await expect(page.getByRole("link", { name: "Agregar miembro" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Acciones de/ })).toHaveCount(0);
    await irAOpcionFamilia(page, "Categorías");
    await expect(page.getByRole("link", { name: "Agregar categoría" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Acciones de/ })).toHaveCount(0);

    // por direccion directa tampoco entra a lo del admin
    await page.goto("/familia/actividad");
    await expect(page.getByRole("heading", { name: "Familia", exact: true })).toBeVisible(); // lo devuelve al menu
    expect(new URL(page.url()).pathname).toBe("/familia");
    await page.goto("/familia/miembros/nuevo");
    await expect(page.getByRole("heading", { name: "Miembros", exact: true })).toBeVisible();
    expect(new URL(page.url()).pathname).toBe("/familia/miembros");
    await page.goto("/familia/categorias/nueva");
    await expect(page.getByRole("heading", { name: "Categorías", exact: true })).toBeVisible();
    expect(new URL(page.url()).pathname).toBe("/familia/categorias");
  });

  test("un miembro desactivado pierde el acceso al instante y no puede volver a entrar", async ({ page, request }) => {
    const admin = await crearAdmin(request);
    const beto = await crearMiembro(request, admin, { nombre: "Beto Miembro" });
    await entrarRapido(page, beto);
    const r = await request.patch(`${API}/familia/miembros/${beto.id}`, { headers: admin.headers, data: { activo: false } });
    expect(r.status()).toBe(200);
    await page.reload();
    await expect(page.getByRole("button", { name: "Entrar" })).toBeVisible(); // su token ya no sirve
    await page.getByLabel("Correo").fill(beto.email);
    await page.getByLabel("Contraseña").fill(beto.clave);
    await page.getByRole("button", { name: "Entrar" }).click();
    await expect(page.getByRole("alert")).toContainText("desactivada");
    await request.patch(`${API}/familia/miembros/${beto.id}`, { headers: admin.headers, data: { activo: true } });
    await entrar(page, beto);
  });
});
