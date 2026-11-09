// Bloque E de las mejoras de UX: navegacion coherente (Inicio activa en /todos, /nuevo y /editar; Volver en /todos)
// y confirmaciones propias (Marcar consumido, Restablecer clave) en lugar del confirm() del navegador.
import type { Page } from "@playwright/test";
import { abrirLista, apoyoApi, crearAdmin, crearMiembro, entrarRapido, expect, gastoApi, irA, irAOpcionFamilia, menu, nav, test, volver } from "./ayudas";

const conAriaCurrent = (page: Page) => page.locator('[aria-current="page"]');
const mas = (page: Page) => page.getByRole("link", { name: "Nuevo movimiento" });

test.describe("Navegacion coherente", () => {
  test("/todos: Inicio activa con aria-current, 'Volver' lleva a Inicio y el titulo no se duplica", async ({ page, request }) => {
    const admin = await crearAdmin(request);
    await gastoApi(request, admin, { monto: 30, nota: "Taxi", categoria: "Transporte" });
    await entrarRapido(page, admin);
    await abrirLista(page);

    await expect(nav(page, "Inicio")).toHaveAttribute("aria-current", "page");
    await expect(conAriaCurrent(page)).toHaveCount(1);
    await expect(page.getByRole("heading", { name: "Todos los movimientos" })).toHaveCount(1);

    await volver(page);
    await expect(page.getByTestId("saldo")).toBeVisible(); // de vuelta en Inicio
    expect(new URL(page.url()).pathname).toBe("/");
    await expect(nav(page, "Inicio")).toHaveAttribute("aria-current", "page");
  });

  test("/nuevo y /editar: Inicio resaltada solo de estilo; el unico aria-current es el +, que no navega", async ({ page, request }) => {
    const admin = await crearAdmin(request);
    await gastoApi(request, admin, { monto: 30, nota: "Taxi", categoria: "Transporte" });
    await entrarRapido(page, admin);

    await mas(page).click();
    await expect(page.getByRole("heading", { name: "Nuevo movimiento" })).toBeVisible();
    await expect(nav(page, "Inicio")).not.toHaveAttribute("aria-current", /.*/);
    await expect(mas(page)).toHaveAttribute("aria-current", "page");
    await expect(conAriaCurrent(page)).toHaveCount(1);
    await expect(nav(page, "Inicio")).toHaveClass(/text-arca/); // resaltada
    await mas(page).click({ force: true }); // (aria-disabled: Playwright no lo da por clicable, se fuerza el toque) no hace nada: sigue en /nuevo
    expect(new URL(page.url()).pathname).toBe("/nuevo");

    // editar: se llega desde el menu de una fila
    await page.goto("/");
    await menu(page, "Acciones de Taxi", "Editar");
    await expect(page.getByRole("heading", { name: "Editar movimiento" })).toBeVisible();
    const ruta = new URL(page.url()).pathname;
    expect(ruta).toMatch(/^\/editar\//);
    await expect(nav(page, "Inicio")).not.toHaveAttribute("aria-current", /.*/);
    await expect(nav(page, "Inicio")).toHaveClass(/text-arca/);
    await expect(mas(page)).toHaveAttribute("aria-current", "page");
    await expect(conAriaCurrent(page)).toHaveCount(1);
    await mas(page).click({ force: true }); // estando editando no se sale hacia /nuevo
    expect(new URL(page.url()).pathname).toBe(ruta);
  });
});

test.describe("Confirmaciones propias", () => {
  test("Marcar consumido: Escape cancela (no se consume nada) y Cancelar tambien; el foco empieza en Cancelar", async ({ page, request }) => {
    const admin = await crearAdmin(request);
    await apoyoApi(request, admin, { beneficiario: "Primo Pedro", monto: 400 });
    await entrarRapido(page, admin);
    await irA(page, "Apoyos");
    const abrir = page.getByRole("button", { name: "Marcar consumido" });
    const dialogo = page.getByRole("dialog", { name: "Marcar consumido" });

    await abrir.click();
    await expect(dialogo.getByTestId("mensaje-confirmar")).toContainText("Marcar Bs 400.00 de Primo Pedro como consumido?");
    await expect(dialogo.getByRole("button", { name: "Cancelar" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dialogo).toHaveCount(0);
    await expect(abrir).toBeFocused(); // el foco vuelve al boton que lo abrio
    await expect(page.getByRole("button", { name: "Marcar consumido" })).toBeVisible(); // sigue Pendiente

    await abrir.click();
    await dialogo.getByRole("button", { name: "Cancelar" }).click();
    await expect(dialogo).toHaveCount(0);
    await expect(page.getByText("Cerrado", { exact: true })).toHaveCount(0);
  });

  test("Restablecer clave: Cancelar no cambia nada; Confirmar muestra la clave temporal", async ({ page, request }) => {
    const admin = await crearAdmin(request);
    await crearMiembro(request, admin, { nombre: "Hijo Clave" });
    await entrarRapido(page, admin);
    await irAOpcionFamilia(page, "Miembros");
    const confirmar = page.getByRole("dialog", { name: "Restablecer clave" });

    await menu(page, "Acciones de Hijo Clave", "Restablecer clave");
    await expect(confirmar.getByTestId("mensaje-confirmar")).toHaveText("¿Restablecer la clave de Hijo Clave? La clave actual dejará de servir.");
    await confirmar.getByRole("button", { name: "Cancelar" }).click();
    await expect(confirmar).toHaveCount(0);
    await expect(page.getByRole("dialog", { name: "Clave temporal" })).toHaveCount(0);

    await menu(page, "Acciones de Hijo Clave", "Restablecer clave");
    await confirmar.getByRole("button", { name: "Confirmar" }).click();
    await expect(page.getByRole("dialog", { name: "Clave temporal" })).toBeVisible();
    await expect(page.getByRole("dialog", { name: "Clave temporal" }).getByRole("button", { name: "Listo" })).toBeFocused(); // el foco no se pelea entre dialogos
  });
});
