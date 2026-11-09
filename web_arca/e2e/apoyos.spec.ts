import { apoyoApi, crearAdmin, devolucionApi, entrarRapido, expect, irA, menu, saldo, sinDesborde, test } from "./ayudas";

const tarjeta = (page: import("@playwright/test").Page, nombre: string) =>
  page.getByRole("heading", { name: nombre }).locator("xpath=ancestor::div[contains(@class,'rounded-tarjeta')][1]");

test.describe("Apoyos: crear, devolver, consumir y reabrir", () => {
  test("crear un apoyo desde Nuevo movimiento: queda Pendiente y resta del saldo", async ({ page, request }) => {
    const admin = await crearAdmin(request);
    await entrarRapido(page, admin);
    await page.getByRole("link", { name: "Nuevo movimiento" }).click();
    await page.getByRole("tab", { name: "Apoyo" }).click();
    await page.getByLabel("Monto").fill("300");
    await page.getByLabel(/Beneficiario/).fill("Tia Rosa");
    await page.getByRole("button", { name: "Guardar" }).click();
    await expect(saldo(page)).toHaveText("-Bs 300.00");
    await expect(page.getByText("Apoyos pendientes: Bs 300.00")).toBeVisible();

    await irA(page, "Apoyos");
    const t = tarjeta(page, "Tia Rosa");
    await expect(t.getByText("Pendiente", { exact: true })).toBeVisible();
    await expect(t).toContainText("Pendiente Bs 300.00");
    await expect(t.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "0");
  });

  test("devoluciones: parcial deja Pendiente; completa lo deja Saldado y retira las acciones", async ({ page, request }) => {
    const admin = await crearAdmin(request);
    await apoyoApi(request, admin, { beneficiario: "Tia Rosa", monto: 300 });
    await entrarRapido(page, admin);
    await irA(page, "Apoyos");
    const t = tarjeta(page, "Tia Rosa");

    await t.getByRole("button", { name: "Registrar devolución" }).click();
    await t.getByLabel("Monto devuelto (Bs)").fill("100");
    await t.getByRole("button", { name: "Guardar" }).click();
    await expect(t).toContainText("Pendiente Bs 200.00");
    await expect(t.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "33");

    await t.getByRole("button", { name: "Registrar devolución" }).click();
    await expect(t.getByLabel("Monto devuelto (Bs)")).toHaveValue("200"); // sugiere lo que falta
    await t.getByRole("button", { name: "Guardar" }).click();
    await expect(t.getByText("Saldado", { exact: true })).toBeVisible();
    await expect(t.getByRole("button", { name: "Registrar devolución" })).toHaveCount(0);
    await expect(t.getByRole("button", { name: "Marcar consumido" })).toHaveCount(0);
    await expect(t.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");

    // una devolucion NO es ingreso: el saldo del mes solo refleja el apoyo entregado y lo devuelto
    await irA(page, "Inicio");
    await expect(saldo(page)).toHaveText("Bs 0.00"); // -300 entregado + 300 devuelto
  });

  test("no se puede devolver mas de lo pendiente", async ({ page, request }) => {
    const admin = await crearAdmin(request);
    await apoyoApi(request, admin, { monto: 300 });
    await entrarRapido(page, admin);
    await irA(page, "Apoyos");
    const t = tarjeta(page, "Tia Rosa");
    await t.getByRole("button", { name: "Registrar devolución" }).click();
    await t.getByLabel("Monto devuelto (Bs)").fill("300.01");
    await t.getByRole("button", { name: "Guardar" }).click();
    await expect(t.getByRole("alert")).toHaveText("No puede superar lo pendiente (Bs 300.00)");
    await expect(t).toContainText("Pendiente Bs 300.00");
  });

  test("marcar consumido cierra el apoyo (cuenta como gasto familiar, aparte) y 'Reabrir apoyo' lo devuelve a Pendiente", async ({ page, request }) => {
    const admin = await crearAdmin(request);
    const apoyo = await apoyoApi(request, admin, { beneficiario: "Primo Pedro", monto: 400 });
    await devolucionApi(request, admin, apoyo.id, 100);
    await entrarRapido(page, admin);
    await irA(page, "Apoyos");
    const t = tarjeta(page, "Primo Pedro");

    await t.getByRole("button", { name: "Marcar consumido" }).click();
    await page.getByRole("dialog", { name: "Marcar consumido" }).getByRole("button", { name: "Confirmar" }).click();
    await expect(t.getByText("Cerrado", { exact: true })).toBeVisible();
    await expect(t).toContainText("Consumido Bs 300.00");
    await expect(t.getByRole("button", { name: "Marcar consumido" })).toHaveCount(0);

    await irA(page, "Inicio");
    await expect(page.getByText(/Apoyos consumidos \(gasto familiar, aparte\): Bs 300.00/)).toBeVisible();
    await expect(saldo(page)).toHaveText("-Bs 300.00"); // el consumido no cambia el efectivo: 400 entregado - 100 devuelto

    await irA(page, "Apoyos");
    await menu(page, "Acciones del apoyo Bs 400.00", "Reabrir apoyo");
    await expect(t.getByText("Pendiente", { exact: true })).toBeVisible();
    await expect(t).toContainText("Pendiente Bs 300.00");
    await expect(t.getByRole("button", { name: "Marcar consumido" })).toBeVisible();
  });

  test("editar un apoyo: el monto no baja de lo devuelto y consumido; al subirlo la diferencia queda pendiente", async ({ page, request }) => {
    const admin = await crearAdmin(request);
    const apoyo = await apoyoApi(request, admin, { monto: 500 });
    await devolucionApi(request, admin, apoyo.id, 200);
    await entrarRapido(page, admin);
    await irA(page, "Apoyos");

    await menu(page, "Acciones del apoyo Bs 500.00", "Editar apoyo");
    await expect(page.getByRole("heading", { name: "Editar apoyo" })).toBeVisible();
    await expect(page.getByRole("tab")).toHaveCount(0);
    await page.getByLabel("Monto").fill("150");
    await page.getByRole("button", { name: "Guardar cambios" }).click();
    await expect(page.getByRole("alert")).toContainText("lo ya devuelto y consumido (Bs 200.00)");

    await page.getByLabel("Monto").fill("600");
    await page.getByLabel(/Beneficiario/).fill("Rosa Mamani");
    await page.getByRole("button", { name: "Guardar cambios" }).click();
    await expect(page.getByRole("heading", { name: "Apoyos", exact: true })).toBeVisible(); // volvio a donde estaba
    const t = tarjeta(page, "Rosa Mamani");
    await expect(t).toContainText("Pendiente Bs 400.00"); // 600 - 200
  });

  test("varios apoyos al mismo beneficiario se agrupan y la devolucion se reparte del mas antiguo al mas nuevo", async ({ page, request }) => {
    const admin = await crearAdmin(request);
    const a1 = await apoyoApi(request, admin, { beneficiario: "Tia Rosa", monto: 100 });
    await apoyoApi(request, admin, { beneficiario: "tia rosa", monto: 150 });
    await entrarRapido(page, admin);
    await irA(page, "Apoyos");
    const t = tarjeta(page, "Tia Rosa");
    await expect(t).toContainText("2 apoyos");
    await expect(t).toContainText("Pendiente Bs 250.00");
    await t.getByRole("button", { name: "Registrar devolución" }).click();
    await t.getByLabel("Monto devuelto (Bs)").fill("180");
    await t.getByRole("button", { name: "Guardar" }).click();
    await expect(t).toContainText("Pendiente Bs 70.00");
    const lista = (await (await request.get("http://localhost:8199/api/apoyos", { headers: admin.headers })).json()) as { id: number; devuelto: number }[];
    expect(lista.find((a) => a.id === a1.id)!.devuelto).toBe(100); // el mas antiguo se cubrio completo
    expect(lista.find((a) => a.id !== a1.id)!.devuelto).toBe(80);
    await sinDesborde(page);
  });
});
