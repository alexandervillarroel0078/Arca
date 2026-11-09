import type { Page } from "@playwright/test";
import {
  API, WEB, cerrarSesion, crearAdmin, crearMiembro, entrar, entrarRapido, expect, irA, irAFamilia, irAOpcionFamilia, menu,
  opcionesDelMenu, saldo, sinDesborde, test, unico, volver,
} from "./ayudas";

const filaCategoria = (page: Page, nombre: string) => page.getByTestId("fila-categoria").filter({ hasText: nombre });
const filaMiembro = (page: Page, nombre: string) => page.getByTestId("fila-miembro").filter({ hasText: nombre });
const rutaActual = (page: Page) => new URL(page.url()).pathname;

test.describe("Familia: menu de opciones y navegacion", () => {
  test("Familia es un menu de tarjetas grandes con icono, titulo, descripcion y flecha; cada opcion abre su ruta", async ({ page, request }) => {
    const admin = await crearAdmin(request);
    await entrarRapido(page, admin);
    await irAFamilia(page);
    const tarjetas = page.getByTestId(/^opcion-familia-/);
    await expect(tarjetas).toHaveCount(7); // (Fase 15: + Bitacora, solo admin; Fase 16: + Mi familia)
    await expect(tarjetas.nth(0)).toContainText("Mi familia");
    await expect(tarjetas.nth(1)).toContainText("Miembros");
    await expect(tarjetas.nth(1)).toContainText("Quiénes forman tu familia");
    await expect(tarjetas.nth(1)).toContainText("›");
    for (const t of await tarjetas.all()) expect((await t.boundingBox())!.height).toBeGreaterThanOrEqual(72);
    await sinDesborde(page);
    await expect(page.locator("form")).toHaveCount(0); // ningun formulario abierto en el menu

    const rutas: [string, string, string][] = [
      ["Mi familia", "/familia/mi-familia", "Mi familia"],
      ["Miembros", "/familia/miembros", "Miembros"],
      ["Categorías", "/familia/categorias", "Categorías"],
      ["Actividad de la familia", "/familia/actividad", "Actividad de la familia"],
      ["Bitácora", "/familia/bitacora", "Bitácora"],
      ["Mi perfil", "/familia/perfil", "Mi perfil"],
    ];
    for (const [opcion, ruta, titulo] of rutas) {
      await irAFamilia(page);
      await page.getByRole("navigation", { name: "Opciones de Familia" }).getByRole("link", { name: new RegExp(`^${opcion}`) }).click();
      await expect(page.getByRole("heading", { name: titulo, exact: true })).toBeVisible();
      expect(rutaActual(page)).toBe(ruta);
      await expect(page.getByRole("button", { name: "Volver", exact: true })).toBeVisible();
      await sinDesborde(page);
    }
  });

  test("'< Volver', el boton atras del navegador y recargar funcionan en cualquier ruta", async ({ page, request }) => {
    const admin = await crearAdmin(request);
    await entrarRapido(page, admin);
    await irAOpcionFamilia(page, "Categorías");
    await page.getByRole("link", { name: "Agregar categoría" }).click();
    await expect(page.getByRole("heading", { name: "Agregar categoría", exact: true })).toBeVisible();
    expect(rutaActual(page)).toBe("/familia/categorias/nueva");

    await page.goBack(); // atras del navegador / del telefono
    await expect(page.getByRole("heading", { name: "Categorías", exact: true })).toBeVisible();
    await page.goBack();
    await expect(page.getByRole("navigation", { name: "Opciones de Familia" })).toBeVisible();
    expect(rutaActual(page)).toBe("/familia");
    await page.goForward();
    await expect(page.getByRole("heading", { name: "Categorías", exact: true })).toBeVisible();

    // '< Volver' vuelve a la pantalla anterior
    await page.getByRole("link", { name: "Agregar categoría" }).click();
    await volver(page);
    await expect(page.getByRole("heading", { name: "Categorías", exact: true })).toBeVisible();

    // recargar en cualquier ruta funciona (la sesion se conserva y la pantalla vuelve a cargar sus datos)
    for (const [ruta, titulo] of [["/familia/miembros", "Miembros"], ["/familia/categorias/nueva", "Agregar categoría"], ["/familia/perfil", "Mi perfil"], ["/familia/actividad", "Actividad de la familia"]]) {
      await page.goto(ruta);
      await page.reload();
      await expect(page.getByRole("heading", { name: titulo, exact: true })).toBeVisible();
      expect(rutaActual(page)).toBe(ruta);
    }

    // tras recargar no hay historial previo: '< Volver' lleva al menu (no saca de la app)
    await page.goto("/familia/categorias");
    await page.reload();
    await volver(page);
    expect(rutaActual(page)).toBe("/familia");
    await expect(page.getByRole("navigation", { name: "Opciones de Familia" })).toBeVisible();
  });

  test("el avatar de Inicio abre directamente 'Mi perfil' y 'Volver' regresa a Inicio", async ({ page, request }) => {
    const admin = await crearAdmin(request);
    await entrarRapido(page, admin);
    await page.getByRole("link", { name: "Mi perfil" }).click();
    await expect(page.getByRole("heading", { name: "Mi perfil", exact: true })).toBeVisible();
    expect(rutaActual(page)).toBe("/familia/perfil");
    await volver(page);
    await expect(saldo(page)).toBeVisible();
    expect(rutaActual(page)).toBe("/");
  });

  test("Cerrar sesion pide confirmacion (cancelar no sale)", async ({ page, request }) => {
    const admin = await crearAdmin(request);
    await entrarRapido(page, admin);
    const dialogo = await cerrarSesion(page, false);
    await dialogo.getByRole("button", { name: "Cancelar" }).click();
    await expect(page.getByRole("navigation", { name: "Opciones de Familia" })).toBeVisible();
    await cerrarSesion(page);
    await expect(page.getByRole("button", { name: "Entrar" })).toBeVisible();
  });
});

test.describe("Familia: categorias", () => {
  test("crear (pantalla propia), rechazar duplicada, renombrar con otro icono, desactivar y reactivar (nunca se borra)", async ({ page, request }) => {
    const admin = await crearAdmin(request);
    await entrarRapido(page, admin);
    await irAOpcionFamilia(page, "Categorías");
    await expect(page.getByTestId("fila-categoria")).toHaveCount(6); // las iniciales
    await expect(page.locator("form")).toHaveCount(0);

    await page.getByRole("link", { name: "Agregar categoría" }).click();
    await page.getByLabel("Nombre", { exact: true }).fill("Ropa");
    await page.getByRole("radio", { name: "shirt" }).click();
    await page.getByRole("button", { name: "Agregar categoría" }).click();
    await expect(page.getByRole("heading", { name: "Categorías", exact: true })).toBeVisible(); // vuelve a la lista
    await expect(filaCategoria(page, "Ropa")).toBeVisible();
    await expect(page.getByTestId("fila-categoria")).toHaveCount(7);

    await page.getByRole("link", { name: "Agregar categoría" }).click();
    await page.getByLabel("Nombre", { exact: true }).fill("ropa");
    await page.getByRole("button", { name: "Agregar categoría" }).click();
    const error = page.getByRole("alert");
    await expect(error).toContainText("Ya existe una categoría con ese nombre");
    await expect(error).toHaveClass(/before:content/); // icono + texto
    expect(rutaActual(page)).toBe("/familia/categorias/nueva");
    await volver(page);

    await menu(page, "Acciones de Ropa", "Editar nombre e icono");
    await page.getByLabel("Nombre de la categoría").fill("Vestimenta");
    // en edicion el nombre esta dentro de un campo: la fila se reconoce por ese campo
    const enEdicion = page.getByTestId("fila-categoria").filter({ has: page.getByLabel("Nombre de la categoría") });
    await enEdicion.getByRole("radio", { name: "gift" }).click();
    await enEdicion.getByRole("button", { name: "OK" }).click();
    await expect(filaCategoria(page, "Vestimenta")).toBeVisible();
    await expect(filaCategoria(page, "Vestimenta")).toContainText("🎁");

    await menu(page, "Acciones de Vestimenta", "Desactivar");
    await expect(filaCategoria(page, "Vestimenta")).toHaveAttribute("data-activa", "false");
    await expect(filaCategoria(page, "Vestimenta")).toContainText("(desactivada)");
    await expect(page.getByTestId("fila-categoria")).toHaveCount(7); // sigue ahi: no se borra
    await menu(page, "Acciones de Vestimenta", "Reactivar");
    await expect(filaCategoria(page, "Vestimenta")).toHaveAttribute("data-activa", "true");
    await sinDesborde(page);
  });

  test("el boton 'Agregar categoria' queda fijo abajo, visible y sin tapar la ultima fila", async ({ page, request }) => {
    const admin = await crearAdmin(request);
    await entrarRapido(page, admin);
    await irAOpcionFamilia(page, "Categorías");
    const boton = page.getByRole("link", { name: "Agregar categoría" });
    await expect(boton).toBeInViewport();
    const nav = (await page.getByRole("navigation", { name: "Navegación principal" }).boundingBox())!;
    const b = (await boton.boundingBox())!;
    expect(b.y + b.height).toBeLessThanOrEqual(nav.y + 0.5); // encima de la barra inferior
    expect(b.height).toBeGreaterThanOrEqual(56);
    await page.mouse.wheel(0, 2000);
    const ultima = (await page.getByTestId("fila-categoria").last().boundingBox())!;
    expect(ultima.y + ultima.height).toBeLessThanOrEqual(b.y + 0.5); // al final de la lista no queda tapada por el boton
  });

  test("una categoria desactivada no aparece en Nuevo movimiento pero sigue en el historial", async ({ page, request }) => {
    const admin = await crearAdmin(request);
    await request.post(`${API}/movimientos`, {
      headers: admin.headers, data: { tipo: "gasto", monto: 12, nota: "Helado", categoria_id: (await (await request.get(`${API}/categorias`, { headers: admin.headers })).json()).find((c: { nombre: string }) => c.nombre === "Antojos").id },
    });
    await entrarRapido(page, admin);
    await irAOpcionFamilia(page, "Categorías");
    await menu(page, "Acciones de Antojos", "Desactivar");
    await expect(filaCategoria(page, "Antojos")).toHaveAttribute("data-activa", "false");

    await irA(page, "Inicio");
    await page.getByRole("link", { name: "Nuevo movimiento" }).click();
    await expect(page.getByRole("radio", { name: /Comida/ })).toBeVisible();
    await expect(page.getByRole("radio", { name: /Antojos/ })).toHaveCount(0);
    await page.getByLabel("Cerrar").click();
    await expect(page.getByText(/Antojos · Ana Admin/)).toBeVisible(); // el historial conserva la categoria

    await irAOpcionFamilia(page, "Categorías");
    await menu(page, "Acciones de Antojos", "Reactivar");
    await irA(page, "Inicio");
    await page.getByRole("link", { name: "Nuevo movimiento" }).click();
    await expect(page.getByRole("radio", { name: /Antojos/ })).toBeVisible();
  });
});

test.describe("Familia: miembros", () => {
  test("agregar un miembro (pantalla propia), que entre con su clave temporal, cambiarle el rol y desactivarlo y reactivarlo", async ({ page, request, browser }) => {
    const admin = await crearAdmin(request);
    await entrarRapido(page, admin);
    await irAOpcionFamilia(page, "Miembros");
    await expect(page.locator("form")).toHaveCount(0);

    const email = `hijo.${unico()}@arca.test`;
    await page.getByRole("link", { name: "Agregar miembro" }).click();
    await expect(page.getByRole("heading", { name: "Agregar miembro", exact: true })).toBeVisible();
    await page.getByLabel("Nombre", { exact: true }).fill("Hijo Prueba");
    await page.getByLabel("Correo").fill(email);
    await page.getByLabel(/Contraseña temporal/).fill("Temporal123");
    await page.getByRole("button", { name: "Agregar miembro" }).click();
    await expect(page.getByRole("heading", { name: "Miembros", exact: true })).toBeVisible();
    await expect(filaMiembro(page, "Hijo Prueba")).toContainText("Miembro");

    // el nuevo miembro entra desde otra sesion (otro telefono)
    const ctx = await browser.newContext({ baseURL: WEB, viewport: { width: 390, height: 844 } });
    const hijo = await ctx.newPage();
    await entrar(hijo, { email, clave: "Temporal123" });
    await irAOpcionFamilia(hijo, "Miembros");
    await expect(hijo.getByRole("link", { name: "Agregar miembro" })).toHaveCount(0); // aun es miembro

    // el admin lo hace administrador: al recargar ya puede administrar
    await menu(page, "Acciones de Hijo Prueba", "Hacer administrador");
    await expect(filaMiembro(page, "Hijo Prueba")).toContainText("Admin");
    await hijo.reload();
    await expect(hijo.getByRole("link", { name: "Agregar miembro" })).toBeVisible();
    await menu(page, "Acciones de Hijo Prueba", "Pasar a miembro");
    await expect(filaMiembro(page, "Hijo Prueba")).toContainText("Miembro");

    // desactivarlo: aparece como Desactivado y su sesion se cierra
    await menu(page, "Acciones de Hijo Prueba", "Desactivar");
    await expect(filaMiembro(page, "Hijo Prueba")).toHaveAttribute("data-activo", "false");
    await expect(filaMiembro(page, "Hijo Prueba")).toContainText("Desactivado");
    await hijo.reload();
    await expect(hijo.getByRole("button", { name: "Entrar" })).toBeVisible();
    await hijo.getByLabel("Correo").fill(email);
    await hijo.getByLabel("Contraseña").fill("Temporal123");
    await hijo.getByRole("button", { name: "Entrar" }).click();
    await expect(hijo.getByRole("alert")).toContainText("desactivada");

    // reactivarlo: vuelve a entrar
    await menu(page, "Acciones de Hijo Prueba", "Reactivar");
    await expect(filaMiembro(page, "Hijo Prueba")).toHaveAttribute("data-activo", "true");
    await hijo.getByRole("button", { name: "Entrar" }).click();
    await expect(hijo.getByRole("heading", { name: "Miembros", exact: true })).toBeVisible(); // entra y queda en la pantalla donde estaba
    await ctx.close();
  });

  test("agregar miembro: un correo repetido muestra el error y no cierra la pantalla", async ({ page, request }) => {
    const admin = await crearAdmin(request);
    const otro = await crearMiembro(request, admin, { nombre: "Ya Existe" });
    await entrarRapido(page, admin);
    await irAOpcionFamilia(page, "Miembros");
    await page.getByRole("link", { name: "Agregar miembro" }).click();
    await page.getByLabel("Nombre", { exact: true }).fill("Otro");
    await page.getByLabel("Correo").fill(otro.email);
    await page.getByLabel(/Contraseña temporal/).fill("Temporal123");
    await page.getByRole("button", { name: "Agregar miembro" }).click();
    await expect(page.getByRole("alert")).toContainText("Ya existe una cuenta con ese correo");
    expect(rutaActual(page)).toBe("/familia/miembros/nuevo");
    // la clave temporal se puede ocultar y volver a mostrar
    await expect(page.getByLabel(/Contraseña temporal/)).toHaveAttribute("type", "text");
    await page.getByRole("button", { name: "Ocultar clave" }).click();
    await expect(page.getByLabel(/Contraseña temporal/)).toHaveAttribute("type", "password");
  });

  test("sus movimientos se conservan y cuentan aunque lo desactiven", async ({ page, request }) => {
    const admin = await crearAdmin(request);
    const hijo = await crearMiembro(request, admin, { nombre: "Hijo Gasto" });
    await request.post(`${API}/movimientos`, { headers: hijo.headers, data: { tipo: "ingreso", monto: 500, nota: "Mesada" } });
    await entrarRapido(page, admin);
    await expect(saldo(page)).toHaveText("Bs 500.00");
    await irAOpcionFamilia(page, "Miembros");
    await menu(page, "Acciones de Hijo Gasto", "Desactivar");
    await expect(filaMiembro(page, "Hijo Gasto")).toHaveAttribute("data-activo", "false");
    await irA(page, "Inicio");
    await expect(saldo(page)).toHaveText("Bs 500.00"); // sigue contando
    await expect(page.getByText("Mesada")).toBeVisible();
    await expect(page.getByText(/Ingreso · Hijo Gasto/)).toBeVisible();
  });

  test("nunca se desactiva ni se degrada al último administrador", async ({ page, request }) => {
    const admin = await crearAdmin(request, { nombre: "Ana Admin" });
    await entrarRapido(page, admin);
    await irAOpcionFamilia(page, "Miembros");
    for (const accion of ["Desactivar", "Pasar a miembro"]) {
      await menu(page, "Acciones de Ana Admin", accion);
      await expect(page.getByText("No puedes desactivar ni degradar al último administrador")).toBeVisible();
      await expect(filaMiembro(page, "Ana Admin")).toHaveAttribute("data-activo", "true");
      await expect(filaMiembro(page, "Ana Admin")).toContainText("Admin");
    }
  });

  test("restablecer clave: muestra una temporal una sola vez, la anterior deja de servir y la temporal entra", async ({ page, request, browser }) => {
    const admin = await crearAdmin(request);
    const hijo = await crearMiembro(request, admin, { nombre: "Hijo Clave" });
    await entrarRapido(page, admin);
    await irAOpcionFamilia(page, "Miembros");
    expect(await opcionesDelMenu(page, "Acciones de Hijo Clave")).toEqual(["Hacer administrador", "Desactivar", "Restablecer clave"]);

    await menu(page, "Acciones de Hijo Clave", "Restablecer clave");
    await page.getByRole("dialog", { name: "Restablecer clave" }).getByRole("button", { name: "Confirmar" }).click();
    const dialogo = page.getByRole("dialog", { name: "Clave temporal" });
    const temporal = (await dialogo.getByTestId("clave-temporal").innerText()).trim();
    expect(temporal.length).toBeGreaterThanOrEqual(6);
    await dialogo.getByRole("button", { name: "Listo" }).click();
    await expect(dialogo).toHaveCount(0);
    await expect(page.getByText(temporal)).toHaveCount(0); // no se vuelve a mostrar

    const ctx = await browser.newContext({ baseURL: WEB, viewport: { width: 390, height: 844 } });
    const otro = await ctx.newPage();
    await otro.goto("/");
    await otro.getByLabel("Correo").fill(hijo.email);
    await otro.getByLabel("Contraseña").fill(hijo.clave);
    await otro.getByRole("button", { name: "Entrar" }).click();
    await expect(otro.getByRole("alert")).toContainText("Correo o contraseña incorrectos");
    await otro.getByLabel("Contraseña").fill(temporal);
    await otro.getByRole("button", { name: "Entrar" }).click();
    await expect(saldo(otro)).toBeVisible();
    await ctx.close();
  });
});

test.describe("Familia: mi perfil", () => {
  test("cambiar el nombre y la clave (pidiendo la clave actual; con mostrar/ocultar)", async ({ page, request }) => {
    const admin = await crearAdmin(request);
    await entrarRapido(page, admin);
    await irAOpcionFamilia(page, "Mi perfil");

    await page.getByLabel("Mi nombre").fill("Ana Maria");
    await page.getByRole("button", { name: "Guardar nombre" }).click();
    await expect(page.getByText("Nombre actualizado")).toBeVisible();
    await irA(page, "Inicio");
    await expect(page.getByText("Hola, Ana")).toBeVisible();
    await irAOpcionFamilia(page, "Mi perfil");

    await page.getByLabel("Clave actual").fill("clave-incorrecta");
    await page.getByLabel("Clave nueva (mínimo 8)").fill("NuevaClave456");
    await page.getByLabel("Repite la clave nueva").fill("NuevaClave456");
    await page.getByRole("button", { name: "Cambiar clave" }).click();
    await expect(page.getByText("La clave actual no es correcta")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Mi perfil", exact: true })).toBeVisible(); // la sesion sigue abierta

    await page.getByLabel("Clave nueva (mínimo 8)").fill("NuevaClave456");
    await page.getByLabel("Repite la clave nueva").fill("OtraDistinta789");
    await page.getByRole("button", { name: "Cambiar clave" }).click();
    await expect(page.getByText("La clave nueva y su repetición no coinciden")).toBeVisible();

    // mostrar / ocultar
    await expect(page.getByLabel("Clave actual")).toHaveAttribute("type", "password");
    await page.getByRole("button", { name: "Mostrar clave" }).first().click();
    await expect(page.getByLabel("Clave actual")).toHaveAttribute("type", "text");
    await page.getByRole("button", { name: "Ocultar clave" }).first().click();
    await expect(page.getByLabel("Clave actual")).toHaveAttribute("type", "password");

    await page.getByLabel("Clave actual").fill(admin.clave);
    await page.getByLabel("Repite la clave nueva").fill("NuevaClave456");
    await page.getByRole("button", { name: "Cambiar clave" }).click();
    await expect(page.getByText("Clave actualizada")).toBeVisible();

    // la clave vieja ya no entra; la nueva si
    await cerrarSesion(page);
    await page.getByLabel("Correo").fill(admin.email);
    await page.getByLabel("Contraseña").fill(admin.clave);
    await page.getByRole("button", { name: "Entrar" }).click();
    await expect(page.getByRole("alert")).toContainText("Correo o contraseña incorrectos");
    await page.getByLabel("Contraseña").fill("NuevaClave456");
    await page.getByRole("button", { name: "Entrar" }).click();
    await expect(saldo(page)).toBeVisible();
    await expect(page.getByText("Hola, Ana")).toBeVisible();
  });
});
