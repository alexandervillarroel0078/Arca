import { useEffect, useRef, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { useAviso } from "../../core/Aviso";
import Encabezado, { AccionFija } from "../../core/Encabezado";
import { Boton, Campo, Cargando, ErrorCaja, claseInput, useCarga } from "../../core/ui";
import { nuevoUuid } from "../../core/uuid";
import { useAuth } from "../auth/AuthContext";
import { listarMiembros } from "../familia/api";
import SelectorVisibilidad, { type Seleccion } from "../privacidad/SelectorVisibilidad";
import { catalogo, crearCuenta, editarCuenta, listarMovimientosCuentas, obtenerCuenta, type Cuenta } from "./api";
import { useManejoError } from "./componentes";
import {
  BANCOS_INICIALES, NOMBRE_TIPO, OTRO, PLATAFORMAS_INICIALES, TIPOS, erroresDeCuenta, monedaTrasCambiarTipo, monedasDe, soloUltimos4,
  usaBanco, type FormCuenta, type TipoCuenta,
} from "./matriz";
import { NOMBRE_MONEDA, aTexto, aMonto, type Moneda } from "./montos";

const VACIO: FormCuenta = { nombre: "", tipo: "efectivo", moneda: "BS", banco: "", banco_otro: "", ultimos4: "", saldo_inicial: "" };

function desdeCuenta(c: Cuenta): FormCuenta {
  return {
    nombre: c.nombre, tipo: c.tipo, moneda: c.moneda, banco: c.banco ?? "", banco_otro: c.banco_otro ?? "", ultimos4: c.ultimos4 ?? "",
    saldo_inicial: aTexto(aMonto(c.saldo_inicial) ?? 0n, c.moneda),
  };
}

/** Nueva cuenta (`/cuentas/nueva`) o editar una (`/cuentas/:id/editar`, solo su dueño). */
export default function PaginaCuentaForm() {
  const idParam = useParams().id;
  const editando = idParam !== undefined;
  const id = Number(idParam);
  const { usuario } = useAuth();
  const navegar = useNavigate();
  const avisar = useAviso();

  const existente = useCarga(() => (editando ? obtenerCuenta(id) : Promise.resolve(null)), [idParam]);
  const miembrosQ = useCarga(() => listarMiembros(), []);
  const lista = useCarga(() => catalogo().catch(() => null), []);
  const tieneMovs = useCarga(
    () => (editando ? listarMovimientosCuentas({ cuenta: id, verAnulados: true, limite: 1 }).then((m) => m.length > 0) : Promise.resolve(false)),
    [idParam],
  );
  const alError = useManejoError(existente.recargar);

  const [f, setF] = useState<FormCuenta>(VACIO);
  const [vis, setVis] = useState<Seleccion>({ visibilidad: "familia", compartido_con: [] });
  const [encargado, setEncargado] = useState<number | null>(null);
  const [intento, setIntento] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [errorServidor, setErrorServidor] = useState<string | null>(null);
  const uuid = useRef(nuevoUuid());
  const cargado = useRef(false);

  const c = existente.datos;
  useEffect(() => {
    if (cargado.current || !c) return;
    cargado.current = true;
    setF(desdeCuenta(c));
    setVis({ visibilidad: c.visibilidad, compartido_con: c.compartido_con });
    setEncargado(c.encargado_id);
  }, [c]);

  const bancos = lista.datos?.bancos ?? BANCOS_INICIALES;
  const plataformas = lista.datos?.plataformas ?? PLATAFORMAS_INICIALES;
  const opcionesBanco = f.tipo === "cripto" ? plataformas : bancos;
  const errores = erroresDeCuenta(f);
  const cambiar = (c: Partial<FormCuenta>) => setF((x) => ({ ...x, ...c }));
  const fijo = editando && !!tieneMovs.datos; // con movimientos no se cambia tipo, moneda ni saldo inicial
  const posiblesEncargados = (miembrosQ.datos ?? []).filter((m) => m.activo && m.usuario_id !== (c?.usuario_id ?? usuario?.id));

  function elegirTipo(tipo: TipoCuenta) {
    cambiar({
      tipo,
      moneda: monedaTrasCambiarTipo(tipo, f.moneda),
      banco: usaBanco(tipo) && usaBanco(f.tipo) && (tipo === "cripto") === (f.tipo === "cripto") ? f.banco : "",
      banco_otro: "",
      ultimos4: usaBanco(tipo) ? f.ultimos4 : "",
    });
  }

  async function guardar() {
    setIntento(true);
    setErrorServidor(null);
    if (Object.keys(errores).length > 0) {
      // el botón está abajo: se lleva la vista al primer error para que se vea qué falta
      setTimeout(() => document.querySelector('[role="alert"]')?.scrollIntoView?.({ block: "center", behavior: "smooth" }), 0);
      return;
    }
    setOcupado(true);
    try {
      const saldo = f.saldo_inicial.trim() ? f.saldo_inicial.trim().replace(",", ".") : "0";
      const banco = usaBanco(f.tipo)
        ? { banco: f.banco, banco_otro: f.banco === OTRO ? f.banco_otro.trim() : undefined, ultimos4: f.ultimos4 || undefined }
        : {};
      if (editando && c) {
        const cambios: Record<string, unknown> = {
          nombre: f.nombre.trim(), banco: usaBanco(f.tipo) ? f.banco : null, banco_otro: usaBanco(f.tipo) && f.banco === OTRO ? f.banco_otro.trim() : null,
          ultimos4: usaBanco(f.tipo) && f.ultimos4 ? f.ultimos4 : null, encargado_id: encargado, version_base: c.version,
          visibilidad: vis.visibilidad, compartido_con: vis.visibilidad === "elegidas" ? vis.compartido_con : undefined,
        };
        if (!fijo) Object.assign(cambios, { tipo: f.tipo, moneda: f.moneda, saldo_inicial: saldo });
        const r = await editarCuenta(c.id, cambios);
        avisar("Cuenta guardada");
        navegar(`/cuentas/${r.id}`, { replace: true });
      } else {
        const r = await crearCuenta({
          nombre: f.nombre.trim(), tipo: f.tipo, moneda: f.moneda, saldo_inicial: saldo, ...banco,
          encargado_id: encargado ?? undefined, visibilidad: vis.visibilidad,
          compartido_con: vis.visibilidad === "elegidas" ? vis.compartido_con : undefined, uuid_cliente: uuid.current,
        });
        avisar("Cuenta creada");
        navegar(`/cuentas/${r.id}`, { replace: true });
      }
    } catch (e) {
      setErrorServidor((e as Error).message);
      alError(e);
      setOcupado(false);
    }
  }

  if (editando && existente.cargando && !c) return <Cargando />;
  if (editando && existente.error && !c) {
    return (
      <div className="space-y-4">
        <Encabezado titulo="Editar cuenta" volverA="/cuentas" />
        <ErrorCaja mensaje={existente.error} />
      </div>
    );
  }
  // solo el dueño edita (lo dice la API); si no lo es, se vuelve al detalle
  if (editando && c && !c.es_dueno) return <Navigate to={`/cuentas/${c.id}`} replace />;

  const m = (k: keyof FormCuenta) => (intento ? errores[k] : null);
  const monedaTexto = NOMBRE_MONEDA[f.moneda];

  return (
    <div className="space-y-4">
      <Encabezado titulo={editando ? "Editar cuenta" : "Nueva cuenta"} volverA={editando ? `/cuentas/${id}` : "/cuentas"} />

      <Campo etiqueta="Nombre de la cuenta" error={m("nombre")}>
        <input className={claseInput} maxLength={80} autoComplete="off" value={f.nombre} onChange={(e) => cambiar({ nombre: e.target.value })} placeholder="Ej.: Caja de ahorro Unión" />
      </Campo>

      <div>
        <span id="etiqueta-tipo-cuenta" className="block text-sm font-semibold text-stone-600 mb-1.5">Tipo</span>
        <div role="radiogroup" aria-labelledby="etiqueta-tipo-cuenta" className="grid grid-cols-2 gap-1 bg-stone-200 rounded-xl p-1">
          {TIPOS.map((t) => (
            <button key={t} type="button" role="radio" aria-checked={f.tipo === t} disabled={fijo} onClick={() => elegirTipo(t)}
              className={`min-h-[48px] rounded-lg text-sm font-semibold disabled:opacity-60 ${f.tipo === t ? "bg-white text-arca shadow-sm" : "text-stone-700"}`}>
              {NOMBRE_TIPO[t]}
            </button>
          ))}
        </div>
      </div>

      {usaBanco(f.tipo) && (
        <>
          <Campo etiqueta={f.tipo === "cripto" ? "Plataforma" : "Banco"} error={m("banco")}>
            <select className={claseInput} value={f.banco} onChange={(e) => cambiar({ banco: e.target.value, banco_otro: "" })}>
              <option value="">{f.tipo === "cripto" ? "Elige la plataforma" : "Elige el banco"}</option>
              {opcionesBanco.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          </Campo>
          {f.banco === OTRO && (
            <Campo etiqueta={f.tipo === "cripto" ? "Nombre de la plataforma" : "Nombre del banco"} error={m("banco_otro")}>
              <input className={claseInput} maxLength={60} autoComplete="off" value={f.banco_otro} onChange={(e) => cambiar({ banco_otro: e.target.value })} />
            </Campo>
          )}
          <div>
            <Campo etiqueta="Últimos 4 dígitos (opcional)" error={m("ultimos4")}>
              <input
                className={claseInput}
                inputMode="numeric"
                pattern="[0-9]*"
                autoComplete="off"
                aria-describedby="ayuda-ultimos4"
                value={f.ultimos4}
                onChange={(e) => cambiar({ ultimos4: soloUltimos4(e.target.value) })}
                placeholder="1234"
              />
            </Campo>
            <p id="ayuda-ultimos4" className="mt-1 text-xs text-stone-600">Solo los últimos 4 dígitos, nunca el número completo, ni claves ni frases semilla.</p>
          </div>
        </>
      )}

      <Campo etiqueta="Moneda" error={m("moneda")}>
        <select className={claseInput} value={f.moneda} disabled={fijo} onChange={(e) => cambiar({ moneda: e.target.value as Moneda })}>
          {monedasDe(f.tipo).map((mo) => <option key={mo} value={mo}>{NOMBRE_MONEDA[mo]}</option>)}
        </select>
      </Campo>

      <div>
        <Campo etiqueta={`Saldo inicial (${monedaTexto})`} error={m("saldo_inicial")}>
          <input className={claseInput} inputMode="decimal" autoComplete="off" disabled={fijo} value={f.saldo_inicial} onChange={(e) => cambiar({ saldo_inicial: e.target.value })} placeholder="0.00" />
        </Campo>
        {fijo && <p className="mt-1 text-xs text-stone-600" data-testid="aviso-fijo">Ya tiene movimientos: el tipo, la moneda y el saldo inicial no se cambian. Para corregir el saldo usa un ajuste por conteo.</p>}
      </div>

      <SelectorVisibilidad valor={vis} alCambiar={setVis} />

      <Campo etiqueta="Encargado (opcional)">
        <select className={claseInput} value={encargado ?? ""} onChange={(e) => setEncargado(e.target.value ? Number(e.target.value) : null)}>
          <option value="">Sin encargado</option>
          {posiblesEncargados.map((mi) => <option key={mi.usuario_id} value={mi.usuario_id}>{mi.nombre}</option>)}
        </select>
        <span className="block text-xs text-stone-600 mt-1">El encargado siempre ve la cuenta y puede registrar sus movimientos. Solo tú la editas.</span>
      </Campo>

      <ErrorCaja mensaje={errorServidor} />
      <AccionFija>
        <Boton onClick={guardar} disabled={ocupado}>{ocupado ? "Guardando..." : editando ? "Guardar cambios" : "Crear cuenta"}</Boton>
      </AccionFija>
    </div>
  );
}
