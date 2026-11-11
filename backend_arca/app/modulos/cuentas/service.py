"""Logica de Cuentas.

Reglas clave (ver tambien `monedas.py`, `nombres.py` y `visibilidad/service.py`):
- Ver: dueno, toda la familia si es 'familia', los elegidos y SIEMPRE el encargado. Lo que no ves es 404 (nunca 403).
- Registrar movimientos: dueno o encargado de la cuenta, NUNCA el admin por serlo. En un traspaso, de AMBAS cuentas.
- Solo el dueno edita la cuenta, cambia su visibilidad y designa al encargado.
- El saldo no se guarda: saldo_inicial + movimientos activos. Excluye movimientos anulados; los totales por moneda,
  ademas, excluyen cuentas anuladas. Saldo negativo permitido (se avisa, no se bloquea).
- Todo registro de movimiento bloquea (SELECT ... FOR UPDATE, en orden de id) las cuentas que toca: el ajuste por
  conteo calcula su diferencia sobre un saldo que nadie mas puede cambiar mientras tanto.
- Los nombres de cuenta SOLO salen por `nombres.nombres_para`.
"""
from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy import and_, case, exists, func, or_, select
from sqlalchemy.orm import Session

from app.core.anulable import (
    auditoria, exigir_activo, exigir_version, limpiar_anulacion, marcar_anulacion, marcar_edicion, nombres_usuarios,
)
from app.core.deps import Contexto
from app.modulos.cuentas import nombres
from app.modulos.cuentas.models import Cuenta, CuentaMovimiento as CM
from app.modulos.cuentas.monedas import (
    BANCOS, DECIMALES, MONEDAS_POR_TIPO, PLATAFORMAS, AVISO_NOTA, con_moneda, texto, validar_cuenta, validar_monto,
)
from app.modulos.cuentas.schemas import (
    AjusteCrear, Catalogo, CuentaCrear, CuentaEditar, CuentaOut, CuentasOut, DepositoCrear, MovimientoCuentaOut,
    PersonaIn, RetiroCrear, TotalMoneda, TraspasoCrear,
)
from app.modulos.familia.models import Miembro
from app.modulos.historial import service as historial
from app.modulos.visibilidad import cambios as visib
from app.modulos.visibilidad import service as vis

OTRA = nombres.OTRA_CUENTA


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
    """saldo_inicial + movimientos activos (los anulados no cuentan). Un traspaso resta del origen y suma al destino."""
    ids = [c.id for c in cuentas]
    if not ids:
        return {}
    total = {c.id: Decimal(c.saldo_inicial) for c in cuentas}
    for cid, suma in db.execute(
        select(CM.cuenta_id, func.sum(_efecto_origen())).where(CM.cuenta_id.in_(ids), CM.anulado.is_(False)).group_by(CM.cuenta_id)
    ):
        total[cid] += suma
    for cid, suma in db.execute(
        select(CM.cuenta_destino_id, func.sum(CM.monto))
        .where(CM.cuenta_destino_id.in_(ids), CM.tipo == "traspaso", CM.anulado.is_(False))
        .group_by(CM.cuenta_destino_id)
    ):
        total[cid] += suma
    return total


def efecto_en(m: CM, cuenta_id: int) -> Decimal:
    """Lo que un movimiento suma (+) o resta (-) a UNA cuenta (misma regla que el SQL de `saldos`)."""
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
        | {m.anulado_por for m in movs} | {m.editado_por for m in movs},
    )
    salida = []
    for m in movs:
        tocadas = [m.cuenta_id] + ([m.cuenta_destino_id] if m.cuenta_destino_id else [])
        registrable = all(i in cuentas and es_dueno_o_encargado(ctx, cuentas[i]) for i in tocadas)
        persona = nom.get(m.persona_usuario_id) if m.persona_tipo == "miembro" else m.persona_nombre
        extra = {}
        if resultado is not None and m.id in resultado:
            extra = {"saldo_resultante": texto(resultado[m.id], m.moneda), "deja_saldo_negativo": resultado[m.id] < 0}
        salida.append(MovimientoCuentaOut(
            id=m.id, tipo=m.tipo, moneda=m.moneda, monto=texto(m.monto, m.moneda), comision=texto(m.comision, m.moneda),
            sentido=m.sentido, saldo_previo=texto(m.saldo_previo, m.moneda), saldo_declarado=texto(m.saldo_declarado, m.moneda),
            fecha=m.fecha, nota=m.nota,
            cuenta_id=m.cuenta_id if m.cuenta_id in ve else None, cuenta_nombre=nom_cuentas[m.cuenta_id],
            cuenta_destino_id=m.cuenta_destino_id if m.cuenta_destino_id in ve else None,
            cuenta_destino_nombre=nom_cuentas[m.cuenta_destino_id] if m.cuenta_destino_id else None,
            persona_tipo=m.persona_tipo, persona_usuario_id=m.persona_usuario_id if m.persona_tipo == "miembro" else None,
            persona_nombre=persona, usuario_id=m.usuario_id, usuario_nombre=nom.get(m.usuario_id, ""),
            puede_registrar=registrable,
            efecto=texto(efecto_en(m, cuenta_ref), m.moneda) if cuenta_ref is not None else None,
            **extra, **auditoria(m, nom),
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
        "fecha": m.fecha, "nota": m.nota, "persona": persona,
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
    persona = _persona(db, ctx, d)
    m = _nuevo(ctx, uuid_txt, c, "deposito", monto=d.monto, fecha=d.fecha, nota=d.nota, **persona)
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
    persona = _persona(db, ctx, d)
    m = _nuevo(ctx, uuid_txt, c, "retiro", monto=d.monto, comision=d.comision, fecha=d.fecha, nota=d.nota, **persona)
    return _guardar(db, ctx, m, persona, c)


def registrar_ajuste(db: Session, ctx: Contexto, cuenta_id: int, d: AjusteCrear) -> tuple[MovimientoCuentaOut, bool]:
    """Ajuste por conteo: el usuario indica el saldo REAL; se registra la diferencia (con nota) sobre el saldo que hay
    AHORA, calculado con la cuenta bloqueada para que nadie lo cambie mientras tanto."""
    uuid_txt = str(d.uuid_cliente) if d.uuid_cliente else None
    if p := _previo(db, ctx, uuid_txt):
        return p
    c = _preparar(db, ctx, [cuenta_id])[cuenta_id]
    validar_monto(d.saldo_declarado, c.moneda, "saldo_declarado", positivo=False, permitir_negativo=True)
    previo = saldos(db, [c])[c.id]
    diferencia = d.saldo_declarado - previo
    if diferencia == 0:
        raise HTTPException(status_code=422, detail="El saldo contado coincide con el saldo actual: no hay nada que ajustar")
    persona = _persona(db, ctx, d)
    m = _nuevo(
        ctx, uuid_txt, c, "ajuste", monto=abs(diferencia), sentido="entrada" if diferencia > 0 else "salida",
        saldo_previo=previo, saldo_declarado=d.saldo_declarado, fecha=d.fecha, nota=d.nota, **persona,
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
    persona = _persona(db, ctx, d)
    m = _nuevo(
        ctx, uuid_txt, origen, "traspaso", cuenta_destino_id=destino.id, monto=d.monto, fecha=d.fecha, nota=d.nota, **persona
    )
    return _guardar(db, ctx, m, persona, origen)


def _ver_movimiento(db: Session, ctx: Contexto, mov_id: int) -> CM:
    m = db.get(CM, mov_id)
    if not vis.puede_ver_mov_cuenta(db, ctx, m):  # otra familia, oculto o inexistente: el mismo 404
        raise HTTPException(status_code=404, detail="Movimiento de cuenta no encontrado")
    return m


def obtener_movimiento(db: Session, ctx: Contexto, mov_id: int) -> MovimientoCuentaOut:
    return armar_movimientos(db, ctx, [_ver_movimiento(db, ctx, mov_id)])[0]


def _tocar_movimiento(db: Session, ctx: Contexto, mov_id: int) -> tuple[CM, dict[int, Cuenta]]:
    """Para anular o reactivar: lo ves (404), eres dueno o encargado de TODAS sus cuentas (403), todo bloqueado."""
    m = _ver_movimiento(db, ctx, mov_id)
    ids = [m.cuenta_id] + ([m.cuenta_destino_id] if m.cuenta_destino_id else [])
    # lo ves (por una de sus cuentas), pero si no eres dueno o encargado de TODAS (incluida una que no ves) es 403
    _exigir_registrar(ctx, [db.get(Cuenta, i) for i in ids])
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
    q = q.order_by(CM.fecha.desc(), CM.id.desc()).limit(limite).offset(desplazamiento)
    return armar_movimientos(db, ctx, list(db.scalars(q)), cuenta_ref=cuenta_id)
