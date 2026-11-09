from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.modulos.categorias.models import Categoria
from app.modulos.historial import service as historial
from app.modulos.categorias.schemas import CategoriaCrear, CategoriaEditar

CATEGORIAS_INICIALES = [
    ("Transporte", "bus"),
    ("Comida", "utensils"),
    ("Antojos", "cookie"),
    ("Servicios", "zap"),
    ("Gasolina", "fuel"),
    ("Otros", "tag"),
]


def _datos(c: Categoria) -> dict:
    return {"nombre": c.nombre, "icono": c.icono, "activa": c.activa}


def crear_iniciales(db: Session, familia_id: int, usuario_id: int) -> None:
    """Crea las categorias iniciales y deja una entrada de historial por cada una."""
    nuevas = [Categoria(familia_id=familia_id, nombre=n, icono=i, activa=True) for n, i in CATEGORIAS_INICIALES]
    db.add_all(nuevas)
    db.flush()
    for c in nuevas:
        historial.registrar(
            db, familia_id, usuario_id, "categoria", c.id, "crear", historial.creacion(_datos(c)), "Categoría inicial"
        )


def listar(db: Session, familia_id: int) -> list[Categoria]:
    return list(db.scalars(select(Categoria).where(Categoria.familia_id == familia_id).order_by(Categoria.id)))


def _existe_nombre(db: Session, familia_id: int, nombre: str, excepto_id: int | None = None) -> bool:
    consulta = select(Categoria.id).where(Categoria.familia_id == familia_id, Categoria.nombre.ilike(nombre))
    if excepto_id:
        consulta = consulta.where(Categoria.id != excepto_id)
    return db.scalar(consulta) is not None


def crear(db: Session, familia_id: int, datos: CategoriaCrear, usuario_id: int) -> Categoria:
    nombre = datos.nombre.strip()
    if _existe_nombre(db, familia_id, nombre):
        raise HTTPException(status_code=409, detail="Ya existe una categoría con ese nombre")
    cat = Categoria(familia_id=familia_id, nombre=nombre, icono=datos.icono, activa=True)
    db.add(cat)
    db.flush()
    historial.registrar(db, familia_id, usuario_id, "categoria", cat.id, "crear", historial.creacion(_datos(cat)))
    db.commit()
    return cat


def editar(db: Session, familia_id: int, categoria_id: int, datos: CategoriaEditar, usuario_id: int) -> Categoria:
    cat = db.get(Categoria, categoria_id)
    if cat is None or cat.familia_id != familia_id:
        raise HTTPException(status_code=404, detail="Categoría no encontrada")
    cambios = datos.model_dump(exclude_unset=True)
    if "nombre" in cambios and cambios["nombre"] is not None:
        cambios["nombre"] = cambios["nombre"].strip()
        if _existe_nombre(db, familia_id, cambios["nombre"], categoria_id):
            raise HTTPException(status_code=409, detail="Ya existe una categoría con ese nombre")
    antes = _datos(cat)
    for campo, valor in cambios.items():
        if valor is not None:
            setattr(cat, campo, valor)
    dif = historial.diferencias(antes, _datos(cat))
    if dif:
        accion = "editar"
        if "activa" in dif:
            accion = "reactivar" if cat.activa else "desactivar"
        historial.registrar(db, familia_id, usuario_id, "categoria", cat.id, accion, dif)
    db.commit()
    return cat


def obtener_de_familia(db: Session, familia_id: int, categoria_id: int) -> Categoria:
    cat = db.get(Categoria, categoria_id)
    if cat is None or cat.familia_id != familia_id:
        raise HTTPException(status_code=422, detail="La categoría no existe en tu familia")
    return cat
