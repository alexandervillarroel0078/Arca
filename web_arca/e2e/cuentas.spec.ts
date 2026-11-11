// Cuentas (etapa 3): crear una cuenta y registrar depósito, retiro, traspaso y ajuste desde la pantalla; lo privado no lo ve
// nadie más (ni el admin); saldo negativo; permisos que salen de la API; el servidor manda; filtro «Cuentas» en historial y bitácora.
import type { APIRequestContext, Page } from "@playwright/test";
import { API, alturaMinima, crearAdmin, crearMiembro, entrarRapido, expect, irAOpcionFamilia, nav, sinDesborde, test, type Sesion } from "./ayudas";

async function cuentaApi(request: APIRequestContext, s: Sesion, datos: Record<string, unknown> = {}) {
  const r = await request.post(`${API}/cuentas`, {
    headers: s.headers, data: { nombre: "Caja", tipo: "efectivo", moneda: "BS", saldo_inicial: "0", ...datos },
  });
  expect(r.status(), await r.text()).toBe(201);
  return (await r.json()) as { id: number; version: number };
}
async function depositoApi(request: APIRequestContext, s: Sesion, cuenta: number, monto: string, extra: Record<string, unknown> = {}) {
  const r = await request.post(`${API}/cuentas/${cuenta}/depositos`, { headers: s.headers, data: { monto, ...extra } });
  expect(r.status(), await r.text()).toBe(201);
  return (await r.json()) as { id: number };
}

const saldoCuenta = (page: Page) => page.getByTestId("saldo-cuenta").first();
const registrarEnEstaCuenta = (page: Page) => page.getByRole("link", { name: "Registrar en esta cuenta" });
const guardar = (page: Page) => page.getByRole("button", { name: /^Guardar/ });

/** Entra a Cuentas por el menú Familia y abre una cuenta de la lista. */
async function abrirCuenta(page: Page, nombre: string) {
  await irAOpcionFamilia(page, "Cuentas");
  await page.getByTestId("fila-cuenta").filter({ hasText: nombre }).click();
  await expect(page.getByRole("heading", { name: nombre, exact: true })).toBeVisible();
}

test.describe("Cuentas", () => {
  test("crear una cuenta y registrar depósito, retiro, traspaso y ajuste", async ({ page, request }) => {
    const ana = await crearAdmin(request);
    await cuentaApi(request, ana, { nombre: "Ahorro Unión", tipo: "ahorro", banco: "Banco Unión", ultimos4: "4821", saldo_inicial: "10" });
    await entrarRapido(page, ana);

    // Familia > Cuentas, y la pestaña Familia sigue marcada
    await irAOpcionFamilia(page, "Cuentas");
    await expect(nav(page, "Familia")).toHaveAttribute("aria-current", "page");
    await expect(page.getByTestId("fila-cuenta").filter({ hasText: "Banco Unión · Caja de ahorro · •••• 4821" })).toBeVisible();
    await sinDesborde(page);

    // Nueva cuenta de efectivo (sin banco ni últimos 4 dígitos)
    await page.getByRole("link", { name: "Nueva cuenta" }).click();
    await expect(page.getByLabel("Banco")).toHaveCount(0);
    await page.getByLabel("Nombre de la cuenta").fill("Efectivo casa");
    await page.getByLabel(/Saldo inicial/).fill("100");
    await page.getByRole("button", { name: "Crear cuenta" }).click();
    await expect(page.getByRole("heading", { name: "Efectivo casa", exact: true })).toBeVisible();
    await expect(saldoCuenta(page)).toHaveText("Bs 100.00");

    // Depósito de 50
    await registrarEnEstaCuenta(page).click();
    await expect(page.getByTestId("aviso-nota")).toContainText("No escribas claves ni frases semilla");
    await expect(page.getByRole("button", { name: /Dictar movimiento/ })).toBeVisible(); // el dictado solo rellena: aquí se llena a mano
    await page.getByLabel("Monto (Bs)").fill("50");
    await page.getByLabel("Nota (opcional)").fill("Pago del almacén");
    await guardar(page).click();
    await expect(page.getByTestId("mes-cuenta")).toBeVisible();
    await expect(saldoCuenta(page)).toHaveText("Bs 150.00");
    await expect(page.getByTestId("fila-movimiento").filter({ hasText: "Pago del almacén" })).toContainText("+Bs 50.00");

    // Retiro de 20 con el botón de monto rápido y una persona
    await registrarEnEstaCuenta(page).click();
    await page.getByRole("radio", { name: "Retiro" }).click();
    await page.getByRole("button", { name: "200", exact: true }).click();
    await page.getByLabel("Monto (Bs)").fill("20");
    await page.getByRole("radio", { name: "Otra persona" }).click();
    await page.getByLabel("Nombre de la otra persona").fill("Tía Rosa");
    await guardar(page).click();
    await expect(saldoCuenta(page)).toHaveText("Bs 130.00");
    await expect(page.getByTestId("fila-movimiento").filter({ hasText: "Tía Rosa" })).toContainText("-Bs 20.00");

    // Traspaso de 30 hacia la otra cuenta (solo ofrece cuentas de la misma moneda)
    await registrarEnEstaCuenta(page).click();
    await page.getByRole("radio", { name: "Traspaso" }).click();
    await expect(page.getByLabel("Hacia").locator("option")).toHaveCount(2); // «Elige…» + Ahorro Unión
    await page.getByLabel("Hacia").selectOption({ index: 1 });
    await page.getByLabel("Monto (Bs)").fill("30");
    await guardar(page).click();
    await expect(saldoCuenta(page)).toHaveText("Bs 100.00");

    // Ajuste por conteo: se muestra la diferencia ANTES de guardar
    await registrarEnEstaCuenta(page).click();
    await page.getByRole("radio", { name: "Ajuste por conteo" }).click();
    await page.getByLabel(/Saldo real contado/).fill("90");
    await expect(page.getByTestId("diferencia-ajuste")).toContainText("Saldo registrado: Bs 100.00");
    await expect(page.getByTestId("diferencia-ajuste")).toContainText("−Bs 10.00");
    await guardar(page).click();
    await expect(saldoCuenta(page)).toHaveText("Bs 90.00");

    // Entró / Salió del mes, con traspasos y ajustes aparte
    await expect(page.getByTestId("entro")).toHaveText("Bs 50.00");
    await expect(page.getByTestId("salio")).toHaveText("Bs 20.00");
    await expect(page.getByTestId("aparte")).toContainText("traspasos -Bs 30.00");
    await expect(page.getByTestId("aparte")).toContainText("ajustes por conteo -Bs 10.00");
    await expect(page.getByTestId("fila-movimiento")).toHaveCount(4);

    // La cuenta destino recibió el MISMO monto, y el inicio suma por moneda
    await page.goto("/cuentas");
    await expect(page.getByTestId("total-BS")).toContainText("Bs 130.00"); // 90 + 40: el traspaso no crea ni destruye dinero
    await expect(page.getByTestId("fila-cuenta").filter({ hasText: "Ahorro Unión" })).toContainText("Bs 40.00");
    await alturaMinima(page.getByRole("link", { name: /^(Nueva cuenta|Registrar movimiento)$/ }));
  });

  test("anular y reactivar un movimiento actualiza el saldo", async ({ page, request }) => {
    const ana = await crearAdmin(request);
    const c = await cuentaApi(request, ana, { nombre: "Caja chica", saldo_inicial: "100" });
    await depositoApi(request, ana, c.id, "40", { nota: "Venta" });
    await entrarRapido(page, ana);
    await abrirCuenta(page, "Caja chica");
    await expect(saldoCuenta(page)).toHaveText("Bs 140.00");
    await page.getByTestId("fila-movimiento").filter({ hasText: "Venta" }).getByRole("button", { name: "Anular" }).click();
    await page.getByRole("dialog", { name: "Anular movimiento" }).getByRole("button", { name: "Anular", exact: true }).click();
    await expect(saldoCuenta(page)).toHaveText("Bs 100.00");
    await page.getByRole("switch", { name: "Ver anulados" }).check({ force: true });
    await page.getByTestId("fila-movimiento").filter({ hasText: "Venta" }).getByRole("button", { name: "Reactivar" }).click();
    await expect(saldoCuenta(page)).toHaveText("Bs 140.00");
  });

  test("una cuenta «solo yo» no la ve nadie más, ni el admin: ni en la lista, ni por URL", async ({ page, request }) => {
    const ana = await crearAdmin(request);
    const beto = await crearMiembro(request, ana, { nombre: "Beto Miembro" });
    const privada = await cuentaApi(request, beto, { nombre: "Ahorro secreto de Beto", visibilidad: "solo_yo", saldo_inicial: "500" });
    const publica = await cuentaApi(request, ana, { nombre: "Caja de la familia", visibilidad: "familia", saldo_inicial: "20" });

    // Ana es admin y NO la ve
    await entrarRapido(page, ana);
    await irAOpcionFamilia(page, "Cuentas");
    await expect(page.getByTestId("fila-cuenta").filter({ hasText: "Caja de la familia" })).toBeVisible();
    await expect(page.getByText("Ahorro secreto de Beto")).toHaveCount(0);
    await expect(page.getByTestId("total-BS")).toContainText("Bs 20.00"); // el total no suma lo privado de otro
    await page.goto(`/cuentas/${privada.id}`);
    await expect(page.getByRole("alert")).toContainText("Cuenta no encontrada");
    await expect(page.getByText("Ahorro secreto de Beto")).toHaveCount(0);

    // Beto sí la ve, con su aviso de cuentas privadas, y ve la de la familia sin poder registrar ni editar
    await entrarRapido(page, beto);
    await irAOpcionFamilia(page, "Cuentas");
    await expect(page.getByTestId("total-BS")).toContainText("Bs 520.00");
    await expect(page.getByTestId("aviso-privadas")).toContainText("Incluye tus 1 cuenta privada");
    await page.goto(`/cuentas/${publica.id}`);
    await expect(page.getByRole("heading", { name: "Caja de la familia", exact: true })).toBeVisible();
    await expect(registrarEnEstaCuenta(page)).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Editar" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Anular cuenta" })).toHaveCount(0);
  });

  test("saldo negativo: se permite, se ve en rojo con aviso y no bloquea", async ({ page, request }) => {
    const ana = await crearAdmin(request);
    const c = await cuentaApi(request, ana, { nombre: "Caja justa", saldo_inicial: "10" });
    await entrarRapido(page, ana);
    await page.goto(`/cuentas/movimiento?cuenta=${c.id}&tipo=retiro`);
    await page.getByLabel("Monto (Bs)").fill("25");
    await expect(page.getByTestId("aviso-negativo")).toContainText("quedará en negativo");
    await guardar(page).click(); // no se bloquea
    await expect(page.getByRole("heading", { name: "Caja justa", exact: true })).toBeVisible();
    await expect(saldoCuenta(page)).toContainText("-Bs 15.00");
    await expect(saldoCuenta(page)).toHaveAttribute("data-negativo", "true");
    await expect(saldoCuenta(page)).toHaveCSS("color", "rgb(185, 28, 28)");
    await expect(page.getByTestId("aviso-negativo")).toContainText("Saldo en negativo");
    await expect(registrarEnEstaCuenta(page)).toBeVisible(); // sigue pudiendo registrar
    await page.goto("/cuentas");
    await expect(page.getByTestId("total-BS")).toContainText("-Bs 15.00");
    await expect(page.getByTestId("total-BS")).toContainText("alguna en negativo");
  });

  test("el encargado registra pero no edita; el servidor manda: si le quitan el permiso, la pantalla se actualiza", async ({ page, request }) => {
    const ana = await crearAdmin(request);
    const beto = await crearMiembro(request, ana, { nombre: "Beto Miembro" });
    const c = await cuentaApi(request, ana, { nombre: "Caja compartida", visibilidad: "familia", encargado_id: beto.id, saldo_inicial: "50" });
    const dep = await depositoApi(request, ana, c.id, "5", { nota: "Del dueño" });
    expect(dep.id).toBeGreaterThan(0);

    await entrarRapido(page, beto);
    await page.goto(`/cuentas/${c.id}`);
    await expect(registrarEnEstaCuenta(page)).toBeVisible(); // encargado: registra
    await expect(page.getByRole("link", { name: "Editar" })).toHaveCount(0); // pero no edita
    await expect(page.getByRole("button", { name: "Anular cuenta" })).toHaveCount(0);
    const fila = page.getByTestId("fila-movimiento").filter({ hasText: "Del dueño" });
    await expect(fila.getByRole("button", { name: "Anular" })).toBeVisible();

    // mientras Beto mira, Ana le quita el encargo (la pantalla de Beto todavía muestra los botones)
    const r = await request.patch(`${API}/cuentas/${c.id}`, { headers: ana.headers, data: { encargado_id: null } });
    expect(r.status()).toBe(200);
    await fila.getByRole("button", { name: "Anular" }).click();
    await page.getByRole("dialog", { name: "Anular movimiento" }).getByRole("button", { name: "Anular", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Anular movimiento" }).getByRole("alert")).toContainText("Solo el dueño o el encargado");
    await page.getByRole("dialog", { name: "Anular movimiento" }).getByRole("button", { name: "Cancelar" }).click();
    // la pantalla se refrescó con lo que dice el servidor: ya no hay botones de registrar ni de anular
    await expect(registrarEnEstaCuenta(page)).toHaveCount(0);
    await expect(page.getByTestId("fila-movimiento").filter({ hasText: "Del dueño" }).getByRole("button", { name: "Anular" })).toHaveCount(0);
  });

  test("Actividad de la familia y Bitácora tienen el filtro «Cuentas»", async ({ page, request }) => {
    const ana = await crearAdmin(request);
    const beto = await crearMiembro(request, ana, { nombre: "Beto Miembro" });
    const c = await cuentaApi(request, ana, { nombre: "Caja visible", saldo_inicial: "10" });
    await depositoApi(request, ana, c.id, "25");
    const oculta = await cuentaApi(request, beto, { nombre: "Cuenta privada de Beto", visibilidad: "solo_yo" });
    await depositoApi(request, beto, oculta.id, "99");

    await entrarRapido(page, ana);
    await irAOpcionFamilia(page, "Actividad de la familia");
    await page.getByRole("button", { name: /^Qué:/ }).click();
    await page.getByRole("dialog", { name: "Qué" }).getByRole("radio", { name: "Cuentas" }).click();
    await expect(page.getByTestId("entrada-historial").filter({ hasText: "Caja visible" }).first()).toBeVisible();
    await expect(page.getByText("Depósito de Bs 25.00 en Caja visible").first()).toBeVisible();
    await expect(page.getByText("Cuenta privada de Beto")).toHaveCount(0); // ni el admin

    await irAOpcionFamilia(page, "Bitácora");
    await page.getByRole("button", { name: /^Qué:/ }).click();
    await page.getByRole("dialog", { name: "Qué" }).getByRole("radio", { name: "Cuentas" }).click();
    await expect(page.getByText(/Caja visible/).first()).toBeVisible();
    await expect(page.getByText("Cuenta privada de Beto")).toHaveCount(0);
    await expect(page.getByText(/Entró|Entrada fallida|Salió/)).toHaveCount(0); // solo cambios de Cuentas, ningún acceso
  });

  test("formularios: campos con etiqueta, objetivos de 44 px y sin desborde en 390 px", async ({ page, request }) => {
    const ana = await crearAdmin(request);
    const c = await cuentaApi(request, ana, { nombre: "Caja", saldo_inicial: "10" });
    await entrarRapido(page, ana);
    for (const ruta of ["/cuentas", "/cuentas/nueva", `/cuentas/${c.id}`, `/cuentas/movimiento?cuenta=${c.id}`, `/cuentas/${c.id}/editar`]) {
      await page.goto(ruta);
      await expect(page.locator("h1")).toBeVisible();
      await sinDesborde(page);
      await alturaMinima(page.locator("main button:visible, main a[href]:visible, main select:visible, main input:not([type=checkbox]):visible, main textarea:visible"), 44);
    }
    await page.goto("/cuentas/nueva");
    for (const e of ["Nombre de la cuenta", "Moneda", /Saldo inicial/, "Encargado (opcional)"]) await expect(page.getByLabel(e)).toBeVisible();
    await page.getByRole("radio", { name: "Cripto" }).click();
    await expect(page.getByLabel("Moneda").locator("option")).toHaveText(["USDT", "BTC"]);
    await page.getByLabel(/Últimos 4 dígitos/).fill("12ab34567");
    await expect(page.getByLabel(/Últimos 4 dígitos/)).toHaveValue("1234");
  });
});
