import type { Page } from "@playwright/test";
import { apoyoApi, crearAdmin, crearMiembro, devolucionApi, entrarRapido, expect, gastoApi, ingresoApi, irA, test, API } from "./ayudas";

const resumen = (page: Page) => page.getByRole("heading", { name: "Resumen" }).locator("xpath=ancestor::div[contains(@class,'rounded-tarjeta')][1]");

test.describe("Reportes", () => {
  test("el resumen del mes cuadra con lo registrado: saldo = ingresos - gastos - apoyos + devoluciones, y el consumido aparte", async ({ page, request }) => {
    const admin = await crearAdmin(request);
    const beto = await crearMiembro(request, admin, { nombre: "Beto Miembro" });
    await ingresoApi(request, admin, 1000);
    await gastoApi(request, admin, { monto: 100, categoria: "Comida" });
    await gastoApi(request, beto, { monto: 50, categoria: "Transporte" });
    const apoyo = await apoyoApi(request, admin, { monto: 200 });
    await devolucionApi(request, admin, apoyo.id, 50);
    await request.post(`${API}/apoyos/${apoyo.id}/consumir`, { headers: admin.headers, data: {} }); // consume 150

    await entrarRapido(page, admin);
    await irA(page, "Reportes");
    const r = resumen(page);
    await expect(r).toContainText("Bs 1,000.00"); // ingresos
    await expect(r.getByText("Gastos").locator("xpath=following-sibling::*[1]")).toHaveText("-Bs 150.00");
    await expect(r.getByText("Apoyos entregados").locator("xpath=following-sibling::*[1]")).toHaveText("-Bs 200.00");
    await expect(r.getByText("Devoluciones").locator("xpath=following-sibling::*[1]")).toHaveText("Bs 50.00");
    await expect(r.getByText("Saldo de efectivo").locator("xpath=following-sibling::*[1]")).toHaveText("Bs 700.00"); // 1000-150-200+50
    await expect(r.getByText("Apoyos consumidos (gasto familiar)").locator("xpath=following-sibling::*[1]")).toHaveText("Bs 150.00");

    const cat = page.getByRole("heading", { name: "Gastos por categoría" }).locator("xpath=ancestor::div[contains(@class,'rounded-tarjeta')][1]");
    await expect(cat).toContainText("Comida");
    await expect(cat).toContainText("(66.7%)");
    await expect(cat).toContainText("Transporte");
    await expect(cat).toContainText("(33.3%)");
    await expect(cat).toContainText("Apoyos consumidos (aparte)");

    const persona = page.getByRole("heading", { name: "Por persona" }).locator("xpath=ancestor::div[contains(@class,'rounded-tarjeta')][1]");
    await expect(persona).toContainText("Ingresos Bs 1,000.00 · Gastos Bs 100.00 · Apoyos Bs 200.00"); // Ana
    await expect(persona).toContainText("Ingresos Bs 0.00 · Gastos Bs 50.00 · Apoyos Bs 0.00"); // Beto
    await expect(page.getByTestId("fila-mes")).toHaveCount(6);
  });

  test("lo anulado no cuenta en el reporte y cambiar de mes muestra el mes vacio", async ({ page, request }) => {
    const admin = await crearAdmin(request);
    await ingresoApi(request, admin, 500);
    const g = await gastoApi(request, admin, { monto: 200 });
    await request.post(`${API}/movimientos/${g.id}/anular`, { headers: admin.headers, data: {} });
    await entrarRapido(page, admin);
    await irA(page, "Reportes");
    await expect(resumen(page).getByText("Saldo de efectivo").locator("xpath=following-sibling::*[1]")).toHaveText("Bs 500.00");
    await expect(page.getByText("Sin gastos en este periodo.")).toBeVisible(); // el gasto anulado no aparece

    await expect(page.getByLabel("Periodo siguiente")).toBeDisabled(); // no hay futuro
    await page.getByLabel("Periodo anterior").click();
    await expect(resumen(page).getByText("Saldo de efectivo").locator("xpath=following-sibling::*[1]")).toHaveText("Bs 0.00");
    await page.getByLabel("Periodo siguiente").click();
    await expect(resumen(page).getByText("Saldo de efectivo").locator("xpath=following-sibling::*[1]")).toHaveText("Bs 500.00");
  });
});
