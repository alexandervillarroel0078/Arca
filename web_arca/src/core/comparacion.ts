// Comparacion con el periodo anterior (mismo largo, inmediatamente antes): texto y flecha. Nunca solo color.
import { bs } from "./formato";

export interface Comparacion {
  anterior: number;
  diferencia: number; // actual - anterior, en Bs
  porcentaje: number | null; // nulo si el anterior es 0 (no se divide por cero)
}

export interface DescripcionComparacion {
  flecha: "▲" | "▼" | "＝";
  direccion: "sube" | "baja" | "igual";
  texto: string; // "12 % mas que el periodo anterior"
  detalle: string; // "+Bs 120.00" (o "" si no hay diferencia)
}

const pct = (p: number) => (Number.isInteger(p) ? String(p) : p.toFixed(1));

/** Diferencia en Bs y en porcentaje, ya redactada. Si el anterior fue 0 no hay porcentaje: se dice. */
export function describirComparacion(c: Comparacion): DescripcionComparacion {
  const dif = Math.round(c.diferencia * 100) / 100;
  const direccion = dif > 0 ? "sube" : dif < 0 ? "baja" : "igual";
  const flecha = direccion === "sube" ? "▲" : direccion === "baja" ? "▼" : "＝";
  const detalle = dif === 0 ? "" : `${dif > 0 ? "+" : "-"}${bs(Math.abs(dif))}`;
  if (c.porcentaje === null) {
    return {
      flecha,
      direccion,
      texto: dif === 0 ? "Sin datos en el periodo anterior" : "Sin datos en el periodo anterior para comparar",
      detalle,
    };
  }
  if (dif === 0) return { flecha, direccion, texto: "Igual que el periodo anterior", detalle };
  const p = Math.abs(c.porcentaje);
  if (p === 0) return { flecha, direccion, texto: "Casi igual que el periodo anterior", detalle };
  return { flecha, direccion, texto: `${pct(p)} % ${direccion === "sube" ? "más" : "menos"} que el periodo anterior`, detalle };
}

/** Recalcula una comparacion cuando el valor actual cambia (p. ej. por registros pendientes de enviar). */
export function recomparar(c: Comparacion, actual: number): Comparacion {
  const diferencia = Math.round((actual - c.anterior) * 100) / 100;
  return {
    anterior: c.anterior,
    diferencia,
    porcentaje: c.anterior === 0 ? null : Math.round((diferencia / Math.abs(c.anterior)) * 1000) / 10,
  };
}
