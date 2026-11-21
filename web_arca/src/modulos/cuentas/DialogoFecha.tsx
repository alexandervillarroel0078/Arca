import { useId, useState } from "react";
import { Fondo } from "../../core/DialogoAnular";
import { ahoraLaPaz, hoyLaPazISO } from "../../core/formato";
import { Boton, Campo, ErrorCaja, claseInput } from "../../core/ui";
import { erroresFechaHora, fechaHoraCorta, normalizarHora, type Ahora } from "./fechaHora";

export interface PedidoFecha {
  detalle: string; // "Depósito · Bs 20.00"
  fecha: string; // la fecha actual del movimiento (AAAA-MM-DD)
  hora: string | null; // su hora actual ("HH:MM" de La Paz) o null si no tiene
  /** Guarda la nueva fecha y hora (null = sin hora). Si lanza un error, el diálogo lo muestra y sigue abierto. */
  ejecutar: (fecha: string, hora: string | null) => Promise<void>;
}

/** Error de la fecha elegida, o null si se puede guardar. */
export function errorDeFecha(nueva: string, actual: string, hoy = hoyLaPazISO()): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(nueva)) return "Elige una fecha";
  if (nueva > hoy) return "La fecha no puede ser posterior a hoy";
  if (nueva === actual) return "Es la misma fecha que ya tiene";
  return null;
}

/** Errores del cambio de fecha y hora (La Paz). `igual`: no cambia nada respecto de lo que ya tiene. */
export function erroresCambio(
  fecha: string, hora: string, actual: { fecha: string; hora: string | null }, ahora: Ahora = ahoraLaPaz(),
): { fecha: string | null; hora: string | null } {
  const e = erroresFechaHora(fecha, hora, ahora);
  if (e.fecha || e.hora) return e;
  if (fecha === actual.fecha && (normalizarHora(hora) || null) === actual.hora) return { fecha: "Es la misma fecha y hora que ya tiene", hora: null };
  return e;
}

/**
 * Cambiar la fecha y la hora de un movimiento: lo único que se corrige (el monto, la cuenta y lo demás se anulan y se
 * registran de nuevo). La hora vacía deja el movimiento sin hora.
 */
export default function DialogoFecha({ pedido, alCerrar }: { pedido: PedidoFecha; alCerrar: () => void }) {
  const [fecha, setFecha] = useState(pedido.fecha);
  const [hora, setHora] = useState(pedido.hora ?? "");
  const [intento, setIntento] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [errorServidor, setErrorServidor] = useState<string | null>(null);
  const idTitulo = useId();
  const idAyuda = useId();
  const errores = erroresCambio(fecha, hora, pedido);
  const hayError = !!(errores.fecha || errores.hora);

  async function guardar() {
    setIntento(true);
    setErrorServidor(null);
    if (hayError) return;
    setOcupado(true);
    try {
      await pedido.ejecutar(fecha, normalizarHora(hora) || null);
      alCerrar();
    } catch (e) {
      setErrorServidor((e as Error).message);
      setOcupado(false);
    }
  }

  return (
    <Fondo alCerrar={alCerrar} sinGuardar={fecha !== pedido.fecha || hora !== (pedido.hora ?? "")} enfoque="primero">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={idTitulo}
        aria-describedby={idAyuda}
        className="bg-white rounded-tarjeta p-5 w-full max-w-[400px] max-h-[calc(100dvh-2rem)] overflow-y-auto space-y-3"
      >
        <h2 id={idTitulo} className="font-titulo text-xl font-bold">Cambiar fecha y hora</h2>
        <p className="font-medium" data-testid="detalle-fecha">{pedido.detalle}</p>
        <p id={idAyuda} className="text-sm text-stone-600">
          Fecha actual: {fechaHoraCorta(pedido.fecha, pedido.hora)}{pedido.hora ? "" : " (sin hora)"}. Solo cambia el mes en que
          aparece y su orden; el saldo no cambia. Sin hora, queda sin hora. El cambio queda en el historial.
        </p>
        <form
          onSubmit={(e) => { e.preventDefault(); void guardar(); }}
          className="space-y-3"
          noValidate
        >
          <div className="grid grid-cols-2 gap-2">
            <Campo etiqueta="Nueva fecha" error={intento ? errores.fecha : null}>
              <input
                className={claseInput}
                type="date"
                required
                max={hoyLaPazISO()}
                value={fecha}
                onChange={(e) => setFecha(e.target.value)}
                aria-invalid={intento && !!errores.fecha}
              />
            </Campo>
            <Campo etiqueta="Hora (opcional)" error={intento ? errores.hora : null}>
              <input
                className={claseInput}
                type="time"
                value={hora}
                onChange={(e) => setHora(e.target.value)}
                aria-invalid={intento && !!errores.hora}
              />
            </Campo>
          </div>
          <ErrorCaja mensaje={errorServidor} />
          <div className="grid grid-cols-2 gap-2">
            <Boton type="button" variante="suave" onClick={alCerrar} disabled={ocupado}>Cancelar</Boton>
            <Boton type="submit" disabled={ocupado}>{ocupado ? "Guardando..." : "Guardar"}</Boton>
          </div>
        </form>
      </div>
    </Fondo>
  );
}
