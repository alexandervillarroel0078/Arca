// Bloque C de las mejoras de UX: dialogos accesibles en el navegador real (Escape, foco, trampa de Tab, fondo, poca altura).
import type { Page } from "@playwright/test";
import { abrirLista, apoyoApi, crearAdmin, devolucionApi, entrarRapido, expect, gastoApi, irA, test } from "./ayudas";

const activo = (page: Page) =>
  page.evaluate(() => {
    const e = document.activeElement as HTMLElement | null;
    return e ? (e.getAttribute("aria-label") ?? e.textContent ?? "").trim().slice(0, 40) : "";
  });

/** Pulsa Tab hasta que el foco este en el elemento con ese nombre (maximo 12 veces). */
async function tabHasta(page: Page, nombre: string) {
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press("Tab");
    if ((await activo(page)) === nombre) return;
  }
  throw new Error(`Con Tab no se llego a "${nombre}"`);
}

test.describe("Dialogos accesibles", () => {
  test("Editar devolucion con poca altura (teclado abierto): todo se alcanza con Tab, Tab no sale, Escape cierra y el foco vuelve al menu", async ({ page, request }) => {
    const admin = await crearAdmin(request);
    const ap = await apoyoApi(request, admin, { beneficiario: "Tia Rosa", monto: 300 });
    await devolucionApi(request, admin, ap.id, 100);
    await entrarRapido(page, admin);
    await irA(page, "Apoyos");

    const abrirMenu = page.getByRole("button", { name: /^Acciones de la devolución/ });
    await abrirMenu.click();
    await page.getByRole("menuitem", { name: "Editar devolución" }).click();
    const dialogo = page.getByRole("dialog", { name: "Editar devolución" });
    await expect(dialogo).toBeVisible();

    // Poca altura, como con el teclado del telefono abierto: 390 x 340
    await page.setViewportSize({ width: 390, height: 340 });
    const dentro = async (nombre: string) => {
      const caja = await dialogo.getByRole("button", { name: nombre }).boundingBox();
      expect(caja, nombre).not.toBeNull();
      expect(caja!.y).toBeGreaterThanOrEqual(0);
      expect(caja!.y + caja!.height).toBeLessThanOrEqual(340);
    };

    // desde el monto (autoFocus) se llega a Cancelar y Guardar solo con Tab y quedan a la vista
    await expect(dialogo.getByLabel("Monto (Bs)")).toBeFocused();
    await tabHasta(page, "Cancelar"); // (el campo de fecha tiene varias paradas: dia, mes, anio y calendario)
    await dentro("Cancelar");
    await page.keyboard.press("Tab");
    expect(await activo(page)).toBe("Guardar");
    await dentro("Guardar");

    // Tab no sale del dialogo: del ultimo vuelve al primero; Shift+Tab hace lo contrario
    await page.keyboard.press("Tab");
    await expect(dialogo.getByLabel("Monto (Bs)")).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    expect(await activo(page)).toBe("Guardar");

    // el dialogo se desplaza por dentro: el titulo queda arriba y se alcanza al subir
    await page.keyboard.press("Tab");
    await expect(dialogo.getByLabel("Monto (Bs)")).toBeFocused();
    expect(await dialogo.evaluate((d) => d.scrollHeight > d.clientHeight)).toBe(true); // no cabe: hay desplazamiento propio
    await dialogo.evaluate((d) => d.scrollTo(0, 0));
    await expect(dialogo.getByRole("heading", { name: "Editar devolución" })).toBeInViewport();

    // Escape cierra y el foco vuelve al boton "..." que abrio el menu
    await page.keyboard.press("Escape");
    await expect(dialogo).toHaveCount(0);
    await expect(abrirMenu).toBeFocused();
  });

  test("con datos escritos, tocar el fondo no cierra; Escape si", async ({ page, request }) => {
    const admin = await crearAdmin(request);
    const ap = await apoyoApi(request, admin, { beneficiario: "Tia Rosa", monto: 300 });
    await devolucionApi(request, admin, ap.id, 100);
    await entrarRapido(page, admin);
    await irA(page, "Apoyos");
    await page.getByRole("button", { name: /^Acciones de la devolución/ }).click();
    await page.getByRole("menuitem", { name: "Editar devolución" }).click();
    const dialogo = page.getByRole("dialog", { name: "Editar devolución" });
    await dialogo.getByLabel("Nota (opcional)").fill("cambio a medias");

    // el fondo cubre TODA la pantalla (antes los 16 px de arriba quedaban fuera por el margen de `space-y-4` del contenedor)
    const caja = await page.locator("[data-fondo]").first().boundingBox();
    expect(caja!.y).toBe(0);
    expect(caja!.height).toBe(844);

    await page.mouse.click(5, 5); // el fondo
    await expect(dialogo).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialogo).toHaveCount(0);

    // sin cambios, tocar el fondo si cierra
    await page.getByRole("button", { name: /^Acciones de la devolución/ }).click();
    await page.getByRole("menuitem", { name: "Editar devolución" }).click();
    await expect(dialogo).toBeVisible();
    await page.mouse.click(5, 5);
    await expect(dialogo).toHaveCount(0);
  });

  test("hoja de filtros y menu de fila: Escape cierra y devuelve el foco; el menu se maneja con flechas", async ({ page, request }) => {
    const admin = await crearAdmin(request);
    await gastoApi(request, admin, { monto: 30, nota: "Taxi", categoria: "Transporte" });
    await entrarRapido(page, admin);
    await abrirLista(page);

    const chip = page.getByRole("button", { name: /^Tipo:/ });
    await chip.click();
    await expect(page.getByRole("dialog", { name: "Tipo" })).toBeVisible();
    await expect(page.getByRole("radio", { name: "Todos los tipos" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Tipo" })).toHaveCount(0);
    await expect(chip).toBeFocused();

    const menuTaxi = page.getByRole("button", { name: "Acciones de Taxi", exact: true });
    await menuTaxi.click();
    await expect(page.getByRole("menuitem").first()).toBeFocused();
    await page.keyboard.press("ArrowDown");
    expect(await activo(page)).toBe("Compartir...");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toHaveCount(0);
    await expect(menuTaxi).toBeFocused();

    // anular desde el menu: el dialogo queda con el foco, Escape lo cierra y el foco vuelve al "..."
    await menuTaxi.click();
    await page.getByRole("menuitem", { name: "Anular", exact: true }).click();
    const anular = page.getByRole("dialog", { name: "Anular gasto" });
    await expect(anular).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(anular).toHaveCount(0);
    await expect(menuTaxi).toBeFocused();
  });
});
