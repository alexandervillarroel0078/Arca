import { useState } from "react";
import { Fondo } from "../../core/DialogoAnular";
import { Boton, ErrorCaja } from "../../core/ui";
import { editarApoyo } from "../apoyos/api";
import { editarMovimiento } from "../movimientos/api";
import SelectorVisibilidad, { type Seleccion } from "./SelectorVisibilidad";
import { visibilidadDe, type ConVisibilidad } from "./visibilidad";

export interface PedidoCompartir {
  clase: "movimiento" | "apoyo";
  id: number;
  titulo: string;
  registro: ConVisibilidad;
}

/** "Compartir...": cambia quien ve un registro (solo su dueno). Pasa por la cola: tambien funciona sin internet. */
export default function DialogoCompartir({
  pedido,
  alCerrar,
  alGuardar,
}: {
  pedido: PedidoCompartir;
  alCerrar: () => void;
  alGuardar: () => void;
}) {
  const [sel, setSel] = useState<Seleccion>({
    visibilidad: visibilidadDe(pedido.registro),
    compartido_con: pedido.registro.compartido_con ?? [],
  });
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function guardar() {
    setError(null);
    setEnviando(true);
    try {
      const cambios = { visibilidad: sel.visibilidad, compartido_con: sel.visibilidad === "elegidas" ? sel.compartido_con : [] };
      if (pedido.clase === "apoyo") await editarApoyo(pedido.id, cambios);
      else await editarMovimiento(pedido.id, cambios);
      alGuardar();
      alCerrar();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Fondo
      alCerrar={alCerrar}
      sinGuardar={sel.visibilidad !== visibilidadDe(pedido.registro) || sel.compartido_con.join() !== (pedido.registro.compartido_con ?? []).join()}
    >
      <div role="dialog" aria-modal="true" aria-label="Compartir" className="bg-white rounded-2xl p-5 w-full max-w-[420px] max-h-[calc(100dvh-2rem)] overflow-y-auto space-y-4">
        <div>
          <h2 className="font-titulo text-xl font-bold">Compartir</h2>
          <p className="text-sm text-stone-600 break-words" data-testid="titulo-compartir">{pedido.titulo}</p>
        </div>
        <SelectorVisibilidad valor={sel} alCambiar={setSel} />
        <ErrorCaja mensaje={error} />
        <div className="grid grid-cols-2 gap-2">
          <Boton variante="suave" onClick={alCerrar}>Cancelar</Boton>
          <Boton onClick={guardar} disabled={enviando || (sel.visibilidad === "elegidas" && sel.compartido_con.length === 0)}>
            {enviando ? "Guardando..." : "Guardar"}
          </Boton>
        </div>
      </div>
    </Fondo>
  );
}
