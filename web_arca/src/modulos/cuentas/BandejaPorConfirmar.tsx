import { useState } from "react";
import { useAviso } from "../../core/Aviso";
import { Fondo } from "../../core/DialogoAnular";
import { useConfirmar } from "../../core/DialogoConfirmar";
import { ahoraLaPaz, fechaCorta, nombreMes } from "../../core/formato";
import { Boton, Campo, ErrorCaja, Tarjeta, claseInput, useCarga } from "../../core/ui";
import { confirmarPago, listarPorConfirmar, rechazarPago, type MovimientoCuenta } from "./api";
import { EnlaceOrigen, NOMBRE_ORIGEN, useManejoError } from "./componentes";
import { formatearTexto } from "./montos";
import { refrescarPorConfirmar } from "./porConfirmar";

/**
 * Lo que dice el diálogo al confirmar: el pago toma la fecha y hora de AHORA (La Paz). Si eso cambia el día (o el mes) en
 * que aparece en Cuentas respecto de la fecha del registro, se dice.
 */
export function mensajeConfirmar(m: Pick<MovimientoCuenta, "tipo" | "monto" | "moneda" | "fecha" | "cuenta_nombre" | "origen_tipo">, ahora = ahoraLaPaz()): string {
  const que = m.origen_tipo ? NOMBRE_ORIGEN[m.origen_tipo].toLowerCase() : "registro";
  const verbo = m.tipo === "deposito" ? "Se sumarán" : "Se descontarán";
  const base = `${verbo} ${formatearTexto(m.monto, m.moneda)} ${m.tipo === "deposito" ? "a" : "de"} ${m.cuenta_nombre} con la fecha y hora de ahora (hoy ${ahora.hora}).`;
  if (m.fecha === ahora.fecha) return base;
  const otroMes = m.fecha.slice(0, 7) !== ahora.fecha.slice(0, 7);
  return `${base} El ${que} es del ${fechaCorta(m.fecha, { hoy: ahora.fecha })}: en Cuentas quedará hoy${otroMes ? `, en ${nombreMes(ahora.fecha.slice(0, 7))}` : ""}.`;
}

function DialogoRechazar({ m, alCerrar, alRechazar }: { m: MovimientoCuenta; alCerrar: () => void; alRechazar: (motivo: string) => Promise<void> }) {
  const [motivo, setMotivo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const que = m.origen_tipo ? NOMBRE_ORIGEN[m.origen_tipo].toLowerCase() : "registro";
  return (
    <Fondo alCerrar={alCerrar} sinGuardar={motivo.trim() !== ""} enfoque="dialogo">
      <div role="dialog" aria-modal="true" aria-label="Rechazar pago" className="bg-white rounded-tarjeta p-5 w-full max-w-[400px] max-h-[calc(100dvh-2rem)] overflow-y-auto space-y-3">
        <h2 className="font-titulo text-xl font-bold">Rechazar pago</h2>
        <p className="text-stone-700">
          No se descontará de {m.cuenta_nombre}. El {que} de {m.usuario_nombre} no se anula: pasa a Efectivo y se le avisa.
        </p>
        <Campo etiqueta="Motivo (opcional)">
          <input className={claseInput} value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={300} />
        </Campo>
        <ErrorCaja mensaje={error} />
        <div className="grid grid-cols-2 gap-2">
          <Boton variante="suave" onClick={alCerrar} disabled={ocupado}>Cancelar</Boton>
          <Boton
            variante="peligro"
            disabled={ocupado}
            onClick={async () => {
              setOcupado(true);
              setError(null);
              try {
                await alRechazar(motivo.trim());
                alCerrar();
              } catch (e) {
                setError((e as Error).message);
                setOcupado(false);
              }
            }}
          >
            {ocupado ? "Rechazando..." : "Rechazar"}
          </Boton>
        </div>
      </div>
    </Fondo>
  );
}

/**
 * Bandeja "Por confirmar" (arriba de Cuentas): pagos con banco que otra persona registró en una cuenta de la que eres dueño o
 * encargado. No suman al saldo hasta que los confirmas. Sin pendientes, no se dibuja.
 */
export default function BandejaPorConfirmar({ alCambiar }: { alCambiar: () => void }) {
  const avisar = useAviso();
  const { datos, recargar } = useCarga(() => listarPorConfirmar(), []);
  const { confirmar, dialogo } = useConfirmar();
  const [rechazando, setRechazando] = useState<MovimientoCuenta | null>(null);
  const despues = () => {
    recargar();
    alCambiar();
    void refrescarPorConfirmar();
  };
  const manejarError = useManejoError(despues);

  if (!datos || datos.length === 0) return null;
  return (
    <section aria-labelledby="titulo-por-confirmar" data-testid="bandeja-por-confirmar" className="space-y-2">
      <h2 id="titulo-por-confirmar" className="font-titulo text-lg font-bold">
        Por confirmar <span className="ml-1 rounded-full bg-arca px-2 py-0.5 align-middle text-sm text-white">{datos.length}</span>
      </h2>
      <p className="text-sm text-stone-600">Pagos con banco registrados en tus cuentas. No cuentan en el saldo hasta que los confirmes.</p>
      <ul className="space-y-2" aria-label="Por confirmar">
        {datos.map((m) => {
          const que = m.origen_tipo ? NOMBRE_ORIGEN[m.origen_tipo] : "Registro";
          return (
            <li key={m.id} data-testid="fila-por-confirmar">
              <Tarjeta className="space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold break-words">{que}{m.origen_detalle ? ` · ${m.origen_detalle}` : ""}</p>
                    <p className="text-sm text-stone-600 break-words">
                      de {m.usuario_nombre} · {fechaCorta(m.fecha, { conDia: true, hoy: ahoraLaPaz().fecha })}{m.hora ? ` ${m.hora}` : ""} · {m.cuenta_nombre}
                    </p>
                    {m.origen_id ? <p className="text-sm"><EnlaceOrigen m={m} /></p> : null}
                  </div>
                  <p className={`monto shrink-0 whitespace-nowrap font-titulo text-lg font-bold ${m.tipo === "deposito" ? "text-arca" : ""}`}>
                    {m.tipo === "deposito" ? "+" : "-"}{formatearTexto(m.monto, m.moneda)}
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Boton variante="suave" onClick={() => setRechazando(m)}>Rechazar</Boton>
                  <Boton
                    onClick={() =>
                      confirmar({
                        titulo: "Confirmar pago",
                        mensaje: mensajeConfirmar(m),
                        ejecutar: async () => {
                          try {
                            await confirmarPago(m);
                            avisar("Pago confirmado");
                          } catch (e) {
                            manejarError(e);
                          }
                          despues();
                        },
                      })
                    }
                  >
                    Confirmar
                  </Boton>
                </div>
              </Tarjeta>
            </li>
          );
        })}
      </ul>
      {dialogo}
      {rechazando && (
        <DialogoRechazar
          m={rechazando}
          alCerrar={() => setRechazando(null)}
          alRechazar={async (motivo) => {
            await rechazarPago(rechazando, motivo);
            avisar("Pago rechazado: el registro pasó a Efectivo");
            despues();
          }}
        />
      )}
    </section>
  );
}
