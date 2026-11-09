import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorApi, ErrorRed, api, token } from "./api";

function respuesta(estado: number, cuerpo?: unknown): Response {
  return new Response(cuerpo === undefined ? null : JSON.stringify(cuerpo), {
    status: estado,
    headers: { "Content-Type": "application/json" },
  });
}

describe("cliente HTTP", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("GET sin cuerpo ni token: sin cabeceras de sesion", async () => {
    fetchMock.mockResolvedValue(respuesta(200, { hola: 1 }));
    await expect(api("/x")).resolves.toEqual({ hola: 1 });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/api\/x$/);
    expect(init.method).toBe("GET");
    expect(init.headers.Authorization).toBeUndefined();
    expect(init.body).toBeUndefined();
  });

  it("con cuerpo hace POST en JSON y manda el token guardado", async () => {
    token.guardar("abc123");
    fetchMock.mockResolvedValue(respuesta(201, { id: 5 }));
    await api("/movimientos", { cuerpo: { monto: 10 } });
    const init = fetchMock.mock.calls[0][1];
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer abc123");
    expect(init.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(init.body)).toEqual({ monto: 10 });
  });

  it("respeta el metodo indicado (PATCH)", async () => {
    fetchMock.mockResolvedValue(respuesta(200, {}));
    await api("/x/1", { metodo: "PATCH", cuerpo: { a: 1 } });
    expect(fetchMock.mock.calls[0][1].method).toBe("PATCH");
  });

  it("204 devuelve undefined", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await expect(api("/auth/cambiar-clave", { cuerpo: {} })).resolves.toBeUndefined();
  });

  it("si no hay conexion lanza ErrorRed (sirve para la cola sin internet)", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(api("/x")).rejects.toBeInstanceOf(ErrorRed);
  });

  it("errores del servidor: usa el detalle en texto", async () => {
    fetchMock.mockResolvedValue(respuesta(400, { detail: "La devolucion supera lo pendiente" }));
    const e = (await api("/x", { cuerpo: {} }).catch((x: unknown) => x)) as ErrorApi;
    expect(e).toBeInstanceOf(ErrorApi);
    expect(e.estado).toBe(400);
    expect(e.message).toBe("La devolucion supera lo pendiente");
  });

  it("errores de validacion (422) dicen que campo falla", async () => {
    fetchMock.mockResolvedValue(respuesta(422, { detail: [{ loc: ["body", "email"], msg: "invalid" }] }));
    const e = (await api("/x", { cuerpo: {} }).catch((x: unknown) => x)) as ErrorApi;
    expect(e.message).toBe("Dato inválido (email)");
  });

  it("errores 500 sin detalle dicen 'Error del servidor'; otros, un mensaje generico", async () => {
    fetchMock.mockResolvedValueOnce(respuesta(500, {}));
    expect(((await api("/x").catch((x: unknown) => x)) as ErrorApi).message).toBe("Error del servidor");
    fetchMock.mockResolvedValueOnce(respuesta(404, {}));
    expect(((await api("/x").catch((x: unknown) => x)) as ErrorApi).message).toBe("No se pudo completar la acción");
  });

  it("un 401 con sesion avisa para cerrarla; sin sesion no", async () => {
    const aviso = vi.fn();
    window.addEventListener("arca-sesion-expirada", aviso);
    fetchMock.mockResolvedValue(respuesta(401, { detail: "No autenticado" }));
    await api("/x").catch(() => {});
    expect(aviso).not.toHaveBeenCalled();
    token.guardar("vencido");
    await api("/x").catch(() => {});
    expect(aviso).toHaveBeenCalledTimes(1);
    window.removeEventListener("arca-sesion-expirada", aviso);
  });
});

describe("token", () => {
  it("guarda, lee y borra", () => {
    expect(token.leer()).toBeNull();
    token.guardar("t1");
    expect(token.leer()).toBe("t1");
    token.borrar();
    expect(token.leer()).toBeNull();
  });
});
