// Fecha y hora de Cuentas: "hoy" y "ahora" en La Paz (no en la zona del aparato) y las reglas de fecha/hora.
import { afterEach, describe, expect, it, vi } from "vitest";
import { ahoraLaPaz, fechaCorta, hoyLaPazISO } from "../../core/formato";
import { erroresFechaHora, fechaHoraCorta, normalizarHora } from "./fechaHora";

afterEach(() => {
  vi.useRealTimers();
});

describe("ahoraLaPaz: el reloj de La Paz (UTC-4), sea cual sea la zona del aparato", () => {
  it("convierte un instante UTC a fecha y hora de La Paz", () => {
    expect(ahoraLaPaz(new Date("2026-11-20T18:37:45Z"))).toEqual({ fecha: "2026-11-20", hora: "14:37" });
  });

  it("cerca de medianoche manda el día de La Paz, no el de UTC", () => {
    expect(ahoraLaPaz(new Date("2026-11-21T03:59:30Z"))).toEqual({ fecha: "2026-11-20", hora: "23:59" });
    expect(ahoraLaPaz(new Date("2026-11-21T04:00:00Z"))).toEqual({ fecha: "2026-11-21", hora: "00:00" });
  });

  it("sin argumento usa el reloj actual; hoyLaPazISO es su fecha", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-01-01T02:15:00Z")); // 22:15 del 31 de diciembre en La Paz
    expect(ahoraLaPaz()).toEqual({ fecha: "2025-12-31", hora: "22:15" });
    expect(hoyLaPazISO()).toBe("2025-12-31");
  });
});

describe("erroresFechaHora", () => {
  const ahora = { fecha: "2026-11-20", hora: "14:37" };
  const ok = { fecha: null, hora: null };

  it("hora vacía vale (hoy: el servidor pone la actual)", () => {
    expect(erroresFechaHora("2026-11-20", "", ahora)).toEqual(ok);
    expect(erroresFechaHora("2026-11-19", "", ahora)).toEqual(ok);
  });

  it("hoy: hasta el minuto actual vale; después no", () => {
    expect(erroresFechaHora("2026-11-20", "14:37", ahora)).toEqual(ok);
    expect(erroresFechaHora("2026-11-20", "14:38", ahora).hora).toBe("La hora no puede ser posterior a la hora actual");
  });

  it("un día pasado admite cualquier hora", () => {
    expect(erroresFechaHora("2026-11-19", "23:59", ahora)).toEqual(ok);
  });

  it("fecha vacía o futura, hora inválida", () => {
    expect(erroresFechaHora("", "", ahora).fecha).toBe("Elige una fecha");
    expect(erroresFechaHora("2026-11-21", "01:00", ahora).fecha).toBe("La fecha no puede ser posterior a hoy");
    expect(erroresFechaHora("2026-11-19", "25:00", ahora).hora).toBe("Escribe una hora válida");
  });

  it("los segundos que agrega algún navegador no cuentan", () => {
    expect(normalizarHora("14:37:59")).toBe("14:37");
    expect(erroresFechaHora("2026-11-20", "14:37:59", ahora)).toEqual(ok);
  });
});

describe("fechaHoraCorta: «Hoy 14:30» con el hoy de La Paz", () => {
  it("con y sin hora", () => {
    expect(fechaHoraCorta("2026-11-20", "14:30", "2026-11-20")).toBe("Hoy 14:30");
    expect(fechaHoraCorta("2026-11-03", "09:05", "2026-11-20")).toBe("3 nov 09:05");
    expect(fechaHoraCorta("2026-11-03", null, "2026-11-20")).toBe("3 nov");
  });

  it("fechaCorta acepta el «hoy» que se le pase (los demás flujos siguen con el del aparato)", () => {
    expect(fechaCorta("2026-11-20", { hoy: "2026-11-20" })).toBe("Hoy");
    expect(fechaCorta("2026-11-20", { hoy: "2026-11-21" })).toBe("20 nov");
  });
});
