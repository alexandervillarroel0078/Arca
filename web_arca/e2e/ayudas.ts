import { expect, test as base, type APIRequestContext, type Locator, type Page } from "@playwright/test";

const SERVIDOR = "http://localhost:8199";
export const API = `${SERVIDOR}/api`;
export const WEB = "http://localhost:5299";

/**
 * `test` con una limpieza automatica: ANTES y DESPUES de cada prueba deja arca_test vacia (TRUNCATE ... CASCADE
 * en el servidor de pruebas; nunca DELETE por el trigger de `historial`). Asi cada prueba prepara sus propios datos
 * y puede repetirse. Tambien comprueba que el servidor este conectado a arca_test y a ninguna otra base.
 */
export const test = base.extend<{ limpio: void }>({
  limpio: [
    async ({ request }, use) => {
      const base = await (await request.get(`${SERVIDOR}/__e2e__/base`)).json();
      if (base.base !== "arca_test") throw new Error(`Las pruebas E2E solo pueden usar arca_test, no ${base.base}`);
      await request.post(`${SERVIDOR}/__e2e__/reset`);
      await use();
      await request.post(`${SERVIDOR}/__e2e__/reset`);
    },
    { auto: true },
  ],
});
export { expect };

// ------------------------------------------------------------------ datos y API (preparacion de cada prueba)
let contador = 0;
/** Texto unico por prueba (para correos y nombres que no choquen). */
export const unico = () => `${Date.now().toString(36)}${(contador++).toString(36)}`;

export interface Sesion {
  token: string;
  id: number;
  nombre: string;
  email: string;
  clave: string;
  headers: { Authorization: string };
}
const sesionDe = (r: { access_token: string; usuario: { id: number; nombre: string; email: string } }, clave: string): Sesion => ({
  token: r.access_token, id: r.usuario.id, nombre: r.usuario.nombre, email: r.usuario.email, clave,
  headers: { Authorization: `Bearer ${r.access_token}` },
});

export async function crearAdmin(request: APIRequestContext, c: { nombre?: string; familia?: string } = {}): Promise<Sesion> {
  const email = `admin.${unico()}@arca.test`;
  const r = await request.post(`${API}/auth/registro`, {
    data: { nombre: c.nombre ?? "Ana Admin", email, password: "Prueba123", nombre_familia: c.familia ?? "Familia E2E" },
  });
  expect(r.status(), await r.text()).toBe(201);
  return sesionDe(await r.json(), "Prueba123");
}

export async function crearMiembro(request: APIRequestContext, admin: Sesion, c: { nombre?: string; rol?: "miembro" | "admin" } = {}): Promise<Sesion> {
  const email = `miembro.${unico()}@arca.test`;
  const r = await request.post(`${API}/familia/invitar`, {
    headers: admin.headers, data: { nombre: c.nombre ?? "Beto Miembro", email, password: "Temporal123", rol: c.rol ?? "miembro" },
  });
  expect(r.status(), await r.text()).toBe(201);
  const l = await request.post(`${API}/auth/login`, { data: { email, password: "Temporal123" } });
  return sesionDe(await l.json(), "Temporal123");
}

export async function categoriaId(request: APIRequestContext, s: Sesion, nombre = "Comida"): Promise<number> {
  const cats = (await (await request.get(`${API}/categorias`, { headers: s.headers })).json()) as { id: number; nombre: string }[];
  return cats.find((c) => c.nombre === nombre)!.id;
}

export async function gastoApi(request: APIRequestContext, s: Sesion, c: { monto?: number; nota?: string; categoria?: string; fecha?: string } = {}) {
  const r = await request.post(`${API}/movimientos`, {
    headers: s.headers,
    data: { tipo: "gasto", monto: c.monto ?? 45, nota: c.nota ?? "Almuerzo", categoria_id: await categoriaId(request, s, c.categoria ?? "Comida"), ...(c.fecha ? { fecha: c.fecha } : {}) },
  });
  expect(r.status(), await r.text()).toBe(201);
  return (await r.json()) as { id: number };
}

/** Un gasto "de antes de la funcion de historial": se inserta directo en la base y no tiene ninguna entrada de historial. */
export async function gastoSinHistorialApi(request: APIRequestContext, s: Sesion, c: { monto?: number; nota?: string } = {}) {
  const yo = (await (await request.get(`${API}/auth/yo`, { headers: s.headers })).json()) as { familia_id: number };
  const r = await request.post(`${SERVIDOR}/__e2e__/movimiento-sin-historial`, {
    data: { familia_id: yo.familia_id, usuario_id: s.id, categoria_id: await categoriaId(request, s), monto: c.monto ?? 20, nota: c.nota ?? "Registro antiguo" },
  });
  expect(r.status(), await r.text()).toBe(200);
  return (await r.json()) as { id: number };
}

export async function ingresoApi(request: APIRequestContext, s: Sesion, monto = 1000, nota = "Sueldo") {
  const r = await request.post(`${API}/movimientos`, { headers: s.headers, data: { tipo: "ingreso", monto, nota } });
  expect(r.status(), await r.text()).toBe(201);
  return (await r.json()) as { id: number };
}

export async function apoyoApi(request: APIRequestContext, s: Sesion, c: { beneficiario?: string; monto?: number } = {}) {
  const r = await request.post(`${API}/apoyos`, { headers: s.headers, data: { beneficiario: c.beneficiario ?? "Tia Rosa", monto: c.monto ?? 300 } });
  expect(r.status(), await r.text()).toBe(201);
  return (await r.json()) as { id: number };
}

export async function devolucionApi(request: APIRequestContext, s: Sesion, apoyoId: number, monto: number) {
  const r = await request.post(`${API}/apoyos/${apoyoId}/devoluciones`, { headers: s.headers, data: { monto } });
  expect(r.status(), await r.text()).toBe(201);
  const apoyo = (await r.json()) as { devoluciones: { id: number }[] };
  return apoyo.devoluciones[apoyo.devoluciones.length - 1].id;
}

export async function movimientosApi(request: APIRequestContext, s: Sesion, query = "ver_anulados=true") {
  return (await (await request.get(`${API}/movimientos?${query}`, { headers: s.headers })).json()) as { id: number; monto: number; anulado: boolean; nota: string | null }[];
}

// ------------------------------------------------------------------ interfaz
export async function entrar(page: Page, s: Pick<Sesion, "email" | "clave">) {
  await page.goto("/");
  await page.getByLabel("Correo").fill(s.email);
  await page.getByLabel("Contraseña").fill(s.clave);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByTestId("saldo")).toBeVisible();
}

/** Abre la app ya con la sesion iniciada (sin pasar por el formulario): para pruebas que no son de login. */
export async function entrarRapido(page: Page, s: Sesion & { familia?: string }) {
  await page.goto("/");
  await page.evaluate(
    ({ token, id, nombre, email }) => {
      localStorage.setItem("arca-token", token);
      localStorage.setItem("arca-usuario", JSON.stringify({ id, nombre, email, familia_id: 0, familia_nombre: "", rol: "x" }));
    },
    { token: s.token, id: s.id, nombre: s.nombre, email: s.email },
  );
  await page.reload();
  await expect(page.getByTestId("saldo")).toBeVisible();
}

export const nav = (page: Page, nombre: "Inicio" | "Apoyos" | "Reportes" | "Familia") =>
  page.getByRole("navigation", { name: "Navegación principal" }).getByRole("link", { name: nombre, exact: true });

export async function irA(page: Page, nombre: "Inicio" | "Apoyos" | "Reportes" | "Familia") {
  await nav(page, nombre).click();
}

export async function abrirLista(page: Page) {
  await irA(page, "Inicio");
  await page.getByRole("link", { name: /Ver todos/ }).click();
  await expect(page.getByRole("heading", { name: "Todos los movimientos" })).toBeVisible();
}

/** Abre el menu "..." de una fila y elige una accion. */
export async function menu(page: Page, etiqueta: string, accion: string) {
  await page.getByRole("button", { name: etiqueta, exact: true }).click();
  await page.getByRole("menuitem", { name: accion, exact: true }).click();
}

/** Las acciones que ofrece el menu "..." de una fila (sin elegir ninguna). */
export async function opcionesDelMenu(page: Page, etiqueta: string): Promise<string[]> {
  await page.getByRole("button", { name: etiqueta, exact: true }).click();
  const items = await page.getByRole("menuitem").allTextContents();
  // el fondo del menu cubre toda la pantalla: se toca una esquina (el centro puede quedar tapado por la lista de opciones)
  await page.getByRole("button", { name: "Cerrar menu" }).click({ position: { x: 5, y: 5 } });
  await expect(page.getByRole("menu")).toHaveCount(0);
  return items;
}

export async function sinDesborde(page: Page) {
  const [ancho, ventana] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  expect(ancho).toBeLessThanOrEqual(ventana);
}

/** Todos los controles interactivos visibles de un contenedor miden 44px o mas de alto (salvo enlaces dentro de texto). */
export async function alturaMinima(loc: Locator, minimo = 44) {
  const cajas = await loc.evaluateAll((els) => els.map((e) => ({ h: e.getBoundingClientRect().height, t: (e.textContent ?? "").trim().slice(0, 30) })));
  for (const c of cajas) expect(c.h, `"${c.t}" mide ${c.h}px`).toBeGreaterThanOrEqual(minimo - 0.5);
}

export const saldo = (page: Page) => page.getByTestId("saldo");
export const filasLista = (page: Page) => page.getByTestId("fila-lista");
export const filaLista = (page: Page, titulo: string) => filasLista(page).filter({ has: page.getByText(titulo, { exact: true }) });

/** Pide ver el historial de una fila de la lista completa y devuelve el cuadro de dialogo. */
export async function verHistorial(page: Page, etiquetaMenu: string, accion = "Ver historial") {
  await menu(page, etiquetaMenu, accion);
  const dialogo = page.getByRole("dialog", { name: "Historial" });
  await expect(dialogo).toBeVisible();
  await expect(dialogo.getByTestId("entrada-historial").first()).toBeVisible();
  return dialogo;
}

// ------------------------------------------------------------------ sin conexion (Fase 12)
/** Una operacion guardada en la cola del telefono (IndexedDB "arca-offline", almacen "cola"). */
export interface OpLocal {
  seq: number;
  id: string;
  entidad: "movimiento" | "apoyo" | "devolucion";
  accion: "crear" | "editar" | "anular" | "reactivar";
  uuid: string | null;
  entidadId: number | null;
  datos: Record<string, any>;
  versionBase: number | null;
  encadenada: boolean;
  fechaCliente: string;
  estado: "pendiente" | "conflicto";
}

/** Lee un almacen de IndexedDB del telefono (la cola, los rechazos, el cache...). Devuelve [] si aun no existe. */
export function almacenLocal<T = any>(page: Page, nombre: "cola" | "rechazos" | "cache" | "entidades" | "meta"): Promise<T[]> {
  return page.evaluate(
    (n) =>
      new Promise<any[]>((res) => {
        const r = indexedDB.open("arca-offline");
        r.onerror = () => res([]);
        r.onsuccess = () => {
          const db = r.result;
          if (!db.objectStoreNames.contains(n)) {
            db.close();
            return res([]);
          }
          const q = db.transaction(n, "readonly").objectStore(n).getAll();
          q.onsuccess = () => {
            db.close();
            res(q.result);
          };
          q.onerror = () => res([]);
        };
      }),
    nombre,
  );
}
export const colaLocal = (page: Page) => almacenLocal<OpLocal>(page, "cola").then((o) => o.sort((a, b) => a.seq - b.seq));

/** Vuelve la conexion y avisa a la app (igual que hace el navegador). */
export async function volverEnLinea(ctx: import("@playwright/test").BrowserContext, page: Page) {
  await ctx.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
}

/** Abre Nuevo movimiento estando EN LINEA (la app guarda las categorias para usarlas sin internet) y vuelve a Inicio. */
export async function prepararCategoriasLocales(page: Page) {
  await page.getByRole("link", { name: "Nuevo movimiento" }).click();
  await expect(page.getByRole("radio", { name: /Comida/ })).toBeVisible();
  await page.getByLabel("Cerrar").click();
  await expect(saldo(page)).toBeVisible();
}

export async function registrarGasto(page: Page, monto: string, categoria: RegExp, nota?: string) {
  await page.getByRole("link", { name: "Nuevo movimiento" }).click();
  await page.getByLabel("Monto").fill(monto);
  await page.getByRole("radio", { name: categoria }).click();
  if (nota) await page.getByLabel("Nota (opcional)").fill(nota);
  await page.getByRole("button", { name: "Guardar" }).click();
}

/** "N cambios pendientes" de la barra de sincronizacion. */
export const cambiosPendientes = (page: Page) => page.getByTestId("cambios-pendientes");

export const AVISO_SIN_INTERNET = "Sin internet: se guardó en el teléfono y se enviará luego";

// ------------------------------------------------------------------ Familia como menu (Fase 14)
export type OpcionFamilia = "Mi familia" | "Miembros" | "Cuentas" | "Categorías" | "Actividad de la familia" | "Bitácora" | "Mi perfil";

/** Abre la pestana Familia (el menu de opciones). */
export async function irAFamilia(page: Page) {
  await irA(page, "Familia");
  await expect(page.getByRole("navigation", { name: "Opciones de Familia" })).toBeVisible();
}

/** Abre una opcion del menu de Familia y espera su pantalla (encabezado con el titulo). */
export async function irAOpcionFamilia(page: Page, opcion: OpcionFamilia) {
  await irAFamilia(page);
  await page.getByRole("navigation", { name: "Opciones de Familia" }).getByRole("link", { name: new RegExp(`^${opcion}`) }).click();
  await expect(page.getByRole("heading", { name: opcion, exact: true })).toBeVisible();
}

/** "< Volver" del encabezado de las pantallas internas. */
export const volver = (page: Page) => page.getByRole("button", { name: "Volver", exact: true }).click();

/** Cerrar sesion como lo hace el usuario: Familia > Cerrar sesion > confirmar. */
export async function cerrarSesion(page: Page, confirmar = true) {
  await irAFamilia(page);
  await page.getByTestId("opcion-familia-salir").click();
  const dialogo = page.getByRole("dialog", { name: "Cerrar sesión" });
  await expect(dialogo).toBeVisible();
  if (confirmar) await dialogo.getByRole("button", { name: "Cerrar sesión" }).click();
  return dialogo;
}
