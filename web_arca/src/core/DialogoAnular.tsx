import { useRef, useState, type ReactNode } from "react";
import { useDialogo } from "./useDialogo";
import { Boton, Campo, ErrorCaja, claseInput } from "./ui";

export interface PedidoAnular {
  titulo: string; // "Anular gasto"
  detalle: string; // nombre y monto: "Comida · Bs 45.00"
  advertencia?: string; // "Se anularan tambien 2 devoluciones"
  ejecutar: (motivo: string) => Promise<void>;
}

/** Confirmacion al anular: muestra que se anula, avisa efectos y pide un motivo opcional. */
export default function DialogoAnular({ pedido, alCerrar }: { pedido: PedidoAnular; alCerrar: () => void }) {
  const [motivo, setMotivo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  async function confirmar() {
    setOcupado(true);
    setError(null);
    try {
      await pedido.ejecutar(motivo.trim());
      alCerrar();
    } catch (e) {
      setError((e as Error).message);
      setOcupado(false);
    }
  }

  return (
    // enfoque "dialogo": el motivo es opcional, asi que no se abre el teclado del telefono de golpe sobre los botones
    <Fondo alCerrar={alCerrar} sinGuardar={motivo.trim() !== ""} enfoque="dialogo">
      <div role="dialog" aria-modal="true" aria-label={pedido.titulo} className="bg-white rounded-tarjeta p-5 w-full max-w-[400px] max-h-[calc(100dvh-2rem)] overflow-y-auto space-y-3">
        <h2 className="font-titulo text-xl font-bold">{pedido.titulo}</h2>
        <p className="font-medium" data-testid="detalle-anular">{pedido.detalle}</p>
        <p className="text-sm text-stone-600">No se borra nada: queda en gris y puedes reactivarlo cuando quieras.</p>
        {pedido.advertencia && (
          <p role="alert" className="text-sm rounded-xl bg-apoyo-claro text-apoyo px-3 py-2 font-medium">{pedido.advertencia}</p>
        )}
        <Campo etiqueta="Motivo (opcional)">
          <input className={claseInput} value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={300} />
        </Campo>
        <ErrorCaja mensaje={error} />
        <div className="grid grid-cols-2 gap-2">
          <Boton variante="suave" onClick={alCerrar} disabled={ocupado}>Cancelar</Boton>
          <Boton variante="peligro" onClick={confirmar} disabled={ocupado}>{ocupado ? "Anulando..." : "Anular"}</Boton>
        </div>
      </div>
    </Fondo>
  );
}

/**
 * Fondo oscuro de un dialogo centrado (z-55). Da a todos los dialogos lo mismo: Escape cierra, foco al abrir y al cerrar,
 * Tab atrapado dentro, tocar el fondo cierra (salvo `sinGuardar`: hay datos escritos que se perderian) y, si el dialogo
 * es mas alto que la pantalla (poca altura o teclado abierto), el fondo se desplaza para llegar a todos los botones.
 */
export function Fondo({
  children,
  alCerrar,
  sinGuardar = false,
  enfoque,
}: {
  children: ReactNode;
  alCerrar?: () => void;
  sinGuardar?: boolean;
  enfoque?: "primero" | "dialogo";
}) {
  const ref = useDialogo<HTMLDivElement>({ alCerrar, enfoque });
  const empezoEnFondo = useRef(false);
  const esFondo = (e: { target: EventTarget | null }) => e.target instanceof HTMLElement && e.target.dataset.fondo !== undefined;
  return (
    <div
      ref={ref}
      data-fondo
      className="fixed inset-0 !m-0 z-[55] bg-black/40 overflow-y-auto"
      onPointerDown={(e) => { empezoEnFondo.current = esFondo(e); }}
      onClick={(e) => {
        // solo cierra si el toque empezo y termino en el fondo (no al soltar tras arrastrar o seleccionar texto)
        if (esFondo(e) && empezoEnFondo.current && !sinGuardar) alCerrar?.();
      }}
    >
      <div data-fondo className="min-h-full flex items-center justify-center px-4 py-4">{children}</div>
    </div>
  );
}
