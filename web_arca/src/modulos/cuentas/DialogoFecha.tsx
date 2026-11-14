import { useId, useState } from "react";
import { Fondo } from "../../core/DialogoAnular";
import { fechaCorta, hoyISO } from "../../core/formato";
import { Boton, Campo, ErrorCaja, claseInput } from "../../core/ui";

export interface PedidoFecha {
  detalle: string; // "Depósito · Bs 20.00"
  fecha: string; // la fecha actual del movimiento (AAAA-MM-DD)
  /** Guarda la nueva fecha. Si lanza un error, el diálogo lo muestra y sigue abierto. */
  ejecutar: (fecha: string) => Promise<void>;
}

/** Error de la fecha elegida, o null si se puede guardar. */
export function errorDeFecha(nueva: string, actual: string, hoy = hoyISO()): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(nueva)) return "Elige una fecha";
  if (nueva > hoy) return "La fecha no puede ser posterior a hoy";
  if (nueva === actual) return "Es la misma fecha que ya tiene";
  return null;
}

/** Cambiar la fecha de un movimiento: lo único que se corrige (el monto, la cuenta y lo demás se anulan y se registran de nuevo). */
export default function DialogoFecha({ pedido, alCerrar }: { pedido: PedidoFecha; alCerrar: () => void }) {
  const [fecha, setFecha] = useState(pedido.fecha);
  const [intento, setIntento] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [errorServidor, setErrorServidor] = useState<string | null>(null);
  const idTitulo = useId();
  const idAyuda = useId();
  const error = errorDeFecha(fecha, pedido.fecha);

  async function guardar() {
    setIntento(true);
    setErrorServidor(null);
    if (error) return;
    setOcupado(true);
    try {
      await pedido.ejecutar(fecha);
      alCerrar();
    } catch (e) {
      setErrorServidor((e as Error).message);
      setOcupado(false);
    }
  }

  return (
    <Fondo alCerrar={alCerrar} sinGuardar={fecha !== pedido.fecha} enfoque="primero">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={idTitulo}
        aria-describedby={idAyuda}
        className="bg-white rounded-tarjeta p-5 w-full max-w-[400px] max-h-[calc(100dvh-2rem)] overflow-y-auto space-y-3"
      >
        <h2 id={idTitulo} className="font-titulo text-xl font-bold">Cambiar fecha</h2>
        <p className="font-medium" data-testid="detalle-fecha">{pedido.detalle}</p>
        <p id={idAyuda} className="text-sm text-stone-600">
          Fecha actual: {fechaCorta(pedido.fecha)}. Solo cambia el mes en que aparece; el saldo no cambia. El cambio queda en el historial.
        </p>
        <form
          onSubmit={(e) => { e.preventDefault(); void guardar(); }}
          className="space-y-3"
          noValidate
        >
          <Campo etiqueta="Nueva fecha" error={intento ? error : null}>
            <input
              className={claseInput}
              type="date"
              required
              max={hoyISO()}
              value={fecha}
              onChange={(e) => setFecha(e.target.value)}
              aria-invalid={intento && !!error}
            />
          </Campo>
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
