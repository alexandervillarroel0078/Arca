import { useEffect, useState } from "react";
import { useUsuarioOpcional } from "../auth/AuthContext";
import { listarMiembros } from "../familia/api";
import ElegirPersonas from "./ElegirPersonas";
import { NOMBRES, resumenSeleccion, type Visibilidad } from "./visibilidad";

export interface Seleccion {
  visibilidad: Visibilidad;
  compartido_con: number[];
}

const ORDEN: Visibilidad[] = ["solo_yo", "familia", "elegidas"];
const ICONO: Record<Visibilidad, string> = { solo_yo: "🔒", familia: "👨‍👩‍👧", elegidas: "👥" };

/** "Quién lo ve": Solo yo | Familia | Personas... (esta ultima abre la pantalla para elegir miembros). */
export default function SelectorVisibilidad({
  valor,
  alCambiar,
  deshabilitado = false,
}: {
  valor: Seleccion;
  alCambiar: (v: Seleccion) => void;
  deshabilitado?: boolean;
}) {
  const usuario = useUsuarioOpcional();
  const [eligiendo, setEligiendo] = useState(false);
  const [nombres, setNombres] = useState<Record<number, string>>({});

  // nombres de las personas elegidas (para el resumen); sin conexion se usa lo que haya guardado
  useEffect(() => {
    if (valor.visibilidad !== "elegidas") return;
    let vivo = true;
    listarMiembros()
      .then((l) => vivo && setNombres(Object.fromEntries(l.map((m) => [m.usuario_id, m.nombre]))))
      .catch(() => {});
    return () => {
      vivo = false;
    };
  }, [valor.visibilidad]);

  function elegir(v: Visibilidad) {
    if (deshabilitado) return;
    if (v === "elegidas") return setEligiendo(true);
    alCambiar({ visibilidad: v, compartido_con: [] });
  }

  return (
    <div data-testid="selector-visibilidad" className="space-y-2">
      <span id="etiqueta-quien-lo-ve" className="block text-sm font-semibold text-stone-600">Quién lo ve</span>
      <div role="radiogroup" aria-labelledby="etiqueta-quien-lo-ve" className="grid grid-cols-3 gap-1 bg-stone-200 rounded-xl p-1">
        {ORDEN.map((v) => {
          const activa = valor.visibilidad === v;
          return (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={activa}
              disabled={deshabilitado}
              onClick={() => elegir(v)}
              className={`min-h-[52px] rounded-lg text-sm font-semibold flex flex-col items-center justify-center leading-tight ${activa ? "bg-white text-arca shadow-sm" : "text-stone-700"}`}
            >
              <span aria-hidden>{ICONO[v]}</span>
              <span>{NOMBRES[v]}</span>
            </button>
          );
        })}
      </div>
      <p className="text-xs text-stone-600" data-testid="resumen-visibilidad">
        {resumenSeleccion(valor.visibilidad, valor.compartido_con.map((id) => nombres[id]).filter(Boolean))}
        {valor.visibilidad === "elegidas" && (
          <>
            {" · "}
            <button type="button" className="underline font-semibold text-arca min-h-[44px] px-1" onClick={() => setEligiendo(true)}>
              Cambiar personas
            </button>
          </>
        )}
      </p>
      {eligiendo && (
        <ElegirPersonas
          elegidas={valor.compartido_con.filter((id) => id !== usuario?.id)}
          alCancelar={() => setEligiendo(false)}
          alListo={(ids) => {
            setEligiendo(false);
            alCambiar({ visibilidad: "elegidas", compartido_con: ids });
          }}
        />
      )}
    </div>
  );
}
