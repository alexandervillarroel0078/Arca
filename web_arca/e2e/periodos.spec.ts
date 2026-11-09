// Fase 16: periodos. El periodo es una VISTA (filtro de fechas): cambiar de periodo, cambiar el dia de inicio del mes
// (solo el admin) y ver el efecto en el saldo. Las fechas se calculan con el MISMO codigo que usa la app y se comparan
// contra lo que responde el servidor (GET /periodos/actual).
import type { APIRequestContext, Page } from "@playwright/test";
import { anterior, calcular, hoyLaPaz, sumarDias } from "../src/core/periodo";
import {
  API, apoyoApi, cerrarSesion, crearAdmin, crearMiembro, entrar, entrarRapido, expect, gastoApi, irA, irAOpcionFamilia, saldo, test,
  type Sesion,
} from "./ayudas";

const etiqueta = (page: Page) => page.getByTestId("etiqueta-periodo");
const anteriorBtn = (page: Page) => page.getByLabel("Periodo anterior");
const siguienteBtn = (page: Page) => page.getByLabel("Periodo siguiente");
const chip = (page: Page, n: string) => page.getByRole("group", { name: "Tipo de periodo" }).getByRole("button", { name: n, exact: true });

async function movEn(request: APIRequestContext, s: Sesion, c: { tipo: "ingreso" | "gasto"; monto: number; fecha: string; nota: string }) {
  const cat = c.tipo === "gasto" ? { categoria_id: (await (await request.get(`${API}/categorias`, { headers: s.headers })).json())[0].id } : {};
  const r = await request.post(`${API}/movimientos`, { headers: s.headers, data: { ...c, ...cat } });
  expect(r.status(), await r.text()).toBe(201);
}

async function periodoApi(request: APIRequestContext, s: Sesion, query: string) {
  return (await (await request.get(`${API}/periodos/actual?${query}`, { headers: s.headers })).json()) as {
    desde: string; hasta: string; etiqueta: string; anterior: { desde: string; hasta: string; etiqueta: string }; siguiente: { etiqueta: string };
  };
}

const bs = (n: number) => `${n < 0 ? "-" : ""}Bs ${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

test.describe("Periodos: cambiar a un periodo anterior", () => {
  test("el saldo, el aviso y la etiqueta cambian; el periodo se conserva al navegar y se reinicia al cerrar sesion", async ({ page, request }) => {
    const admin = await crearAdmin(request);
    const hoy = hoyLaPaz();
    const mesActual = calcular("mes", hoy);
    const mesAnt = anterior("mes", mesActual);
    const enMesAnterior = sumarDias(mesAnt.desde, 9);
    await movEn(request, admin, { tipo: "ingreso", monto: 1000, fecha: hoy, nota: "Sueldo de este mes" });
    await movEn(request, admin, { tipo: "ingreso", monto: 400, fecha: enMesAnterior, nota: "Sueldo del mes pasado" });
    await movEn(request, admin, { tipo: "gasto", monto: 300, fecha: enMesAnterior, nota: "Mercado del mes pasado" });
    const srv = await periodoApi(request, admin, "tipo=mes");
    await entrarRapido(page, admin);

    // mes actual
    await expect(etiqueta(page)).toHaveText(srv.etiqueta);
    await expect(saldo(page)).toHaveText("Bs 1,000.00");
    await expect(page.getByTestId("aviso-periodo-anterior")).toHaveCount(0);
    await expect(siguienteBtn(page)).toBeDisabled();
    await expect(chip(page, "Mes")).toHaveAttribute("aria-pressed", "true");

    // periodo anterior
    await anteriorBtn(page).click();
    await expect(etiqueta(page)).toHaveText(srv.anterior.etiqueta);
    await expect(saldo(page)).toHaveText("Bs 100.00"); // 400 - 300
    await expect(page.getByTestId("etiqueta-saldo")).toHaveText(srv.anterior.etiqueta);
    await expect(page.getByTestId("aviso-periodo-anterior")).toHaveText(/Viendo un periodo anterior/);
    await expect(siguienteBtn(page)).toBeEnabled();
    await expect(page.getByTestId("fila-inicio")).toHaveCount(2);
    await expect(page.getByText("Sueldo de este mes")).toHaveCount(0);

    // se conserva al navegar: Apoyos, Reportes y la lista completa muestran el mismo periodo
    await irA(page, "Apoyos");
    await expect(etiqueta(page)).toHaveText(srv.anterior.etiqueta);
    await irA(page, "Reportes");
    await expect(etiqueta(page)).toHaveText(srv.anterior.etiqueta);
    await irA(page, "Inicio");
    await page.getByRole("link", { name: /Ver todos/ }).click();
    await expect(etiqueta(page)).toHaveText(srv.anterior.etiqueta);
    await expect(page.getByTestId("total-lista")).toHaveText("2 registros");

    // volver al actual con la flecha
    await irA(page, "Inicio");
    await siguienteBtn(page).click();
    await expect(etiqueta(page)).toHaveText(srv.etiqueta);
    await expect(saldo(page)).toHaveText("Bs 1,000.00");
    await expect(siguienteBtn(page)).toBeDisabled();

    // al cerrar sesion se reinicia a "Mes actual"
    await anteriorBtn(page).click();
    await expect(etiqueta(page)).toHaveText(srv.anterior.etiqueta);
    await cerrarSesion(page);
    await entrar(page, admin);
    await expect(etiqueta(page)).toHaveText(srv.etiqueta);
    await expect(chip(page, "Mes")).toHaveAttribute("aria-pressed", "true");
  });

  test("chips Hoy | Semana | Anio y el rango de fechas", async ({ page, request }) => {
    const admin = await crearAdmin(request);
    const hoy = hoyLaPaz();
    const mesAnt = anterior("mes", calcular("mes", hoy));
    await movEn(request, admin, { tipo: "ingreso", monto: 50, fecha: hoy, nota: "Hoy" });
    await movEn(request, admin, { tipo: "ingreso", monto: 700, fecha: mesAnt.desde, nota: "Primer dia del mes pasado" });
    await movEn(request, admin, { tipo: "ingreso", monto: 30, fecha: mesAnt.hasta, nota: "Ultimo dia del mes pasado" });
    await entrarRapido(page, admin);

    await chip(page, "Hoy").click();
    await expect(etiqueta(page)).toHaveText((await periodoApi(request, admin, "tipo=dia")).etiqueta);
    await expect(saldo(page)).toHaveText("Bs 50.00");
    await expect(siguienteBtn(page)).toBeDisabled();

    await chip(page, "Semana").click();
    await expect(etiqueta(page)).toHaveText((await periodoApi(request, admin, "tipo=semana")).etiqueta);

    await chip(page, "Año").click();
    await expect(etiqueta(page)).toHaveText(String(hoy.slice(0, 4)));

    // rango = todo el mes pasado (los dos extremos cuentan)
    await chip(page, "Rango").click();
    await expect(page.getByRole("heading", { name: "Rango de fechas" })).toBeVisible();
    await page.getByLabel("Desde").fill(mesAnt.desde);
    await page.getByLabel("Hasta").fill(mesAnt.hasta);
    await page.getByRole("button", { name: "Aplicar rango" }).click();
    await expect(saldo(page)).toHaveText("Bs 730.00");
    await expect(chip(page, "Rango")).toHaveAttribute("aria-pressed", "true");
    // y la flecha mueve el rango por su mismo largo
    await anteriorBtn(page).click();
    await expect(saldo(page)).toHaveText("Bs 0.00");
  });

  test("Reportes compara con el periodo anterior con flecha y texto; Apoyos dice que el pendiente es acumulado", async ({ page, request }) => {
    const admin = await crearAdmin(request);
    const hoy = hoyLaPaz();
    const mesActual = calcular("mes", hoy);
    const dentroDelAnterior = anterior("mes", mesActual).desde; // el 1 del mes pasado: con "mismo largo" no entraba, con "mes anterior" si
    await movEn(request, admin, { tipo: "ingreso", monto: 1200, fecha: hoy, nota: "Ahora" });
    await movEn(request, admin, { tipo: "ingreso", monto: 1000, fecha: dentroDelAnterior, nota: "Antes" });
    await movEn(request, admin, { tipo: "gasto", monto: 80, fecha: hoy, nota: "Gasto de ahora" });
    await apoyoApi(request, admin, { beneficiario: "Tia Rosa", monto: 300 });
    await entrarRapido(page, admin);

    await irA(page, "Reportes");
    await expect(page.getByTestId("comparacion-ingresos")).toContainText("▲ 20 % más que el periodo anterior");
    await expect(page.getByTestId("comparacion-ingresos")).toContainText("+Bs 200.00");
    await expect(page.getByTestId("comparacion-gastos")).toContainText("Sin datos en el periodo anterior para comparar"); // el anterior fue 0: no se divide
    await expect(page.getByTestId("comparacion-gastos")).not.toContainText("%");
    const srv = await periodoApi(request, admin, "tipo=mes");
    await expect(page.getByTestId("periodo-anterior")).toHaveText(`Comparado vs ${srv.anterior.etiqueta[0].toLowerCase()}${srv.anterior.etiqueta.slice(1)}`);

    await irA(page, "Apoyos");
    await expect(page.getByTestId("nota-pendiente-total")).toHaveText("Pendiente total, no depende del periodo");
    await expect(page.getByTestId("pendiente-total")).toHaveText("Bs 300.00");
    await expect(page.getByTestId("entregado-periodo")).toHaveText("Bs 300.00");
    await anteriorBtn(page).click();
    await expect(page.getByTestId("pendiente-total")).toHaveText("Bs 300.00"); // sigue igual en otro periodo
    await expect(page.getByTestId("entregado-periodo")).toHaveText("Bs 0.00");
    await expect(page.getByRole("heading", { name: "Tia Rosa" })).toBeVisible(); // con pendiente, se ve en cualquier periodo
  });
});

test.describe("Periodos: dia de inicio del mes (Familia > Mi familia)", () => {
  test("el admin cambia el dia de inicio y ve el efecto en el saldo; el miembro ve el mismo periodo", async ({ page, request, browser }) => {
    const admin = await crearAdmin(request);
    const miembro = await crearMiembro(request, admin);
    const hoy = hoyLaPaz();
    const mesActual = calcular("mes", hoy);
    const primeroDeMes = mesActual.desde;
    const veintiochoAnterior = `${anterior("mes", mesActual).desde.slice(0, 8)}28`;
    // tres ingresos: el 28 del mes pasado, el 1 de este mes y hoy (montos distintos para saber cuales cuentan)
    await movEn(request, admin, { tipo: "ingreso", monto: 4, fecha: veintiochoAnterior, nota: "Dia 28 del mes pasado" });
    await movEn(request, admin, { tipo: "ingreso", monto: 30, fecha: primeroDeMes, nota: "Dia 1" });
    await movEn(request, admin, { tipo: "ingreso", monto: 500, fecha: hoy, nota: "Hoy" });
    const sumaDe = (r: { desde: string; hasta: string }) =>
      [[veintiochoAnterior, 4], [primeroDeMes, 30], [hoy, 500]].filter(([f]) => (f as string) >= r.desde && (f as string) <= r.hasta).reduce((s, [, m]) => s + (m as number), 0);

    await entrarRapido(page, admin);
    const antes = await periodoApi(request, admin, "tipo=mes");
    await expect(etiqueta(page)).toHaveText(antes.etiqueta);
    await expect(saldo(page)).toHaveText(bs(sumaDe(antes))); // mes calendario: 530 (sin el del mes pasado)
    expect(sumaDe(antes)).toBe(530);

    // Familia > Mi familia > dia 28
    await irAOpcionFamilia(page, "Mi familia");
    await expect(page.getByTestId("nombre-familia")).toHaveText("Familia E2E");
    await expect(page.getByTestId("nota-dia-inicio")).toContainText("Con 1 es el mes calendario");
    const campo = page.getByLabel(/Día de inicio del mes/);
    await expect(campo).toHaveValue("1");
    await campo.fill("29");
    await expect(page.getByRole("button", { name: "Guardar" })).toBeDisabled(); // fuera de 1 a 28
    await campo.fill("28");
    await expect(page.getByTestId("vista-previa-dia-inicio")).toContainText("el mes de hoy sería:");
    await page.getByRole("button", { name: "Guardar" }).click();
    await expect(page.getByText("El mes ahora empieza el día 28")).toBeVisible();

    // el servidor ya usa el nuevo dia y el saldo de Inicio cambia en consecuencia
    const despues = await periodoApi(request, admin, "tipo=mes");
    expect(despues.etiqueta).toMatch(/^28 [a-z]{3} - 27 [a-z]{3}$/);
    expect(sumaDe(despues)).not.toBe(sumaDe(antes)); // los datos elegidos hacen que el cambio se note
    await irA(page, "Inicio");
    await expect(etiqueta(page)).toHaveText(despues.etiqueta);
    await expect(saldo(page)).toHaveText(bs(sumaDe(despues)));

    // nada se movio ni se cerro: los tres ingresos siguen en la lista (periodo Anio, que los abarca a todos si es el mismo anio)
    const todos = await (await request.get(`${API}/movimientos`, { headers: admin.headers })).json();
    expect(todos).toHaveLength(3);

    // el cambio quedo en el historial de la familia (Actividad de la familia, solo admin)
    const hist = await (await request.get(`${API}/historial?entidad=familia`, { headers: admin.headers })).json();
    expect(hist.items).toHaveLength(1);
    expect(hist.items[0].accion).toBe("editar");

    // un miembro (otra sesion) ve el mismo periodo en cuanto abre la app
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, baseURL: "http://localhost:5299" });
    const paginaMiembro = await ctx.newPage();
    await entrarRapido(paginaMiembro, miembro);
    await expect(etiqueta(paginaMiembro)).toHaveText(despues.etiqueta);
    await expect(saldo(paginaMiembro)).toHaveText(bs(sumaDe(despues)));
    await ctx.close();
  });

  test("un miembro NO ve el control para cambiar el dia de inicio (y el servidor tampoco se lo permite)", async ({ page, request }) => {
    const admin = await crearAdmin(request);
    const miembro = await crearMiembro(request, admin);
    await entrarRapido(page, miembro);
    await irAOpcionFamilia(page, "Mi familia");
    await expect(page.getByTestId("dia-inicio-solo-lectura")).toContainText("empieza el día 1. Solo un administrador puede cambiarlo");
    await expect(page.getByLabel(/Día de inicio del mes/)).toHaveCount(0);
    await expect(page.getByRole("spinbutton")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Guardar" })).toHaveCount(0);
    // aunque lo intentara por la API, el servidor lo rechaza
    const r = await request.patch(`${API}/familia`, { headers: miembro.headers, data: { dia_inicio_mes: 15 } });
    expect(r.status()).toBe(403);
    expect((await (await request.get(`${API}/familia`, { headers: admin.headers })).json()).dia_inicio_mes).toBe(1);
  });
});

test.describe("Periodos sin conexion", () => {
  test("un periodo que nunca se abrio avisa 'Sin datos guardados para este periodo'; el ya abierto se ve con sus datos guardados", async ({ page, request, context }) => {
    const admin = await crearAdmin(request);
    await movEn(request, admin, { tipo: "ingreso", monto: 800, fecha: hoyLaPaz(), nota: "Sueldo" });
    await gastoApi(request, admin, { monto: 50, nota: "Pan" });
    await entrarRapido(page, admin);
    await expect(saldo(page)).toHaveText("Bs 750.00");

    await context.setOffline(true);
    await anteriorBtn(page).click(); // nunca se abrio con internet
    await expect(page.getByTestId("sin-datos-periodo")).toContainText("Sin datos guardados para este periodo");
    await expect(page.getByTestId("selector-periodo")).toBeVisible(); // se puede volver
    await expect(page.getByRole("link", { name: "Nuevo movimiento" })).toBeVisible(); // y registrar

    await siguienteBtn(page).click(); // el periodo actual si estaba guardado
    await expect(saldo(page)).toHaveText("Bs 750.00");
    await expect(page.getByTestId("datos-viejos")).toContainText("Datos de hace");
    await context.setOffline(false);
  });
});
