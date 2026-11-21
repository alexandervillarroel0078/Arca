"""Logica de Cuentas.

Reglas clave (ver tambien `monedas.py`, `nombres.py` y `visibilidad/service.py`):
- Ver: dueno, toda la familia si es 'familia', los elegidos y SIEMPRE el encargado. Lo que no ves es 404 (nunca 403).
- Registrar movimientos: dueno o encargado de la cuenta, NUNCA el admin por serlo. En un traspaso, de AMBAS cuentas.
- Solo el dueno edita la cuenta, cambia su visibilidad y designa al encargado.
- El saldo no se guarda: saldo_inicial + movimientos activos y CONFIRMADOS. Excluye anulados, pendientes y rechazados; los totales por moneda,
  ademas, excluyen cuentas anuladas. Saldo negativo permitido (se avisa, no se bloquea).
- Todo registro de movimiento bloquea (SELECT ... FOR UPDATE, en orden de id) las cuentas que toca: el ajuste por
  conteo calcula su diferencia sobre un saldo que nadie mas puede cambiar mientras tanto.
- Los nombres de cuenta SOLO salen por `nombres.nombres_para`.
- Un movimiento no se edita: se anula y se reactiva. La UNICA excepcion es su fecha y su hora
  (`cambiar_fecha_movimiento`), y nunca las de un ajuste por conteo. Ninguna fecha/hora (al crear ni al corregir) puede
  ser posterior al momento actual en La Paz (`_hora_valida`).
- La hora es LOCAL de La Paz, sin zona, por minutos y opcional (nula en lo anterior a la 0009). `fecha` manda en
  filtros y periodos; la hora solo ordena dentro del dia (`ORDEN_MOVIMIENTOS`).
"""
from datetime import date, time, timedelta
from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy import and_, case, exists, func, or_, select
from sqlalchemy.orm import Session

from app.core.anulable import (
    ahora as ahora_utc, auditoria, exigir_activo, exigir_version, limpiar_anulacion, marcar_anulacion, marcar_edicion, nombres_usuarios,
)
from app.core.deps import Contexto
from app.modulos.cuentas import nombres
from app.modulos.cuentas.models import Cuenta, CuentaMovimiento as CM
from app.modulos.cuentas.monedas import (
    BANCOS, DECIMALES, MONEDAS_POR_TIPO, PLATAFORMAS, AVISO_NOTA, con_moneda, texto, validar_cuenta, validar_monto,
)
from app.modulos.cuentas.schemas import (
    AjusteCrear, Catalogo, CuentaCrear, CuentaEditar, CuentaFuenteOut, CuentaOut, CuentasOut, DepositoCrear,
    MovimientoCuentaOut, MovimientoFechaEditar, PersonaIn, PorConfirmarResumen, RechazoAviso, RetiroCrear, TotalMoneda,
    TraspasoCrear,
)
from app.modulos.familia.models import Miembro
from app.modulos.historial import service as historial
from app.modulos.periodos.calculo import ahora_la_paz
from app.modulos.visibilidad import cambios as visib
from app.modulos.visibilidad import service as vis

OTRA = nombres.OTRA_CUENTA


def hora_texto(h: time | None) -> str | None:
    """"HH:MM" (la hora se guarda y se muestra por minutos) o None."""
    return h.strftime("%H:%M") if h is not None else None


# Mas reciente primero: por dia, luego por hora (lo antiguo sin hora va al final de su dia) y por orden de registro.
ORDEN_MOVIMIENTOS = (CM.fecha.desc(), CM.hora.desc().nulls_last(), CM.id.desc())


# ------------------------------------------------------------------ saldos (calculados, nunca guardados)
def _efecto_origen():
    """Efecto de un movimiento ACTIVO sobre su cuenta de origen (`cuenta_id`)."""
    return case(
        (CM.tipo == "deposito", CM.monto),
        (CM.tipo == "retiro", -(CM.monto + func.coalesce(CM.comision, 0))),  # la comision se descuenta ademas del monto
        (CM.tipo == "traspaso", -CM.monto),
        (and_(CM.tipo == "ajuste", CM.sentido == "entrada"), CM.monto),
        (and_(CM.tipo == "ajuste", CM.sentido == "salida"), -CM.monto),
        else_=0,
    )


def saldos(db: Session, cuentas: list[Cuenta]) -> dict[int, Decimal]:
    """saldo_inicial + movimientos activos Y confirmados (los anulados, pendientes y rechazados no cuentan). Un
    traspaso resta del origen y suma al destino."""
    ids = [c.id for c in cuentas]
    if not ids:
        return {}
    total = {c.id: Decimal(c.saldo_inicial) for c in cuentas}
    for cid, suma in db.execute(
        select(CM.cuenta_id, func.sum(_efecto_origen())).where(CM.cuenta_id.in_(ids), CM.anulado.is_(False), CM.estado == "confirmado").group_by(CM.cuenta_id)
    ):
        total[cid] += suma
    for cid, suma in db.execute(
        select(CM.cuenta_destino_id, func.sum(CM.monto))
        .where(CM.cuenta_destino_id.in_(ids), CM.tipo == "traspaso", CM.anulado.is_(False), CM.estado == "confirmado")
        .group_by(CM.cuenta_destino_id)
    ):
        total[cid] += suma
    return total


def efecto_en(m: CM, cuenta_id: int) -> Decimal:
    """Lo que un movimiento suma (+) o resta (-) a UNA cuenta (misma regla que el SQL de `saldos`). Es lo que haria si
    estuviera confirmado: un pendiente o rechazado no suma al saldo (ver `estado` en la salida)."""
    if m.cuenta_destino_id == cuenta_id:
        return m.monto
    if m.tipo == "deposito" or (m.tipo == "ajuste" and m.sentido == "entrada"):
        return m.monto
    if m.tipo == "retiro":
        return -(m.monto + (m.comision or 0))
    return -m.monto  # traspaso (origen) o ajuste de salida


# ------------------------------------------------------------------ permisos
def es_dueno_o_encargado(ctx: Contexto, c: Cuenta) -> bool:
    return c.usuario_id == ctx.usuario.id or c.encargado_id == ctx.usuario.id


def _exigir_registrar(ctx: Contexto, cuentas: list[Cuenta]) -> None:
    """403 si el usuario (que ya VE las cuentas) no es dueno o encargado de TODAS. El admin no es excepcion."""
    if not all(es_dueno_o_encargado(ctx, c) for c in cuentas):
        raise HTTPException(
            status_code=403,
            detail="Solo el dueño o el encargado de la cuenta puede registrar o anular sus movimientos",
        )


def _exigir_dueno(ctx: Contexto, c: Cuenta) -> None:
    if c.usuario_id != ctx.usuario.id:
        raise HTTPException(status_code=403, detail="Solo quien creó la cuenta puede modificarla")


def _ver_cuenta(db: Session, ctx: Contexto, cuenta_id: int, bloquear: bool = False) -> Cuenta:
    c = db.get(Cuenta, cuenta_id)
    vis.exigir_ver(db, ctx, c, "Cuenta")  # otra familia, privada de otro o inexistente: el mismo 404
    if bloquear:
        c = db.scalars(
            select(Cuenta).where(Cuenta.id == cuenta_id).with_for_update().execution_options(populate_existing=True)
        ).one()
    return c


def _bloquear(db: Session, ids) -> dict[int, Cuenta]:
    """SELECT ... FOR UPDATE de las cuentas, siempre en orden de id (sin interbloqueos entre traspasos cruzados)."""
    filas = db.scalars(
        select(Cuenta).where(Cuenta.id.in_(sorted(set(ids)))).order_by(Cuenta.id).with_for_update()
        .execution_options(populate_existing=True)
    ).all()
    return {c.id: c for c in filas}


def _exigir_cuenta_activa(c: Cuenta) -> None:
    if c.anulado:
        raise HTTPException(status_code=400, detail="La cuenta está anulada: reactívala antes de usarla")


def _hora_valida(fecha: date, hora: time | None, poner_actual: bool = True) -> time | None:
    """Valida la fecha (nunca futura) y la hora LOCAL de La Paz (por minutos, sin zona). Si es hoy: una hora posterior a
    la actual es 422 y, sin hora, `poner_actual` pone la de ahora. Un solo reloj para fecha y hora (sin saltos a medianoche)."""
    if hora is not None and hora.tzinfo is not None:
        raise HTTPException(status_code=422, detail="La hora va sin zona horaria: es la hora de La Paz")
    ahora = ahora_la_paz()
    if fecha > ahora.date():
        raise HTTPException(status_code=422, detail="La fecha no puede ser posterior a hoy")
    actual = time(ahora.hour, ahora.minute)
    if hora is not None:
        hora = hora.replace(second=0, microsecond=0)
    if fecha == ahora.date():
        if hora is None and poner_actual:
            return actual
        if hora is not None and hora > actual:
            raise HTTPException(status_code=422, detail="La hora no puede ser posterior a la hora actual")
    return hora


def _ya_aplicada(db: Session, ctx: Contexto, entidad: str, entidad_id: int) -> bool:
    return historial.operacion_aplicada(db, ctx.familia_id, ctx.uuid_operacion, entidad, entidad_id)


# ------------------------------------------------------------------ armado de salidas
def armar_cuentas(db: Session, ctx: Contexto, cuentas: list[Cuenta]) -> list[CuentaOut]:
    uid = ctx.usuario.id
    propias = [c.id for c in cuentas if c.usuario_id == uid and c.visibilidad == "elegidas"]
    personas = vis.compartidos_de(db, "cuenta", propias)
    nom = nombres_usuarios(
        db, {c.usuario_id for c in cuentas} | {c.encargado_id for c in cuentas}
        | {c.anulado_por for c in cuentas} | {c.editado_por for c in cuentas},
    )
    sal = saldos(db, cuentas)
    nom_cuentas = nombres.nombres_para(db, ctx, [c.id for c in cuentas])  # UNICA fuente de nombres de cuenta
    salida = []
    for c in cuentas:
        saldo = sal[c.id]
        salida.append(CuentaOut(
            id=c.id, nombre=nom_cuentas[c.id], tipo=c.tipo, banco=c.banco,
            banco_otro=c.banco_otro, moneda=c.moneda, ultimos4=c.ultimos4,
            saldo_inicial=texto(c.saldo_inicial, c.moneda), saldo=texto(saldo, c.moneda), saldo_negativo=saldo < 0,
            visibilidad=c.visibilidad, compartido_con=personas.get(c.id, []), usuario_id=c.usuario_id,
            usuario_nombre=nom.get(c.usuario_id, ""), encargado_id=c.encargado_id,
            encargado_nombre=nom.get(c.encargado_id) if c.encargado_id else None, es_dueno=c.usuario_id == uid,
            puede_registrar=es_dueno_o_encargado(ctx, c), **auditoria(c, nom),
        ))
    return salida


def armar_movimientos(
    db: Session, ctx: Contexto, movs: list[CM], cuenta_ref: int | None = None, resultado: dict | None = None
) -> list[MovimientoCuentaOut]:
    """`cuenta_ref`: en la lista de una cuenta, calcula el efecto sobre ESA cuenta. `resultado`: {mov_id: saldo despues}."""
    ids = {m.cuenta_id for m in movs} | {m.cuenta_destino_id for m in movs if m.cuenta_destino_id}
    ve = nombres.visibles(db, ctx, ids)
    nom_cuentas = nombres.nombres_para(db, ctx, ids)  # UNICA fuente de nombres de cuenta ("otra cuenta" si no la ves)
    cuentas = {c.id: c for c in db.scalars(select(Cuenta).where(Cuenta.id.in_(ve)))} if ve else {}
    nom = nombres_usuarios(
        db, {m.usuario_id for m in movs} | {m.persona_usuario_id for m in movs}
        | {m.anulado_por for m in movs} | {m.editado_por for m in movs} | {m.confirmado_por for m in movs}
        | {c.usuario_id for c in cuentas.values()},
    )
    origen = _datos_origen(db, ctx, movs)
    salida = []
    for m in movs:
        tocadas = [m.cuenta_id] + ([m.cuenta_destino_id] if m.cuenta_destino_id else [])
        duenio_de_todas = all(i in cuentas and es_dueno_o_encargado(ctx, cuentas[i]) for i in tocadas)
        registrable = duenio_de_todas and m.origen_id is None  # un vinculado es de solo lectura en Cuentas
        pendiente = m.estado == "pendiente" and not m.anulado
        persona = nom.get(m.persona_usuario_id) if m.persona_tipo == "miembro" else m.persona_nombre
        extra = {}
        if resultado is not None and m.id in resultado:
            extra = {"saldo_resultante": texto(resultado[m.id], m.moneda), "deja_saldo_negativo": resultado[m.id] < 0}
        salida.append(MovimientoCuentaOut(
            id=m.id, tipo=m.tipo, moneda=m.moneda, monto=texto(m.monto, m.moneda), comision=texto(m.comision, m.moneda),
            sentido=m.sentido, saldo_previo=texto(m.saldo_previo, m.moneda), saldo_declarado=texto(m.saldo_declarado, m.moneda),
            fecha=m.fecha, hora=hora_texto(m.hora), nota=m.nota,
            cuenta_id=m.cuenta_id if m.cuenta_id in ve else None, cuenta_nombre=nom_cuentas[m.cuenta_id],
            cuenta_destino_id=m.cuenta_destino_id if m.cuenta_destino_id in ve else None,
            cuenta_destino_nombre=nom_cuentas[m.cuenta_destino_id] if m.cuenta_destino_id else None,
            persona_tipo=m.persona_tipo, persona_usuario_id=m.persona_usuario_id if m.persona_tipo == "miembro" else None,
            persona_nombre=persona, usuario_id=m.usuario_id, usuario_nombre=nom.get(m.usuario_id, ""),
            puede_registrar=registrable,
            efecto=texto(efecto_en(m, cuenta_ref), m.moneda) if cuenta_ref is not None else None,
            estado=m.estado, hora_registrada=hora_texto(m.hora_registrada), confirmado_por=m.confirmado_por,
            confirmado_por_nombre=nom.get(m.confirmado_por) if m.confirmado_por else None,
            confirmado_en=m.confirmado_en, motivo_rechazo=m.motivo_rechazo,
            puede_confirmar=pendiente and duenio_de_todas,
            confirma_nombre=nom.get(cuentas[m.cuenta_id].usuario_id) if pendiente and m.cuenta_id in cuentas else None,
            **origen.get(m.id, {}), **extra, **auditoria(m, nom),
        ))
    return salida


# ------------------------------------------------------------------ cuentas
def catalogo() -> Catalogo:
    return Catalogo(
        monedas=dict(DECIMALES), monedas_por_tipo={k: list(v) for k, v in MONEDAS_POR_TIPO.items()},
        bancos=list(BANCOS), plataformas=list(PLATAFORMAS), aviso_nota=AVISO_NOTA,
    )


def listar(db: Session, ctx: Contexto, ver_anuladas: bool = False) -> CuentasOut:
    q = vis.filtrar(select(Cuenta), ctx, Cuenta).order_by(Cuenta.id)
    if not ver_anuladas:
        q = q.where(Cuenta.anulado.is_(False))
    cuentas = list(db.scalars(q))
    salida = armar_cuentas(db, ctx, cuentas)
    por_moneda: dict[str, list[CuentaOut]] = {}
    for c in salida:
        if not c.anulado:  # los totales NUNCA suman cuentas anuladas
            por_moneda.setdefault(c.moneda, []).append(c)
    totales = [
        TotalMoneda(
            moneda=mon, total=texto(sum((Decimal(c.saldo) for c in cs), Decimal(0)), mon), cuentas=len(cs),
            hay_negativas=any(c.saldo_negativo for c in cs),
        )
        for mon, cs in sorted(por_moneda.items())
    ]
    privadas = db.scalar(
        select(func.count()).select_from(Cuenta).where(vis.privados_propios(ctx, Cuenta), Cuenta.anulado.is_(False))
    ) or 0
    return CuentasOut(cuentas=salida, totales=totales, privadas_propias=privadas)


def obtener(db: Session, ctx: Contexto, cuenta_id: int) -> CuentaOut:
    return armar_cuentas(db, ctx, [_ver_cuenta(db, ctx, cuenta_id)])[0]


def _validar_encargado(db: Session, ctx: Contexto, encargado_id: int | None) -> None:
    if encargado_id is None:
        return
    ok = encargado_id != ctx.usuario.id and db.scalar(
        select(Miembro.id).where(
            Miembro.familia_id == ctx.familia_id, Miembro.usuario_id == encargado_id, Miembro.activo.is_(True)
        )
    )
    if not ok:
        raise HTTPException(status_code=422, detail="El encargado debe ser otro miembro activo de tu familia")


def _datos_cuenta(c: Cuenta, nom_encargado: str | None) -> dict:
    """Foto de los campos para el historial. SIN ultimos 4 digitos."""
    return {
        "nombre": c.nombre, "tipo": c.tipo, "banco": c.banco, "banco_otro": c.banco_otro, "moneda": c.moneda,
        "saldo_inicial": con_moneda(c.saldo_inicial, c.moneda), "encargado": nom_encargado,
    }


def crear(db: Session, ctx: Contexto, datos: CuentaCrear) -> tuple[CuentaOut, bool]:
    uuid_txt = str(datos.uuid_cliente) if datos.uuid_cliente else None
    if uuid_txt:
        previo = db.scalar(select(Cuenta).where(Cuenta.familia_id == ctx.familia_id, Cuenta.uuid_cliente == uuid_txt))
        if previo is not None:
            if not vis.puede_ver(db, ctx, previo):
                raise HTTPException(status_code=409, detail="Ese identificador ya fue usado")
            return armar_cuentas(db, ctx, [previo])[0], False
    nombre = datos.nombre.strip()
    if not nombre:
        raise HTTPException(status_code=422, detail="Escribe el nombre de la cuenta")
    validar_cuenta(datos.tipo, datos.moneda, datos.banco, datos.banco_otro, datos.ultimos4)
    validar_monto(datos.saldo_inicial, datos.moneda, "saldo_inicial", positivo=False)
    _validar_encargado(db, ctx, datos.encargado_id)
    visibilidad, personas = visib.preparar_creacion(db, ctx, datos)
    c = Cuenta(
        familia_id=ctx.familia_id, usuario_id=ctx.usuario.id, encargado_id=datos.encargado_id, nombre=nombre,
        tipo=datos.tipo, banco=datos.banco, banco_otro=(datos.banco_otro or "").strip() or None, moneda=datos.moneda,
        ultimos4=datos.ultimos4, saldo_inicial=datos.saldo_inicial, visibilidad=visibilidad, uuid_cliente=uuid_txt,
    )
    db.add(c)
    db.flush()
    visib.guardar_personas(db, ctx, "cuenta", c.id, personas)
    enc = nombres_usuarios(db, [c.encargado_id]).get(c.encargado_id) if c.encargado_id else None
    cambios = historial.creacion({**_datos_cuenta(c, enc), "visibilidad": visibilidad})
    historial.registrar(db, ctx.familia_id, ctx.usuario.id, "cuenta", c.id, "crear", cambios)
    db.commit()
    return armar_cuentas(db, ctx, [c])[0], True


def _tiene_movimientos(db: Session, cuenta_id: int) -> bool:
    return bool(db.scalar(select(exists().where(or_(CM.cuenta_id == cuenta_id, CM.cuenta_destino_id == cuenta_id)))))


def editar(db: Session, ctx: Contexto, cuenta_id: int, datos: CuentaEditar) -> CuentaOut:
    c = _ver_cuenta(db, ctx, cuenta_id, bloquear=True)
    _exigir_dueno(ctx, c)
    if _ya_aplicada(db, ctx, "cuenta", c.id):
        return armar_cuentas(db, ctx, [c])[0]
    exigir_version(c, datos.version_base, lambda: armar_cuentas(db, ctx, [c])[0], "La cuenta")
    cambios = datos.model_dump(exclude_unset=True, exclude={"visibilidad", "compartido_con", "version_base"})
    if cambios or not (datos.visibilidad or datos.compartido_con is not None):
        exigir_activo(c, "La cuenta")  # cambiar solo "quien la ve" se permite tambien en una cuenta anulada
    nombre_enc = lambda i: nombres_usuarios(db, [i]).get(i) if i else None  # noqa: E731
    antes = _datos_cuenta(c, nombre_enc(c.encargado_id))

    estructurales = {k for k in ("tipo", "moneda", "saldo_inicial") if k in cambios and cambios[k] != getattr(c, k)}
    if estructurales and _tiene_movimientos(db, c.id):
        raise HTTPException(
            status_code=400,
            detail="La cuenta ya tiene movimientos: no se puede cambiar su tipo, moneda ni saldo inicial (usa un ajuste por conteo)",
        )
    nuevo = {k: cambios.get(k, getattr(c, k)) for k in ("tipo", "moneda", "banco", "banco_otro", "ultimos4", "saldo_inicial")}
    if nuevo["tipo"] == "efectivo":
        nuevo["banco"] = nuevo["banco_otro"] = nuevo["ultimos4"] = None
    elif nuevo["banco"] != "Otro" and "banco_otro" not in cambios:
        nuevo["banco_otro"] = None
    validar_cuenta(nuevo["tipo"], nuevo["moneda"], nuevo["banco"], nuevo["banco_otro"], nuevo["ultimos4"])
    validar_monto(nuevo["saldo_inicial"], nuevo["moneda"], "saldo_inicial", positivo=False)
    if "encargado_id" in cambios:
        _validar_encargado(db, ctx, cambios["encargado_id"])
        c.encargado_id = cambios["encargado_id"]
    if cambios.get("nombre") is not None:
        if not cambios["nombre"].strip():
            raise HTTPException(status_code=422, detail="Escribe el nombre de la cuenta")
        c.nombre = cambios["nombre"].strip()
    for k, v in nuevo.items():
        setattr(c, k, (v.strip() or None) if isinstance(v, str) and k == "banco_otro" else v)
    diferencias = historial.diferencias(antes, _datos_cuenta(c, nombre_enc(c.encargado_id)))
    # el cambio de ultimos 4 digitos cuenta como edicion pero su valor NUNCA va al historial
    cambio_ultimos4 = "ultimos4" in cambios
    cambio_vis = visib.aplicar(db, ctx, c, datos.visibilidad, datos.compartido_con)
    if diferencias or cambio_ultimos4 or not cambio_vis:
        marcar_edicion(c, ctx.usuario.id)
        historial.registrar(db, ctx.familia_id, ctx.usuario.id, "cuenta", c.id, "editar", diferencias)
    db.commit()
    return armar_cuentas(db, ctx, [c])[0]


def cambiar_visibilidad(db: Session, ctx: Contexto, cuenta_id: int, datos: visib.VisibilidadCambiar) -> CuentaOut:
    c = _ver_cuenta(db, ctx, cuenta_id, bloquear=True)
    _exigir_dueno(ctx, c)
    exigir_version(c, datos.version_base, lambda: armar_cuentas(db, ctx, [c])[0], "La cuenta")
    visib.aplicar(db, ctx, c, datos.visibilidad, datos.compartido_con)
    db.commit()
    return armar_cuentas(db, ctx, [c])[0]


def anular(db: Session, ctx: Contexto, cuenta_id: int, motivo: str | None, version_base: int | None = None) -> CuentaOut:
    c = _ver_cuenta(db, ctx, cuenta_id, bloquear=True)
    _exigir_dueno(ctx, c)
    if _ya_aplicada(db, ctx, "cuenta", c.id):
        return armar_cuentas(db, ctx, [c])[0]
    exigir_version(c, version_base, lambda: armar_cuentas(db, ctx, [c])[0], "La cuenta")
    if c.anulado:
        raise HTTPException(status_code=400, detail="La cuenta ya está anulada")
    if db.scalar(select(exists().where(CM.cuenta_id == c.id, CM.estado == "pendiente", CM.anulado.is_(False)))):
        raise HTTPException(
            status_code=400, detail="La cuenta tiene movimientos por confirmar: confírmalos o recházalos antes de anularla"
        )
    marcar_anulacion(c, ctx.usuario.id, motivo)
    historial.registrar(
        db, ctx.familia_id, ctx.usuario.id, "cuenta", c.id, "anular", {"anulado": historial.cambio(False, True)}, c.motivo_anulacion
    )
    db.commit()
    return armar_cuentas(db, ctx, [c])[0]


def reactivar(db: Session, ctx: Contexto, cuenta_id: int, version_base: int | None = None) -> CuentaOut:
    c = _ver_cuenta(db, ctx, cuenta_id, bloquear=True)
    _exigir_dueno(ctx, c)
    if _ya_aplicada(db, ctx, "cuenta", c.id):
        return armar_cuentas(db, ctx, [c])[0]
    exigir_version(c, version_base, lambda: armar_cuentas(db, ctx, [c])[0], "La cuenta")
    if not c.anulado:
        raise HTTPException(status_code=400, detail="La cuenta no está anulada")
    limpiar_anulacion(c)
    marcar_edicion(c, ctx.usuario.id)
    historial.registrar(
        db, ctx.familia_id, ctx.usuario.id, "cuenta", c.id, "reactivar", {"anulado": historial.cambio(True, False)}
    )
    db.commit()
    return armar_cuentas(db, ctx, [c])[0]


# ------------------------------------------------------------------ movimientos
def _persona(db: Session, ctx: Contexto, datos: PersonaIn) -> dict:
    """Columnas persona_* ya validadas: miembro de la familia, 'otra persona' con nombre libre o sin identificar."""
    if datos.persona_tipo == "miembro":
        if datos.persona_usuario_id is None or datos.persona_nombre:
            raise HTTPException(status_code=422, detail="Elige al miembro de la familia")
        ok = db.scalar(
            select(Miembro.id).where(Miembro.familia_id == ctx.familia_id, Miembro.usuario_id == datos.persona_usuario_id)
        )
        if not ok:
            raise HTTPException(status_code=422, detail="La persona debe ser un miembro de tu familia")
        return {"persona_tipo": "miembro", "persona_usuario_id": datos.persona_usuario_id, "persona_nombre": None}
    if datos.persona_tipo == "otra":
        nombre = (datos.persona_nombre or "").strip()
        if not nombre or datos.persona_usuario_id is not None:
            raise HTTPException(status_code=422, detail="Escribe el nombre de la otra persona")
        return {"persona_tipo": "otra", "persona_usuario_id": None, "persona_nombre": nombre}
    if datos.persona_usuario_id is not None or datos.persona_nombre:
        raise HTTPException(status_code=422, detail="«Sin identificar» no lleva persona")
    return {"persona_tipo": "sin_identificar", "persona_usuario_id": None, "persona_nombre": None}


def _nombre_persona(db: Session, p: dict) -> str | None:
    if p["persona_tipo"] == "miembro":
        return nombres_usuarios(db, [p["persona_usuario_id"]]).get(p["persona_usuario_id"])
    return p["persona_nombre"]


def _previo(db: Session, ctx: Contexto, uuid_txt: str | None):
    """Idempotencia: si el UUID ya existe devuelve (salida, False); si lo uso quien no lo ve, 409."""
    if not uuid_txt:
        return None
    previo = db.scalar(select(CM).where(CM.familia_id == ctx.familia_id, CM.uuid_cliente == uuid_txt))
    if previo is None:
        return None
    if not vis.puede_ver_mov_cuenta(db, ctx, previo):
        raise HTTPException(status_code=409, detail="Ese identificador ya fue usado")
    return armar_movimientos(db, ctx, [previo])[0], False


def _preparar(db: Session, ctx: Contexto, ids: list[int]) -> dict[int, Cuenta]:
    """Para REGISTRAR: ves todas (404 si no), eres dueno o encargado de todas (403 si no), las bloqueas y estan activas."""
    cuentas = [db.get(Cuenta, i) for i in ids]
    for c in cuentas:
        vis.exigir_ver(db, ctx, c, "Cuenta")  # primero TODOS los 404: una cuenta oculta no deja ver el resto
    _exigir_registrar(ctx, cuentas)
    bloqueadas = _bloquear(db, ids)
    for c in bloqueadas.values():
        _exigir_cuenta_activa(c)
    return bloqueadas


def _cambios_mov(db: Session, m: CM, persona: str | None) -> dict:
    """Se guardan IDS de cuenta, no nombres: el nombre se resuelve al leer segun quien lee (`nombres.resolver_cambios`)."""
    return historial.creacion({
        "tipo": m.tipo, "cuenta_id": m.cuenta_id, "cuenta_destino_id": m.cuenta_destino_id,
        "monto": con_moneda(m.monto, m.moneda), "comision": con_moneda(m.comision, m.moneda), "sentido": m.sentido,
        "saldo_previo": con_moneda(m.saldo_previo, m.moneda), "saldo_declarado": con_moneda(m.saldo_declarado, m.moneda),
        "fecha": m.fecha, "hora": hora_texto(m.hora), "nota": m.nota, "persona": persona,
    })


def _guardar(db: Session, ctx: Contexto, m: CM, persona: dict, origen: Cuenta) -> tuple[MovimientoCuentaOut, bool]:
    db.add(m)
    db.flush()
    historial.registrar(
        db, ctx.familia_id, ctx.usuario.id, "cuenta_mov", m.id, "crear", _cambios_mov(db, m, _nombre_persona(db, persona))
    )
    db.commit()
    saldo = saldos(db, [origen])[origen.id]
    return armar_movimientos(db, ctx, [m], resultado={m.id: saldo})[0], True


def _nuevo(ctx: Contexto, uuid_txt: str | None, cuenta: Cuenta, tipo: str, **campos) -> CM:
    return CM(
        familia_id=ctx.familia_id, usuario_id=ctx.usuario.id, cuenta_id=cuenta.id, moneda=cuenta.moneda, tipo=tipo,
        uuid_cliente=uuid_txt, **campos,
    )


def registrar_deposito(db: Session, ctx: Contexto, cuenta_id: int, d: DepositoCrear) -> tuple[MovimientoCuentaOut, bool]:
    uuid_txt = str(d.uuid_cliente) if d.uuid_cliente else None
    if p := _previo(db, ctx, uuid_txt):
        return p
    c = _preparar(db, ctx, [cuenta_id])[cuenta_id]
    validar_monto(d.monto, c.moneda)
    hora = _hora_valida(d.fecha, d.hora)
    persona = _persona(db, ctx, d)
    m = _nuevo(ctx, uuid_txt, c, "deposito", monto=d.monto, fecha=d.fecha, hora=hora, nota=d.nota, **persona)
    return _guardar(db, ctx, m, persona, c)


def registrar_retiro(db: Session, ctx: Contexto, cuenta_id: int, d: RetiroCrear) -> tuple[MovimientoCuentaOut, bool]:
    uuid_txt = str(d.uuid_cliente) if d.uuid_cliente else None
    if p := _previo(db, ctx, uuid_txt):
        return p
    c = _preparar(db, ctx, [cuenta_id])[cuenta_id]
    validar_monto(d.monto, c.moneda)
    if d.comision is not None:
        if c.tipo != "cripto":
            raise HTTPException(status_code=422, detail="Solo los retiros de cuentas cripto llevan comisión de red")
        validar_monto(d.comision, c.moneda, "comision", positivo=False)
    hora = _hora_valida(d.fecha, d.hora)
    persona = _persona(db, ctx, d)
    m = _nuevo(
        ctx, uuid_txt, c, "retiro", monto=d.monto, comision=d.comision, fecha=d.fecha, hora=hora, nota=d.nota, **persona
    )
    return _guardar(db, ctx, m, persona, c)


def registrar_ajuste(db: Session, ctx: Contexto, cuenta_id: int, d: AjusteCrear) -> tuple[MovimientoCuentaOut, bool]:
    """Ajuste por conteo: el usuario indica el saldo REAL; se registra la diferencia (con nota) sobre el saldo que hay
    AHORA, calculado con la cuenta bloqueada para que nadie lo cambie mientras tanto."""
    uuid_txt = str(d.uuid_cliente) if d.uuid_cliente else None
    if p := _previo(db, ctx, uuid_txt):
        return p
    c = _preparar(db, ctx, [cuenta_id])[cuenta_id]
    validar_monto(d.saldo_declarado, c.moneda, "saldo_declarado", positivo=False, permitir_negativo=True)
    hora = _hora_valida(d.fecha, d.hora)
    previo = saldos(db, [c])[c.id]
    diferencia = d.saldo_declarado - previo
    if diferencia == 0:
        raise HTTPException(status_code=422, detail="El saldo contado coincide con el saldo actual: no hay nada que ajustar")
    persona = _persona(db, ctx, d)
    m = _nuevo(
        ctx, uuid_txt, c, "ajuste", monto=abs(diferencia), sentido="entrada" if diferencia > 0 else "salida",
        saldo_previo=previo, saldo_declarado=d.saldo_declarado, fecha=d.fecha, hora=hora, nota=d.nota, **persona,
    )
    return _guardar(db, ctx, m, persona, c)


def registrar_traspaso(db: Session, ctx: Contexto, d: TraspasoCrear) -> tuple[MovimientoCuentaOut, bool]:
    """UNA fila que sale de `cuenta_id` y entra en `cuenta_destino_id`: mismo monto por construccion; misma moneda
    por validacion Y por FK compuesta en la base. Exige permiso de registro sobre AMBAS cuentas."""
    uuid_txt = str(d.uuid_cliente) if d.uuid_cliente else None
    if p := _previo(db, ctx, uuid_txt):
        return p
    if d.cuenta_id == d.cuenta_destino_id:
        raise HTTPException(status_code=422, detail="El origen y el destino deben ser cuentas distintas")
    cuentas = _preparar(db, ctx, [d.cuenta_id, d.cuenta_destino_id])
    origen, destino = cuentas[d.cuenta_id], cuentas[d.cuenta_destino_id]
    if origen.moneda != destino.moneda:
        raise HTTPException(status_code=422, detail="Solo se puede traspasar entre cuentas de la misma moneda")
    validar_monto(d.monto, origen.moneda)
    hora = _hora_valida(d.fecha, d.hora)
    persona = _persona(db, ctx, d)
    m = _nuevo(
        ctx, uuid_txt, origen, "traspaso", cuenta_destino_id=destino.id, monto=d.monto, fecha=d.fecha, hora=hora,
        nota=d.nota, **persona,
    )
    return _guardar(db, ctx, m, persona, origen)


def _ver_movimiento(db: Session, ctx: Contexto, mov_id: int) -> CM:
    m = db.get(CM, mov_id)
    if not vis.puede_ver_mov_cuenta(db, ctx, m):  # otra familia, oculto o inexistente: el mismo 404
        raise HTTPException(status_code=404, detail="Movimiento de cuenta no encontrado")
    return m


def obtener_movimiento(db: Session, ctx: Contexto, mov_id: int) -> MovimientoCuentaOut:
    return armar_movimientos(db, ctx, [_ver_movimiento(db, ctx, mov_id)])[0]


def _exigir_no_vinculado(db: Session, m: CM) -> None:
    """Un movimiento creado por un gasto, ingreso o apoyo solo se cambia desde ese registro (solo se confirma o rechaza)."""
    if m.origen_id is not None:
        o = db.get(_modelo_origen(m.origen_tipo), m.origen_id)
        tipo = tipo_origen(m.origen_tipo, o) if o is not None else None
        raise HTTPException(status_code=422, detail=f"Se gestiona desde {_articulo(tipo)}")


def _tocar_movimiento(db: Session, ctx: Contexto, mov_id: int) -> tuple[CM, dict[int, Cuenta]]:
    """Para anular, reactivar o corregir la fecha: lo ves (404), eres dueno o encargado de TODAS sus cuentas (403), no
    es un vinculado (422), todo bloqueado."""
    m = _ver_movimiento(db, ctx, mov_id)
    ids = [m.cuenta_id] + ([m.cuenta_destino_id] if m.cuenta_destino_id else [])
    # lo ves (por una de sus cuentas), pero si no eres dueno o encargado de TODAS (incluida una que no ves) es 403
    _exigir_registrar(ctx, [db.get(Cuenta, i) for i in ids])
    _exigir_no_vinculado(db, m)
    bloqueadas = _bloquear(db, ids)
    m = db.scalars(select(CM).where(CM.id == mov_id).with_for_update().execution_options(populate_existing=True)).one()
    return m, bloqueadas


def anular_movimiento(
    db: Session, ctx: Contexto, mov_id: int, motivo: str | None, version_base: int | None = None
) -> MovimientoCuentaOut:
    m, cuentas = _tocar_movimiento(db, ctx, mov_id)
    if _ya_aplicada(db, ctx, "cuenta_mov", m.id):
        return armar_movimientos(db, ctx, [m])[0]
    exigir_version(m, version_base, lambda: armar_movimientos(db, ctx, [m])[0], "El movimiento")
    if m.anulado:
        raise HTTPException(status_code=400, detail="El movimiento ya está anulado")
    marcar_anulacion(m, ctx.usuario.id, motivo)
    historial.registrar(
        db, ctx.familia_id, ctx.usuario.id, "cuenta_mov", m.id, "anular", {"anulado": historial.cambio(False, True)},
        m.motivo_anulacion,
    )
    db.commit()
    return armar_movimientos(db, ctx, [m])[0]


def reactivar_movimiento(db: Session, ctx: Contexto, mov_id: int, version_base: int | None = None) -> MovimientoCuentaOut:
    m, cuentas = _tocar_movimiento(db, ctx, mov_id)
    if _ya_aplicada(db, ctx, "cuenta_mov", m.id):
        return armar_movimientos(db, ctx, [m])[0]
    exigir_version(m, version_base, lambda: armar_movimientos(db, ctx, [m])[0], "El movimiento")
    if not m.anulado:
        raise HTTPException(status_code=400, detail="El movimiento no está anulado")
    for c in cuentas.values():
        _exigir_cuenta_activa(c)
    limpiar_anulacion(m)
    marcar_edicion(m, ctx.usuario.id)
    historial.registrar(
        db, ctx.familia_id, ctx.usuario.id, "cuenta_mov", m.id, "reactivar", {"anulado": historial.cambio(True, False)}
    )
    db.commit()
    saldo = saldos(db, [cuentas[m.cuenta_id]])[m.cuenta_id]
    return armar_movimientos(db, ctx, [m], resultado={m.id: saldo})[0]


def cambiar_fecha_movimiento(db: Session, ctx: Contexto, mov_id: int, d: MovimientoFechaEditar) -> MovimientoCuentaOut:
    """Corrige SOLO la fecha y/o la hora. No toca el saldo (que no depende de ellas): solo el mes en que aparece y el orden.

    `hora` ausente = se conserva la que tenia; `hora: null` = queda sin hora. Lo que resulte no puede quedar en el
    futuro de La Paz. Nunca en un ajuste por conteo: su saldo previo y su saldo contado son una foto del momento en que
    se registro. El historial guarda solo lo que cambio ({fecha} y/o {hora})."""
    m, cuentas = _tocar_movimiento(db, ctx, mov_id)
    if _ya_aplicada(db, ctx, "cuenta_mov", m.id):
        return armar_movimientos(db, ctx, [m])[0]
    exigir_version(m, d.version_base, lambda: armar_movimientos(db, ctx, [m])[0], "El movimiento")
    exigir_activo(m, "El movimiento")
    if m.tipo == "ajuste":
        raise HTTPException(
            status_code=422,
            detail="La fecha y la hora de un ajuste por conteo no se pueden cambiar: el saldo contado corresponde al "
            "momento en que se registró. Anúlalo y registra un ajuste nuevo",
        )
    for c in cuentas.values():
        _exigir_cuenta_activa(c)
    hora = d.hora if "hora" in d.model_fields_set else m.hora
    hora = _hora_valida(d.fecha, hora, poner_actual=False)
    cambios = {}
    if d.fecha != m.fecha:
        cambios["fecha"] = historial.cambio(m.fecha, d.fecha)
    if hora != m.hora:
        cambios["hora"] = historial.cambio(hora_texto(m.hora), hora_texto(hora))
    if not cambios:  # sin cambio real: no se toca nada (ni la version ni el historial)
        return armar_movimientos(db, ctx, [m])[0]
    m.fecha, m.hora = d.fecha, hora
    marcar_edicion(m, ctx.usuario.id)
    historial.registrar(db, ctx.familia_id, ctx.usuario.id, "cuenta_mov", m.id, "editar", cambios)
    db.commit()
    return armar_movimientos(db, ctx, [m])[0]


def listar_movimientos(
    db: Session, ctx: Contexto, cuenta_id: int | None, tipo: str | None, ver_anulados: bool, limite: int,
    desplazamiento: int, desde=None, hasta=None,
) -> list[MovimientoCuentaOut]:
    """Solo movimientos de cuentas que ves (en un traspaso basta ver una de las dos)."""
    q = select(CM).where(vis.condicion_mov_cuenta(ctx))
    if cuenta_id is not None:
        _ver_cuenta(db, ctx, cuenta_id)  # 404 si no la ves
        q = q.where(or_(CM.cuenta_id == cuenta_id, CM.cuenta_destino_id == cuenta_id))
    if tipo:
        q = q.where(CM.tipo == tipo)
    if not ver_anulados:
        q = q.where(CM.anulado.is_(False))
    if desde is not None:
        q = q.where(CM.fecha >= desde)
    if hasta is not None:
        q = q.where(CM.fecha <= hasta)
    q = q.order_by(*ORDEN_MOVIMIENTOS).limit(limite).offset(desplazamiento)
    return armar_movimientos(db, ctx, list(db.scalars(q)), cuenta_ref=cuenta_id)


# ------------------------------------------------------------------ fuente de pago (0010)
# Un gasto, ingreso o apoyo de Arca pagado con Banco crea UN movimiento de cuenta vinculado (retiro o deposito) en la
# MISMA transaccion. Estas funciones NO hacen commit: las llama el servicio del registro (movimientos/apoyos), que ya
# bloqueo la cuenta (`bloquear_cuentas`) ANTES que su registro: orden fijo cuenta -> registro (sin interbloqueos).
# El movimiento vinculado es de solo lectura en Cuentas; solo se confirma o se rechaza.
TIPOS_FUENTE = ("ahorro", "corriente")  # cuentas que pueden ser "Banco" (nunca las de tipo efectivo ni cripto)
MONEDA_FUENTE = "BS"  # Arca registra en Bs: sin conversion de monedas
ORIGEN_ENTIDAD = {"movimiento": "movimiento", "apoyo": "apoyo"}  # origen_tipo -> entidad del historial
MOTIVO_CON_ORIGEN = "Anulado junto con su registro"
MOTIVO_FUENTE = "Cambió la fuente de pago"
MOTIVO_RECHAZO = "Fuente cambiada por rechazo"


def _modelo_origen(clase: str):
    from app.modulos.apoyos.models import Apoyo
    from app.modulos.movimientos.models import Movimiento

    return Movimiento if clase == "movimiento" else Apoyo


def tipo_origen(clase: str, obj) -> str:
    """gasto | ingreso | apoyo."""
    return obj.tipo if clase == "movimiento" else "apoyo"


def _articulo(tipo: str) -> str:
    return {"gasto": "el gasto", "ingreso": "el ingreso", "apoyo": "el apoyo"}.get(tipo, "el registro")


def _cargar_origenes(db: Session, movs: list[CM]) -> dict[tuple[str, int], object]:
    out: dict[tuple[str, int], object] = {}
    for clase in ORIGEN_ENTIDAD:
        ids = {m.origen_id for m in movs if m.origen_tipo == clase}
        if ids:
            modelo = _modelo_origen(clase)
            out |= {(clase, o.id): o for o in db.scalars(select(modelo).where(modelo.id.in_(ids)))}
    return out


def _datos_origen(db: Session, ctx: Contexto, movs: list[CM]) -> dict[int, dict]:
    """{cm.id: campos de origen para la salida}. Sin nota NUNCA; id, fecha y categoria/beneficiario SOLO si el lector
    ve el registro de origen (si no, solo se sabe que es un gasto/ingreso/apoyo de quien lo registro)."""
    from app.modulos.categorias.models import Categoria

    con_origen = [m for m in movs if m.origen_id is not None]
    if not con_origen:
        return {}
    origenes = _cargar_origenes(db, con_origen)
    cat_ids = {getattr(o, "categoria_id", None) for o in origenes.values()} - {None}
    cats = {c.id: c.nombre for c in db.scalars(select(Categoria).where(Categoria.id.in_(cat_ids)))} if cat_ids else {}
    out = {}
    for m in con_origen:
        o = origenes.get((m.origen_tipo, m.origen_id))
        tipo = tipo_origen(m.origen_tipo, o) if o is not None else None
        datos = {"vinculado": True, "origen_tipo": tipo}
        if o is not None and vis.puede_ver(db, ctx, o):
            detalle = o.beneficiario if m.origen_tipo == "apoyo" else cats.get(o.categoria_id)
            datos |= {"origen_id": o.id, "origen_clase": m.origen_tipo, "origen_detalle": detalle, "origen_fecha": o.fecha}
        out[m.id] = datos
    return out


def bloquear_cuentas(db: Session, ids) -> dict[int, Cuenta]:
    """Bloquea (FOR UPDATE, en orden de id) las cuentas de los ids no nulos. Se llama ANTES de bloquear el registro."""
    ids = [i for i in ids if i is not None]
    return _bloquear(db, ids) if ids else {}


def es_fuente_valida(c: Cuenta | None) -> bool:
    return c is not None and not c.anulado and c.moneda == MONEDA_FUENTE and c.tipo in TIPOS_FUENTE


def _cuenta_fuente(db: Session, ctx: Contexto, cuenta_id: int) -> Cuenta:
    c = db.get(Cuenta, cuenta_id)
    if c is None or not vis.puede_ver(db, ctx, c):  # otra familia, privada de otro o inexistente: el mismo mensaje
        raise HTTPException(status_code=422, detail="Elige una cuenta de banco que puedas ver")
    if c.anulado:
        raise HTTPException(status_code=422, detail="La cuenta está anulada: elige otra o paga en efectivo")
    if c.moneda != MONEDA_FUENTE or c.tipo not in TIPOS_FUENTE:
        raise HTTPException(status_code=422, detail="Solo se puede usar una cuenta de banco en Bs")
    return c


def cuentas_fuente(db: Session, ctx: Contexto) -> list[CuentaFuenteOut]:
    """Cuentas que el usuario puede elegir como "Banco": las que VE (nunca las solo_yo de otros), activas, en Bs y de
    banco. `directo` si es dueno o encargado; si no, quedara por confirmar del dueno."""
    q = (
        vis.filtrar(select(Cuenta), ctx, Cuenta)
        .where(Cuenta.anulado.is_(False), Cuenta.moneda == MONEDA_FUENTE, Cuenta.tipo.in_(TIPOS_FUENTE))
        .order_by(Cuenta.id)
    )
    cuentas = list(db.scalars(q))
    nom = nombres_usuarios(db, {c.usuario_id for c in cuentas})
    nom_cuentas = nombres.nombres_para(db, ctx, [c.id for c in cuentas])
    salida = [
        CuentaFuenteOut(
            id=c.id, nombre=nom_cuentas[c.id], tipo=c.tipo, banco=c.banco, banco_otro=c.banco_otro, ultimos4=c.ultimos4,
            directo=es_dueno_o_encargado(ctx, c),
            confirma_nombre=None if es_dueno_o_encargado(ctx, c) else nom.get(c.usuario_id),
        )
        for c in cuentas
    ]
    return sorted(salida, key=lambda x: (not x.directo, x.nombre.lower()))  # primero las propias


def vigente(db: Session, clase: str, origen_id: int) -> CM | None:
    """El vinculo VIGENTE (activo y no rechazado) de un registro de Arca: como mucho uno (indice unico parcial)."""
    return db.scalars(
        select(CM).where(
            CM.origen_tipo == clase, CM.origen_id == origen_id, CM.anulado.is_(False), CM.estado != "rechazado",
        ).with_for_update().execution_options(populate_existing=True)
    ).one_or_none()


def _log_mov(db: Session, ctx: Contexto, m: CM, accion: str, cambios: dict, motivo: str | None = None) -> None:
    historial.registrar(db, ctx.familia_id, ctx.usuario.id, "cuenta_mov", m.id, accion, cambios, motivo)


def _hora_de(fecha: date) -> time | None:
    """Los registros de Arca no llevan hora: la de ahora si son de hoy (La Paz), ninguna si son de otro dia."""
    ahora = ahora_la_paz()
    return time(ahora.hour, ahora.minute) if fecha == ahora.date() else None


def crear_vinculado(db: Session, ctx: Contexto, clase: str, obj, cuenta_id: int, tipo: str) -> CM:
    """Crea el retiro/deposito vinculado a `obj` (ya guardado, con id). Confirmado si el usuario es dueno o encargado
    de la cuenta; si no, pendiente (no suma al saldo hasta que lo confirmen). Sin commit."""
    c = _cuenta_fuente(db, ctx, cuenta_id)
    validar_monto(obj.monto, c.moneda)
    directo = es_dueno_o_encargado(ctx, c)
    m = CM(
        familia_id=ctx.familia_id, usuario_id=ctx.usuario.id, cuenta_id=c.id, moneda=c.moneda, tipo=tipo,
        monto=obj.monto, fecha=obj.fecha, hora=_hora_de(obj.fecha), nota=None, origen_tipo=clase, origen_id=obj.id,
        estado="confirmado" if directo else "pendiente",
        confirmado_por=ctx.usuario.id if directo else None, confirmado_en=ahora_utc() if directo else None,
    )
    db.add(m)
    db.flush()
    _log_mov(db, ctx, m, "crear", historial.creacion({
        "tipo": m.tipo, "cuenta_id": m.cuenta_id, "monto": con_moneda(m.monto, m.moneda), "fecha": m.fecha,
        "hora": hora_texto(m.hora), "origen": tipo_origen(clase, obj), "estado": m.estado,
    }))
    obj.cuenta_id = c.id
    return m


def _anular_vinculado(db: Session, ctx: Contexto, m: CM, motivo: str) -> None:
    marcar_anulacion(m, ctx.usuario.id, motivo)
    _log_mov(db, ctx, m, "anular", {"anulado": historial.cambio(False, True)}, motivo)


def _volver_a_pendiente(m: CM, fecha: date) -> dict:
    """Un confirmado en cuenta ajena cuyo monto cambio vuelve a esperar al dueno, con su fecha/hora de registro."""
    cambios = {"estado": historial.cambio("confirmado", "pendiente")}
    hora = m.hora_registrada if m.hora_registrada is not None else _hora_de(fecha)
    m.estado, m.confirmado_por, m.confirmado_en, m.hora_registrada = "pendiente", None, None, None
    if m.fecha != fecha:
        cambios["fecha"] = historial.cambio(m.fecha, fecha)
    if m.hora != hora:
        cambios["hora"] = historial.cambio(hora_texto(m.hora), hora_texto(hora))
    m.fecha, m.hora = fecha, hora
    return cambios


def sincronizar(db: Session, ctx: Contexto, clase: str, obj, cuenta_nueva: int | None, tipo: str) -> None:
    """Deja el vinculo de `obj` (ACTIVO) al dia con su fuente: `cuenta_nueva` None = Efectivo. Sin commit.

    - Otra cuenta (o pasa a Efectivo): el vinculo anterior se anula (queda como rastro) y, si hay cuenta, se crea otro.
    - Misma cuenta: se copian monto y fecha. La fecha solo mientras esta pendiente o si se registro directo (la de un
      confirmado por el dueno es la de su confirmacion). Si cambia el monto de un confirmado en una cuenta de la que
      el usuario NO es dueno ni encargado, vuelve a pendiente. La nota nunca se copia (no se filtra a Cuentas)."""
    v = vigente(db, clase, obj.id)
    if v is not None and (cuenta_nueva is None or v.cuenta_id != cuenta_nueva or v.tipo != tipo):
        _anular_vinculado(db, ctx, v, MOTIVO_FUENTE)
        v = None
    if cuenta_nueva is None:
        obj.cuenta_id = None
        return
    if v is None:
        crear_vinculado(db, ctx, clase, obj, cuenta_nueva, tipo)
        return
    obj.cuenta_id = v.cuenta_id
    c = db.get(Cuenta, v.cuenta_id)
    directo = v.estado == "pendiente" or v.confirmado_por == v.usuario_id
    cambia_monto = v.monto != obj.monto
    cambia_fecha = directo and v.fecha != obj.fecha
    if not (cambia_monto or cambia_fecha):
        return
    if c.anulado:
        raise HTTPException(
            status_code=400, detail="La cuenta de este pago está anulada: pásalo a efectivo para poder cambiarlo"
        )
    validar_monto(obj.monto, v.moneda)
    cambios: dict = {}
    if cambia_monto:
        cambios["monto"] = historial.cambio(con_moneda(v.monto, v.moneda), con_moneda(obj.monto, v.moneda))
        v.monto = obj.monto
    if cambia_monto and v.estado == "confirmado" and not es_dueno_o_encargado(ctx, c):
        cambios |= _volver_a_pendiente(v, obj.fecha)
    elif cambia_fecha:
        hora = _hora_de(obj.fecha)
        cambios["fecha"] = historial.cambio(v.fecha, obj.fecha)
        if hora != v.hora:
            cambios["hora"] = historial.cambio(hora_texto(v.hora), hora_texto(hora))
        v.fecha, v.hora = obj.fecha, hora
    marcar_edicion(v, ctx.usuario.id)
    _log_mov(db, ctx, v, "editar", cambios)


def anular_de_origen(db: Session, ctx: Contexto, clase: str, obj) -> None:
    """El registro de Arca se anula: su vinculo vigente tambien (pendiente o confirmado; el saldo se restituye)."""
    v = vigente(db, clase, obj.id)
    if v is not None:
        _anular_vinculado(db, ctx, v, MOTIVO_CON_ORIGEN)


def reactivar_de_origen(db: Session, ctx: Contexto, clase: str, obj, tipo: str) -> str | None:
    """El registro de Arca se reactiva con su fuente: se crea un vinculo NUEVO (confirmado si el usuario es dueno o
    encargado; si no, por confirmar otra vez). Si la cuenta ya no se puede usar, el registro vuelve a Efectivo y se
    devuelve el motivo (para el historial y el aviso)."""
    if obj.cuenta_id is None:
        return None
    try:
        crear_vinculado(db, ctx, clase, obj, obj.cuenta_id, tipo)
    except HTTPException as e:
        obj.cuenta_id = None
        return f"La cuenta ya no se puede usar ({e.detail}): vuelve a efectivo"
    return None


# ------------------------------------------------------------------ confirmar / rechazar (dueno o encargado)
def _tocar_por_confirmar(db: Session, ctx: Contexto, mov_id: int):
    """Lo ves (404), tiene origen (400), eres dueno o encargado de la cuenta (403). Bloquea cuenta -> movimiento ->
    registro, en ese orden (el mismo que usan los servicios de gastos y apoyos)."""
    m = _ver_movimiento(db, ctx, mov_id)
    if m.origen_id is None:
        raise HTTPException(status_code=400, detail="Este movimiento se registró en Cuentas: no se confirma")
    c = db.get(Cuenta, m.cuenta_id)
    if not es_dueno_o_encargado(ctx, c):
        raise HTTPException(
            status_code=403, detail="Solo el dueño o el encargado de la cuenta puede confirmarlo o rechazarlo"
        )
    c = _bloquear(db, [c.id])[c.id]
    m = db.scalars(select(CM).where(CM.id == mov_id).with_for_update().execution_options(populate_existing=True)).one()
    modelo = _modelo_origen(m.origen_tipo)
    obj = db.scalars(
        select(modelo).where(modelo.id == m.origen_id).with_for_update().execution_options(populate_existing=True)
    ).one()
    return m, c, obj


def _exigir_por_confirmar(m: CM, obj) -> None:
    if m.anulado or obj.anulado or obj.cuenta_id != m.cuenta_id:
        raise HTTPException(
            status_code=409, detail="Ya no aplica: el registro se anuló o cambió de fuente de pago"
        )
    if m.estado != "pendiente":
        raise HTTPException(status_code=400, detail="Este movimiento no está por confirmar")


def confirmar(db: Session, ctx: Contexto, mov_id: int, version_base: int | None = None) -> MovimientoCuentaOut:
    """Confirma un pago pendiente: desde ahora suma al saldo. Toma la fecha y hora de la confirmacion (La Paz); la hora
    real del registro queda en `hora_registrada`."""
    m, c, obj = _tocar_por_confirmar(db, ctx, mov_id)
    if _ya_aplicada(db, ctx, "cuenta_mov", m.id):
        return armar_movimientos(db, ctx, [m])[0]
    exigir_version(m, version_base, lambda: armar_movimientos(db, ctx, [m])[0], "El movimiento")
    _exigir_por_confirmar(m, obj)
    _exigir_cuenta_activa(c)
    ahora = ahora_la_paz()
    fecha, hora = ahora.date(), time(ahora.hour, ahora.minute)
    cambios = {"estado": historial.cambio("pendiente", "confirmado")}
    if m.fecha != fecha:
        cambios["fecha"] = historial.cambio(m.fecha, fecha)
    if m.hora != hora:
        cambios["hora"] = historial.cambio(hora_texto(m.hora), hora_texto(hora))
    m.hora_registrada = m.hora
    m.fecha, m.hora = fecha, hora
    m.estado, m.confirmado_por, m.confirmado_en = "confirmado", ctx.usuario.id, ahora_utc()
    _log_mov(db, ctx, m, "confirmar", cambios)
    db.commit()
    saldo = saldos(db, [c])[c.id]
    return armar_movimientos(db, ctx, [m], resultado={m.id: saldo})[0]


def rechazar(
    db: Session, ctx: Contexto, mov_id: int, motivo: str | None, version_base: int | None = None
) -> MovimientoCuentaOut:
    """Rechaza un pago pendiente: queda visible como rechazado (sin efecto en el saldo) y el registro de Arca vuelve a
    Efectivo (NO se anula: el gasto si ocurrio). Su autor lo ve en `resumen_por_confirmar().rechazos`."""
    m, c, obj = _tocar_por_confirmar(db, ctx, mov_id)
    if _ya_aplicada(db, ctx, "cuenta_mov", m.id):
        return armar_movimientos(db, ctx, [m])[0]
    exigir_version(m, version_base, lambda: armar_movimientos(db, ctx, [m])[0], "El movimiento")
    _exigir_por_confirmar(m, obj)
    motivo = (motivo or "").strip() or None
    m.estado, m.confirmado_por, m.confirmado_en, m.motivo_rechazo = "rechazado", ctx.usuario.id, ahora_utc(), motivo
    _log_mov(db, ctx, m, "rechazar", {"estado": historial.cambio("pendiente", "rechazado")}, motivo)
    obj.cuenta_id = None
    historial.registrar(
        db, ctx.familia_id, ctx.usuario.id, ORIGEN_ENTIDAD[m.origen_tipo], obj.id, "editar",
        {"fuente": historial.cambio(c.id, None)}, MOTIVO_RECHAZO,
    )
    db.commit()
    return armar_movimientos(db, ctx, [m])[0]


def _mis_cuentas(ctx: Contexto):
    uid = ctx.usuario.id
    return select(Cuenta.id).where(
        Cuenta.familia_id == ctx.familia_id, or_(Cuenta.usuario_id == uid, Cuenta.encargado_id == uid)
    )


def _q_por_confirmar(ctx: Contexto):
    return select(CM).where(
        CM.familia_id == ctx.familia_id, CM.estado == "pendiente", CM.anulado.is_(False), CM.cuenta_id.in_(_mis_cuentas(ctx))
    )


def por_confirmar(db: Session, ctx: Contexto) -> list[MovimientoCuentaOut]:
    """Bandeja "Por confirmar": pagos pendientes en cuentas de las que el usuario es dueno o encargado."""
    return armar_movimientos(db, ctx, list(db.scalars(_q_por_confirmar(ctx).order_by(*ORDEN_MOVIMIENTOS))))


DIAS_AVISO_RECHAZO = 30


def resumen_por_confirmar(db: Session, ctx: Contexto) -> PorConfirmarResumen:
    """Contador del menu y avisos al autor: rechazos recientes de SUS registros que siguen activos y en Efectivo."""
    cantidad = db.scalar(select(func.count()).select_from(_q_por_confirmar(ctx).subquery())) or 0
    desde = ahora_utc() - timedelta(days=DIAS_AVISO_RECHAZO)
    rechazados = list(db.scalars(
        select(CM).where(
            CM.familia_id == ctx.familia_id, CM.usuario_id == ctx.usuario.id, CM.estado == "rechazado",
            CM.confirmado_en >= desde,
        ).order_by(CM.confirmado_en.desc()).limit(20)
    ))
    origenes = _cargar_origenes(db, rechazados)
    nom = nombres_usuarios(db, {m.confirmado_por for m in rechazados})
    nom_cuentas = nombres.nombres_para(db, ctx, {m.cuenta_id for m in rechazados})
    avisos = []
    for m in rechazados:
        o = origenes.get((m.origen_tipo, m.origen_id))
        if o is None or o.anulado or o.cuenta_id is not None:  # ya se anulo o ya eligio otra fuente: sin aviso
            continue
        avisos.append(RechazoAviso(
            id=m.id, origen_clase=m.origen_tipo, origen_id=o.id, origen_tipo=tipo_origen(m.origen_tipo, o),
            monto=texto(m.monto, m.moneda), fecha=o.fecha, cuenta_nombre=nom_cuentas[m.cuenta_id],
            rechazado_por_nombre=nom.get(m.confirmado_por, ""), motivo=m.motivo_rechazo, rechazado_en=m.confirmado_en,
        ))
    return PorConfirmarResumen(cantidad=cantidad, rechazos=avisos)


def fuentes_de(db: Session, ctx: Contexto, clase: str, objs: list) -> dict[int, dict]:
    """Para la salida de gastos/ingresos/apoyos: {obj.id: campos de la fuente} vistos por ESTE lector.

    `cuenta_nombre` sale por `nombres_para` ("otra cuenta" si no la ve) y `cuenta_id` solo si la ve. `estado_cuenta` es
    el del vinculo vigente (o el del ultimo, si el registro esta anulado). Si el registro esta en Efectivo porque
    rechazaron su pago, `rechazado_por_nombre`/`rechazo_motivo`/`rechazo_cuenta_nombre` lo explican."""
    ids = [o.id for o in objs]
    if not ids:
        return {}
    filas = list(db.scalars(
        select(CM).where(CM.origen_tipo == clase, CM.origen_id.in_(ids)).order_by(CM.origen_id, CM.id)
    ))
    ultimo: dict[int, CM] = {}
    for m in filas:  # en orden de id: queda el mas reciente de cada registro
        ultimo[m.origen_id] = m
    cuenta_ids = ({o.cuenta_id for o in objs} | {m.cuenta_id for m in ultimo.values()}) - {None}
    ve = nombres.visibles(db, ctx, cuenta_ids)
    nom_cuentas = nombres.nombres_para(db, ctx, cuenta_ids)
    duenos = (
        {c.id: c.usuario_id for c in db.scalars(select(Cuenta).where(Cuenta.id.in_(cuenta_ids)))} if cuenta_ids else {}
    )
    nom = nombres_usuarios(db, {m.confirmado_por for m in ultimo.values()} | set(duenos.values()))
    out = {}
    for o in objs:
        m = ultimo.get(o.id)
        d = {"fuente": "efectivo" if o.cuenta_id is None else "banco", "cuenta_id": None, "cuenta_nombre": None,
             "estado_cuenta": None, "confirma_nombre": None, "rechazado_por_nombre": None, "rechazo_motivo": None,
             "rechazo_cuenta_nombre": None}
        if o.cuenta_id is not None:
            d["cuenta_id"] = o.cuenta_id if o.cuenta_id in ve else None
            d["cuenta_nombre"] = nom_cuentas[o.cuenta_id]
            if m is not None and m.cuenta_id == o.cuenta_id:
                d["estado_cuenta"] = m.estado
                if m.estado == "pendiente":
                    d["confirma_nombre"] = nom.get(duenos.get(m.cuenta_id))
        elif m is not None and m.estado == "rechazado":
            d["rechazado_por_nombre"] = nom.get(m.confirmado_por)
            d["rechazo_motivo"] = m.motivo_rechazo
            d["rechazo_cuenta_nombre"] = nom_cuentas[m.cuenta_id]
        out[o.id] = d
    return out
