import {
  API, abrirLista, apoyoApi, crearAdmin, crearMiembro, devolucionApi, entrarRapido, expect, gastoApi, gastoSinHistorialApi, irA, menu,
  sinDesborde, test, verHistorial,
  irAOpcionFamilia
} from "./ayudas";

test.describe("Historial", () => {
  test("editar, anular y reactivar un movimiento deja su historial: quien, cuando, de X a Y y el motivo", async ({ page, request }) => {
    const admin = await crearAdmin(request);
    await gastoApi(request, admin, { monto: 45, nota: "Almuerzo" });
    await entrarRapido(page, admin);
    await abrirLista(page);

    await menu(page, "Acciones de Almuerzo", "Editar");
    await page.getByLabel("Monto").fill("60");
    await page.getByRole("button", { name: "Guardar cambios" }).click();
    await expect(page.getByTestId("fila-lista").getByText("-Bs 60.00")).toBeVisible(); // en la fila (el total del dia repite el monto)

    await menu(page, "Acciones de Almuerzo", "Anular");
    const anular = page.getByRole("dialog", { name: "Anular gasto" });
    await anular.getByLabel("Motivo (opcional)").fill("Duplicado");
    await anular.getByRole("button", { name: "Anular", exact: true }).click();
    await page.getByRole("button", { name: "Reactivar", exact: true }).click();
    await expect(page.getByTestId("fila-lista")).toHaveCount(1);

    const d = await verHistorial(page, "Acciones de Almuerzo");
    const entradas = d.getByTestId("entrada-historial");
    await expect(entradas).toHaveCount(4);
    const acciones = await entradas.evaluateAll((els) => els.map((e) => e.getAttribute("data-accion")));
    expect(acciones).toEqual(["crear", "editar", "anular", "reactivar"]); // cronologico
    await expect(entradas.nth(0)).toContainText("Monto: Bs 45.00");
    await expect(entradas.nth(1)).toContainText("Editó · Ana Admin");
    await expect(entradas.nth(1)).toContainText("Monto: Bs 45.00 → Bs 60.00");
    await expect(entradas.nth(2)).toContainText("Motivo: Duplicado");
    await expect(entradas.nth(2)).toContainText("Anulado: No → Si");
    await expect(entradas.nth(3)).toContainText("Anulado: Si → No");
    await expect(d.getByTestId("titulo-historial")).toHaveText("Almuerzo · Bs 60.00");
    await sinDesborde(page);
    await d.getByRole("button", { name: "Cerrar" }).click();
    await expect(d).toHaveCount(0);
  });

  test("anular un apoyo deja una entrada por cada devolucion afectada (y otra al reactivar)", async ({ page, request }) => {
    const admin = await crearAdmin(request);
    const apoyo = await apoyoApi(request, admin, { monto: 300 });
    await devolucionApi(request, admin, apoyo.id, 100);
    await entrarRapido(page, admin);
    await irA(page, "Apoyos");
    await menu(page, "Acciones del apoyo Bs 300.00", "Anular apoyo");
    await page.getByRole("dialog", { name: "Anular apoyo" }).getByRole("button", { name: "Anular", exact: true }).click();
    await page.getByLabel("Ver anulados").check();
    await expect(page.getByText("Apoyos anulados")).toBeVisible();

    let d = await verHistorial(page, "Acciones de la devolución Bs 100.00", "Ver historial de la devolución");
    await expect(d.getByTestId("entrada-historial")).toHaveCount(2);
    await expect(d).toContainText("Motivo: Anulada junto con el apoyo");
    await d.getByRole("button", { name: "Cerrar" }).click();

    await menu(page, "Acciones del apoyo Bs 300.00", "Reactivar");
    await page.getByLabel("Ver anulados").uncheck();
    await expect(page.getByRole("heading", { name: "Tia Rosa" })).toBeVisible();
    await expect(page.getByTestId("fila-devolucion")).toHaveAttribute("data-anulado", "false");

    d = await verHistorial(page, "Acciones de la devolución Bs 100.00", "Ver historial de la devolución");
    await expect(d.getByTestId("entrada-historial")).toHaveCount(3);
    await expect(d).toContainText("Motivo: Reactivada junto con el apoyo");
    await d.getByRole("button", { name: "Cerrar" }).click();

    d = await verHistorial(page, "Acciones del apoyo Bs 300.00", "Ver historial del apoyo");
    const acciones = await d.getByTestId("entrada-historial").evaluateAll((els) => els.map((e) => e.getAttribute("data-accion")));
    expect(acciones).toEqual(["crear", "anular", "reactivar"]);
  });

  test("un miembro puede ver el historial de lo del admin", async ({ page, request }) => {
    const admin = await crearAdmin(request);
    const beto = await crearMiembro(request, admin);
    const g = await gastoApi(request, admin, { monto: 45, nota: "Del admin" });
    await request.patch(`${API}/movimientos/${g.id}`, { headers: admin.headers, data: { monto: 50 } });
    await entrarRapido(page, beto);
    await abrirLista(page);
    const d = await verHistorial(page, "Acciones de Del admin");
    await expect(d.getByTestId("entrada-historial")).toHaveCount(2);
    await expect(d).toContainText("Monto: Bs 45.00 → Bs 50.00");
    await expect(d).toContainText("Ana Admin");
  });

  test("un registro anterior a la funcion de historial no tiene historial y lo dice; solo se registra lo que pase desde ahora", async ({ page, request }) => {
    const admin = await crearAdmin(request);
    await gastoSinHistorialApi(request, admin, { nota: "Registro antiguo", monto: 20 });
    await entrarRapido(page, admin);
    await abrirLista(page);

    await menu(page, "Acciones de Registro antiguo", "Ver historial");
    const d = page.getByRole("dialog", { name: "Historial" });
    await expect(d.getByText("Sin historial: este registro es anterior a la función de historial.")).toBeVisible();
    await expect(d.getByTestId("entrada-historial")).toHaveCount(0); // no se inventa un "creo"
    await d.getByRole("button", { name: "Cerrar" }).click();

    // al modificarlo, el historial empieza ahi: solo la edicion, sin "crear"
    await menu(page, "Acciones de Registro antiguo", "Editar");
    await page.getByLabel("Monto").fill("25");
    await page.getByRole("button", { name: "Guardar cambios" }).click();
    await expect(page.getByTestId("fila-lista").getByText("-Bs 25.00")).toBeVisible(); // en la fila (el total del dia repite el monto)
    const d2 = await verHistorial(page, "Acciones de Registro antiguo");
    await expect(d2.getByTestId("entrada-historial")).toHaveCount(1);
    await expect(d2.getByTestId("entrada-historial")).toHaveAttribute("data-accion", "editar");
    await expect(d2).toContainText("Monto: Bs 20.00 → Bs 25.00");
  });

  test("actividad de la familia (admin): filtros, paginacion y nunca muestra claves", async ({ page, request }) => {
    const admin = await crearAdmin(request, { nombre: "Ana Admin" });
    const beto = await crearMiembro(request, admin, { nombre: "Beto Miembro" });
    for (let i = 0; i < 12; i++) await gastoApi(request, admin, { nota: `Gasto ${i}`, monto: 1 + i });
    await gastoApi(request, beto, { nota: "Del miembro", monto: 5 });
    const apoyo = await apoyoApi(request, admin, { monto: 100 });
    await devolucionApi(request, admin, apoyo.id, 10);
    // cambio de clave del admin: en el historial solo debe leerse "clave cambiada"
    await request.post(`${API}/auth/cambiar-clave`, { headers: admin.headers, data: { clave_actual: admin.clave, clave_nueva: "OtraClaveNueva9" } });

    await entrarRapido(page, admin);
    await irAOpcionFamilia(page, "Actividad de la familia");
    await expect(page.getByTestId("entrada-historial")).toHaveCount(20); // primera pagina
    const total = Number((await page.getByTestId("total-actividad").innerText()).split(" ")[0]);
    expect(total).toBeGreaterThan(20);
    await sinDesborde(page);

    await page.getByRole("button", { name: "Cargar más" }).click();
    await expect(page.getByTestId("entrada-historial")).toHaveCount(total);
    await expect(page.getByRole("button", { name: "Cargar más" })).toHaveCount(0);

    // los filtros son chips que abren una hoja de opciones (antes eran <select>)
    const elegir = async (chip: RegExp, hoja: string, opcion: string) => {
      await page.getByRole("button", { name: chip }).click();
      await page.getByRole("dialog", { name: hoja }).getByRole("radio", { name: opcion, exact: true }).click();
    };
    await elegir(/^Qué:/, "Qué", "Apoyos");
    await expect(page.getByTestId("entrada-historial")).toHaveCount(1);
    await expect(page.getByTestId("entrada-historial")).toContainText("Apoyo a Tia Rosa");
    await elegir(/^Qué:/, "Qué", "Todo");
    await elegir(/^Quién:/, "Quién", "Beto Miembro");
    await expect(page.getByTestId("entrada-historial")).toHaveCount(1); // solo lo que hizo Beto
    await expect(page.getByTestId("entrada-historial")).toContainText("Del miembro");
    await elegir(/^Quién:/, "Quién", "Toda la familia");
    await elegir(/^Acción:/, "Acción", "Cambió su clave");
    const entrada = page.getByTestId("entrada-historial");
    await expect(entrada).toHaveCount(1);
    await expect(entrada).toContainText("Clave: clave cambiada");
    const pagina = await page.locator("body").innerText();
    expect(pagina).not.toContain("OtraClaveNueva9");
    expect(pagina).not.toContain(admin.clave);
  });

  test("tras cambiar nombre y clave desde la interfaz, el historial lo registra sin guardar la clave", async ({ page, request }) => {
    const admin = await crearAdmin(request);
    await entrarRapido(page, admin);
    await irAOpcionFamilia(page, "Mi perfil");
    await page.getByLabel("Mi nombre").fill("Ana Maria");
    await page.getByRole("button", { name: "Guardar nombre" }).click();
    await expect(page.getByText("Nombre actualizado")).toBeVisible();
    await page.getByLabel("Clave actual").fill(admin.clave);
    await page.getByLabel("Clave nueva (mínimo 8)").fill("ClaveDeLaInterfaz8");
    await page.getByLabel("Repite la clave nueva").fill("ClaveDeLaInterfaz8");
    await page.getByRole("button", { name: "Cambiar clave" }).click();
    await expect(page.getByText("Clave actualizada")).toBeVisible();

    await irAOpcionFamilia(page, "Actividad de la familia");
    await expect(page.getByText("Nombre: Ana Admin → Ana Maria")).toBeVisible();
    await expect(page.getByText("Clave: clave cambiada").first()).toBeVisible();
    expect(await page.locator("body").innerText()).not.toContain("ClaveDeLaInterfaz8");
  });
});
