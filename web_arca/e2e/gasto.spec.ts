import {
  alturaMinima, crearAdmin, entrarRapido, expect, filaLista, abrirLista, movimientosApi, saldo, sinDesborde, test,
} from "./ayudas";

test.describe("Crear gastos e ingresos", () => {
  test("crear un gasto: queda registrado, baja el saldo y se ve en los ultimos movimientos (en menos de 5 s)", async ({ page, request }) => {
    const admin = await crearAdmin(request);
    await entrarRapido(page, admin);
    await expect(saldo(page)).toHaveText("Bs 0.00");

    const inicio = Date.now();
    await page.getByRole("link", { name: "Nuevo movimiento" }).click();
    await page.getByLabel("Monto").fill("45.50");
    await page.getByRole("radio", { name: /Comida/ }).click();
    await page.getByLabel("Nota (opcional)").fill("Almuerzo");
    await page.getByRole("button", { name: "Guardar" }).click();
    await expect(page.getByText("Guardado", { exact: true })).toBeVisible();
    expect(Date.now() - inicio, "meta del SPEC: registrar en 5 segundos").toBeLessThan(5000);

    await expect(saldo(page)).toHaveText("-Bs 45.50");
    await expect(page.getByText("Almuerzo", { exact: true })).toBeVisible();
    await expect(page.getByText("Comida · Ana Admin · Hoy")).toBeVisible();

    const guardados = await movimientosApi(request, admin);
    expect(guardados).toHaveLength(1);
    expect(guardados[0]).toMatchObject({ monto: 45.5, nota: "Almuerzo", anulado: false });
  });

  test("crear un ingreso: sube el saldo y no pide categoria", async ({ page, request }) => {
    const admin = await crearAdmin(request);
    await entrarRapido(page, admin);
    await page.getByRole("link", { name: "Nuevo movimiento" }).click();
    await page.getByRole("tab", { name: "Ingreso" }).click();
    await expect(page.getByRole("radiogroup", { name: "Categoría" })).toHaveCount(0);
    await page.getByLabel("Monto").fill("1000");
    await page.getByLabel("Nota (opcional)").fill("Sueldo");
    await page.getByRole("button", { name: "Guardar" }).click();
    await expect(saldo(page)).toHaveText("Bs 1,000.00");
    await expect(page.getByText("+Bs 1,000.00")).toBeVisible();
  });

  test("el saldo suma ingresos y resta gastos (coma decimal incluida)", async ({ page, request }) => {
    const admin = await crearAdmin(request);
    await entrarRapido(page, admin);
    for (const [tipo, monto] of [["Ingreso", "1000"], ["Gasto", "45,25"], ["Gasto", "54.75"]] as const) {
      await page.getByRole("link", { name: "Nuevo movimiento" }).click();
      await page.getByRole("tab", { name: tipo }).click();
      await page.getByLabel("Monto").fill(monto);
      if (tipo === "Gasto") await page.getByRole("radio", { name: /Transporte/ }).click();
      await page.getByRole("button", { name: "Guardar" }).click();
      await expect(page.getByRole("link", { name: "Nuevo movimiento" })).toBeVisible();
    }
    await expect(saldo(page)).toHaveText("Bs 900.00"); // 1000 - 45.25 - 54.75
    const r = page.getByLabel("Saldo del periodo");
    await expect(r).toContainText("Bs 1,000.00");
    await expect(r).toContainText("Bs 100.00"); // gastos
  });

  test("las validaciones impiden guardar y no crean nada", async ({ page, request }) => {
    const admin = await crearAdmin(request);
    await entrarRapido(page, admin);
    await page.getByRole("link", { name: "Nuevo movimiento" }).click();
    await page.getByRole("button", { name: "Guardar" }).click();
    await expect(page.getByRole("alert")).toHaveText("Escribe un monto mayor a cero");
    await page.getByLabel("Monto").fill("10");
    await page.getByRole("button", { name: "Guardar" }).click();
    await expect(page.getByRole("alert")).toHaveText("Elige una categoría");
    await page.getByLabel("Monto").fill("10.999");
    await page.getByRole("radio", { name: /Comida/ }).click();
    await page.getByRole("button", { name: "Guardar" }).click();
    await expect(page.getByRole("alert")).toHaveText("El monto admite hasta 2 decimales");
    await page.getByRole("tab", { name: "Apoyo" }).click();
    await page.getByLabel("Monto").fill("100");
    await page.getByRole("button", { name: "Guardar" }).click();
    await expect(page.getByRole("alert")).toHaveText("Escribe quién recibe el apoyo");
    expect(await movimientosApi(request, admin)).toHaveLength(0);
  });

  test("la pantalla es tactil: categorias, pestanas y boton miden 44px o mas, sin desborde a 390px", async ({ page, request }) => {
    const admin = await crearAdmin(request);
    await entrarRapido(page, admin);
    await page.getByRole("link", { name: "Nuevo movimiento" }).click();
    await expect(page.getByRole("radio", { name: /Comida/ })).toBeVisible();
    await alturaMinima(page.getByRole("radio"));
    await alturaMinima(page.getByRole("tab"));
    await alturaMinima(page.getByRole("button", { name: "Guardar" }));
    await alturaMinima(page.getByLabel("Fecha"));
    await sinDesborde(page);
  });

  test("lo que se crea aparece en la lista completa con su fecha y quien lo hizo", async ({ page, request }) => {
    const admin = await crearAdmin(request);
    await entrarRapido(page, admin);
    await page.getByRole("link", { name: "Nuevo movimiento" }).click();
    await page.getByLabel("Monto").fill("12");
    await page.getByRole("radio", { name: /Antojos/ }).click();
    await page.getByLabel("Nota (opcional)").fill("Helado");
    await page.getByRole("button", { name: "Guardar" }).click();
    await expect(saldo(page)).toHaveText("-Bs 12.00");
    await abrirLista(page);
    const fila = filaLista(page, "Helado");
    await expect(fila).toContainText("Antojos · Ana Admin · Hoy");
    await expect(fila).toContainText("-Bs 12.00");
    await expect(page.getByTestId("total-lista")).toHaveText("1 registro");
  });
});
