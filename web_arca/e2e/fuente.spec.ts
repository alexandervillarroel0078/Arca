// Fuente de pago (0010) de punta a punta con DOS usuarios: Beto paga con la cuenta de Ana (queda por confirmar), Ana
// confirma o rechaza desde la bandeja de Cuentas, y Beto ve el estado y el aviso. Más: cuenta propia directa y sin conexión.
import type { APIRequestContext, Page } from "@playwright/test";
import { API, categoriaId, crearAdmin, crearMiembro, entrarRapido, expect, irA, irAOpcionFamilia, nav, saldo, sinDesborde, test, type Sesion } from "./ayudas";

async function bancoApi(request: APIRequestContext, s: Sesion, nombre: string, saldoInicial = "1000") {
  const r = await request.post(`${API}/cuentas`, {
    headers: s.headers,
    data: { nombre, tipo: "corriente", moneda: "BS", banco: "Banco Unión", saldo_inicial: saldoInicial, visibilidad: "familia" },
  });
  expect(r.status(), await r.text()).toBe(201);
  return (await r.json()) as { id: number };
}
async function saldoCuentaApi(request: APIRequestContext, s: Sesion, id: number) {
  return ((await (await request.get(`${API}/cuentas/${id}`, { headers: s.headers })).json()) as { saldo: string }).saldo;
}

const hoja = (page: Page) => page.getByRole("dialog", { name: "¿Efectivo o Banco?" });

/** "+", Banco y la cuenta: abre Nuevo movimiento con esa fuente. */
async function nuevoConBanco(page: Page, cuenta: string) {
  await page.getByRole("link", { name: "Nuevo movimiento" }).click();
  await hoja(page).getByRole("button", { name: /Banco/ }).click();
  await hoja(page).getByTestId("opcion-cuenta").filter({ hasText: cuenta }).click();
  await expect(page.getByRole("heading", { name: "Nuevo movimiento" })).toBeVisible();
  await expect(page.getByTestId("chip-fuente")).toContainText(cuenta);
}

test.describe("Fuente de pago", () => {
  test("Beto paga con la cuenta de Ana: queda por confirmar, Ana lo confirma y recién ahí resta del saldo", async ({ page, request }) => {
    const ana = await crearAdmin(request);
    const beto = await crearMiembro(request, ana);
    const cuenta = await bancoApi(request, ana, "BNB de Ana");

    // Beto: la hoja se abre SOBRE Inicio (no es otra pantalla) y marca que la cuenta requiere confirmación
    await entrarRapido(page, beto);
    await page.getByRole("link", { name: "Nuevo movimiento" }).click();
    await expect(hoja(page)).toBeVisible();
    expect(new URL(page.url()).pathname).toBe("/");
    await hoja(page).getByRole("button", { name: /Banco/ }).click();
    await expect(hoja(page).getByTestId("opcion-cuenta").filter({ hasText: "BNB de Ana" })).toContainText("Requiere confirmación de Ana Admin");
    await sinDesborde(page);
    await hoja(page).getByTestId("opcion-cuenta").filter({ hasText: "BNB de Ana" }).click();
    await expect(page.getByTestId("aviso-confirmacion")).toContainText("Requiere confirmación de Ana Admin");
    await page.getByLabel("Monto").fill("100");
    await page.getByRole("radio", { name: /Comida/ }).click();
    await page.getByLabel("Nota (opcional)").fill("Mercado del sábado");
    await page.getByRole("button", { name: "Guardar" }).click();
    const fila = page.getByTestId("fila-inicio").filter({ hasText: "Mercado del sábado" });
    await expect(fila.getByTestId("etiqueta-fuente")).toHaveText(/Pendiente de confirmar · BNB de Ana/);
    expect(await saldoCuentaApi(request, ana, cuenta.id)).toBe("1000.00"); // todavía no resta

    // Ana: contador en Familia, bandeja arriba de Cuentas, confirmar (dice que toma la fecha y hora de ahora)
    await entrarRapido(page, ana);
    await expect(page.getByTestId("insignia-por-confirmar")).toHaveText("1");
    await irAOpcionFamilia(page, "Cuentas");
    const bandeja = page.getByTestId("bandeja-por-confirmar");
    const pago = bandeja.getByTestId("fila-por-confirmar");
    await expect(pago).toContainText("Gasto · Comida");
    await expect(pago).toContainText("de Beto Miembro");
    await expect(pago).not.toContainText("Mercado del sábado"); // la nota nunca pasa a Cuentas
    await pago.getByRole("button", { name: "Confirmar" }).click();
    const dialogo = page.getByRole("dialog", { name: "Confirmar pago" });
    await expect(dialogo).toContainText("con la fecha y hora de ahora");
    await dialogo.getByRole("button", { name: "Confirmar" }).click();
    await expect(page.getByText("Pago confirmado")).toBeVisible();
    await expect(bandeja).toHaveCount(0);
    await expect(page.getByTestId("insignia-por-confirmar")).toHaveCount(0);
    expect(await saldoCuentaApi(request, ana, cuenta.id)).toBe("900.00");

    // en la cuenta: fila de solo lectura con enlace al gasto
    await page.getByTestId("fila-cuenta").filter({ hasText: "BNB de Ana" }).click();
    const mov = page.getByTestId("fila-movimiento").first();
    await expect(mov).toContainText("Retiro · Gasto");
    await expect(mov).toContainText("solo lectura");
    await expect(mov.getByRole("link", { name: "Ver gasto" })).toBeVisible();

    // Beto ve el gasto confirmado
    await entrarRapido(page, beto);
    await expect(page.getByTestId("fila-inicio").filter({ hasText: "Mercado del sábado" }).getByTestId("etiqueta-fuente"))
      .toHaveText(/Confirmado · BNB de Ana/);
  });

  test("Ana rechaza: el gasto de Beto vuelve a Efectivo (no se anula) y Beto recibe el aviso con «Cambiar fuente»", async ({ page, request }) => {
    const ana = await crearAdmin(request);
    const beto = await crearMiembro(request, ana);
    const cuenta = await bancoApi(request, ana, "BNB de Ana");
    const cat = await categoriaId(request, beto, "Comida");
    const r = await request.post(`${API}/movimientos`, {
      headers: beto.headers, data: { tipo: "gasto", monto: 75, categoria_id: cat, nota: "Farmacia", cuenta_id: cuenta.id },
    });
    expect(r.status(), await r.text()).toBe(201);

    await entrarRapido(page, ana);
    await irAOpcionFamilia(page, "Cuentas");
    await page.getByTestId("fila-por-confirmar").getByRole("button", { name: "Rechazar" }).click();
    const dialogo = page.getByRole("dialog", { name: "Rechazar pago" });
    await expect(dialogo).toContainText("no se anula: pasa a Efectivo");
    await dialogo.getByLabel("Motivo (opcional)").fill("No era de esta cuenta");
    await dialogo.getByRole("button", { name: "Rechazar" }).click();
    await expect(page.getByText("Pago rechazado: el registro pasó a Efectivo")).toBeVisible();
    expect(await saldoCuentaApi(request, ana, cuenta.id)).toBe("1000.00");

    await entrarRapido(page, beto);
    const aviso = page.getByTestId("aviso-rechazo");
    await expect(aviso).toContainText("Ana Admin rechazó el pago con BNB de Ana de tu gasto de Bs 75.00");
    await expect(aviso).toContainText("No era de esta cuenta");
    const fila = page.getByTestId("fila-inicio").filter({ hasText: "Farmacia" });
    await expect(fila.getByTestId("etiqueta-fuente")).toHaveText(/Rechazado por Ana Admin · ahora Efectivo/);
    await expect(fila).not.toHaveAttribute("data-anulado", "true");
    await expect(saldo(page)).toHaveText("-Bs 75.00"); // ahora sale del efectivo

    await aviso.getByRole("button", { name: "Cambiar fuente" }).click();
    await expect(page.getByRole("heading", { name: "Editar movimiento" })).toBeVisible();
    await expect(hoja(page)).toBeVisible(); // la hoja se abre sola para elegir otra fuente
    await hoja(page).getByRole("button", { name: "Cerrar hoja" }).click();
    await expect(page.getByTestId("chip-fuente")).toContainText("Efectivo");
    await nav(page, "Inicio").click();
    await expect(page.getByTestId("aviso-rechazo")).toHaveCount(0); // cerrado: no se repite
  });

  test("con su propia cuenta se registra directo y la tarjeta de Inicio cuadra con «Pagado con banco»", async ({ page, request }) => {
    const ana = await crearAdmin(request);
    const cuenta = await bancoApi(request, ana, "Mi Unión");
    await entrarRapido(page, ana);
    await nuevoConBanco(page, "Mi Unión");
    await expect(page.getByTestId("aviso-confirmacion")).toHaveCount(0);
    await page.getByLabel("Monto").fill("250");
    await page.getByRole("radio", { name: /Comida/ }).click();
    await page.getByRole("button", { name: "Guardar" }).click();
    await expect(page.getByTestId("fila-inicio").first().getByTestId("etiqueta-fuente")).toHaveText(/Confirmado · Mi Unión/);
    await expect(saldo(page)).toHaveText("Bs 0.00"); // no salió del efectivo
    await expect(page.getByTestId("cuadre-saldo")).toContainText("Pagado con banco");
    expect(await saldoCuentaApi(request, ana, cuenta.id)).toBe("750.00");

    // la próxima vez la hoja recuerda la última cuenta usada
    await page.getByRole("link", { name: "Nuevo movimiento" }).click();
    await expect(hoja(page).getByTestId("opcion-cuenta").filter({ hasText: "Mi Unión" })).toContainText("Última usada");
  });

  test("sin conexión Banco está deshabilitado: solo Efectivo", async ({ page, context, request }) => {
    const ana = await crearAdmin(request);
    await bancoApi(request, ana, "Mi Unión");
    await entrarRapido(page, ana);
    await context.setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event("offline")));
    await page.getByRole("link", { name: "Nuevo movimiento" }).click();
    await expect(hoja(page).getByRole("button", { name: /Banco/ })).toBeDisabled();
    await expect(hoja(page)).toContainText("Sin conexión: solo efectivo");
    await hoja(page).getByRole("button", { name: /Efectivo/ }).click();
    await expect(page.getByTestId("chip-fuente")).toContainText("Efectivo");
    await context.setOffline(false);
  });

  test("Reportes: el filtro Banco solo muestra lo pagado con banco", async ({ page, request }) => {
    const ana = await crearAdmin(request);
    const cuenta = await bancoApi(request, ana, "Mi Unión");
    const cat = await categoriaId(request, ana, "Comida");
    for (const extra of [{}, { cuenta_id: cuenta.id }]) {
      const r = await request.post(`${API}/movimientos`, { headers: ana.headers, data: { tipo: "gasto", monto: 100, categoria_id: cat, ...extra } });
      expect(r.status()).toBe(201);
    }
    await entrarRapido(page, ana);
    await irA(page, "Reportes");
    const filtro = page.getByRole("radiogroup", { name: "Fuente de pago" });
    await expect(page.getByTestId("fila-mes").last()).toContainText("Pagado con banco Bs 100.00 (incluido en gastos)");
    await filtro.getByRole("radio", { name: "Banco" }).click();
    await expect(filtro.getByRole("radio", { name: "Banco" })).toHaveAttribute("aria-checked", "true");
    await expect(page.getByTestId("saldo-efectivo-reportes")).toHaveCount(0);
    await sinDesborde(page);
  });
});
