import { useState, type FormEvent } from "react";
import { useAviso } from "../../core/Aviso";
import Encabezado from "../../core/Encabezado";
import { calcular, etiqueta, hoyLaPaz } from "../../core/periodo";
import { Boton, Campo, Tarjeta, claseInput } from "../../core/ui";
import { useAuth } from "../auth/AuthContext";
import { cambiarDiaInicioMes } from "./api";

/** Como se veria el periodo "Mes" de hoy con ese dia de inicio (para que el efecto se entienda antes de guardar). */
function vistaPrevia(dia: number): string {
  const r = calcular("mes", hoyLaPaz(), dia);
  return etiqueta("mes", r);
}

/** Familia > Mi familia: el nombre y, solo para el administrador, el dia en que empieza el mes de los periodos. */
export default function PaginaMiFamilia() {
  const { usuario, actualizarUsuario } = useAuth();
  const avisar = useAviso();
  const esAdmin = usuario?.rol === "admin";
  const actual = usuario?.dia_inicio_mes ?? 1;
  const [texto, setTexto] = useState(String(actual));
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  const numero = Number(texto);
  const valido = texto.trim() !== "" && Number.isInteger(numero) && numero >= 1 && numero <= 28;

  async function guardar(e: FormEvent) {
    e.preventDefault();
    if (!valido) return setError("Escribe un número entero de 1 a 28");
    setError(null);
    setGuardando(true);
    try {
      const f = await cambiarDiaInicioMes(numero);
      if (usuario) actualizarUsuario({ ...usuario, dia_inicio_mes: f.dia_inicio_mes });
      avisar(`El mes ahora empieza el día ${f.dia_inicio_mes}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="space-y-4">
      <Encabezado titulo="Mi familia" volverA="/familia" />

      <Tarjeta className="flex items-center gap-3">
        <span className="shrink-0 w-14 h-14 rounded-2xl bg-arca-claro flex items-center justify-center text-3xl" aria-hidden>👨‍👩‍👧</span>
        <div className="min-w-0">
          <p className="font-titulo font-bold break-words" data-testid="nombre-familia">{usuario?.familia_nombre}</p>
          <p className="text-sm text-stone-600">{esAdmin ? "Eres administrador de esta familia" : "Eres miembro de esta familia"}</p>
        </div>
      </Tarjeta>

      {esAdmin ? (
        <form onSubmit={guardar} className="space-y-3" aria-label="Periodos">
          <Tarjeta className="space-y-3">
            <h2 className="font-titulo font-bold">Periodos</h2>
            <Campo etiqueta="Día de inicio del mes (1 a 28)" error={error}>
              <input
                className={claseInput}
                type="number"
                inputMode="numeric"
                min={1}
                max={28}
                step={1}
                value={texto}
                onChange={(e) => setTexto(e.target.value)}
              />
            </Campo>
            <div className="rounded-xl bg-arca-claro px-3 py-2 text-sm text-stone-800 space-y-1" data-testid="nota-dia-inicio">
              <p>
                Define cuándo empieza el &quot;mes&quot; en Inicio, Lista, Reportes y Apoyos. Con <strong>1</strong> es el mes calendario.
              </p>
              <p>
                Ejemplo: si tu sueldo llega el 15, pon <strong>15</strong> y el mes irá del 15 de un mes al 14 del siguiente (15 nov - 14 dic).
              </p>
              <p>Solo cambia cómo se agrupan los días en pantalla: no se mueve, cierra ni bloquea ningún registro.</p>
            </div>
            {valido && (
              <p className="text-sm text-stone-700" data-testid="vista-previa-dia-inicio">
                Con el día {numero}, el mes de hoy sería: <strong>{vistaPrevia(numero)}</strong>
              </p>
            )}
          </Tarjeta>
          <Boton type="submit" disabled={guardando || !valido || numero === actual}>
            {guardando ? "Guardando..." : "Guardar"}
          </Boton>
        </form>
      ) : (
        <Tarjeta className="space-y-1">
          <h2 className="font-titulo font-bold">Periodos</h2>
          <p className="text-sm text-stone-700" data-testid="dia-inicio-solo-lectura">
            El mes de tu familia empieza el día {actual}. Solo un administrador puede cambiarlo.
          </p>
        </Tarjeta>
      )}
    </div>
  );
}
