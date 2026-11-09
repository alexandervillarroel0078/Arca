import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import "fake-indexeddb/auto";
import { afterEach, beforeEach, vi } from "vitest";
import { reiniciarParaPruebas } from "../core/almacen";
import { reiniciarActualizacion } from "../core/actualizacion";
import { reiniciarServidor } from "../core/servidor";
import { olvidarLecturasDeCache } from "../modulos/sync/cache";

beforeEach(async () => {
  // IndexedDB limpia en cada prueba (la cola y el cache son persistentes)
  await reiniciarParaPruebas();
  olvidarLecturasDeCache();
  reiniciarServidor();
  reiniciarActualizacion();
  globalThis.indexedDB = new IDBFactory();
  localStorage.clear();
  // jsdom no implementa confirm(); por defecto se acepta.
  vi.spyOn(window, "confirm").mockReturnValue(true);
});

afterEach(() => {
  cleanup();
});
