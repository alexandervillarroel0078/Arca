"""Apoyos y devoluciones. Lo anulado no cuenta en ningun total ni estado; nada se borra."""
from datetime import date
from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session

from app.core.anulable import (
    auditoria,
    exigir_activo,
    exigir_dueno_o_admin,
    exigir_version,
    limpiar_anulacion,
    marcar_anulacion,
    marcar_edicion,
    nombres_usuarios,
)
from app.core.deps import Contexto
from app.core.tipos import rango_filtro
from app.modulos.historial import service as historial
from app.modulos.visibilidad import cambios as visib
from app.modulos.visibilidad import service as vis
from app.modulos.apoyos.models import Apoyo, Devolucion
from app.modulos.apoyos.schemas import (
    ApoyoCrear,
    ApoyoEditar,
    ApoyoOut,
    ApoyosResumen,
    BeneficiarioResumen,
    DevolucionCrear,
    DevolucionEditar,
    DevolucionOut,
)

CERO = Decimal("0.00")
MOTIVO_CASCADA = "Anulada junto con el apoyo"


def _datos_apoyo(a: Apoyo) -> dict:
    return {"beneficiario": a.beneficiario, "monto": a.monto, "fecha": a.fecha, "nota": a.nota}


def _datos_dev(d: Devolucion) -> dict:
    return {"monto": d.monto, "fecha": d.fecha, "nota": d.nota}


def _log(db: Session, ctx: Contexto, entidad: str, entidad_id: int, accion: str, cambios: dict | None = None, motivo: str | None = None):
    historial.registrar(db, ctx.familia_id, ctx.usuario.id, entidad, entidad_id, accion, cambios, motivo)


def calcular_estado(pendiente: Decimal, consumido: Decimal) -> str:
    """Pendiente: queda por devolver. Saldado: todo devuelto. Cerrado: el resto se consumio."""
    if pendiente > 0:
        return "Pendiente"
    return "Cerrado" if consumido > 0 else "Saldado"


def _devuelto_activo(db: Session, apoyo_ids: list[int]) -> dict[int, Decimal]:
    if not apoyo_ids:
        return {}
    filas = db.execute(
        select(Devolucion.apoyo_id, func.coalesce(func.sum(Devolucion.monto), 0))
        .where(Devolucion.apoyo_id.in_(apoyo_ids), Devolucion.anulado.is_(False))
        .group_by(Devolucion.apoyo_id)
    ).all()
    return {a: Decimal(s) for a, s in filas}


def _armar(db: Session, apoyos: list[Apoyo], ctx: Contexto) -> list[ApoyoOut]:
    ids = [a.id for a in apoyos]
    personas = vis.compartidos_de(db, "apoyo", [a.id for a in apoyos if a.usuario_id == ctx.usuario.id and a.visibilidad == "elegidas"])
    devuelto = _devuelto_activo(db, ids)
    anulados = {a.id for a in apoyos if a.anulado}
    devs: dict[int, list[Devolucion]] = {i: [] for i in ids}
    if ids:
        for d in db.scalars(select(Devolucion).where(Devolucion.apoyo_id.in_(ids)).order_by(Devolucion.fecha, Devolucion.id)):
            devs[d.apoyo_id].append(d)
    # las devoluciones anuladas solo se muestran si el apoyo fue anulado o ya se pidio verlas (ver_anulados)
    nombres = nombres_usuarios(
        db,
        {a.usuario_id for a in apoyos} | {a.anulado_por for a in apoyos} | {a.editado_por for a in apoyos}
        | {d.usuario_id for lista in devs.values() for d in lista}
        | {d.anulado_por for lista in devs.values() for d in lista}
        | {d.editado_por for lista in devs.values() for d in lista},
    )
    salida = []
    for a in apoyos:
        if a.anulado:
            dev, consumido, pendiente, estado = CERO, CERO, CERO, "Anulado"
        else:
            dev = devuelto.get(a.id, CERO)
            consumido = a.monto_consumido
            pendiente = a.monto - dev - consumido
            estado = calcular_estado(pendiente, consumido)
        todas = devs[a.id]
        salida.append(
            ApoyoOut(
                id=a.id,
                beneficiario=a.beneficiario,
                monto=a.monto,
                fecha=a.fecha,
                nota=a.nota,
                usuario_id=a.usuario_id,
                usuario_nombre=nombres.get(a.usuario_id, ""),
                visibilidad=a.visibilidad,
                compartido_con=personas.get(a.id, []),
                devuelto=dev,
                consumido=consumido,
                pendiente=pendiente,
                estado=estado,
                devoluciones_activas=sum(1 for d in todas if not d.anulado),
                devoluciones=[
                    DevolucionOut(
                        id=d.id,
                        apoyo_id=d.apoyo_id,
                        monto=d.monto,
                        fecha=d.fecha,
                        nota=d.nota,
                        usuario_id=d.usuario_id,
                        usuario_nombre=nombres.get(d.usuario_id) if d.usuario_id else None,
                        anulada_con_apoyo=d.anulada_con_apoyo,
                        **auditoria(d, nombres),
                    )
                    for d in todas
                ],
                **auditoria(a, nombres),
            )
        )
    return salida


def _en_periodo(inicio: date | None, fin: date | None, columna):
    condiciones = []
    if inicio is not None:
        condiciones.append(columna >= inicio)
    if fin is not None:
        condiciones.append(columna < fin)
    return condiciones


def listar(
    db: Session,
    ctx: Contexto,
    beneficiario: str | None = None,
    ver_anulados: bool = False,
    desde: date | None = None,
    hasta: date | None = None,
) -> list[ApoyoOut]:
    consulta = vis.filtrar(select(Apoyo), ctx, Apoyo).order_by(Apoyo.fecha.desc(), Apoyo.id.desc())
    if not ver_anulados:
        consulta = consulta.where(Apoyo.anulado.is_(False))
    inicio, fin = rango_filtro(None, desde, hasta)
    if inicio is not None or fin is not None:
        # entregado en el periodo, o con alguna devolucion hecha dentro de el
        con_devolucion = select(Devolucion.apoyo_id).where(*_en_periodo(inicio, fin, Devolucion.fecha))
        if not ver_anulados:
            con_devolucion = con_devolucion.where(Devolucion.anulado.is_(False))
        consulta = consulta.where(or_(and_(*_en_periodo(inicio, fin, Apoyo.fecha)), Apoyo.id.in_(con_devolucion)))
    if beneficiario:
        consulta = consulta.where(func.lower(Apoyo.beneficiario) == beneficiario.strip().lower())
    salida = _armar(db, list(db.scalars(consulta)), ctx)
    if not ver_anulados:
        for a in salida:  # sin "ver anulados" tampoco se muestran las devoluciones anuladas
            a.devoluciones = [d for d in a.devoluciones if not d.anulado]
    return salida


def _obtener(db: Session, ctx: Contexto, apoyo_id: int, bloquear: bool = False) -> Apoyo:
    a = db.get(Apoyo, apoyo_id, with_for_update=bloquear or None)
    vis.exigir_ver(db, ctx, a, "Apoyo")  # lo que no puedes ver responde igual que lo que no existe: 404
    return a


def obtener(db: Session, ctx: Contexto, apoyo_id: int) -> ApoyoOut:
    return _armar(db, [_obtener(db, ctx, apoyo_id)], ctx)[0]


def _obtener_modificable(db: Session, ctx: Contexto, apoyo_id: int) -> Apoyo:
    a = _obtener(db, ctx, apoyo_id, bloquear=True)
    vis.exigir_editar(ctx, a)
    return a


def _ya_aplicada(db: Session, ctx: Contexto, entidad: str, entidad_id: int) -> bool:
    """Idempotencia por operacion: la misma operacion (mismo UUID) enviada dos veces tiene un solo efecto."""
    return historial.operacion_aplicada(db, ctx.familia_id, ctx.uuid_operacion, entidad, entidad_id)


def _actual_apoyo(db: Session, a: Apoyo, ctx: Contexto):
    return lambda: _armar(db, [a], ctx)[0]


def _actual_dev(db: Session, a: Apoyo, d: Devolucion, ctx: Contexto):
    return lambda: next(x for x in _armar(db, [a], ctx)[0].devoluciones if x.id == d.id)


def _pendiente(db: Session, a: Apoyo) -> Decimal:
    return a.monto - _devuelto_activo(db, [a.id]).get(a.id, CERO) - a.monto_consumido


def crear(db: Session, ctx: Contexto, datos: ApoyoCrear) -> tuple[ApoyoOut, bool]:
    uuid_txt = str(datos.uuid_cliente) if datos.uuid_cliente else None
    if uuid_txt:
        previo = db.scalar(select(Apoyo).where(Apoyo.familia_id == ctx.familia_id, Apoyo.uuid_cliente == uuid_txt))
        if previo is not None:
            if not vis.puede_ver(db, ctx, previo):
                raise HTTPException(status_code=409, detail="Ese identificador ya fue usado")
            return _armar(db, [previo], ctx)[0], False  # si estaba anulado, sigue anulado
    visibilidad, personas = visib.preparar_creacion(db, ctx, datos)
    a = Apoyo(
        visibilidad=visibilidad,
        familia_id=ctx.familia_id,
        usuario_id=ctx.usuario.id,
        beneficiario=datos.beneficiario.strip(),
        monto=datos.monto,
        fecha=datos.fecha,
        nota=datos.nota,
        monto_consumido=CERO,
        uuid_cliente=uuid_txt,
    )
    db.add(a)
    db.flush()
    visib.guardar_personas(db, ctx, "apoyo", a.id, personas)
    _log(db, ctx, "apoyo", a.id, "crear", historial.creacion(_datos_apoyo(a)))
    if datos.anulado:  # creado y anulado sin internet: una sola operacion
        marcar_anulacion(a, ctx.usuario.id, datos.motivo_anulacion)
        historial.registrar(
            db, ctx.familia_id, ctx.usuario.id, "apoyo", a.id, "anular",
            {"anulado": historial.cambio(False, True)}, a.motivo_anulacion, datos.fecha_cliente_anulacion,
        )
    db.commit()
    return _armar(db, [a], ctx)[0], True


def editar(db: Session, ctx: Contexto, apoyo_id: int, datos: ApoyoEditar) -> ApoyoOut:
    a = _obtener_modificable(db, ctx, apoyo_id)
    if _ya_aplicada(db, ctx, "apoyo", a.id):
        return _armar(db, [a], ctx)[0]
    if (datos.visibilidad is not None or datos.compartido_con is not None) and a.usuario_id != ctx.usuario.id:
        # el admin puede editar lo "familia" de otros, pero quien lo ve solo lo cambia el dueno (como en /visibilidad)
        raise HTTPException(status_code=403, detail="Solo quien lo registró puede cambiar quién lo ve")
    exigir_version(a, datos.version_base, _actual_apoyo(db, a, ctx), "El apoyo")
    cambios = datos.model_dump(exclude_unset=True, exclude={"visibilidad", "compartido_con", "version_base"})
    if cambios or not (datos.visibilidad or datos.compartido_con is not None):
        exigir_activo(a, "El apoyo")  # cambiar solo "quien lo ve" se permite tambien en un apoyo anulado
    antes = _datos_apoyo(a)
    if cambios.get("monto") is not None:
        minimo = a.monto_consumido + _devuelto_activo(db, [a.id]).get(a.id, CERO)
        if cambios["monto"] < minimo:
            raise HTTPException(
                status_code=400,
                detail=f"El monto no puede ser menor a lo ya devuelto y consumido (Bs {minimo:.2f})",
            )
        a.monto = cambios["monto"]
    if cambios.get("beneficiario") is not None:
        a.beneficiario = cambios["beneficiario"].strip()
    if cambios.get("fecha") is not None:
        a.fecha = cambios["fecha"]
    if "nota" in cambios:
        a.nota = cambios["nota"]
    diferencias = historial.diferencias(antes, _datos_apoyo(a))
    cambio_vis = visib.aplicar(db, ctx, a, datos.visibilidad, datos.compartido_con)
    if diferencias or not cambio_vis:
        marcar_edicion(a, ctx.usuario.id)
        _log(db, ctx, "apoyo", a.id, "editar", diferencias)
    db.commit()
    return _armar(db, [a], ctx)[0]


def anular(db: Session, ctx: Contexto, apoyo_id: int, motivo: str | None, version_base: int | None = None) -> ApoyoOut:
    """Anula el apoyo y, en cascada, sus devoluciones activas (marcadas para volver al reactivar)."""
    a = _obtener_modificable(db, ctx, apoyo_id)
    if _ya_aplicada(db, ctx, "apoyo", a.id):
        return _armar(db, [a], ctx)[0]
    exigir_version(a, version_base, _actual_apoyo(db, a, ctx), "El apoyo")
    if a.anulado:
        raise HTTPException(status_code=400, detail="El apoyo ya está anulado")
    for d in db.scalars(select(Devolucion).where(Devolucion.apoyo_id == a.id, Devolucion.anulado.is_(False))):
        marcar_anulacion(d, ctx.usuario.id, MOTIVO_CASCADA)
        d.anulada_con_apoyo = True
        _log(db, ctx, "devolucion", d.id, "anular", {"anulado": historial.cambio(False, True)}, MOTIVO_CASCADA)
    marcar_anulacion(a, ctx.usuario.id, motivo)
    _log(db, ctx, "apoyo", a.id, "anular", {"anulado": historial.cambio(False, True)}, a.motivo_anulacion)
    db.commit()
    return _armar(db, [a], ctx)[0]


def reactivar(db: Session, ctx: Contexto, apoyo_id: int, version_base: int | None = None) -> ApoyoOut:
    """Reactiva el apoyo y SOLO las devoluciones que se anularon con el."""
    a = _obtener_modificable(db, ctx, apoyo_id)
    if _ya_aplicada(db, ctx, "apoyo", a.id):
        return _armar(db, [a], ctx)[0]
    exigir_version(a, version_base, _actual_apoyo(db, a, ctx), "El apoyo")
    if not a.anulado:
        raise HTTPException(status_code=400, detail="El apoyo no está anulado")
    limpiar_anulacion(a)
    for d in db.scalars(select(Devolucion).where(Devolucion.apoyo_id == a.id, Devolucion.anulada_con_apoyo.is_(True))):
        limpiar_anulacion(d)
        d.anulada_con_apoyo = False
        _log(db, ctx, "devolucion", d.id, "reactivar", {"anulado": historial.cambio(True, False)}, "Reactivada junto con el apoyo")
    marcar_edicion(a, ctx.usuario.id)
    _log(db, ctx, "apoyo", a.id, "reactivar", {"anulado": historial.cambio(True, False)})
    db.commit()
    return _armar(db, [a], ctx)[0]


def _exigir_puede_devolver(ctx: Contexto, a: Apoyo) -> None:
    if not vis.puede_registrar_devolucion(ctx, a):
        raise HTTPException(
            status_code=403, detail="Esto fue compartido contigo: solo lo puede modificar quien lo registró"
        )


def devolver(db: Session, ctx: Contexto, apoyo_id: int, datos: DevolucionCrear) -> tuple[ApoyoOut, bool]:
    a = _obtener(db, ctx, apoyo_id)
    _exigir_puede_devolver(ctx, a)
    uuid_txt = str(datos.uuid_cliente) if datos.uuid_cliente else None
    if uuid_txt:
        previa = db.scalar(
            select(Devolucion).join(Apoyo, Apoyo.id == Devolucion.apoyo_id).where(
                Apoyo.familia_id == ctx.familia_id, Devolucion.uuid_cliente == uuid_txt
            )
        )
        if previa is not None:
            apoyo_previo = db.get(Apoyo, previa.apoyo_id)
            if previa.apoyo_id != a.id or not vis.puede_ver(db, ctx, apoyo_previo):
                # UUID ya usado en un apoyo que no es este (o que no puedes ver): no se revela nada de ese apoyo
                raise HTTPException(status_code=409, detail="Ese identificador ya fue usado")
            return _armar(db, [apoyo_previo], ctx)[0], False
    exigir_activo(a, "El apoyo")
    pendiente = _pendiente(db, a)
    if datos.monto > pendiente:
        raise HTTPException(status_code=400, detail=f"La devolución supera lo pendiente (Bs {pendiente:.2f})")
    d = Devolucion(
        apoyo_id=a.id, usuario_id=ctx.usuario.id, monto=datos.monto, fecha=datos.fecha,
        nota=datos.nota, uuid_cliente=uuid_txt,
    )
    db.add(d)
    db.flush()
    _log(db, ctx, "devolucion", d.id, "crear", historial.creacion(_datos_dev(d)))
    if datos.anulado:  # creada y anulada sin internet: una sola operacion
        marcar_anulacion(d, ctx.usuario.id, datos.motivo_anulacion)
        historial.registrar(
            db, ctx.familia_id, ctx.usuario.id, "devolucion", d.id, "anular",
            {"anulado": historial.cambio(False, True)}, d.motivo_anulacion, datos.fecha_cliente_anulacion,
        )
    db.commit()
    return _armar(db, [a], ctx)[0], True


def _obtener_devolucion(db: Session, ctx: Contexto, apoyo_id: int, devolucion_id: int) -> tuple[Apoyo, Devolucion]:
    a = _obtener(db, ctx, apoyo_id)
    d = db.get(Devolucion, devolucion_id, with_for_update=True)
    if d is None or d.apoyo_id != a.id:
        raise HTTPException(status_code=404, detail="Devolución no encontrada")
    if a.visibilidad != "familia":
        _exigir_puede_devolver(ctx, a)  # en un apoyo privado o compartido solo su dueno toca las devoluciones
        return a, d
    # dueno de la devolucion: quien la registro (o, si es antigua, quien entrego el apoyo)
    exigir_dueno_o_admin(ctx.es_admin, ctx.usuario.id, d.usuario_id if d.usuario_id else a.usuario_id)
    return a, d


def editar_devolucion(db: Session, ctx: Contexto, apoyo_id: int, devolucion_id: int, datos: DevolucionEditar) -> ApoyoOut:
    a, d = _obtener_devolucion(db, ctx, apoyo_id, devolucion_id)
    if _ya_aplicada(db, ctx, "devolucion", d.id):
        return _armar(db, [a], ctx)[0]
    exigir_version(d, datos.version_base, _actual_dev(db, a, d, ctx), "La devolucion")
    exigir_activo(a, "El apoyo")
    exigir_activo(d, "La devolucion")
    cambios = datos.model_dump(exclude_unset=True)
    antes = _datos_dev(d)
    if cambios.get("monto") is not None:
        otras = _devuelto_activo(db, [a.id]).get(a.id, CERO) - d.monto
        maximo = a.monto - a.monto_consumido - otras
        if cambios["monto"] > maximo:
            raise HTTPException(
                status_code=400, detail=f"Las devoluciones y lo consumido no pueden superar el apoyo (máximo Bs {maximo:.2f})"
            )
        d.monto = cambios["monto"]
    if cambios.get("fecha") is not None:
        d.fecha = cambios["fecha"]
    if "nota" in cambios:
        d.nota = cambios["nota"]
    marcar_edicion(d, ctx.usuario.id)
    _log(db, ctx, "devolucion", d.id, "editar", historial.diferencias(antes, _datos_dev(d)))
    db.commit()
    return _armar(db, [a], ctx)[0]


def anular_devolucion(
    db: Session, ctx: Contexto, apoyo_id: int, devolucion_id: int, motivo: str | None, version_base: int | None = None
) -> ApoyoOut:
    a, d = _obtener_devolucion(db, ctx, apoyo_id, devolucion_id)
    if _ya_aplicada(db, ctx, "devolucion", d.id):
        return _armar(db, [a], ctx)[0]
    exigir_version(d, version_base, _actual_dev(db, a, d, ctx), "La devolucion")
    if d.anulado:
        raise HTTPException(status_code=400, detail="La devolución ya está anulada")
    marcar_anulacion(d, ctx.usuario.id, motivo)
    d.anulada_con_apoyo = False
    _log(db, ctx, "devolucion", d.id, "anular", {"anulado": historial.cambio(False, True)}, d.motivo_anulacion)
    db.commit()
    return _armar(db, [a], ctx)[0]


def reactivar_devolucion(
    db: Session, ctx: Contexto, apoyo_id: int, devolucion_id: int, version_base: int | None = None
) -> ApoyoOut:
    a, d = _obtener_devolucion(db, ctx, apoyo_id, devolucion_id)
    if _ya_aplicada(db, ctx, "devolucion", d.id):
        return _armar(db, [a], ctx)[0]
    exigir_version(d, version_base, _actual_dev(db, a, d, ctx), "La devolucion")
    if not d.anulado:
        raise HTTPException(status_code=400, detail="La devolución no está anulada")
    exigir_activo(a, "El apoyo")
    total = _devuelto_activo(db, [a.id]).get(a.id, CERO) + d.monto + a.monto_consumido
    if total > a.monto:
        raise HTTPException(
            status_code=400,
            detail="No se puede reactivar: lo devuelto y consumido superaría el monto del apoyo",
        )
    limpiar_anulacion(d)
    d.anulada_con_apoyo = False
    marcar_edicion(d, ctx.usuario.id)
    _log(db, ctx, "devolucion", d.id, "reactivar", {"anulado": historial.cambio(True, False)})
    db.commit()
    return _armar(db, [a], ctx)[0]


def consumir(db: Session, ctx: Contexto, apoyo_id: int) -> ApoyoOut:
    """Pasa todo el pendiente a consumido (cuenta como gasto familiar)."""
    a = _obtener_modificable(db, ctx, apoyo_id)
    exigir_activo(a, "El apoyo")
    pendiente = _pendiente(db, a)
    if pendiente <= 0:
        raise HTTPException(status_code=400, detail="Este apoyo no tiene saldo pendiente")
    antes = a.monto_consumido
    a.monto_consumido = a.monto_consumido + pendiente
    marcar_edicion(a, ctx.usuario.id)
    _log(db, ctx, "apoyo", a.id, "consumir", {"monto_consumido": historial.cambio(antes, a.monto_consumido)})
    db.commit()
    return _armar(db, [a], ctx)[0]


def reabrir(db: Session, ctx: Contexto, apoyo_id: int) -> ApoyoOut:
    """Deshace lo consumido: ese monto vuelve a quedar pendiente."""
    a = _obtener_modificable(db, ctx, apoyo_id)
    exigir_activo(a, "El apoyo")
    if a.monto_consumido <= 0:
        raise HTTPException(status_code=400, detail="Este apoyo no tiene nada consumido")
    antes = a.monto_consumido
    a.monto_consumido = CERO
    marcar_edicion(a, ctx.usuario.id)
    _log(db, ctx, "apoyo", a.id, "reabrir", {"monto_consumido": historial.cambio(antes, CERO)})
    db.commit()
    return _armar(db, [a], ctx)[0]


def resumen(
    db: Session, ctx: Contexto, desde: date | None = None, hasta: date | None = None
) -> ApoyosResumen:
    """Por beneficiario. `entregado`, `devuelto`, `consumido`, `pendiente` y `estado` son ACUMULADOS: un apoyo
    pendiente sigue pendiente aunque el periodo elegido no lo incluya. Con desde/hasta solo se agregan
    `entregado_periodo` y `devuelto_periodo` (cada uno por su propia fecha) y se ocultan los beneficiarios sin
    nada pendiente y sin movimiento en el periodo."""
    inicio, fin = rango_filtro(None, desde, hasta)
    con_periodo = inicio is not None or fin is not None

    def dentro(dia: date) -> bool:
        return (inicio is None or dia >= inicio) and (fin is None or dia < fin)

    # solo los apoyos que este usuario puede ver: lo privado de otros (y su beneficiario) no aparece ni suma
    apoyos = _armar(db, list(db.scalars(vis.filtrar(select(Apoyo), ctx, Apoyo).where(Apoyo.anulado.is_(False)))), ctx)
    grupos: dict[str, dict] = {}
    for a in apoyos:
        clave = a.beneficiario.strip().lower()
        g = grupos.setdefault(
            clave,
            {
                "beneficiario": a.beneficiario, "entregado": CERO, "devuelto": CERO, "consumido": CERO, "n": 0,
                "entregado_periodo": CERO, "devuelto_periodo": CERO,
            },
        )
        g["entregado"] += a.monto
        g["devuelto"] += a.devuelto
        g["consumido"] += a.consumido
        g["n"] += 1
        if dentro(a.fecha):
            g["entregado_periodo"] += a.monto
        g["devuelto_periodo"] += sum((d.monto for d in a.devoluciones if not d.anulado and dentro(d.fecha)), CERO)
    beneficiarios = []
    for g in grupos.values():
        pendiente = g["entregado"] - g["devuelto"] - g["consumido"]
        if con_periodo and pendiente <= 0 and g["entregado_periodo"] == 0 and g["devuelto_periodo"] == 0:
            continue
        beneficiarios.append(
            BeneficiarioResumen(
                beneficiario=g["beneficiario"],
                entregado=g["entregado"],
                devuelto=g["devuelto"],
                consumido=g["consumido"],
                pendiente=pendiente,
                estado=calcular_estado(pendiente, g["consumido"]),
                cantidad_apoyos=g["n"],
                entregado_periodo=g["entregado_periodo"],
                devuelto_periodo=g["devuelto_periodo"],
            )
        )
    beneficiarios.sort(key=lambda b: (b.estado != "Pendiente", b.beneficiario.lower()))
    return ApoyosResumen(
        total_entregado=sum((b.entregado for b in beneficiarios), CERO),
        total_devuelto=sum((b.devuelto for b in beneficiarios), CERO),
        total_consumido=sum((b.consumido for b in beneficiarios), CERO),
        total_pendiente=sum((b.pendiente for b in beneficiarios), CERO),
        total_entregado_periodo=sum((b.entregado_periodo for b in beneficiarios), CERO),
        total_devuelto_periodo=sum((b.devuelto_periodo for b in beneficiarios), CERO),
        beneficiarios=beneficiarios,
        incluye_privados=sum(1 for a in apoyos if a.usuario_id == ctx.usuario.id and a.visibilidad != "familia"),
    )


def cambiar_visibilidad(db: Session, ctx: Contexto, apoyo_id: int, datos: visib.VisibilidadCambiar) -> ApoyoOut:
    """Solo el dueno cambia quien lo ve (el admin no ve lo privado de otros). Las devoluciones lo heredan."""
    a = _obtener(db, ctx, apoyo_id, bloquear=True)
    if a.usuario_id != ctx.usuario.id:
        raise HTTPException(status_code=403, detail="Solo quien lo registró puede cambiar quién lo ve")
    if _ya_aplicada(db, ctx, "apoyo", a.id):
        return _armar(db, [a], ctx)[0]
    exigir_version(a, datos.version_base, _actual_apoyo(db, a, ctx), "El apoyo")
    visib.aplicar(db, ctx, a, datos.visibilidad, datos.compartido_con)
    db.commit()
    return _armar(db, [a], ctx)[0]
