import {
  abrirLista, apoyoApi, crearAdmin, devolucionApi, entrarRapido, expect, filaLista, filasLista, gastoApi, ingresoApi, irA,
  menu, movimientosApi, saldo, test,
} from "./ayudas";

const tarjeta = (page: import("@playwright/test").Page, nombre: string) =>
  page.getByRole("heading", { name: nombre }).locator("xpath=ancestor::div[contains(@class,'rounded-tarjeta')][1]");

test.describe("Movimientos: editar, anular y reactivar", () => {
  test("editar desde la lista cambia monto y nota, deja constancia de quien edito y vuelve a la lista", async ({ page, request }) => {
    const admin = await crearAdmin(request);
    await gastoApi(request, admin, { monto: 45, nota: "Almuerzo" });
    await entrarRapido(page, admin);
    await abrirLista(page);

    await menu(page, "Acciones de Almuerzo", "Editar");
    await expect(page.getByRole("heading", { name: "Editar movimiento" })).toBeVisible();
    await expect(page.getByLabel("Monto")).toHaveValue("45");
    await expect(page.getByLabel("Nota (opcional)")).toHaveValue("Almuerzo");
    await page.getByLabel("Monto").fill("60");
    await page.getByLabel("Nota (opcional)").fill("Almuerzo familiar");
    await page.getByRole("button", { name: "Guardar cambios" }).click();

    await expect(page.getByRole("heading", { name: "Todos los movimientos" })).toBeVisible(); // volvio a donde estaba
    const fila = filaLista(page, "Almuerzo familiar");
    await expect(fila).toContainText("-Bs 60.00");
    await expect(fila).toContainText("Editado por Ana Admin");
    expect((await movimientosApi(request, admin))[0]).toMatchObject({ monto: 60, nota: "Almuerzo familiar" });
  });

  test("editar el tipo: un gasto pasa a ingreso y el saldo cambia en consecuencia", async ({ page, request }) => {
    const admin = await crearAdmin(request);
    await gastoApi(request, admin, { monto: 100, nota: "Reintegro" });
    await entrarRapido(page, admin);
    await expect(saldo(page)).toHaveText("-Bs 100.00");
    await abrirLista(page);
    await menu(page, "Acciones de Reintegro", "Editar");
    await page.getByRole("tab", { name: "Ingreso" }).click();
    await page.getByRole("button", { name: "Guardar cambios" }).click();
    await expect(filaLista(page, "Reintegro")).toContainText("+Bs 100.00");
    await irA(page, "Inicio");
    await expect(saldo(page)).toHaveText("Bs 100.00");
  });

  test("anular pide confirmacion con nombre y monto, no cuenta en el saldo, se ve con 'Ver anulados' y se reactiva", async ({ page, request }) => {
    const admin = await crearAdmin(request);
    await ingresoApi(request, admin, 1000);
    await gastoApi(request, admin, { monto: 300, nota: "Cena" });
    await entrarRapido(page, admin);
    await expect(saldo(page)).toHaveText("Bs 700.00");
    await abrirLista(page);

    await menu(page, "Acciones de Cena", "Anular");
    const dialogo = page.getByRole("dialog", { name: "Anular gasto" });
    await expect(dialogo.getByTestId("detalle-anular")).toHaveText("Cena · Bs 300.00");
    await dialogo.getByLabel("Motivo (opcional)").fill("Se registro dos veces");
    await dialogo.getByRole("button", { name: "Anular", exact: true }).click();

    await expect(page.getByText("Anulado", { exact: true })).toBeVisible(); // aviso con "Reactivar"
    await expect(page.getByRole("button", { name: "Reactivar", exact: true })).toBeVisible();
    await expect(filasLista(page)).toHaveCount(1); // desaparece de la lista normal

    await irA(page, "Inicio");
    await expect(saldo(page)).toHaveText("Bs 1,000.00"); // lo anulado no cuenta
    await abrirLista(page);
    await page.getByLabel("Ver anulados").check();
    const fila = filaLista(page, "Cena");
    await expect(fila).toHaveAttribute("data-anulado", "true");
    await expect(fila).toContainText("Anulado por Ana Admin");
    await expect(fila).toContainText("Se registro dos veces");
    await expect(fila.getByText("Cena", { exact: true })).toHaveClass(/line-through/);

    await menu(page, "Acciones de Cena", "Reactivar");
    await expect(fila).toHaveAttribute("data-anulado", "false");
    await irA(page, "Inicio");
    await expect(saldo(page)).toHaveText("Bs 700.00");
  });

  test("tras anular, el aviso 'Reactivar' lo deshace al instante", async ({ page, request }) => {
    const admin = await crearAdmin(request);
    await gastoApi(request, admin, { monto: 20, nota: "Taxi", categoria: "Transporte" });
    await entrarRapido(page, admin);
    await abrirLista(page);
    await menu(page, "Acciones de Taxi", "Anular");
    await page.getByRole("dialog", { name: "Anular gasto" }).getByRole("button", { name: "Anular", exact: true }).click();
    await expect(filasLista(page)).toHaveCount(0);
    await page.getByRole("button", { name: "Reactivar", exact: true }).click();
    await expect(filasLista(page)).toHaveCount(1);
    await expect(filaLista(page, "Taxi")).toContainText("-Bs 20.00");
    expect((await movimientosApi(request, admin))[0].anulado).toBe(false);
  });

  test("un movimiento anulado no se puede editar hasta reactivarlo (el menu solo ofrece Reactivar)", async ({ page, request }) => {
    const admin = await crearAdmin(request);
    await gastoApi(request, admin, { nota: "Cena" });
    await entrarRapido(page, admin);
    await abrirLista(page);
    await menu(page, "Acciones de Cena", "Anular");
    await page.getByRole("dialog", { name: "Anular gasto" }).getByRole("button", { name: "Anular", exact: true }).click();
    await page.getByLabel("Ver anulados").check();
    await expect(filaLista(page, "Cena")).toHaveAttribute("data-anulado", "true"); // esperar los datos nuevos
    await page.getByRole("button", { name: "Acciones de Cena", exact: true }).click();
    await expect(page.getByRole("menuitem")).toHaveText(["Reactivar", "Ver historial"]);
  });
});

test.describe("Apoyos y devoluciones: editar, anular y reactivar", () => {
  test("devolucion: editar el monto, anularla (vuelve a Pendiente) y reactivarla desde el aviso", async ({ page, request }) => {
    const admin = await crearAdmin(request);
    const apoyo = await apoyoApi(request, admin, { monto: 300 });
    await devolucionApi(request, admin, apoyo.id, 100);
    await entrarRapido(page, admin);
    await irA(page, "Apoyos");
    const t = tarjeta(page, "Tia Rosa");
    await expect(t).toContainText("Pendiente Bs 200.00");

    await menu(page, "Acciones de la devolución Bs 100.00", "Editar devolución");
    const ed = page.getByRole("dialog", { name: "Editar devolución" });
    await ed.getByLabel("Monto (Bs)").fill("120");
    await ed.getByRole("button", { name: "Guardar" }).click();
    await expect(t).toContainText("Pendiente Bs 180.00");

    await menu(page, "Acciones de la devolución Bs 120.00", "Anular devolución");
    await page.getByRole("dialog", { name: "Anular devolución" }).getByRole("button", { name: "Anular", exact: true }).click();
    await expect(t).toContainText("Pendiente Bs 300.00"); // la devolucion anulada no cuenta

    await page.getByRole("button", { name: "Reactivar", exact: true }).click();
    await expect(t).toContainText("Pendiente Bs 180.00");
  });

  test("la devolucion no puede dejar devuelto + consumido por encima del apoyo", async ({ page, request }) => {
    const admin = await crearAdmin(request);
    const apoyo = await apoyoApi(request, admin, { monto: 300 });
    await devolucionApi(request, admin, apoyo.id, 100);
    await entrarRapido(page, admin);
    await irA(page, "Apoyos");
    await menu(page, "Acciones de la devolución Bs 100.00", "Editar devolución");
    const ed = page.getByRole("dialog", { name: "Editar devolución" });
    await ed.getByLabel("Monto (Bs)").fill("300.01");
    await ed.getByRole("button", { name: "Guardar" }).click();
    await expect(ed.getByRole("alert")).toContainText("no pueden superar el apoyo (máximo Bs 300.00)");
  });

  test("anular un apoyo avisa de sus devoluciones, no cuenta en nada y al reactivarlo vuelve con su devolucion", async ({ page, request }) => {
    const admin = await crearAdmin(request);
    await ingresoApi(request, admin, 1000);
    const apoyo = await apoyoApi(request, admin, { monto: 300 });
    await devolucionApi(request, admin, apoyo.id, 100);
    await entrarRapido(page, admin);
    await expect(saldo(page)).toHaveText("Bs 800.00"); // 1000 - 300 + 100
    await irA(page, "Apoyos");

    await menu(page, "Acciones del apoyo Bs 300.00", "Anular apoyo");
    const dialogo = page.getByRole("dialog", { name: "Anular apoyo" });
    await expect(dialogo.getByTestId("detalle-anular")).toHaveText("Tia Rosa · Bs 300.00");
    await expect(dialogo.getByRole("alert")).toHaveText("Se anularán también 1 devolución.");
    await dialogo.getByLabel("Motivo (opcional)").fill("Error de digitacion");
    await dialogo.getByRole("button", { name: "Anular", exact: true }).click();
    await expect(page.getByText(/No hay apoyos pendientes ni apoyos de este periodo/)).toBeVisible();

    await irA(page, "Inicio");
    await expect(saldo(page)).toHaveText("Bs 1,000.00"); // ni el apoyo ni su devolucion cuentan
    await expect(page.getByText(/Apoyos pendientes/)).toHaveCount(0);

    await irA(page, "Apoyos");
    await page.getByLabel("Ver anulados").check();
    await expect(page.getByText("Apoyos anulados")).toBeVisible();
    await expect(page.getByTestId("fila-devolucion")).toHaveAttribute("data-anulado", "true");
    await menu(page, "Acciones del apoyo Bs 300.00", "Reactivar");
    await page.getByLabel("Ver anulados").uncheck();
    const t = tarjeta(page, "Tia Rosa");
    await expect(t).toContainText("Pendiente Bs 200.00"); // volvio con su devolucion
    await expect(page.getByTestId("fila-devolucion")).toHaveAttribute("data-anulado", "false");
    await irA(page, "Inicio");
    await expect(saldo(page)).toHaveText("Bs 800.00");
  });

  test("al reactivar un apoyo NO vuelve una devolucion que se habia anulado aparte", async ({ page, request }) => {
    const admin = await crearAdmin(request);
    const apoyo = await apoyoApi(request, admin, { monto: 300 });
    await devolucionApi(request, admin, apoyo.id, 100);
    const aparte = await devolucionApi(request, admin, apoyo.id, 50);
    await request.post(`http://localhost:8199/api/apoyos/${apoyo.id}/devoluciones/${aparte}/anular`, { headers: admin.headers, data: { motivo: "aparte" } });
    await entrarRapido(page, admin);
    await irA(page, "Apoyos");
    await menu(page, "Acciones del apoyo Bs 300.00", "Anular apoyo");
    await expect(page.getByRole("dialog").getByRole("alert")).toHaveText("Se anularán también 1 devolución."); // solo la activa
    await page.getByRole("dialog").getByRole("button", { name: "Anular", exact: true }).click();
    await page.getByLabel("Ver anulados").check();
    await expect(page.getByText("Apoyos anulados")).toBeVisible(); // esperar los datos nuevos antes de usar el menu
    await menu(page, "Acciones del apoyo Bs 300.00", "Reactivar");
    await page.getByLabel("Ver anulados").uncheck();
    await expect(tarjeta(page, "Tia Rosa")).toContainText("Pendiente Bs 200.00"); // 300 - 100 (la de 50 sigue anulada)
  });
});
