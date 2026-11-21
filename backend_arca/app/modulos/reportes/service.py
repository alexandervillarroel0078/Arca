"""Agregaciones de solo lectura. Reglas: devolucion no es ingreso; consumido va aparte.

Fuente de pago (0010): ingresos, gastos, categorias y miembros cuentan TODO sin importar la fuente (un gasto por confirmar
tambien: el gasto ocurrio). `saldo_efectivo` ("Te queda") usa SOLO lo registrado en Efectivo:
ingresos_efectivo - gastos_efectivo - apoyos_efectivo + devoluciones (las devoluciones siempre son en efectivo).
`fuente` = efectivo | banco filtra cada reporte por la fuente del registro (sin filtro = todos)."""
from datetime import date, timedelta
from decimal import Decimal

from sqlalchemy import func, select, true
from sqlalchemy.orm import Session

from app.core.deps import Contexto
from app.core.tipos import rango_completo, rango_mes
from app.modulos.familia.models import Familia, Miembro
from app.modulos.periodos.calculo import etiqueta_comparacion, hoy_la_paz, periodo_comparacion
from app.modulos.apoyos.models import Apoyo, Devolucion
from app.modulos.apoyos.service import resumen as resumen_apoyos
from app.modulos.auth.models import Usuario
from app.modulos.categorias.models import Categoria
from app.modulos.movimientos.models import Movimiento
from app.modulos.visibilidad import service as vis
from app.modulos.reportes.schemas import (
    CategoriaTotal,
    Comparacion,
    PeriodoAnterior,
    ComparacionResumen,
    MesTotal,
    MiembroTotal,
    PorCategoriaOut,
    PorMiembroOut,
    ResumenOut,
    TendenciaOut,
)

CERO = Decimal("0.00")


def _etiqueta(inicio: date) -> str:
    return f"{inicio.year:04d}-{inicio.month:02d}"


def _suma(db: Session, columna, *condiciones) -> Decimal:
    return Decimal(db.scalar(select(func.coalesce(func.sum(columna), 0)).where(*condiciones)))


def de_fuente(modelo, fuente: str | None):
    """Condicion de la fuente de pago: efectivo (sin cuenta), banco (con cuenta) o todos."""
    if fuente == "efectivo":
        return modelo.cuenta_id.is_(None)
    if fuente == "banco":
        return modelo.cuenta_id.is_not(None)
    return true()


def _totales_mes(db: Session, ctx: Contexto, inicio: date, fin: date, fuente: str | None = None) -> dict[str, Decimal]:
    """Todo se calcula SOLO con lo que `ctx` puede ver (vis.condicion): lo privado de otros no suma."""
    def mov(tipo: str, f: str | None) -> Decimal:
        return _suma(
            db, Movimiento.monto,
            vis.condicion(ctx, Movimiento), Movimiento.tipo == tipo, Movimiento.anulado.is_(False),
            Movimiento.fecha >= inicio, Movimiento.fecha < fin, de_fuente(Movimiento, fuente), de_fuente(Movimiento, f),
        )

    def apo(columna, f: str | None) -> Decimal:
        return _suma(
            db, columna, vis.condicion(ctx, Apoyo), Apoyo.anulado.is_(False), Apoyo.fecha >= inicio, Apoyo.fecha < fin,
            de_fuente(Apoyo, fuente), de_fuente(Apoyo, f),
        )

    ingresos, gastos = mov("ingreso", None), mov("gasto", None)
    ingresos_banco, gastos_banco = mov("ingreso", "banco"), mov("gasto", "banco")
    apoyos, apoyos_banco = apo(Apoyo.monto, None), apo(Apoyo.monto, "banco")
    consumido = apo(Apoyo.monto_consumido, None)
    # las devoluciones no tienen fuente: son efectivo (con el filtro "banco" no aparecen)
    devoluciones = CERO if fuente == "banco" else Decimal(
        db.scalar(
            select(func.coalesce(func.sum(Devolucion.monto), 0))
            .join(Apoyo, Apoyo.id == Devolucion.apoyo_id)
            .where(
                vis.condicion(ctx, Apoyo), Apoyo.anulado.is_(False), Devolucion.anulado.is_(False),
                Devolucion.fecha >= inicio, Devolucion.fecha < fin,
            )
        )
    )
    return {
        "ingresos": ingresos,
        "gastos": gastos,
        "apoyos_entregados": apoyos,
        "devoluciones": devoluciones,
        "consumido": consumido,
        "saldo": ingresos - gastos - apoyos + devoluciones,
        "ingresos_banco": ingresos_banco,
        "gastos_banco": gastos_banco,
        "apoyos_banco": apoyos_banco,
        "saldo_efectivo": (ingresos - ingresos_banco) - (gastos - gastos_banco) - (apoyos - apoyos_banco) + devoluciones,
    }


def comparar(actual: Decimal, anterior: Decimal) -> Comparacion:
    """Diferencia en Bs y en porcentaje. Si el anterior es 0 el porcentaje es nulo (nunca se divide por cero)."""
    diferencia = actual - anterior
    porcentaje = round(float(diferencia / abs(anterior) * 100), 1) if anterior != 0 else None
    return Comparacion(anterior=anterior, diferencia=diferencia, porcentaje=porcentaje)


def _periodo_anterior(
    db: Session, ctx: Contexto, inicio: date, fin: date, tipo: str | None, mes: str | None
) -> tuple[date, date, date, date, str]:
    """(desde_ant, hasta_ant, inicio_ant, fin_ant_exclusivo, etiqueta). Mes, semana y anio se comparan con el
    periodo anterior DEL MISMO TIPO (el de la flecha "anterior", con el dia de inicio del mes de la familia); dia y
    rango con un tramo del mismo largo inmediatamente antes. Sin `tipo`: `mes=AAAA-MM` es un mes calendario y
    `desde`/`hasta` sueltos son un rango."""
    dia = 1
    if tipo is None:
        tipo = "mes" if mes else "rango"
    elif tipo == "mes":
        dia = db.get(Familia, ctx.familia_id).dia_inicio_mes
    hasta = fin - timedelta(days=1)
    desde_ant, hasta_ant = periodo_comparacion(tipo, inicio, hasta, dia)
    return desde_ant, hasta_ant, desde_ant, hasta_ant + timedelta(days=1), etiqueta_comparacion(tipo, inicio, hasta, dia)


def contar_privados(db: Session, ctx: Contexto, inicio: date, fin: date) -> int:
    """'Incluye tus N registros privados': tus movimientos y apoyos activos del periodo que no son de toda la familia."""
    n_mov = db.scalar(
        select(func.count()).select_from(Movimiento).where(
            vis.privados_propios(ctx, Movimiento), Movimiento.anulado.is_(False),
            Movimiento.fecha >= inicio, Movimiento.fecha < fin,
        )
    )
    n_apo = db.scalar(
        select(func.count()).select_from(Apoyo).where(
            vis.privados_propios(ctx, Apoyo), Apoyo.anulado.is_(False), Apoyo.fecha >= inicio, Apoyo.fecha < fin
        )
    )
    return (n_mov or 0) + (n_apo or 0)


def _gastos_por_categoria(db: Session, ctx: Contexto, inicio: date, fin: date, fuente: str | None = None):
    return db.execute(
        select(Categoria.id, Categoria.nombre, Categoria.icono, func.sum(Movimiento.monto))
        .join(Movimiento, Movimiento.categoria_id == Categoria.id)
        .where(
            Categoria.familia_id == ctx.familia_id,
            vis.condicion(ctx, Movimiento), Movimiento.tipo == "gasto", Movimiento.anulado.is_(False),
            Movimiento.fecha >= inicio, Movimiento.fecha < fin, de_fuente(Movimiento, fuente),
        )
        .group_by(Categoria.id, Categoria.nombre, Categoria.icono)
        .order_by(func.sum(Movimiento.monto).desc())
    ).all()


def resumen(
    db: Session, ctx: Contexto, mes: str | None, desde: date | None = None, hasta: date | None = None,
    tipo: str | None = None, fuente: str | None = None,
) -> ResumenOut:
    inicio, fin = rango_completo(mes, desde, hasta)
    t = _totales_mes(db, ctx, inicio, fin, fuente)
    d_ant, h_ant, i_ant, f_ant, et_ant = _periodo_anterior(db, ctx, inicio, fin, tipo, mes)
    ant = _totales_mes(db, ctx, i_ant, f_ant, fuente)
    pendientes = resumen_apoyos(db, ctx)
    con_saldo = [b for b in pendientes.beneficiarios if b.pendiente > 0]
    return ResumenOut(
        mes=_etiqueta(inicio),
        desde=inicio,
        hasta=fin - timedelta(days=1),
        comparacion=ComparacionResumen(
            desde=d_ant, hasta=h_ant, etiqueta=et_ant,
            ingresos=comparar(t["ingresos"], ant["ingresos"]),
            gastos=comparar(t["gastos"], ant["gastos"]),
            saldo=comparar(t["saldo"], ant["saldo"]),
            saldo_efectivo=comparar(t["saldo_efectivo"], ant["saldo_efectivo"]),
        ),
        gasto_familiar_total=t["gastos"] + t["consumido"],
        apoyos_pendientes_total=pendientes.total_pendiente,
        apoyos_pendientes_cantidad=len(con_saldo),
        incluye_privados=contar_privados(db, ctx, inicio, fin),
        **t,
    )


def por_categoria(
    db: Session, ctx: Contexto, mes: str | None, desde: date | None = None, hasta: date | None = None,
    tipo: str | None = None, fuente: str | None = None,
) -> PorCategoriaOut:
    inicio, fin = rango_completo(mes, desde, hasta)
    filas = _gastos_por_categoria(db, ctx, inicio, fin, fuente)
    total = sum((Decimal(f[3]) for f in filas), CERO)
    d_ant, h_ant, i_ant, f_ant, et_ant = _periodo_anterior(db, ctx, inicio, fin, tipo, mes)
    previas = {f[0]: Decimal(f[3]) for f in _gastos_por_categoria(db, ctx, i_ant, f_ant, fuente)}
    total_ant = sum(previas.values(), CERO)
    categorias = [
        CategoriaTotal(
            categoria_id=i, categoria=n, icono=ic, total=Decimal(s),
            porcentaje=round(float(Decimal(s) / total * 100), 1) if total else 0.0,
            comparacion=comparar(Decimal(s), previas.get(i, CERO)),
        )
        for i, n, ic, s in filas
    ]
    consumido = _suma(
        db, Apoyo.monto_consumido, vis.condicion(ctx, Apoyo), Apoyo.anulado.is_(False),
        Apoyo.fecha >= inicio, Apoyo.fecha < fin, de_fuente(Apoyo, fuente),
    )
    return PorCategoriaOut(
        incluye_privados=contar_privados(db, ctx, inicio, fin),
        mes=_etiqueta(inicio), desde=inicio, hasta=fin - timedelta(days=1), comparacion=comparar(total, total_ant),
        periodo_anterior=PeriodoAnterior(desde=d_ant, hasta=h_ant, etiqueta=et_ant),
        categorias=categorias, total_gastos=total, apoyos_consumidos=consumido,
    )


def por_miembro(
    db: Session, ctx: Contexto, mes: str | None, desde: date | None = None, hasta: date | None = None,
    fuente: str | None = None,
) -> PorMiembroOut:
    inicio, fin = rango_completo(mes, desde, hasta)
    miembros = db.execute(
        select(Usuario.id, Usuario.nombre)
        .join(Miembro, Miembro.usuario_id == Usuario.id)
        .where(Miembro.familia_id == ctx.familia_id)
        .order_by(Miembro.id)
    ).all()
    salida = []
    for uid, nombre in miembros:
        def mov(tipo: str) -> Decimal:
            return _suma(
                db, Movimiento.monto,
                vis.condicion(ctx, Movimiento), Movimiento.usuario_id == uid,
                Movimiento.tipo == tipo, Movimiento.anulado.is_(False),
                Movimiento.fecha >= inicio, Movimiento.fecha < fin, de_fuente(Movimiento, fuente),
            )

        apoyos = _suma(
            db, Apoyo.monto,
            vis.condicion(ctx, Apoyo), Apoyo.usuario_id == uid, Apoyo.anulado.is_(False),
            Apoyo.fecha >= inicio, Apoyo.fecha < fin, de_fuente(Apoyo, fuente),
        )
        salida.append(
            MiembroTotal(usuario_id=uid, nombre=nombre, ingresos=mov("ingreso"), gastos=mov("gasto"), apoyos_entregados=apoyos)
        )
    return PorMiembroOut(
        mes=_etiqueta(inicio), desde=inicio, hasta=fin - timedelta(days=1), miembros=salida,
        incluye_privados=contar_privados(db, ctx, inicio, fin),
    )


def tendencia_mensual(db: Session, ctx: Contexto, meses: int = 6, fuente: str | None = None) -> TendenciaOut:
    hoy = hoy_la_paz()
    anio, mes = hoy.year, hoy.month
    lista = []
    for _ in range(meses):
        lista.append(date(anio, mes, 1))
        mes -= 1
        if mes == 0:
            anio, mes = anio - 1, 12
    salida = []
    for inicio in reversed(lista):
        _, fin = rango_mes(_etiqueta(inicio))
        salida.append(MesTotal(mes=_etiqueta(inicio), **_totales_mes(db, ctx, inicio, fin, fuente)))
    primero = lista[-1]
    return TendenciaOut(meses=salida, incluye_privados=contar_privados(db, ctx, primero, rango_mes(_etiqueta(lista[0]))[1]))
