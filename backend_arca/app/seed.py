"""Seed de datos de prueba (solo desarrollo). Uso: python -m app.seed

Es idempotente: se puede correr varias veces sin duplicar datos.
"""
import os
import sys
from datetime import date, timedelta
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.db import SessionLocal
from app.core.security import hashear_clave
from app.modulos.apoyos.models import Apoyo, Devolucion
from app.modulos.auth.models import Usuario
from app.modulos.categorias.models import Categoria
from app.modulos.familia.models import Familia, Miembro
from app.modulos.movimientos.models import Movimiento

CLAVE = "Prueba123"
FAMILIA = "Familia Prueba"
MARCA = "[seed]"  # prefijo en las notas para reconocer los datos sembrados

USUARIOS = [
    ("Admin Prueba", "admin@arca.test", "admin"),
    ("Miembro Uno", "miembro1@arca.test", "miembro"),
    ("Miembro Dos", "miembro2@arca.test", "miembro"),
]

CATEGORIAS = [
    ("Transporte", "bus"),
    ("Comida", "utensils"),
    ("Antojos", "cookie"),
    ("Servicios", "zap"),
    ("Gasolina", "fuel"),
    ("Otros", "tag"),
]

# (tipo, categoria, monto, dias atras, indice de usuario, nota)
MOVIMIENTOS = [
    ("ingreso", None, "4500.00", 0, 0, "Sueldo"),
    ("ingreso", None, "1200.00", 1, 1, "Trabajo extra"),
    ("ingreso", None, "800.00", 2, 2, "Venta"),
    ("gasto", "Comida", "180.50", 0, 0, "Mercado semanal"),
    ("gasto", "Comida", "65.00", 1, 1, "Almuerzo"),
    ("gasto", "Transporte", "12.00", 1, 2, "Micro"),
    ("gasto", "Transporte", "20.00", 2, 0, "Taxi"),
    ("gasto", "Antojos", "25.00", 2, 1, "Helado"),
    ("gasto", "Servicios", "230.00", 3, 0, "Luz"),
    ("gasto", "Servicios", "95.00", 3, 2, "Internet"),
    ("gasto", "Gasolina", "150.00", 4, 0, "Tanque"),
    ("gasto", "Otros", "70.00", 4, 1, "Farmacia"),
    ("gasto", "Comida", "110.00", 5, 2, "Cena familiar"),
    ("gasto", "Antojos", "18.00", 6, 1, "Salteñas"),
    ("gasto", "Transporte", "15.00", 6, 0, "Pasaje"),
]

# (beneficiario, monto, [devoluciones], consumido, nota) -> Pendiente, Saldado, Cerrado
APOYOS = [
    ("Tia Rosa", "500.00", ["200.00"], "0.00", "Ayuda para medicinas"),
    ("Hermano Luis", "300.00", ["100.00", "200.00"], "0.00", "Prestamo para pasajes"),
    ("Primo Pedro", "400.00", ["100.00"], "300.00", "Ayuda para materiales"),
]


def _fecha(hoy: date, dias_atras: int) -> date:
    """Fecha dentro del mes actual (nunca antes del dia 1)."""
    return max(hoy.replace(day=1), hoy - timedelta(days=dias_atras))


def _usuarios_y_familia(db: Session) -> tuple[Familia, list[Usuario]]:
    usuarios: list[Usuario] = []
    for nombre, email, _rol in USUARIOS:
        u = db.scalar(select(Usuario).where(Usuario.email == email))
        if u is None:
            u = Usuario(nombre=nombre, email=email, password_hash=hashear_clave(CLAVE))
            db.add(u)
            db.flush()
        usuarios.append(u)

    admin = usuarios[0]
    familia = db.scalar(
        select(Familia).join(Miembro, Miembro.familia_id == Familia.id).where(
            Familia.nombre == FAMILIA, Miembro.usuario_id == admin.id
        )
    )
    if familia is None:
        familia = Familia(nombre=FAMILIA)
        db.add(familia)
        db.flush()

    for u, (_n, _e, rol) in zip(usuarios, USUARIOS):
        existe = db.scalar(
            select(Miembro).where(Miembro.usuario_id == u.id, Miembro.familia_id == familia.id)
        )
        if existe is None:
            db.add(Miembro(usuario_id=u.id, familia_id=familia.id, rol=rol))
    db.flush()
    return familia, usuarios


def _categorias(db: Session, familia: Familia) -> dict[str, Categoria]:
    resultado: dict[str, Categoria] = {}
    for nombre, icono in CATEGORIAS:
        c = db.scalar(
            select(Categoria).where(Categoria.familia_id == familia.id, Categoria.nombre == nombre)
        )
        if c is None:
            c = Categoria(familia_id=familia.id, nombre=nombre, icono=icono, activa=True)
            db.add(c)
            db.flush()
        resultado[nombre] = c
    return resultado


def _movimientos(db: Session, familia: Familia, usuarios: list[Usuario], cats: dict[str, Categoria]) -> int:
    hoy = date.today()
    creados = 0
    for tipo, cat, monto, dias, idx_usuario, nota in MOVIMIENTOS:
        nota_seed = f"{MARCA} {nota}"
        existe = db.scalar(
            select(Movimiento.id).where(
                Movimiento.familia_id == familia.id,
                Movimiento.nota == nota_seed,
                Movimiento.fecha >= hoy.replace(day=1),
            )
        )
        if existe:
            continue
        db.add(
            Movimiento(
                familia_id=familia.id,
                usuario_id=usuarios[idx_usuario].id,
                tipo=tipo,
                monto=Decimal(monto),
                fecha=_fecha(hoy, dias),
                categoria_id=cats[cat].id if cat else None,
                nota=nota_seed,
            )
        )
        creados += 1
    return creados


def _apoyos(db: Session, familia: Familia, admin: Usuario) -> int:
    hoy = date.today()
    creados = 0
    for beneficiario, monto, devoluciones, consumido, nota in APOYOS:
        nota_seed = f"{MARCA} {nota}"
        existe = db.scalar(
            select(Apoyo.id).where(
                Apoyo.familia_id == familia.id,
                Apoyo.beneficiario == beneficiario,
                Apoyo.nota == nota_seed,
            )
        )
        if existe:
            continue
        apoyo = Apoyo(
            familia_id=familia.id,
            usuario_id=admin.id,
            beneficiario=beneficiario,
            monto=Decimal(monto),
            fecha=_fecha(hoy, 5),
            nota=nota_seed,
            monto_consumido=Decimal(consumido),
        )
        db.add(apoyo)
        db.flush()
        for i, d in enumerate(devoluciones):
            db.add(Devolucion(apoyo_id=apoyo.id, monto=Decimal(d), fecha=_fecha(hoy, 2 - min(i, 2)), nota=MARCA))
        creados += 1
    return creados


def main() -> int:
    entorno = (os.environ.get("ENTORNO") or settings.entorno).strip().lower()
    if entorno in ("produccion", "producción", "prod", "production"):
        print("ERROR: el seed es solo para desarrollo; ENTORNO=produccion. No se hizo nada.")
        return 1

    db = SessionLocal()
    try:
        familia, usuarios = _usuarios_y_familia(db)
        cats = _categorias(db, familia)
        n_mov = _movimientos(db, familia, usuarios, cats)
        n_apo = _apoyos(db, familia, usuarios[0])
        db.commit()
    except Exception as e:  # noqa: BLE001
        db.rollback()
        print(f"ERROR al sembrar datos: {e}")
        return 1
    finally:
        db.close()

    print(f"Seed listo. Movimientos nuevos: {n_mov}. Apoyos nuevos: {n_apo}.")
    print(f"Usuarios: admin@arca.test, miembro1@arca.test, miembro2@arca.test (clave {CLAVE})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
