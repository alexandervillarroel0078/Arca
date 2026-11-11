import { Boton } from "../../core/ui";
import { EXPLICACION_SIN_CONEXION, EXPLICACION_SIN_SOPORTE, useDictado } from "./dictadoVoz";

/** Texto fijo, siempre visible junto al botón. */
export const AVISO_PRIVACIDAD_DICTADO =
  "El dictado lo procesa el servicio de voz de tu navegador. Arca no guarda ni recibe el audio. No dictes claves ni frases semilla.";

interface Props {
  /** false mientras la pantalla todavía no cargó las cuentas y los miembros. */
  listo: boolean;
  /** Recibe las alternativas que entendió el reconocedor; la pantalla las interpreta y rellena el formulario. */
  alTerminar: (alternativas: string[]) => void;
  /** Resultado del último dictado, para anunciarlo (aria-live). */
  mensaje: string;
}

/** «Dictar movimiento»: rellena el formulario con lo que dices. Nunca guarda: Guardar sigue siendo el único camino. */
export default function BotonDictar({ listo, alTerminar, mensaje }: Props) {
  const d = useDictado(alTerminar);
  const explicacion = d.soporte === "sin_soporte" ? EXPLICACION_SIN_SOPORTE : d.soporte === "sin_conexion" ? EXPLICACION_SIN_CONEXION : null;
  const puede = d.soporte === "disponible" && listo;
  const texto = d.error ?? mensaje;
  return (
    <section aria-label="Dictar movimiento" data-testid="dictado" className="space-y-2">
      <Boton
        type="button"
        variante="suave"
        className="w-full"
        disabled={!puede}
        aria-pressed={d.escuchando}
        aria-describedby={explicacion ? "dictado-explicacion" : undefined}
        onClick={d.escuchando ? d.detener : d.iniciar}
        data-testid="boton-dictar"
      >
        {d.escuchando ? "⏹ Escuchando… toca para terminar" : "🎤 Dictar movimiento"}
      </Boton>
      {explicacion && (
        <p id="dictado-explicacion" data-testid="dictado-explicacion" className="text-sm font-medium text-stone-700">
          {explicacion}
        </p>
      )}
      {d.escuchando && d.parcial && (
        <p aria-hidden data-testid="dictado-parcial" className="text-sm italic text-stone-600">
          «{d.parcial}»
        </p>
      )}
      <p role="status" aria-live="polite" data-testid="dictado-estado" className={texto ? "text-sm font-semibold text-stone-800" : "sr-only"}>
        {texto}
      </p>
      <p data-testid="dictado-privacidad" className="flex items-start gap-1.5 rounded-xl bg-apoyo-claro px-3 py-2 text-sm font-medium text-apoyo-texto">
        <span aria-hidden>🔒</span>
        <span>{AVISO_PRIVACIDAD_DICTADO}</span>
      </p>
    </section>
  );
}
