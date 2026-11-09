// Fase 15: bitacora unificada (accesos y seguridad + cambios de datos) a 390px contra el backend de prueba (arca_test).
import {
  API, alturaMinima, crearAdmin, crearMiembro, entrar, expect, gastoApi, irAFamilia, irAOpcionFamilia, sinDesborde, test, volver,
} from "./ayudas";

interface ItemApi {
  clave: string;
  evento: string;
  origen: string;
}

const filas = (page: import("@playwright/test").Page) => page.getByTestId("entrada-bitacora");

test.describe("Bitacora (Fase 15)", () => {
  test("fallar la clave y luego entrar bien se ve en la bitacora, junto a un cambio de datos", async ({ page, request }) => {
    const admin = await crearAdmin(request, { nombre: "Ana Admin" });
    // Descarga: se intercepta el clic del enlace "download" y se lee el contenido que la app entrega (en Edge una descarga
    // real cierra el contexto de Playwright y rompe la limpieza de la prueba).
    await page.addInitScript(() => {
      const w = window as unknown as { __descargas: { nombre: string; texto: string }[] };
      w.__descargas = [];
      const clicOriginal = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function () {
        if (!this.download) return clicOriginal.call(this);
        const nombre = this.download;
        void fetch(this.href).then((r) => r.text()).then((texto) => w.__descargas.push({ nombre, texto }));
      };
    });

    // 1) clave equivocada y luego la correcta, desde la pantalla de entrada
    await page.goto("/");
    await page.getByLabel("Correo").fill(admin.email);
    await page.getByLabel("Contraseña").fill("ClaveEquivocada1");
    await page.getByRole("button", { name: "Entrar" }).click();
    await expect(page.getByText("Correo o contrasena incorrectos")).toBeVisible();
    await page.getByLabel("Contraseña").fill(admin.clave);
    await page.getByRole("button", { name: "Entrar" }).click();
    await expect(page.getByTestId("saldo")).toBeVisible();

    // 2) un cambio de datos: un gasto y su anulacion con motivo
    const gasto = await gastoApi(request, admin, { monto: 50, categoria: "Transporte", nota: "Taxi" });
    const r = await request.post(`${API}/movimientos/${gasto.id}/anular`, { headers: admin.headers, data: { motivo: "Se pago dos veces" } });
    expect(r.status()).toBe(200);

    // 3) la bitacora: Familia > Bitacora
    await irAOpcionFamilia(page, "Bitácora");
    await expect(filas(page).first()).toBeVisible();
    const textos = await filas(page).allTextContents();
    const posicion = (t: string) => textos.findIndex((x) => x.includes(t));
    const anulo = posicion("Anulo gasto Transporte Bs 50.00");
    const creo = posicion("Creo gasto Transporte Bs 50.00");
    const entro = posicion("Ana Admin inicio sesion");
    const fallo = posicion(`Intento fallido de entrada con ${admin.email}`);
    for (const [nombre, i] of Object.entries({ anulo, creo, entro, fallo })) expect(i, `falta en la lista: ${nombre}`).toBeGreaterThanOrEqual(0);
    // orden cronologico, lo mas reciente primero: anular, crear, entrar bien, clave mala
    expect(anulo).toBeLessThan(creo);
    expect(creo).toBeLessThan(entro);
    expect(entro).toBeLessThan(fallo);
    // el anular se muestra como "Anulado" con su motivo (nada se borra)
    const filaAnulado = filas(page).filter({ hasText: "Anulo gasto Transporte Bs 50.00" });
    await expect(filaAnulado).toContainText("Datos · Anulado");
    await expect(filaAnulado).toContainText("Motivo: Se pago dos veces");
    // el fallo y la entrada traen texto, IP y dispositivo en la linea secundaria
    const filaFallo = filas(page).filter({ hasText: "Intento fallido de entrada" });
    await expect(filaFallo).toContainText("Acceso · Fallo · Entrada fallida");
    await expect(filaFallo.getByTestId("origen-acceso")).toContainText(/IP .+ · .+ en /);

    // 4) resumen arriba: ultimo acceso por persona y fallos de la semana
    await expect(page.getByTestId("ultimo-acceso").first()).toContainText("Ana Admin");
    await expect(page.getByTestId("ultimo-acceso").first()).not.toContainText("Nunca entró");
    await expect(page.getByTestId("fallos-semana")).toContainText("1 intento fallido de entrada");

    // 5) chips Todo | Accesos | Datos
    const origen = page.getByRole("group", { name: "Origen" });
    await origen.getByRole("button", { name: "Accesos" }).click();
    await expect(origen.getByRole("button", { name: "Accesos" })).toHaveAttribute("aria-pressed", "true");
    await expect(filaFallo).toBeVisible();
    await expect(filas(page).first()).toHaveAttribute("data-origen", "acceso");
    expect(await filas(page).evaluateAll((els) => els.every((e) => e.getAttribute("data-origen") === "acceso"))).toBe(true);
    await origen.getByRole("button", { name: "Datos" }).click();
    await expect(filaAnulado).toBeVisible();
    await expect(filaFallo).toHaveCount(0);
    expect(await filas(page).evaluateAll((els) => els.every((e) => e.getAttribute("data-origen") === "datos"))).toBe(true);
    await origen.getByRole("button", { name: "Todo" }).click();
    await expect(filaFallo).toBeVisible();

    // 6) chip Resultado: solo el fallo
    await page.getByRole("button", { name: /^Resultado:/ }).click();
    await page.getByRole("dialog", { name: "Resultado" }).getByRole("radio", { name: "Con fallo" }).click();
    await expect(filas(page)).toHaveCount(1);
    await expect(filas(page)).toContainText("Intento fallido de entrada");
    // chip Evento
    await page.getByRole("button", { name: /^Resultado:/ }).click();
    await page.getByRole("dialog", { name: "Resultado" }).getByRole("radio", { name: "Todos" }).click();
    await page.getByRole("button", { name: /^Evento:/ }).click();
    await page.getByRole("dialog", { name: "Evento" }).getByRole("radio", { name: "Datos · Anulado" }).click();
    await expect(filas(page)).toHaveCount(1);
    await expect(filas(page)).toContainText("Anulo gasto Transporte Bs 50.00");
    // chip Persona
    await page.getByRole("button", { name: /^Evento:/ }).click();
    await page.getByRole("dialog", { name: "Evento" }).getByRole("radio", { name: "Todos los eventos" }).click();
    await page.getByRole("button", { name: /^Persona:/ }).click();
    await page.getByRole("dialog", { name: "Persona" }).getByRole("radio", { name: "Ana Admin" }).click();
    await expect(filaFallo).toBeVisible();
    // chip Fechas: "Hoy" las incluye todas; un rango del pasado no deja nada y ofrece quitar los filtros
    await page.getByRole("button", { name: /^Fechas:/ }).click();
    await page.getByRole("dialog", { name: "Fechas" }).getByRole("radio", { name: "Hoy" }).click();
    await expect(filaFallo).toBeVisible();
    await page.getByRole("button", { name: /^Fechas:/ }).click();
    const hoja = page.getByRole("dialog", { name: "Fechas" });
    await hoja.getByLabel("Desde").fill("2020-01-01");
    await hoja.getByLabel("Hasta").fill("2020-01-31");
    await hoja.getByRole("button", { name: "Aplicar rango" }).click();
    await expect(page.getByTestId("estado-vacio")).toContainText("No hay nada en la bitácora con estos filtros");
    await page.getByTestId("estado-vacio").getByRole("button", { name: "Quitar filtros" }).click();
    await expect(filaFallo).toBeVisible();

    // 7) Exportar CSV (con los mismos filtros)
    await origen.getByRole("button", { name: "Accesos" }).click();
    await page.getByRole("button", { name: "Exportar CSV" }).click();
    const leer = () => page.evaluate(() => (window as unknown as { __descargas: { nombre: string; texto: string }[] }).__descargas);
    await expect.poll(async () => (await leer()).length).toBe(1);
    const [{ nombre, texto: csv }] = await leer();
    expect(nombre).toBe("bitacora.csv");
    expect(csv.split("\n")[0]).toContain("origen");
    expect(csv).toContain("login_fallido");
    expect(csv).toContain("login_ok");
    expect(csv).not.toContain(",datos,"); // filtrado por Accesos
    expect(csv).not.toContain("ClaveEquivocada1"); // ni claves ni tokens
    expect(csv).not.toContain(admin.clave);

    // 8) 390px: sin desborde y controles de 44px o mas
    await sinDesborde(page);
    await alturaMinima(page.getByRole("group", { name: "Origen" }).getByRole("button"));
    await alturaMinima(page.getByRole("group", { name: "Filtros" }).getByRole("button"));
    await alturaMinima(page.getByRole("button", { name: "Exportar CSV" }));

    // 9) "< Volver" regresa al menu de Familia
    await volver(page);
    await expect(page.getByRole("navigation", { name: "Opciones de Familia" })).toBeVisible();
  });

  test("un miembro no ve la opcion ni entra por la URL directa; el intento queda como acceso denegado", async ({ page, request }) => {
    const admin = await crearAdmin(request, { nombre: "Ana Admin" });
    const beto = await crearMiembro(request, admin, { nombre: "Beto Miembro" });
    await entrar(page, beto);
    await irAFamilia(page);
    await expect(page.getByTestId("opcion-familia-bitacora")).toHaveCount(0);
    await expect(page.getByTestId("opcion-familia-miembros")).toBeVisible();

    await page.goto("/familia/bitacora"); // URL directa
    await expect(page.getByRole("navigation", { name: "Opciones de Familia" })).toBeVisible();
    await expect(page).toHaveURL(/\/familia$/);
    await expect(page.getByRole("heading", { name: "Bitácora", exact: true })).toHaveCount(0);
    await expect(filas(page)).toHaveCount(0);

    // aunque se salte la interfaz, el backend lo rechaza (y lo registra)
    for (const ruta of ["/bitacora", "/bitacora/resumen", "/bitacora/exportar.csv"]) {
      expect((await request.get(`${API}${ruta}`, { headers: beto.headers })).status(), ruta).toBe(403);
    }
    const lista = (await (await request.get(`${API}/bitacora?evento=acceso_denegado&limite=100`, { headers: admin.headers })).json()) as { items: (ItemApi & { usuario_nombre: string })[] };
    expect(lista.items.length).toBe(3);
    expect(lista.items.every((i) => i.usuario_nombre === "Beto Miembro")).toBe(true);
  });

  test("'Cargar mas' agrega paginas sin repetir ni saltarse entradas", async ({ page, request }) => {
    const admin = await crearAdmin(request, { nombre: "Ana Admin" });
    for (let i = 1; i <= 30; i++) await gastoApi(request, admin, { monto: i, nota: `Gasto ${i}`, categoria: "Comida" });
    await entrar(page, admin);
    await irAOpcionFamilia(page, "Bitácora");
    await expect(filas(page)).toHaveCount(20);
    const cargar = page.getByRole("button", { name: "Cargar más" });
    for (let i = 0; i < 10 && (await cargar.count()); i++) {
      const antes = await filas(page).count();
      await cargar.click();
      await expect.poll(() => filas(page).count()).toBeGreaterThan(antes);
    }
    await expect(cargar).toHaveCount(0);

    const claves = await filas(page).evaluateAll((els) => els.map((e) => e.getAttribute("data-clave")));
    expect(new Set(claves).size).toBe(claves.length); // ni repetidos
    // todas las del servidor (paginas de 100 por cursor)
    const todas: string[] = [];
    let cursor = "";
    for (;;) {
      const p = (await (await request.get(`${API}/bitacora?limite=100${cursor}`, { headers: admin.headers })).json()) as { items: ItemApi[]; hay_mas: boolean; siguiente: string | null };
      todas.push(...p.items.map((i) => i.clave));
      if (!p.hay_mas) break;
      cursor = `&cursor=${encodeURIComponent(p.siguiente!)}`;
    }
    expect(claves.length).toBeGreaterThan(30);
    expect(claves).toEqual(todas); // mismas entradas y mismo orden: sin saltos
  });

  test("al cerrar sesion queda la salida en la bitacora", async ({ page, request }) => {
    const admin = await crearAdmin(request, { nombre: "Ana Admin" });
    await entrar(page, admin);
    await irAFamilia(page);
    await page.getByTestId("opcion-familia-salir").click();
    await page.getByRole("dialog", { name: "Cerrar sesión" }).getByRole("button", { name: "Cerrar sesión" }).click();
    await expect(page.getByRole("button", { name: "Entrar" })).toBeVisible();
    await expect
      .poll(async () => {
        const p = (await (await request.get(`${API}/bitacora?evento=logout`, { headers: admin.headers })).json()) as { items: ItemApi[] };
        return p.items.length;
      })
      .toBe(1);
  });
});
