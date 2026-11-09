import { useState } from "react";
import { useAviso } from "../../core/Aviso";
import { Fondo } from "../../core/DialogoAnular";
import Encabezado from "../../core/Encabezado";
import { Boton, Cargando, ErrorCaja, Tarjeta, useCarga } from "../../core/ui";
import { useAuth } from "../auth/AuthContext";
import { aplicarPreferencia, cambiarPreferencia, obtenerPrivacidad } from "./api";
import { NOMBRES, type Preferencia } from "./visibilidad";

const OPCIONES: { valor: Preferencia; icono: string; titulo: string; texto: string }[] = [
  { valor: "familia", icono: "👨‍👩‍👧", titulo: NOMBRES.familia, texto: "Lo que registres lo verá toda la familia." },
  { valor: "solo_yo", icono: "🔒", titulo: NOMBRES.solo_yo, texto: "Lo que registres solo lo verás tú." },
];

/** Familia > Mi perfil > Privacidad: tu preferencia por defecto y "Aplicar a mis registros anteriores". */
export default function PaginaPrivacidad() {
  const avisar = useAviso();
  const { usuario, actualizarUsuario } = useAuth();
  const { datos, error, cargando, recargar } = useCarga(() => obtenerPrivacidad(), []);
  const [confirmando, setConfirmando] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [errorAccion, setErrorAccion] = useState<string | null>(null);

  async function elegir(v: Preferencia) {
    if (!datos || v === datos.visibilidad_defecto) return;
    setErrorAccion(null);
    try {
      await cambiarPreferencia(v);
      if (usuario) actualizarUsuario({ ...usuario, visibilidad_defecto: v });
      avisar("Preferencia guardada: vale para lo que registres desde ahora");
      recargar();
    } catch (e) {
      setErrorAccion((e as Error).message);
    }
  }

  async function aplicar() {
    if (!datos) return;
    setOcupado(true);
    setErrorAccion(null);
    try {
      const r = await aplicarPreferencia(datos.registros_distintos);
      setConfirmando(false);
      avisar(`Listo: ${r.afectados} ${r.afectados === 1 ? "registro cambió" : "registros cambiaron"}`);
      recargar();
    } catch (e) {
      setConfirmando(false);
      setErrorAccion((e as Error).message);
      recargar(); // la cantidad pudo cambiar: se muestra la nueva
    } finally {
      setOcupado(false);
    }
  }

  const n = datos?.registros_distintos ?? 0;
  const actual = datos?.visibilidad_defecto;

  return (
    <div className="space-y-4">
      <Encabezado titulo="Privacidad" volverA="/familia/perfil" />
      {cargando && !datos && <Cargando />}
      <ErrorCaja mensaje={error} />
      {datos && (
        <>
          <Tarjeta className="space-y-3">
            <h2 className="font-titulo font-bold">¿Quién ve lo que registras?</h2>
            <p className="text-sm text-stone-600">
              Es lo que se elige al inicio en cada registro nuevo. Siempre puedes cambiarlo en el momento con “Quién lo ve”.
            </p>
            <div role="radiogroup" aria-label="Preferencia por defecto" className="space-y-2">
              {OPCIONES.map((o) => (
                <button
                  key={o.valor}
                  type="button"
                  role="radio"
                  aria-checked={actual === o.valor}
                  onClick={() => void elegir(o.valor)}
                  className={`w-full min-h-[64px] flex items-center gap-3 text-left px-4 py-2 rounded-tarjeta border-2 ${
                    actual === o.valor ? "border-arca bg-arca-claro" : "border-stone-200 bg-white"
                  }`}
                >
                  <span className="text-2xl" aria-hidden>{o.icono}</span>
                  <span className="flex-1 min-w-0">
                    <span className="block font-semibold">{o.titulo}</span>
                    <span className="block text-sm text-stone-600">{o.texto}</span>
                  </span>
                  {actual === o.valor && <span aria-hidden className="text-xl text-arca">✓</span>}
                </button>
              ))}
            </div>
          </Tarjeta>

          <Tarjeta className="space-y-3">
            <h2 className="font-titulo font-bold">Mis registros anteriores</h2>
            <p className="text-sm text-stone-600" data-testid="cuantos-afecta">
              {n === 0
                ? "Todos tus registros ya tienen tu preferencia."
                : `Aplicar tu preferencia cambiaría ${n} ${n === 1 ? "registro tuyo" : "registros tuyos"}.`}
            </p>
            <Boton variante="suave" className="w-full min-h-[52px]" disabled={n === 0 || ocupado} onClick={() => setConfirmando(true)}>
              Aplicar a mis registros anteriores
            </Boton>
            <ErrorCaja mensaje={errorAccion} />
          </Tarjeta>

          <section data-testid="aviso-privacidad" aria-label="Qué protege y qué no" className="rounded-tarjeta bg-apoyo-claro border border-apoyo/30 p-4 text-apoyo-texto space-y-1">
            <p className="font-titulo font-bold flex items-center gap-2"><span aria-hidden>ℹ️</span> Qué protege y qué no</p>
            <p className="text-sm">
              La privacidad es entre las personas que usan la app: lo que marcas como privado no lo ve nadie más, ni siquiera el administrador de tu familia.
            </p>
            <p className="text-sm">
              Quien administra el servidor puede acceder técnicamente a la base de datos: los datos no van cifrados de extremo a extremo.
            </p>
            <p className="text-sm">
              Si algo ya lo vieron antes de pasarlo a privado, no se puede “des-ver”. Y quien tenga una copia en su teléfono la pierde
              recién cuando ese teléfono se sincroniza con conexión.
            </p>
          </section>
        </>
      )}

      {confirmando && datos && (
        <Fondo alCerrar={() => setConfirmando(false)}>
          <div role="dialog" aria-modal="true" aria-label="Confirmar" className="bg-white rounded-2xl p-5 w-full max-w-[420px] space-y-3">
            <h2 className="font-titulo text-xl font-bold">¿Aplicar a tus registros anteriores?</h2>
            <p className="text-sm" data-testid="confirmar-cuantos">
              Se cambiarán <strong>{n}</strong> {n === 1 ? "registro tuyo" : "registros tuyos"} (gastos, ingresos y apoyos) para que{" "}
              {actual === "solo_yo" ? "solo tú los veas" : "los vea toda la familia"}. Cada cambio queda en el historial.
            </p>
            <div className="grid grid-cols-2 gap-2">
              <Boton variante="suave" onClick={() => setConfirmando(false)} disabled={ocupado}>Cancelar</Boton>
              <Boton onClick={() => void aplicar()} disabled={ocupado}>{ocupado ? "Aplicando..." : `Cambiar ${n}`}</Boton>
            </div>
          </div>
        </Fondo>
      )}
    </div>
  );
}
