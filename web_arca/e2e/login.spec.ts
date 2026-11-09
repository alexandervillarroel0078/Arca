import { crearAdmin, entrar, expect, saldo, sinDesborde, test, unico , cerrarSesion} from "./ayudas";

test.describe("Login y registro", () => {
  test("registro por la interfaz crea cuenta y familia, la sesion sobrevive a recargar y se puede salir y volver a entrar", async ({ page }) => {
    const email = `nuevo.${unico()}@arca.test`;
    await page.goto("/");
    await page.getByText("Crear una cuenta nueva").click();
    await page.getByLabel("Tu nombre").fill("Maria Prueba");
    await page.getByLabel("Nombre de la familia (opcional)").fill("Los Prueba");
    await page.getByLabel("Correo").fill(email);
    await page.getByLabel("Contraseña").fill("Prueba123");
    await page.getByRole("button", { name: "Crear cuenta y familia" }).click();

    await expect(page.getByRole("heading", { name: "Los Prueba" })).toBeVisible();
    await expect(page.getByText("Hola, Maria")).toBeVisible();
    await expect(saldo(page)).toHaveText("Bs 0.00");
    await sinDesborde(page);

    await page.reload();
    await expect(saldo(page)).toBeVisible(); // la sesion se conserva

    await cerrarSesion(page);
    await expect(page.getByRole("button", { name: "Entrar" })).toBeVisible();
    await page.getByLabel("Correo").fill(email);
    await page.getByLabel("Contraseña").fill("Prueba123");
    await page.getByRole("button", { name: "Entrar" }).click();
    await expect(saldo(page)).toBeVisible();
  });

  test("entra con un usuario existente; con la clave equivocada muestra el error y despues deja entrar", async ({ page, request }) => {
    const admin = await crearAdmin(request, { nombre: "Ana Admin" });
    await page.goto("/");
    await page.getByLabel("Correo").fill(admin.email);
    await page.getByLabel("Contraseña").fill("clave-equivocada");
    await page.getByRole("button", { name: "Entrar" }).click();
    await expect(page.getByRole("alert")).toHaveText("Correo o contraseña incorrectos");
    await expect(saldo(page)).toHaveCount(0);

    await page.getByLabel("Contraseña").fill(admin.clave);
    await page.getByRole("button", { name: "Entrar" }).click();
    await expect(saldo(page)).toBeVisible();
    await expect(page.getByText("Hola, Ana")).toBeVisible();
  });

  test("un correo repetido no deja registrarse", async ({ page, request }) => {
    const admin = await crearAdmin(request);
    await page.goto("/");
    await page.getByText("Crear una cuenta nueva").click();
    await page.getByLabel("Tu nombre").fill("Otra Persona");
    await page.getByLabel("Correo").fill(admin.email);
    await page.getByLabel("Contraseña").fill("Prueba123");
    await page.getByRole("button", { name: "Crear cuenta y familia" }).click();
    await expect(page.getByRole("alert")).toHaveText("Ya existe una cuenta con ese correo");
  });

  test("sin sesion cualquier direccion muestra el login", async ({ page }) => {
    for (const ruta of ["/", "/apoyos", "/todos", "/familia"]) {
      await page.goto(ruta);
      await expect(page.getByRole("button", { name: "Entrar" })).toBeVisible();
    }
  });

  test("entrar con el formulario deja ver el saldo y la navegacion de las 4 secciones", async ({ page, request }) => {
    const admin = await crearAdmin(request);
    await entrar(page, admin);
    for (const nombre of ["Inicio", "Apoyos", "Reportes", "Familia"]) {
      await expect(page.getByRole("navigation", { name: "Navegación principal" }).getByRole("link", { name: nombre, exact: true })).toBeVisible();
    }
    expect(page.viewportSize()?.width).toBe(390);
  });
});
