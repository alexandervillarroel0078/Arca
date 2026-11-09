// Capturas a 390x844 de las pantallas que tocan los bloques A a E de las mejoras de UX.
// Salen en capturas/mejoras/<CAPTURA_FASE>/ (ej. "antes", "despues-A"). Carpeta fuera del control de versiones.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { anterior, calcular, hoyLaPaz, sumarDias } from "../../src/core/periodo";
import {
  abrirLista, apoyoApi, crearAdmin, crearMiembro, categoriaId, cambiosPendientes, devolucionApi, entrarRapido, API, expect, gastoApi, ingresoApi, irA, irAOpcionFamilia, prepararCategoriasLocales, registrarGasto, test, volverEnLinea,
} from "../ayudas";

const FASE = process.env.CAPTURA_FASE ?? "antes";
const CARPETA = join(process.cwd(), "capturas", "mejoras", FASE);
mkdirSync(CARPETA, { recursive: true });

async function captura(page: Page, nombre: string, abajo: boolean | "tal-cual" = false) {
  if (abajo !== "tal-cual") await page.evaluate((b) => window.scrollTo(0, b ? document.documentElement.scrollHeight : 0), abajo);
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(CARPETA, `${nombre}.png`) });
}

test("capturas de las pantallas de los bloques A a E", async ({ page, request }) => {
  const admin = await crearAdmin(request, { nombre: "Ana Maria de los Angeles Perez", familia: "Familia Perez Rodriguez" });
  const beto = await crearMiembro(request, admin, { nombre: "Beto Miembro" });
  await ingresoApi(request, admin, 4500, "Sueldo de noviembre");
  await gastoApi(request, admin, { monto: 245.5, nota: "Compra grande del supermercado del fin de semana", categoria: "Comida" });
  await gastoApi(request, admin, { monto: 60, nota: "Gasolina", categoria: "Gasolina" });
  await gastoApi(request, admin, { monto: 80, nota: "Luz", categoria: "Servicios" });
  await gastoApi(request, beto, { monto: 12.75, nota: "Helado", categoria: "Antojos" });
  await gastoApi(request, admin, { monto: 30, nota: "Taxi", categoria: "Transporte" });
  const ap1 = await apoyoApi(request, admin, { beneficiario: "Tia Rosa Maria del Carmen", monto: 600 });
  await devolucionApi(request, admin, ap1.id, 200);
  await apoyoApi(request, admin, { beneficiario: "Hermano Luis", monto: 150 });
  const dup = await gastoApi(request, admin, { monto: 99, nota: "Registrado dos veces", categoria: "Otros" });
  await request.post(`${API}/movimientos/${dup.id}/anular`, { headers: admin.headers, data: { motivo: "Duplicado" } });
  const apAnulado = await apoyoApi(request, admin, { beneficiario: "Primo Pedro", monto: 80 });
  await request.post(`${API}/apoyos/${apAnulado.id}/anular`, { headers: admin.headers, data: { motivo: "Error de monto" } });

  await entrarRapido(page, admin);
  await expect(page.getByText("Compra grande del supermercado del fin de semana")).toBeVisible();

  // Inicio: arriba y al final (el + sobre la ultima fila)
  await captura(page, "01-inicio-arriba");
  await captura(page, "01b-inicio-abajo", true);

  // Nuevo movimiento: arriba, al final y con un error de validacion (monto sin categoria)
  await page.getByRole("link", { name: "Nuevo movimiento" }).click();
  await expect(page.getByRole("radio", { name: /Comida/ })).toBeVisible();
  await page.getByLabel("Monto").fill("45.50");
  await captura(page, "02-nuevo-arriba");
  await captura(page, "02b-nuevo-abajo", true);
  await page.getByRole("button", { name: "Guardar", exact: true }).click({ force: true });
  await expect(page.getByRole("alert").filter({ hasText: "Elige una categoria" })).toBeVisible();
  await page.waitForTimeout(500);
  await captura(page, "02c-nuevo-error-en-pantalla", "tal-cual"); // lo que ve el usuario justo despues de tocar Guardar

  // Lista completa
  await page.goto("/");
  await abrirLista(page);
  await captura(page, "03-lista");
  await page.getByLabel("Ver anulados").check();
  await expect(page.getByTestId("fila-lista").filter({ hasText: "Registrado dos veces" })).toHaveAttribute("data-anulado", "true");
  await captura(page, "03b-lista-anulados");
  await captura(page, "03c-lista-anulados-abajo", true);
  await page.getByLabel("Ver anulados").uncheck();

  // Menu de una fila y dialogo de anular
  await page.getByRole("button", { name: "Acciones de Taxi", exact: true }).click();
  await captura(page, "04-menu-fila");
  await page.getByRole("menuitem", { name: "Anular" }).click();
  await captura(page, "05-dialogo-anular");
  await page.getByRole("button", { name: "Cancelar" }).click();

  // Apoyos: tarjeta del beneficiario y dialogo de editar devolucion
  await irA(page, "Apoyos");
  await expect(page.getByRole("heading", { name: "Tia Rosa Maria del Carmen" })).toBeVisible();
  await captura(page, "06-apoyos");
  await captura(page, "06b-apoyos-abajo", true);
  await page.getByRole("button", { name: /^Acciones de la devolucion/ }).first().click();
  await page.getByRole("menuitem", { name: "Editar devolucion" }).click();
  await captura(page, "07-dialogo-editar-devolucion");
  await page.getByRole("button", { name: "Cancelar" }).click();

  // Apoyos con anulados
  await page.getByLabel("Ver anulados").check();
  await expect(page.getByTestId("fila-apoyo").filter({ hasText: "Primo Pedro" }).or(page.getByText("Apoyos anulados"))).toBeVisible();
  await captura(page, "06c-apoyos-anulados-abajo", true);

  // Reportes
  await irA(page, "Reportes");
  await expect(page.getByRole("heading", { name: "Resumen" })).toBeVisible();
  await captura(page, "08-reportes");
  await captura(page, "08b-reportes-abajo", true);
});

test("capturas de una fila sin enviar (sin conexion)", async ({ page, request, context }) => {
  const admin = await crearAdmin(request, { nombre: "Ana Maria de los Angeles Perez", familia: "Familia Perez Rodriguez" });
  await gastoApi(request, admin, { monto: 30, nota: "Taxi", categoria: "Transporte" });
  await entrarRapido(page, admin);
  await expect(page.getByText("Taxi")).toBeVisible();
  await page.getByRole("link", { name: "Nuevo movimiento" }).click(); // cachea las categorias
  await expect(page.getByRole("radio", { name: /Comida/ })).toBeVisible();
  await page.getByRole("link", { name: "Nuevo movimiento" }).count(); // (sigue en el formulario)
  await context.setOffline(true);
  await page.getByLabel("Monto").fill("25.50");
  await page.getByRole("radio", { name: /Comida/ }).click();
  await page.getByLabel("Nota (opcional)").fill("Almuerzo sin internet");
  await page.getByRole("button", { name: "Guardar", exact: true }).click();
  await page.waitForTimeout(800);
  await captura(page, "09-inicio-sin-enviar", true);
  await page.goto("/").catch(() => {});
  await context.setOffline(false);
});

test("capturas del Bloque C: hoja de opciones, menu, anular y editar devolucion con poca altura", async ({ page, request }) => {
  const admin = await crearAdmin(request, { nombre: "Ana Maria de los Angeles Perez", familia: "Familia Perez Rodriguez" });
  await gastoApi(request, admin, { monto: 30, nota: "Taxi", categoria: "Transporte" });
  const ap = await apoyoApi(request, admin, { beneficiario: "Tia Rosa Maria del Carmen", monto: 600 });
  await devolucionApi(request, admin, ap.id, 200);
  await entrarRapido(page, admin);
  await abrirLista(page);

  await page.getByRole("button", { name: /^Persona:/ }).click();
  await expect(page.getByRole("dialog", { name: "Persona" })).toBeVisible();
  await captura(page, "10-hoja-opciones", "tal-cual");
  await page.getByRole("button", { name: "Cerrar hoja" }).click();

  await page.getByRole("button", { name: "Acciones de Taxi", exact: true }).click();
  await captura(page, "11-menu-fila-abierto", "tal-cual");
  await page.getByRole("menuitem", { name: "Anular" }).click();
  await expect(page.getByRole("dialog", { name: "Anular gasto" })).toBeVisible();
  await captura(page, "12-dialogo-anular", "tal-cual");
  await page.setViewportSize({ width: 390, height: 340 }); // el teclado se come ~500 px de un telefono de 844
  await page.waitForTimeout(300);
  await captura(page, "12b-dialogo-anular-teclado-340", "tal-cual");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Cancelar" }).click();

  await irA(page, "Apoyos");
  await expect(page.getByRole("heading", { name: "Tia Rosa Maria del Carmen" })).toBeVisible();
  await page.getByRole("button", { name: /^Acciones de la devolucion/ }).first().click();
  await page.getByRole("menuitem", { name: "Editar devolucion" }).click();
  await expect(page.getByRole("dialog", { name: "Editar devolucion" })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 600 });
  await page.waitForTimeout(300);
  await captura(page, "13-editar-devolucion-390x600", "tal-cual");
  await page.setViewportSize({ width: 390, height: 340 });
  await page.waitForTimeout(300);
  await captura(page, "13b-editar-devolucion-teclado-340", "tal-cual");
});

test("capturas del Bloque D: Inicio arriba, a mitad de scroll con el + sobre los montos, y al final", async ({ page, request }) => {
  const admin = await crearAdmin(request, { nombre: "Ana Maria de los Angeles Perez", familia: "Familia Perez Rodriguez" });
  await ingresoApi(request, admin, 4500, "Sueldo de noviembre");
  const gastos: [string, number, string][] = [
    ["Compra grande del supermercado", 1245.5, "Comida"], ["Gasolina", 160, "Gasolina"], ["Luz", 98.75, "Servicios"],
    ["Taxi", 30, "Transporte"], ["Internet", 189, "Servicios"], ["Almuerzo familiar", 345.25, "Comida"],
    ["Pasajes", 52.5, "Transporte"], ["Helado", 12.75, "Antojos"],
  ];
  for (const [nota, monto, categoria] of gastos) await gastoApi(request, admin, { monto, nota, categoria });
  await entrarRapido(page, admin);
  await expect(page.getByText("Helado")).toBeVisible();

  await captura(page, "20-inicio-arriba");

  // a mitad de scroll: se desplaza hasta que una fila quede justo a la altura del +, para que se vea si tapa su monto
  await page.evaluate(() => window.scrollTo(0, 0));
  const y = await page.evaluate(() => {
    const filas = Array.from(document.querySelectorAll("[data-testid='fila-inicio']"));
    const f = filas[4].getBoundingClientRect(); // una fila del medio
    const centroDelMas = window.innerHeight - 72 - 16 - 32; // el + mide 64 y flota sobre la barra
    return Math.max(0, f.top + window.scrollY + f.height / 2 - centroDelMas);
  });
  await page.evaluate((v) => window.scrollTo(0, v), y);
  await captura(page, "21-inicio-mitad-scroll-quieto", "tal-cual"); // 300 ms despues: el scroll ya paro
  // y justo despues de mover el scroll (el + deberia estar reducido en la version nueva)
  await page.evaluate((v) => window.scrollTo(0, v - 80), y);
  await page.waitForTimeout(500); // quieto un rato (el + vuelve a su tamano)
  await page.evaluate((v) => window.scrollTo(0, v), y); // 80 px hacia abajo: ahora si se esta bajando
  await page.waitForTimeout(60);
  await page.screenshot({ path: join(CARPETA, "21b-inicio-mitad-scroll-moviendo.png") });

  await captura(page, "22-inicio-abajo", true);
});

test("maqueta del Bloque D (opcion 2, NO implementada): el + en el centro de la barra de navegacion", async ({ page, request }) => {
  const admin = await crearAdmin(request, { nombre: "Ana Maria de los Angeles Perez", familia: "Familia Perez Rodriguez" });
  await ingresoApi(request, admin, 4500, "Sueldo de noviembre");
  const gastos: [string, number, string][] = [
    ["Compra grande del supermercado", 1245.5, "Comida"], ["Gasolina", 160, "Gasolina"], ["Luz", 98.75, "Servicios"],
    ["Taxi", 30, "Transporte"], ["Internet", 189, "Servicios"], ["Almuerzo familiar", 345.25, "Comida"],
    ["Pasajes", 52.5, "Transporte"], ["Helado", 12.75, "Antojos"],
  ];
  for (const [nota, monto, categoria] of gastos) await gastoApi(request, admin, { monto, nota, categoria });
  await entrarRapido(page, admin);
  await expect(page.getByText("Helado")).toBeVisible();
  // Solo en el navegador (no toca el codigo de la app): se oculta el + flotante y se mete un + en el centro de la barra
  await page.evaluate(() => {
    document.querySelector<HTMLElement>("a[aria-label='Nuevo movimiento']")!.style.display = "none";
    const ul = document.querySelector("nav[aria-label='Navegacion principal'] ul")!;
    ul.className = ul.className.replace("grid-cols-4", "grid-cols-5");
    const li = document.createElement("li");
    li.innerHTML = '<a href="/nuevo" aria-label="Nuevo movimiento (maqueta)" style="display:flex;align-items:center;justify-content:center;height:72px"><span style="display:flex;align-items:center;justify-content:center;width:56px;height:56px;margin-top:-22px;border-radius:9999px;background:#0E6B58;color:#fff;font-size:34px;line-height:1;box-shadow:0 4px 12px rgba(0,0,0,.25);border:4px solid #F4F6F5">+</span></a>';
    ul.insertBefore(li, ul.children[2]);
  });
  await captura(page, "30-maqueta-barra-arriba");
  const y = await page.evaluate(() => {
    const f = document.querySelectorAll("[data-testid='fila-inicio']")[4].getBoundingClientRect();
    return Math.max(0, f.top + window.scrollY + f.height / 2 - (window.innerHeight - 72 - 16 - 32));
  });
  await page.evaluate((v) => window.scrollTo(0, v), y);
  await captura(page, "31-maqueta-barra-mitad-scroll", "tal-cual");
});

test("capturas del Bloque D2: Inicio, Apoyos, Reportes, /nuevo y Inicio a mitad de scroll", async ({ page, request }) => {
  const admin = await crearAdmin(request, { nombre: "Ana Maria de los Angeles Perez", familia: "Familia Perez Rodriguez" });
  await ingresoApi(request, admin, 4500, "Sueldo de noviembre");
  const gastos: [string, number, string][] = [
    ["Compra grande del supermercado", 1245.5, "Comida"], ["Gasolina", 160, "Gasolina"], ["Luz", 98.75, "Servicios"],
    ["Taxi", 30, "Transporte"], ["Internet", 189, "Servicios"], ["Almuerzo familiar", 345.25, "Comida"],
    ["Pasajes", 52.5, "Transporte"], ["Helado", 12.75, "Antojos"],
  ];
  for (const [nota, monto, categoria] of gastos) await gastoApi(request, admin, { monto, nota, categoria });
  const ap = await apoyoApi(request, admin, { beneficiario: "Tia Rosa Maria del Carmen", monto: 600 });
  await devolucionApi(request, admin, ap.id, 200);
  await entrarRapido(page, admin);
  await expect(page.getByText("Helado")).toBeVisible();

  await captura(page, "40-inicio");
  const y = await page.evaluate(() => {
    const f = document.querySelectorAll("[data-testid='fila-inicio']")[4].getBoundingClientRect();
    return Math.max(0, f.top + window.scrollY + f.height / 2 - (window.innerHeight - 72 - 16 - 32));
  });
  await page.evaluate((v) => window.scrollTo(0, v), y);
  await captura(page, "41-inicio-mitad-scroll", "tal-cual");
  await captura(page, "42-inicio-abajo", true);

  await irA(page, "Apoyos");
  await expect(page.getByRole("heading", { name: "Tia Rosa Maria del Carmen" })).toBeVisible();
  await captura(page, "43-apoyos");
  await irA(page, "Reportes");
  await expect(page.getByRole("heading", { name: "Resumen" })).toBeVisible();
  await captura(page, "44-reportes");
  await irA(page, "Inicio");
  await page.goto("/nuevo");
  await expect(page.getByRole("radio", { name: /Comida/ })).toBeVisible();
  await captura(page, "45-nuevo");
});

test("capturas del Bloque E: /todos, dialogo de Marcar consumido y de Restablecer clave", async ({ page, request }) => {
  const admin = await crearAdmin(request, { nombre: "Ana Maria de los Angeles Perez", familia: "Familia Perez Rodriguez" });
  await crearMiembro(request, admin, { nombre: "Beto Miembro" });
  await gastoApi(request, admin, { monto: 30, nota: "Taxi", categoria: "Transporte" });
  await gastoApi(request, admin, { monto: 245.5, nota: "Compra del supermercado", categoria: "Comida" });
  const ap = await apoyoApi(request, admin, { beneficiario: "Tia Rosa Maria del Carmen", monto: 600 });
  await devolucionApi(request, admin, ap.id, 200);
  await entrarRapido(page, admin);

  // el dialogo NATIVO del navegador (antes del bloque) no se puede fotografiar: se guarda su texto
  let nativo: string | null = null;
  page.on("dialog", (d) => { nativo = `${d.type()}: ${d.message()}`; void d.dismiss(); });
  const guardarNativo = async (nombre: string) => {
    if (nativo) writeFileSync(join(CARPETA, `${nombre}-dialogo-nativo.txt`), nativo, "utf-8");
    nativo = null;
  };

  await abrirLista(page);
  await captura(page, "50-todos");

  await irA(page, "Apoyos");
  await expect(page.getByRole("heading", { name: "Tia Rosa Maria del Carmen" })).toBeVisible();
  await page.getByRole("button", { name: "Marcar consumido" }).click();
  await page.waitForTimeout(600);
  await guardarNativo("51-consumido");
  if (await page.getByRole("dialog", { name: "Marcar consumido" }).count()) {
    await captura(page, "51-dialogo-consumido", "tal-cual");
    await page.keyboard.press("Escape");
  }

  await irAOpcionFamilia(page, "Miembros");
  await page.getByRole("button", { name: "Acciones de Beto Miembro", exact: true }).click();
  await page.getByRole("menuitem", { name: "Restablecer clave", exact: true }).click();
  await page.waitForTimeout(600);
  await guardarNativo("52-restablecer");
  if (await page.getByRole("dialog", { name: "Restablecer clave" }).count()) {
    await captura(page, "52-dialogo-restablecer-clave", "tal-cual");
    await page.keyboard.press("Escape");
  }
});

test("capturas del Bloque F: Inicio con pendientes sin conexion y recien sincronizado", async ({ page, request, context }) => {
  const admin = await crearAdmin(request, { nombre: "Ana Maria de los Angeles Perez", familia: "Familia Perez Rodriguez" });
  await gastoApi(request, admin, { monto: 30, nota: "Taxi", categoria: "Transporte" });
  await entrarRapido(page, admin);
  await prepararCategoriasLocales(page);
  await context.setOffline(true);
  await registrarGasto(page, "25.50", /Comida/, "Almuerzo sin internet");
  await expect(cambiosPendientes(page)).toHaveText("1 cambio pendiente");
  await registrarGasto(page, "12", /Transporte/, "Pasaje sin internet");
  await expect(cambiosPendientes(page)).toHaveText("2 cambios pendientes");
  await page.waitForTimeout(4000); // que se vaya el aviso "Sin internet: se guardo..."
  await captura(page, "60-inicio-pendientes-sin-conexion");

  await volverEnLinea(context, page);
  await expect(cambiosPendientes(page)).toHaveCount(0);
  await page.screenshot({ path: join(CARPETA, "62-inicio-recien-sincronizado.png") }); // justo despues de enviar
  await page.waitForTimeout(4200); // se fue el aviso "Se sincronizaron..." y sale "Todo sincronizado"
  await page.screenshot({ path: join(CARPETA, "62b-inicio-pasados-4-segundos.png") });
});

test("capturas del Bloque F: Inicio con rechazos", async ({ page, request, context }) => {
  const admin = await crearAdmin(request, { nombre: "Ana Maria de los Angeles Perez", familia: "Familia Perez Rodriguez" });
  await gastoApi(request, admin, { monto: 30, nota: "Taxi", categoria: "Transporte" });
  await entrarRapido(page, admin);
  await prepararCategoriasLocales(page);
  await context.setOffline(true);
  await registrarGasto(page, "20", /Antojos/, "Categoria que se desactiva");
  await expect(cambiosPendientes(page)).toHaveText("1 cambio pendiente");
  const antojos = await categoriaId(request, admin, "Antojos");
  const r = await request.patch(`${API}/categorias/${antojos}`, { headers: admin.headers, data: { activa: false } });
  expect(r.status()).toBe(200);
  await volverEnLinea(context, page);
  await expect(page.getByTestId("aviso-rechazos")).toBeVisible();
  await page.waitForTimeout(11000); // que se vayan los avisos (los errores duran 10 s)
  await captura(page, "61-inicio-con-rechazos");
});

test("capturas del Bloque G: /todos con varios dias, Actividad familiar, Reportes por persona y Apoyos", async ({ page, request }) => {
  const hoy = hoyLaPaz();
  const ayer = sumarDias(hoy, -1);
  const antes = sumarDias(hoy, -3);
  const admin = await crearAdmin(request, { nombre: "Ana Maria de los Angeles Perez", familia: "Familia Perez Rodriguez" });
  const beto = await crearMiembro(request, admin, { nombre: "Beto Miembro" });
  await ingresoApi(request, admin, 4500, "Sueldo de noviembre");
  await gastoApi(request, admin, { monto: 245.5, nota: "Compra del supermercado", categoria: "Comida" });
  await gastoApi(request, admin, { monto: 30, nota: "Taxi", categoria: "Transporte" });
  await gastoApi(request, beto, { monto: 12.75, nota: "Helado", categoria: "Antojos" });
  await gastoApi(request, admin, { monto: 160, nota: "Gasolina", categoria: "Gasolina", fecha: ayer });
  await gastoApi(request, admin, { monto: 98.75, nota: "Luz", categoria: "Servicios", fecha: ayer });
  await gastoApi(request, beto, { monto: 52.5, nota: "Pasajes", categoria: "Transporte", fecha: antes });
  await gastoApi(request, admin, { monto: 189, nota: "Internet", categoria: "Servicios", fecha: antes });
  const dup = await gastoApi(request, admin, { monto: 99, nota: "Registrado dos veces", categoria: "Otros", fecha: ayer });
  await request.post(`${API}/movimientos/${dup.id}/anular`, { headers: admin.headers, data: { motivo: "Duplicado" } });
  await apoyoApi(request, admin, { beneficiario: "Hermano Luis", monto: 150 });
  await entrarRapido(page, admin);
  await expect(page.getByText("Helado")).toBeVisible();

  await abrirLista(page);
  await captura(page, "70-todos");
  await captura(page, "70b-todos-abajo", true);
  await page.getByLabel("Ver anulados").check();
  await captura(page, "70c-todos-anulados");

  await irAOpcionFamilia(page, "Actividad de la familia");
  await captura(page, "71-actividad");

  await irA(page, "Reportes");
  await expect(page.getByRole("heading", { name: "Por persona" })).toBeVisible();
  await page.getByRole("heading", { name: "Por persona" }).scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await captura(page, "72-reportes-por-persona", "tal-cual");

  await irA(page, "Apoyos");
  await expect(page.getByRole("heading", { name: "Hermano Luis" })).toBeVisible();
  await captura(page, "73-apoyos");
});

/** Un ingreso con fecha (la ayuda `ingresoApi` no la admite). */
async function ingresoEn(request: import("@playwright/test").APIRequestContext, s: Awaited<ReturnType<typeof crearAdmin>>, monto: number, fecha: string, nota: string) {
  const r = await request.post(`${API}/movimientos`, { headers: s.headers, data: { tipo: "ingreso", monto, nota, fecha } });
  expect(r.status(), await r.text()).toBe(201);
}

async function capturasReportes(page: Page, prefijo: string) {
  await irA(page, "Reportes");
  await expect(page.getByRole("heading", { name: "Resumen" })).toBeVisible();
  await captura(page, `${prefijo}-arriba`);
  await page.getByRole("heading", { name: "Gastos por categoria" }).scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await captura(page, `${prefijo}-categorias`, "tal-cual");
  await page.getByRole("heading", { name: "Últimos 6 meses" }).scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await captura(page, `${prefijo}-6-meses`, "tal-cual");
}

test("capturas del Bloque H: Reportes sin periodo anterior, con periodo anterior y mixto; tarjeta de Apoyos", async ({ page, request }) => {
  const hoy = hoyLaPaz();
  const mesAnterior = anterior("mes", calcular("mes", hoy)).desde; // el 1 del mes pasado
  const ant2 = sumarDias(mesAnterior, 3);

  // 1) sin periodo anterior: todo es de este mes
  const sola = await crearAdmin(request, { nombre: "Ana Maria de los Angeles Perez", familia: "Familia Sola" });
  await ingresoApi(request, sola, 4500, "Sueldo");
  await gastoApi(request, sola, { monto: 245.5, nota: "Compra", categoria: "Comida" });
  await gastoApi(request, sola, { monto: 160, nota: "Gasolina", categoria: "Gasolina" });
  await gastoApi(request, sola, { monto: 98.75, nota: "Luz", categoria: "Servicios" });
  await entrarRapido(page, sola);
  await capturasReportes(page, "80-sin-periodo-anterior");
  await irA(page, "Familia");
  await page.evaluate(() => localStorage.clear());
  await page.context().clearCookies();

  // 2) con periodo anterior: ingresos y gastos en los dos meses; y una categoria nueva este mes
  const con = await crearAdmin(request, { nombre: "Ana Maria de los Angeles Perez", familia: "Familia Con Base" });
  await ingresoEn(request, con, 4000, mesAnterior, "Sueldo anterior");
  await ingresoEn(request, con, 4500, hoy, "Sueldo");
  await gastoApi(request, con, { monto: 300, nota: "Compra anterior", categoria: "Comida", fecha: ant2 });
  await gastoApi(request, con, { monto: 245.5, nota: "Compra", categoria: "Comida" });
  await gastoApi(request, con, { monto: 160, nota: "Gasolina", categoria: "Gasolina" }); // sin base: no se gasto antes
  const p2 = await page.context().newPage();
  await entrarRapido(p2, con);
  await capturasReportes(p2, "81-con-periodo-anterior");

  // 3) tarjeta de Apoyos (barra inferior con Devuelto / Consumido / Pendiente)
  const a = await apoyoApi(request, con, { beneficiario: "Tia Rosa Maria del Carmen", monto: 1245.5 });
  await devolucionApi(request, con, a.id, 200);
  await irA(p2, "Apoyos");
  await expect(p2.getByRole("heading", { name: "Tia Rosa Maria del Carmen" })).toBeVisible();
  await p2.getByRole("progressbar").first().scrollIntoViewIfNeeded();
  await p2.evaluate(() => window.scrollBy(0, 230)); // hasta ver toda la barra inferior de la tarjeta
  await p2.waitForTimeout(300);
  await p2.screenshot({ path: join(CARPETA, "82-tarjeta-apoyos.png") });
});

test("capturas del Bloque J: Inicio, Apoyos, Familia y Bitacora (tildes y enie)", async ({ page, request }) => {
  const admin = await crearAdmin(request, { nombre: "Ana Maria de los Angeles Perez", familia: "Familia Perez Rodriguez" });
  const beto = await crearMiembro(request, admin, { nombre: "Beto Miembro" });
  await ingresoApi(request, admin, 4500, "Sueldo de noviembre");
  await gastoApi(request, admin, { monto: 245.5, nota: "Compra del supermercado", categoria: "Comida" });
  await gastoApi(request, beto, { monto: 12.75, nota: "Helado", categoria: "Antojos" });
  const ap = await apoyoApi(request, admin, { beneficiario: "Tia Rosa Maria del Carmen", monto: 600 });
  await devolucionApi(request, admin, ap.id, 200);
  await entrarRapido(page, admin);
  await expect(page.getByText("Helado")).toBeVisible();
  await captura(page, "90-inicio");
  await captura(page, "90b-inicio-abajo", true);

  await irA(page, "Apoyos");
  await expect(page.getByRole("heading", { name: "Tia Rosa Maria del Carmen" })).toBeVisible();
  await captura(page, "91-apoyos");
  await page.getByRole("progressbar").first().scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollBy(0, 230));
  await page.waitForTimeout(300);
  await captura(page, "91b-apoyos-tarjeta", "tal-cual");

  await irA(page, "Familia");
  await expect(page.getByTestId("opcion-familia-bitacora")).toBeVisible();
  await captura(page, "92-familia");
  await captura(page, "92b-familia-abajo", true);

  await page.getByTestId("opcion-familia-bitacora").click();
  await expect(page.getByRole("heading", { name: /Bit[aá]cora/ })).toBeVisible();
  await page.waitForTimeout(600);
  await captura(page, "93-bitacora");
  await captura(page, "93b-bitacora-abajo", true);
});
