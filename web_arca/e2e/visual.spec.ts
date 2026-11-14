// Fase 14: prueba visual a 390px. Saca una captura de cada pantalla principal en `capturas/` (carpeta fuera del control de
// versiones) y comprueba automaticamente: sin desborde horizontal, sin texto cortado y sin nada tapado por la barra inferior.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { anterior, calcular, hoyLaPaz, sumarDias } from "../src/core/periodo";
import {
  abrirLista, apoyoApi, crearAdmin, crearMiembro, devolucionApi, entrar, entrarRapido, expect, gastoApi, ingresoApi, irA, irAFamilia,
  irAOpcionFamilia, menu, sinDesborde, test, API,
} from "./ayudas";

const CARPETA = join(process.cwd(), "capturas");
mkdirSync(CARPETA, { recursive: true });

async function captura(page: Page, nombre: string) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(250); // que terminen las animaciones
  await page.screenshot({ path: join(CARPETA, `${nombre}.png`) });
}

interface Problema {
  tipo: string;
  detalle: string;
}

/** Revisiones automaticas de la pantalla actual (hace scroll hasta abajo para mirar tambien el final). */
async function revisar(page: Page, nombre: string) {
  await sinDesborde(page);
  const problemas: Problema[] = await page.evaluate(() => {
    const out: { tipo: string; detalle: string }[] = [];
    window.scrollTo(0, document.documentElement.scrollHeight);
    const nav = document.querySelector("nav[aria-label='Navegación principal']")!.getBoundingClientRect();
    const dentroDeNav = (e: Element) => !!e.closest("nav[aria-label='Navegación principal']");
    const visible = (e: Element) => {
      const r = e.getBoundingClientRect();
      const cs = getComputedStyle(e);
      return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none" && !(e as HTMLElement).closest("[aria-hidden=true]");
    };
    const principal = document.querySelector("main")!;

    // 1) texto cortado: contenido mas ancho que su caja, escondido y SIN puntos suspensivos (ni deslizable a proposito)
    for (const e of Array.from(principal.querySelectorAll("*"))) {
      if (!visible(e)) continue;
      const cs = getComputedStyle(e);
      const escondido = cs.overflowX === "hidden" || cs.overflowX === "clip";
      // Excepcion UNICA: texto marcado data-truncado="a-proposito" que de verdad muestra "…" (text-overflow: ellipsis) y lleva el
      // texto completo en `title` (p. ej. el tipo de un movimiento de Cuentas junto a un monto grande). Todo lo demas sigue igual.
      const truncadoAProposito = e.getAttribute("data-truncado") === "a-proposito" && cs.textOverflow === "ellipsis" && !!e.getAttribute("title");
      if (truncadoAProposito) continue;
      if (escondido && e.scrollWidth > e.clientWidth + 1 && !e.classList.contains("esqueleto")) { // incluye el texto truncado con "..."
        // las barras de progreso recortan a proposito sus segmentos
        if (e.getAttribute("role") === "progressbar" || e.closest("[role=progressbar]")) continue;
        out.push({ tipo: "texto cortado", detalle: `${e.tagName}.${(e.className as string).toString().slice(0, 50)} "${(e.textContent ?? "").trim().slice(0, 40)}"` });
      }
    }
    // 2) controles tapados por la barra inferior: tras bajar hasta el final, ningun control del contenido queda bajo la barra
    for (const e of Array.from(document.querySelectorAll("a, button, input, select, textarea, [role=switch]"))) {
      if (!visible(e) || dentroDeNav(e)) continue;
      const r = e.getBoundingClientRect();
      const fijo = getComputedStyle(e.closest(".fixed") ?? e).position === "fixed";
      if (e.closest("[role=dialog]") || e.closest("[role=menu]") || e.getAttribute("aria-label")?.startsWith("Cerrar")) continue; // capas encima de todo
      if (r.bottom > nav.top + 0.5 && r.top < nav.bottom) {
        out.push({ tipo: fijo ? "control fijo tapa la barra" : "control tapado por la barra", detalle: `${e.tagName} "${(e.getAttribute("aria-label") ?? e.textContent ?? "").trim().slice(0, 40)}" bottom=${Math.round(r.bottom)} nav.top=${Math.round(nav.top)}` });
      }
      // 3) areas tactiles de 44px o mas
      if ((r.height < 43.5 || r.width < 43.5) && !(e as HTMLInputElement).type?.match(/^(checkbox|radio)$/) && e.tagName !== "SELECT") {
        if (e.tagName === "A" && e.closest("p, li, span") && !e.closest("nav")) continue; // enlaces dentro de un texto
        if (r.height < 43.5) out.push({ tipo: "area tactil pequena", detalle: `${e.tagName} "${(e.getAttribute("aria-label") ?? e.textContent ?? "").trim().slice(0, 40)}" ${Math.round(r.width)}x${Math.round(r.height)}` });
      }
    }
    // 4) el ultimo bloque del contenido debe terminar por encima de la barra
    const ultimo = principal.lastElementChild;
    if (ultimo) {
      const r = ultimo.getBoundingClientRect();
      if (r.height > 0 && r.bottom > nav.top + 0.5 && !ultimo.classList.contains("h-24") && getComputedStyle(ultimo).position !== "fixed")
        out.push({ tipo: "contenido tapado por la barra", detalle: `ultimo bloque termina en ${Math.round(r.bottom)} y la barra empieza en ${Math.round(nav.top)}` });
    }
    // 5) la barra mide 72px
    if (Math.round(nav.height) < 72) out.push({ tipo: "barra inferior", detalle: `mide ${nav.height}px` });
    return out;
  });
  expect(problemas, `${nombre}: ${JSON.stringify(problemas, null, 1)}`).toEqual([]);
}

test.describe("Prueba visual a 390px", () => {
  test("capturas y revisiones de las pantallas principales", async ({ page, request }) => {
    const admin = await crearAdmin(request, { nombre: "Ana Maria de los Angeles Perez", familia: "Familia Perez Rodriguez" });
    const beto = await crearMiembro(request, admin, { nombre: "Beto Miembro" });
    await ingresoApi(request, admin, 4500, "Sueldo de noviembre");
    await gastoApi(request, admin, { monto: 245.5, nota: "Compra grande del supermercado del fin de semana para toda la familia", categoria: "Comida" });
    await gastoApi(request, admin, { monto: 30, nota: "Taxi", categoria: "Transporte" });
    await gastoApi(request, beto, { monto: 12.75, nota: "Helado", categoria: "Antojos" });
    const duplicado = await gastoApi(request, admin, { monto: 99, nota: "Registrado dos veces", categoria: "Otros" });
    await request.post(`${API}/movimientos/${duplicado.id}/anular`, { headers: admin.headers, data: { motivo: "Duplicado" } });
    const ap1 = await apoyoApi(request, admin, { beneficiario: "Tia Rosa Maria del Carmen", monto: 600 });
    await devolucionApi(request, admin, ap1.id, 200);
    const ap2 = await apoyoApi(request, admin, { beneficiario: "Hermano Luis", monto: 150 });
    await devolucionApi(request, admin, ap2.id, 150);
    const ap3 = await apoyoApi(request, admin, { beneficiario: "Primo Pedro", monto: 80 });
    await request.post(`${API}/apoyos/${ap3.id}/consumir`, { headers: admin.headers });

    await entrarRapido(page, admin);

    // ---- Inicio
    await expect(page.getByText("Compra grande del supermercado del fin de semana para toda la familia")).toBeVisible();
    await captura(page, "01-inicio");
    await revisar(page, "Inicio");

    // ---- Lista de movimientos (con un anulado visible)
    await abrirLista(page);
    await page.getByLabel("Ver anulados").check();
    await expect(page.getByTestId("fila-lista").filter({ hasText: "Registrado dos veces" })).toHaveAttribute("data-anulado", "true");
    await captura(page, "02-lista");
    await revisar(page, "Lista");
    // hoja de opciones de un filtro
    await page.getByRole("button", { name: /^Persona:/ }).click();
    await expect(page.getByRole("dialog", { name: "Persona" })).toBeVisible();
    await captura(page, "02b-lista-filtro-persona");
    await page.getByRole("button", { name: "Cerrar hoja" }).click();
    // menu "..." de una fila
    await page.getByRole("button", { name: "Acciones de Taxi", exact: true }).click();
    await captura(page, "02c-lista-menu-fila");
    await page.getByRole("button", { name: "Cerrar menu" }).click({ position: { x: 5, y: 5 } });

    // ---- Apoyos
    await irA(page, "Apoyos");
    await expect(page.getByRole("heading", { name: "Tia Rosa Maria del Carmen" })).toBeVisible();
    await captura(page, "03-apoyos");
    await revisar(page, "Apoyos");

    // ---- Familia (menu)
    await irAFamilia(page);
    await captura(page, "04-familia-menu");
    await revisar(page, "Familia (menu)");

    // ---- Miembros
    await irAOpcionFamilia(page, "Miembros");
    await expect(page.getByTestId("fila-miembro")).toHaveCount(2);
    await captura(page, "05-miembros");
    await revisar(page, "Miembros");

    // ---- Categorias
    await irAOpcionFamilia(page, "Categorías");
    await captura(page, "06-categorias");
    await revisar(page, "Categorías");
    await menu(page, "Acciones de Antojos", "Desactivar");
    await expect(page.getByTestId("fila-categoria").filter({ hasText: "Antojos" })).toHaveAttribute("data-activa", "false");
    await expect(page.getByText("Categoría desactivada", { exact: true })).toHaveCount(0, { timeout: 8_000 }); // que el aviso ya no tape los encabezados

    // ---- Mi perfil
    await irAOpcionFamilia(page, "Mi perfil");
    await captura(page, "07-mi-perfil");
    await revisar(page, "Mi perfil");

    // ---- Nuevo movimiento
    await irA(page, "Inicio");
    await page.getByRole("link", { name: "Nuevo movimiento" }).click();
    await expect(page.getByRole("radio", { name: /Comida/ })).toBeVisible();
    await page.getByLabel("Monto").fill("45.50");
    await captura(page, "08-nuevo-movimiento");
    await sinDesborde(page);

    // ---- extras: agregar miembro, agregar categoria, actividad, reportes
    await irAOpcionFamilia(page, "Miembros");
    await page.getByRole("link", { name: "Agregar miembro" }).click();
    await captura(page, "09-agregar-miembro");
    await revisar(page, "Agregar miembro");
    await irAOpcionFamilia(page, "Categorías");
    await page.getByRole("link", { name: "Agregar categoría" }).click();
    await captura(page, "10-agregar-categoria");
    await revisar(page, "Agregar categoría");
    await irAOpcionFamilia(page, "Actividad de la familia");
    await captura(page, "11-actividad");
    await revisar(page, "Actividad");
    await irA(page, "Reportes");
    await expect(page.getByRole("heading", { name: "Resumen" })).toBeVisible();
    await captura(page, "12-reportes");
    await revisar(page, "Reportes");
  });

  test("Bitacora (Fase 15): capturas y revisiones a 390px", async ({ page, request }) => {
    const admin = await crearAdmin(request, { nombre: "Ana Maria de los Angeles Perez", familia: "Familia Perez Rodriguez" });
    const beto = await crearMiembro(request, admin, { nombre: "Beto Miembro" });
    await gastoApi(request, admin, { monto: 50, nota: "Taxi", categoria: "Transporte" });
    const g = await gastoApi(request, beto, { monto: 245.5, nota: "Compra grande del supermercado del fin de semana", categoria: "Comida" });
    await request.patch(`${API}/movimientos/${g.id}`, { headers: beto.headers, data: { monto: 260 } });
    const dup = await gastoApi(request, admin, { monto: 99, nota: "Registrado dos veces", categoria: "Otros" });
    await request.post(`${API}/movimientos/${dup.id}/anular`, { headers: admin.headers, data: { motivo: "Se pago dos veces" } });
    // accesos fallidos y un bloqueo (5 fallos de la misma IP y correo -> 429), un acceso denegado y un token invalido
    for (let i = 0; i < 6; i++) await request.post(`${API}/auth/login`, { data: { email: beto.email, password: "ClaveEquivocada1" } });
    await request.get(`${API}/bitacora`, { headers: beto.headers });
    await request.get(`${API}/auth/yo`, { headers: { Authorization: "Bearer esto.no.sirve" } });

    await entrar(page, admin); // un ingreso real: queda con la IP y el dispositivo de este navegador
    await irAFamilia(page);
    await captura(page, "16-familia-menu-admin-con-bitacora");
    await revisar(page, "Familia (menu admin)");

    await irAOpcionFamilia(page, "Bitácora");
    await expect(page.getByTestId("entrada-bitacora").first()).toBeVisible();
    await expect(page.getByTestId("ultimo-acceso")).toHaveCount(2);
    await captura(page, "17-bitacora-resumen");
    await revisar(page, "Bitácora");
    await page.getByRole("group", { name: "Origen" }).scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight * 0.35));
    await page.waitForTimeout(250);
    await page.screenshot({ path: join(CARPETA, "18-bitacora-lista.png") });
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForTimeout(250);
    await page.screenshot({ path: join(CARPETA, "19-bitacora-final-exportar.png") });

    await page.getByRole("button", { name: /^Evento:/ }).click();
    await expect(page.getByRole("dialog", { name: "Evento" })).toBeVisible();
    await captura(page, "20-bitacora-filtro-evento");
    await page.getByRole("button", { name: "Cerrar hoja" }).click();
    await page.getByRole("button", { name: /^Fechas:/ }).click();
    await expect(page.getByRole("dialog", { name: "Fechas" })).toBeVisible();
    await captura(page, "21-bitacora-filtro-fechas");
    await page.getByRole("button", { name: "Cerrar hoja" }).click();

    await page.getByRole("group", { name: "Origen" }).getByRole("button", { name: "Accesos" }).click();
    await expect(page.getByTestId("entrada-bitacora").first()).toHaveAttribute("data-origen", "acceso");
    await page.getByRole("button", { name: /^Resultado:/ }).click();
    await page.getByRole("dialog", { name: "Resultado" }).getByRole("radio", { name: "Con fallo" }).click();
    await expect(page.getByTestId("entrada-bitacora").first()).toHaveAttribute("data-resultado", "fallo");
    await captura(page, "22-bitacora-solo-fallos");
    await revisar(page, "Bitacora (solo fallos)");

    await page.getByRole("group", { name: "Origen" }).getByRole("button", { name: "Datos" }).click();
    await expect(page.getByTestId("estado-vacio")).toContainText("No hay nada en la bitácora con estos filtros");
    await captura(page, "23-bitacora-sin-resultados");
    await revisar(page, "Bitacora (sin resultados)");
  });

  test("Bitacora: esqueletos de carga y estado vacio de una familia nueva", async ({ page, request }) => {
    const admin = await crearAdmin(request);
    await entrarRapido(page, admin);
    await page.route("**/api/bitacora?*", async (route) => {
      await new Promise((r) => setTimeout(r, 1500));
      await route.continue();
    });
    await irAOpcionFamilia(page, "Bitácora");
    await expect(page.locator(".esqueleto").first()).toBeVisible();
    await captura(page, "24-bitacora-esqueletos");
    await expect(page.locator(".esqueleto")).toHaveCount(0);
    // una familia recien creada ya tiene su registro y categorias iniciales, pero ninguna entrada de acceso fallido
    await expect(page.getByTestId("fallos-semana")).toContainText("Sin intentos fallidos");
    await page.getByRole("group", { name: "Origen" }).getByRole("button", { name: "Accesos" }).click();
    await page.getByRole("button", { name: /^Evento:/ }).click();
    await page.getByRole("dialog", { name: "Evento" }).getByRole("radio", { name: "Entrada bloqueada" }).click();
    await expect(page.getByTestId("estado-vacio")).toBeVisible();
    await captura(page, "25-bitacora-vacio");
    await revisar(page, "Bitacora (vacio)");
  });

  test("estados vacios y de carga: mensaje amable con una accion y esqueletos (nunca pantalla en blanco)", async ({ page, request }) => {
    const admin = await crearAdmin(request);
    await entrarRapido(page, admin);
    await expect(page.getByTestId("estado-vacio")).toContainText("Sin movimientos en este periodo");
    await expect(page.getByTestId("estado-vacio").getByRole("link", { name: "Registrar un movimiento" })).toBeVisible();
    await captura(page, "13-inicio-vacio");
    await revisar(page, "Inicio vacio");

    await irA(page, "Apoyos");
    await expect(page.getByTestId("estado-vacio")).toContainText("No hay apoyos pendientes ni apoyos de este periodo");
    await expect(page.getByTestId("estado-vacio").getByRole("link", { name: "Registrar un apoyo" })).toBeVisible();
    await captura(page, "14-apoyos-vacio");
    await revisar(page, "Apoyos vacio");

    await abrirLista(page);
    await expect(page.getByTestId("estado-vacio")).toContainText("No hay movimientos en este periodo");
    await expect(page.getByTestId("estado-vacio").getByRole("link", { name: "Registrar un movimiento" })).toBeVisible();

    // carga lenta: se ven esqueletos mientras llega la respuesta
    await page.route("**/api/reportes/resumen*", async (route) => {
      await new Promise((r) => setTimeout(r, 1500));
      await route.continue();
    });
    await irA(page, "Reportes");
    await expect(page.locator(".esqueleto").first()).toBeVisible();
    await captura(page, "15-carga-esqueletos");
    await expect(page.getByRole("heading", { name: "Resumen" })).toBeVisible();
    await expect(page.locator(".esqueleto")).toHaveCount(0);
  });
  test("Fase 16: selector de periodo, periodo anterior, rango, comparacion, apoyos y Mi familia", async ({ page, request, context }) => {
    const admin = await crearAdmin(request, { nombre: "Ana Maria de los Angeles Perez", familia: "Familia Perez Rodriguez" });
    const beto = await crearMiembro(request, admin, { nombre: "Beto Miembro" });
    const hoy = hoyLaPaz();
    const mesAnt = anterior("mes", calcular("mes", hoy));
    const hace = sumarDias(mesAnt.desde, 11);
    const cats = (await (await request.get(`${API}/categorias`, { headers: admin.headers })).json()) as { id: number; nombre: string }[];
    const mov = async (tipo: string, monto: number, fecha: string, nota: string, cat?: string) =>
      request.post(`${API}/movimientos`, {
        headers: admin.headers,
        data: { tipo, monto, fecha, nota, ...(cat ? { categoria_id: cats.find((c) => c.nombre === cat)!.id } : {}) },
      });
    await mov("ingreso", 4500, hoy, "Sueldo de este mes");
    await mov("gasto", 245.5, hoy, "Compra grande del supermercado del fin de semana", "Comida");
    await mov("gasto", 30, hoy, "Taxi", "Transporte");
    await mov("ingreso", 4000, hace, "Sueldo del mes pasado");
    await mov("gasto", 310, hace, "Mercado del mes pasado", "Comida");
    await mov("gasto", 90, hace, "Transporte del mes pasado", "Transporte");
    const ap = await apoyoApi(request, admin, { beneficiario: "Tia Rosa Maria del Carmen", monto: 600 });
    await devolucionApi(request, admin, ap.id, 200);

    await entrarRapido(page, admin);
    await expect(page.getByTestId("etiqueta-periodo")).toBeVisible();
    await captura(page, "26-periodo-inicio-mes-actual");
    await revisar(page, "Inicio con selector de periodo");

    await page.getByLabel("Periodo anterior").click();
    await expect(page.getByTestId("aviso-periodo-anterior")).toBeVisible();
    await captura(page, "27-periodo-inicio-periodo-anterior");
    await revisar(page, "Inicio en un periodo anterior");

    await page.getByRole("group", { name: "Tipo de periodo" }).getByRole("button", { name: "Rango", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Rango de fechas" })).toBeVisible();
    await captura(page, "28-periodo-rango");
    await revisar(page, "Rango de fechas");
    await page.getByLabel("Desde").fill(mesAnt.desde);
    await page.getByLabel("Hasta").fill(mesAnt.hasta);
    await page.getByRole("button", { name: "Aplicar rango" }).click();
    await expect(page.getByTestId("saldo")).toBeVisible();
    await captura(page, "29-periodo-inicio-rango");
    await revisar(page, "Inicio con rango");

    await page.getByRole("group", { name: "Tipo de periodo" }).getByRole("button", { name: "Mes", exact: true }).click();
    await abrirLista(page);
    await expect(page.getByTestId("fila-lista").first()).toBeVisible();
    await captura(page, "30-periodo-lista");
    await revisar(page, "Lista con periodo");

    await irA(page, "Reportes");
    await expect(page.getByTestId("comparacion-ingresos")).toBeVisible();
    await captura(page, "31-periodo-reportes-comparacion");
    await revisar(page, "Reportes con comparacion");

    await irA(page, "Apoyos");
    await expect(page.getByTestId("nota-pendiente-total")).toBeVisible();
    await captura(page, "32-periodo-apoyos");
    await revisar(page, "Apoyos con periodo");
    await page.getByLabel("Periodo anterior").click();
    await expect(page.getByTestId("entregado-periodo")).toHaveText("Bs 0.00");
    await captura(page, "33-periodo-apoyos-periodo-anterior");
    await revisar(page, "Apoyos en un periodo anterior");

    await irAOpcionFamilia(page, "Mi familia");
    await expect(page.getByTestId("nota-dia-inicio")).toBeVisible();
    await page.getByLabel(/Día de inicio del mes/).fill("15");
    await expect(page.getByTestId("vista-previa-dia-inicio")).toBeVisible();
    await captura(page, "34-mi-familia-admin");
    await revisar(page, "Mi familia (admin)");

    // sin conexion: un periodo que nunca se abrio
    await irA(page, "Reportes");
    await expect(page.getByRole("heading", { name: "Resumen" })).toBeVisible(); // (aqui se mira el mes anterior, sin periodo previo: no hay tarjetas de comparacion)
    await context.setOffline(true);
    await page.getByLabel("Periodo anterior").click();
    await expect(page.getByTestId("sin-datos-periodo")).toBeVisible();
    await captura(page, "35-periodo-sin-datos-sin-conexion");
    await revisar(page, "Periodo sin datos guardados");
    await context.setOffline(false);

    // vista del miembro
    const otro = await context.browser()!.newContext({ viewport: { width: 390, height: 844 }, baseURL: "http://localhost:5299" });
    const pm = await otro.newPage();
    await entrarRapido(pm, beto);
    await irAOpcionFamilia(pm, "Mi familia");
    await expect(pm.getByTestId("dia-inicio-solo-lectura")).toBeVisible();
    await captura(pm, "36-mi-familia-miembro");
    await revisar(pm, "Mi familia (miembro)");
    await otro.close();
  });

  test("Cuentas: fila de movimiento en una línea a 360px, con montos grandes", async ({ page, request }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    const admin = await crearAdmin(request, { nombre: "Ana Maria de los Angeles Perez", familia: "Familia Perez Rodriguez" });
    const crear = async (ruta: string, data: Record<string, unknown>) => {
      const r = await request.post(`${API}${ruta}`, { headers: admin.headers, data });
      expect(r.status(), await r.text()).toBe(201);
      return (await r.json()) as { id: number };
    };
    const caja = await crear("/cuentas", { nombre: "Caja de la casa", tipo: "efectivo", moneda: "BS", saldo_inicial: "0" });
    const ahorro = await crear("/cuentas", {
      nombre: "Cuenta de ahorros familiar para emergencias", tipo: "ahorro", moneda: "BS", banco: "Banco Unión", saldo_inicial: "0",
    });
    await crear(`/cuentas/${caja.id}/depositos`, {
      monto: "123456789.50", nota: "Venta del terreno de la familia en las afueras de la ciudad", persona_tipo: "otra",
      persona_nombre: "Tía Rosa María del Carmen",
    });
    await crear(`/cuentas/${caja.id}/retiros`, { monto: "1234567.89" });
    await crear("/cuentas/traspasos", { cuenta_id: caja.id, cuenta_destino_id: ahorro.id, monto: "999999.99" });
    await crear(`/cuentas/${caja.id}/ajustes`, { saldo_declarado: "100000000" });
    const dup = await crear(`/cuentas/${caja.id}/depositos`, { monto: "10" });
    await request.post(`${API}/cuentas/movimientos/${dup.id}/anular`, { headers: admin.headers, data: { motivo: "Registrado dos veces" } });

    await entrarRapido(page, admin);
    await page.goto(`/cuentas/${caja.id}`);
    await page.getByRole("switch", { name: "Ver anulados" }).check({ force: true });
    const filas = page.getByTestId("fila-movimiento");
    await expect(filas).toHaveCount(5);
    await expect(filas.filter({ hasText: "Venta del terreno" })).toContainText("+Bs 123,456,789.50");
    // el monto nunca se parte en dos líneas; la primera línea de cada fila mide ~52px (mínimo 48 para el dedo)
    for (const alto of await page.getByTestId("monto-movimiento").evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height))) {
      expect(alto).toBeLessThan(32);
    }
    for (const alto of await filas.evaluateAll((els) => els.map((e) => e.firstElementChild!.getBoundingClientRect().height))) {
      expect(alto).toBeGreaterThanOrEqual(48);
      expect(alto).toBeLessThan(60);
    }
    // el tipo del traspaso no cabe junto al monto: se trunca con "…" (a propósito), sin desbordar
    const tipoTraspaso = filas.filter({ hasText: "Traspaso a" }).locator("[data-truncado=a-proposito]");
    expect(await tipoTraspaso.evaluate((e) => e.scrollWidth > e.clientWidth)).toBe(true);
    await captura(page, "37-cuenta-movimientos-360");
    await revisar(page, "Cuenta (movimientos a 360px)");
    await page.getByTestId("cabecera-movimientos").evaluate((e) => e.scrollIntoView({ block: "start" }));
    await page.waitForTimeout(250);
    await page.screenshot({ path: join(CARPETA, "37b-cuenta-lista-de-movimientos-360.png") });

    // el menú «…» de una fila (captura sin volver arriba, para que se vea el menú abierto)
    await filas.filter({ hasText: "Venta del terreno" }).getByRole("button", { name: /^Acciones de / }).click();
    await expect(page.getByRole("menuitem")).toHaveText(["Historial", "Cambiar fecha", "Anular"]);
    await page.waitForTimeout(250);
    await page.screenshot({ path: join(CARPETA, "38-cuenta-menu-fila-360.png") });
    await page.keyboard.press("Escape");

    // lista global: la misma fila compacta, sin menú, con el nombre de la cuenta en la segunda línea
    await page.goto("/cuentas");
    const globales = page.getByRole("list", { name: "Últimos movimientos" }).getByTestId("fila-movimiento");
    await expect(globales.first()).toBeVisible();
    await expect(globales.getByRole("button")).toHaveCount(0);
    await expect(globales.filter({ hasText: "Venta del terreno" }).getByTestId("detalle-movimiento")).toContainText("Caja de la casa");
    await captura(page, "39-cuentas-inicio-360");
    await revisar(page, "Cuentas (inicio a 360px)");
  });
});
