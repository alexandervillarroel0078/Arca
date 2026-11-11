// Dictado de movimientos (Cuentas, entrega A) con SpeechRecognition SIMULADO: rellena el formulario sin guardar, ambigüedad
// resuelta con un toque, navegador sin soporte, sin conexión, errores del servicio de voz y que no queda nada en el aparato.
// (El reconocimiento real depende del navegador y de su servicio de voz: eso va en la lista de pruebas manuales.)
import type { APIRequestContext, Page } from "@playwright/test";
import { API, alturaMinima, crearAdmin, entrarRapido, expect, sinDesborde, test, volverEnLinea, type Sesion } from "./ayudas";
import { decir, fallarVoz, idiomasUsados, instalarVoz, sinVoz } from "./vozSimulada";

async function cuentaApi(request: APIRequestContext, s: Sesion, datos: Record<string, unknown> = {}) {
  const r = await request.post(`${API}/cuentas`, { headers: s.headers, data: { nombre: "Caja", tipo: "efectivo", moneda: "BS", saldo_inicial: "0", ...datos } });
  expect(r.status(), await r.text()).toBe(201);
  return (await r.json()) as { id: number };
}
async function saldoApi(request: APIRequestContext, s: Sesion, id: number) {
  const r = await request.get(`${API}/cuentas`, { headers: s.headers });
  return ((await r.json()) as { cuentas: { id: number; saldo: string }[] }).cuentas.find((c) => c.id === id)!.saldo;
}

const dictar = (page: Page) => page.getByRole("button", { name: /Dictar movimiento|Escuchando/ });
const guardar = (page: Page) => page.getByRole("button", { name: /^Guardar/ });
const monto = (page: Page) => page.getByLabel("Monto (Bs)");
const cuentaSel = (page: Page) => page.getByLabel(/^Cuenta/);
const estado = (page: Page) => page.getByTestId("dictado-estado");

/** Abre Nuevo movimiento con la voz simulada (o sin ella) y espera a que carguen las cuentas. */
async function abrir(page: Page, s: Sesion, voz: "simulada" | "ninguna" = "simulada") {
  if (voz === "simulada") await instalarVoz(page);
  else await sinVoz(page);
  await entrarRapido(page, s);
  await page.goto("/cuentas/movimiento");
  await expect(page.getByRole("radiogroup", { name: "Tipo de movimiento" })).toBeVisible();
}

test.describe("Dictado de movimientos", () => {
  test("rellena tipo, cuenta y monto SIN guardar; Guardar es el único camino", async ({ page, request }) => {
    const ana = await crearAdmin(request);
    const caja = await cuentaApi(request, ana, { nombre: "Caja", saldo_inicial: "1000" });
    await cuentaApi(request, ana, { nombre: "Ahorro Unión", tipo: "ahorro", banco: "Banco Unión", ultimos4: "4821" });
    await abrir(page, ana);

    await expect(dictar(page)).toBeEnabled();
    await expect(page.getByTestId("dictado-privacidad")).toContainText(
      "El dictado lo procesa el servicio de voz de tu navegador. Arca no guarda ni recibe el audio. No dictes claves ni frases semilla.",
    );
    await dictar(page).click();
    await expect(dictar(page)).toContainText("Escuchando");
    expect(await idiomasUsados(page)).toEqual(["es-BO"]);

    await decir(page, "Retiro de cien con cincuenta de la caja, Luis", "retiro de cien con cincuenta de la casa");
    await expect(page.getByRole("radio", { name: "Retiro" })).toHaveAttribute("aria-checked", "true");
    await expect(cuentaSel(page)).toHaveValue(String(caja.id));
    await expect(monto(page)).toHaveValue("100.50");
    await expect(estado(page)).toContainText("Dictado aplicado: 3 campos rellenados, 0 por revisar");
    await expect(page.getByTestId("aviso-revisar")).toHaveCount(0);

    // nada se guardó solo
    await expect(page).toHaveURL(/\/cuentas\/movimiento/);
    expect(await saldoApi(request, ana, caja.id)).toMatch(/^1000(\.00)?$/);

    await guardar(page).click();
    await expect(page.getByTestId("saldo-cuenta").first()).toHaveText("Bs 899.50");
  });

  test("traspaso dictado: origen y destino", async ({ page, request }) => {
    const ana = await crearAdmin(request);
    const principal = await cuentaApi(request, ana, { nombre: "Principal", tipo: "corriente", banco: "Banco Unión", saldo_inicial: "500" });
    const ahorro = await cuentaApi(request, ana, { nombre: "Ahorro", tipo: "ahorro", banco: "Banco Unión" });
    await abrir(page, ana);
    await dictar(page).click();
    await decir(page, "Traspaso de 200 de la principal al ahorro");
    await expect(page.getByRole("radio", { name: "Traspaso" })).toHaveAttribute("aria-checked", "true");
    await expect(page.getByLabel("Desde")).toHaveValue(String(principal.id));
    await expect(page.getByLabel("Hacia")).toHaveValue(String(ahorro.id));
    await expect(monto(page)).toHaveValue("200");
    await guardar(page).click();
    await expect(page.getByTestId("saldo-cuenta").first()).toHaveText("Bs 300.00");
    expect(await saldoApi(request, ana, ahorro.id)).toMatch(/^200(\.00)?$/);
  });

  test("ambigüedad: dos cuentas encajan y se elige con UN toque", async ({ page, request }) => {
    const ana = await crearAdmin(request);
    await cuentaApi(request, ana, { nombre: "BCP Sueldo", tipo: "corriente", banco: "Banco Unión" });
    const ahorro = await cuentaApi(request, ana, { nombre: "BCP Ahorro", tipo: "ahorro", banco: "Banco Unión" });
    await abrir(page, ana);
    await dictar(page).click();
    await decir(page, "Depósito a la cuenta BCP, 1.500 bolivianos, de Ana");

    const fichas = page.getByRole("group", { name: "Elige la cuenta", exact: true });
    await expect(fichas.getByRole("button")).toHaveText(["BCP Sueldo · Banco Unión · Bs", "BCP Ahorro · Banco Unión · Bs"]);
    await expect(page.getByTestId("aviso-revisar")).toContainText("más de una cuenta");
    await expect(monto(page)).toHaveValue("1500");
    await expect(estado(page)).toContainText("2 campos rellenados, 1 por revisar");
    await alturaMinima(fichas.getByRole("button").first());
    await sinDesborde(page);

    await fichas.getByRole("button", { name: /BCP Ahorro/ }).click();
    await expect(cuentaSel(page)).toHaveValue(String(ahorro.id));
    await expect(fichas).toHaveCount(0);
    await expect(page.getByTestId("aviso-revisar")).toHaveCount(0);
    expect(await saldoApi(request, ana, ahorro.id)).toMatch(/^0(\.00)?$/); // todavía no guardó

    await guardar(page).click();
    await expect(page.getByTestId("saldo-cuenta").first()).toHaveText("Bs 1,500.00");
  });

  test("lo que no entiende queda vacío y resaltado, y la validación de siempre sigue mandando", async ({ page, request }) => {
    const ana = await crearAdmin(request);
    await cuentaApi(request, ana, { nombre: "Caja" });
    await abrir(page, ana);
    await dictar(page).click();
    await decir(page, "Depósito de 10,5555 a la caja"); // 4 decimales en Bs: no se redondea
    await expect(monto(page)).toHaveValue("");
    await expect(page.getByTestId("aviso-revisar")).toHaveText("Escuché 10.5555: Bs admite hasta 2 decimales");
    await expect(page.locator('[data-revisar="true"]')).toHaveCount(1);
    await expect(estado(page)).toContainText("2 campos rellenados, 1 por revisar");

    await guardar(page).click(); // vacío: el formulario no lo deja pasar
    await expect(page.getByRole("alert")).toContainText("Escribe el monto");
    await expect(page).toHaveURL(/\/cuentas\/movimiento/);

    await monto(page).fill("10.55"); // al corregirlo deja de estar por revisar
    await expect(page.getByTestId("aviso-revisar")).toHaveCount(0);
  });

  test("tipo que no se entiende: se marca; «ajuste» no se dicta y no cambia nada", async ({ page, request }) => {
    const ana = await crearAdmin(request);
    await cuentaApi(request, ana, { nombre: "Caja" });
    await abrir(page, ana);
    await dictar(page).click();
    await decir(page, "cien bolivianos de la caja");
    await expect(page.getByTestId("aviso-revisar")).toContainText("No entendí el tipo de movimiento");
    await expect(page.getByRole("radio", { name: "Depósito" })).toHaveAttribute("aria-checked", "true");

    await dictar(page).click();
    await decir(page, "Ajuste de la caja, quinientos");
    await expect(estado(page)).toContainText("El ajuste por conteo no se dicta");
    await expect(page.getByRole("radio", { name: "Ajuste por conteo" })).toHaveAttribute("aria-checked", "false");
    await expect(monto(page)).toHaveValue("100"); // lo del dictado anterior sigue igual
  });

  test("sin soporte del navegador: botón visible pero desactivado, con su explicación; el formulario sigue sirviendo", async ({ page, request }) => {
    const ana = await crearAdmin(request);
    const caja = await cuentaApi(request, ana, { nombre: "Caja" });
    await abrir(page, ana, "ninguna");
    await expect(dictar(page)).toBeVisible();
    await expect(dictar(page)).toBeDisabled();
    await expect(page.getByTestId("dictado-explicacion")).toHaveText("Tu navegador no permite dictar. Prueba con Chrome o Edge.");
    await expect(page.getByTestId("dictado-privacidad")).toBeVisible();
    await alturaMinima(dictar(page));
    await sinDesborde(page);
    await monto(page).fill("25");
    await guardar(page).click();
    await expect(page.getByTestId("saldo-cuenta").first()).toHaveText("Bs 25.00");
    expect(await saldoApi(request, ana, caja.id)).toMatch(/^25(\.00)?$/);
  });

  test("sin conexión: desactivado con explicación, y se activa al volver", async ({ page, request, context }) => {
    const ana = await crearAdmin(request);
    await cuentaApi(request, ana, { nombre: "Caja" });
    await abrir(page, ana);
    await expect(dictar(page)).toBeEnabled();
    await context.setOffline(true);
    await expect(dictar(page)).toBeDisabled();
    await expect(page.getByTestId("dictado-explicacion")).toHaveText("Necesitas conexión a internet para dictar.");
    await volverEnLinea(context, page);
    await expect(dictar(page)).toBeEnabled();
    await expect(page.getByTestId("dictado-explicacion")).toHaveCount(0);
  });

  test("errores del servicio de voz: se explican; si es-BO no existe usa es-419", async ({ page, request }) => {
    const ana = await crearAdmin(request);
    await cuentaApi(request, ana, { nombre: "Caja" });
    await abrir(page, ana);

    await dictar(page).click();
    await fallarVoz(page, "not-allowed");
    await expect(estado(page)).toContainText("No tengo permiso para usar el micrófono");
    await expect(dictar(page)).toBeEnabled();

    await dictar(page).click();
    await fallarVoz(page, "network");
    await expect(estado(page)).toContainText("El servicio de voz de tu navegador no responde");

    await dictar(page).click();
    const antes = (await idiomasUsados(page)).length;
    await fallarVoz(page, "language-not-supported");
    expect((await idiomasUsados(page)).slice(antes - 1)).toEqual(["es-BO", "es-419"]);
    await expect(dictar(page)).toContainText("Escuchando"); // reintentó sin molestar
    await decir(page, "Depósito de 40 a la caja");
    await expect(monto(page)).toHaveValue("40");
  });

  test("dictar no escribe nada en el aparato ni manda nada al servidor", async ({ page, request }) => {
    const ana = await crearAdmin(request);
    await cuentaApi(request, ana, { nombre: "Caja" });
    await abrir(page, ana);
    const local = () => page.evaluate(() => JSON.stringify([Object.entries(localStorage), Object.entries(sessionStorage)]));
    const antes = await local();
    const escritura: string[] = [];
    page.on("request", (r) => {
      if (r.url().includes("/api/") && r.method() !== "GET") escritura.push(`${r.method()} ${r.url()}`);
    });
    await dictar(page).click();
    await decir(page, "Retiro de cien con cincuenta de la caja");
    await expect(monto(page)).toHaveValue("100.50");
    expect(await local()).toBe(antes);
    expect(await local()).not.toMatch(/cincuenta|100\.50/);
    expect(escritura).toEqual([]);
  });
});
