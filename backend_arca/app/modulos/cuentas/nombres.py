"""UNICO punto que convierte ids de cuenta en nombres para el lector.

`nombres_para` devuelve el nombre real si el lector VE la cuenta y "otra cuenta" si no (otra familia, privada de otro,
inexistente). Las salidas de la API de cuentas, el historial, la bitacora y el CSV de la bitacora pasan TODAS por aqui:
en la base (`historial.cambios`) solo se guardan IDS de cuenta, nunca nombres, asi que un nombre no puede filtrarse
por otro camino. PROHIBIDO leer `Cuenta.nombre` para mostrarlo en otro lugar.
"""
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.deps import Contexto
from app.modulos.cuentas.models import Cuenta, CuentaMovimiento
from app.modulos.cuentas.monedas import con_moneda
from app.modulos.historial.models import Historial
from app.modulos.visibilidad import service as vis

OTRA_CUENTA = "otra cuenta"
# Campos de `historial.cambios` que guardan un id de cuenta -> nombre del campo ya resuelto en la salida
CAMPOS_CUENTA = {"cuenta_id": "cuenta", "cuenta_destino_id": "cuenta_destino"}
ENTIDADES_CUENTAS = ("cuenta", "cuenta_mov")


def visibles(db: Session, ctx: Contexto, ids) -> set[int]:
    """Ids de cuenta (de los pedidos) que este usuario puede ver."""
    ids = {i for i in ids if i is not None}
    if not ids:
        return set()
    return set(db.scalars(select(Cuenta.id).where(Cuenta.id.in_(ids), vis.condicion(ctx, Cuenta))))


def nombres_para(db: Session, ctx: Contexto, ids) -> dict[int, str]:
    """{id: nombre real} si la ves, {id: "otra cuenta"} si no. Incluye todos los ids pedidos."""
    ids = {i for i in ids if i is not None}
    if not ids:
        return {}
    ve = visibles(db, ctx, ids)
    reales = {i: n for i, n in db.execute(select(Cuenta.id, Cuenta.nombre).where(Cuenta.id.in_(ve)))} if ve else {}
    return {i: reales.get(i, OTRA_CUENTA) for i in ids}


def _ids_de_cambios(cambios: dict) -> set[int]:
    out = set()
    for campo in CAMPOS_CUENTA:
        c = cambios.get(campo)
        if isinstance(c, dict):
            out |= {v for v in (c.get("antes"), c.get("despues")) if isinstance(v, int)}
    return out


def resolver_cambios(db: Session, ctx: Contexto, filas: list[Historial]) -> list[dict]:
    """`cambios` de cada fila (en el mismo orden) con los ids de cuenta cambiados por su nombre para ESTE lector."""
    ids: set[int] = set()
    for f in filas:
        if f.entidad == "cuenta_mov":
            ids |= _ids_de_cambios(f.cambios or {})
    nombres = nombres_para(db, ctx, ids)
    salida = []
    for f in filas:
        cambios = f.cambios or {}
        if f.entidad != "cuenta_mov":
            salida.append(cambios)
            continue
        nuevo = {}
        for campo, c in cambios.items():
            if campo in CAMPOS_CUENTA and isinstance(c, dict):
                nuevo[CAMPOS_CUENTA[campo]] = {k: nombres.get(c.get(k)) if c.get(k) is not None else None for k in ("antes", "despues")}
            else:
                nuevo[campo] = c
        salida.append(nuevo)
    return salida


def describir(db: Session, ctx: Contexto, entidad: str, ids) -> dict[int, str]:
    """Descripcion corta en minusculas ("depósito de 100.00 USD en Caja") SIN saldos ni ultimos 4 digitos."""
    ids = {i for i in ids if i is not None}
    if not ids:
        return {}
    if entidad == "cuenta":
        nombres = nombres_para(db, ctx, ids)
        return {i: f"cuenta {n}" for i, n in nombres.items()}
    movs = list(db.scalars(select(CuentaMovimiento).where(CuentaMovimiento.id.in_(ids))))
    nombres = nombres_para(db, ctx, {m.cuenta_id for m in movs} | {m.cuenta_destino_id for m in movs})
    out = {}
    for m in movs:
        monto, origen = con_moneda(m.monto, m.moneda), nombres[m.cuenta_id]
        if m.tipo == "deposito":
            out[m.id] = f"depósito de {monto} en {origen}"
        elif m.tipo == "retiro":
            out[m.id] = f"retiro de {monto} de {origen}"
        elif m.tipo == "traspaso":
            out[m.id] = f"traspaso de {monto} de {origen} a {nombres[m.cuenta_destino_id]}"
        else:
            out[m.id] = f"ajuste por conteo en {origen}"
    return out
