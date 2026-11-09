import { Fondo } from "../../core/DialogoAnular";
import { Boton, Cargando, ErrorCaja, Vacio, useCarga } from "../../core/ui";
import { cadenaHistorial, type EntidadHistorial } from "./api";
import EntradaHistorialVista from "./EntradaHistorialVista";

export interface PedidoHistorial {
  entidad: EntidadHistorial;
  id: number;
  titulo: string; // "Almuerzo familiar · Bs 60.00"
}

/** "Ver historial": lista cronologica de lo que se hizo con un registro. */
export default function DialogoHistorial({ pedido, alCerrar }: { pedido: PedidoHistorial; alCerrar: () => void }) {
  const { datos, error, cargando } = useCarga(() => cadenaHistorial(pedido.entidad, pedido.id), [pedido.entidad, pedido.id]);
  return (
    <Fondo alCerrar={alCerrar}>
      <div role="dialog" aria-modal="true" aria-label="Historial" className="bg-white rounded-2xl p-5 w-full max-w-[420px] max-h-[85vh] flex flex-col">
        <h2 className="font-titulo text-xl font-bold">Historial</h2>
        <p className="text-sm text-stone-600 mb-2" data-testid="titulo-historial">{pedido.titulo}</p>
        <div className="overflow-y-auto flex-1 -mx-1 px-1">
          {cargando && !datos && <Cargando />}
          <ErrorCaja mensaje={error} />
          {datos && datos.items.length === 0 && (
            <Vacio texto="Sin historial: este registro es anterior a la función de historial." />
          )}
          {datos && datos.items.length > 0 && (
            <ul className="divide-y divide-stone-100">
              {datos.items.map((e) => (
                <EntradaHistorialVista key={e.id} e={e} />
              ))}
            </ul>
          )}
        </div>
        <Boton className="w-full mt-3" onClick={alCerrar}>Cerrar</Boton>
      </div>
    </Fondo>
  );
}
