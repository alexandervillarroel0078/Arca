"""Etapa 1 de Cuentas - el historial es CERRADO POR DEFECTO.

Una entidad que no esta en la lista blanca (categoria, miembro, usuario, familia) ni tiene rama explicita en
`condicion_historial` no la ve nadie, admin incluido; y `exigir_ver_entidad` responde 404 para entidades desconocidas.
"""
import pytest
from fastapi import HTTPException
from sqlalchemy import select

from app.core.deps import Contexto
from app.modulos.auth.models import Usuario
from app.modulos.historial.models import Historial
from app.modulos.visibilidad import service as vis
from tests.conftest import SesionTest
from tests.test_fase17_matriz import USUARIOS, construir

INVENTADA = "entidad_inventada"
CONOCIDAS_SIN_VISIBILIDAD = ("categoria", "miembro", "usuario", "familia")


def _ctx(db, m, quien):
    u = db.get(Usuario, m.uid[quien])
    familia = 2 if quien == "ajeno" else 1
    return Contexto(usuario=u, familia_id=familia, rol="admin" if quien in ("admin", "ajeno") else "miembro")


def _sembrar(db, m):
    """Entradas de historial de cada entidad en la familia 1 (insertar si esta permitido; solo UPDATE/DELETE no)."""
    ids = {}
    for entidad in (INVENTADA, *CONOCIDAS_SIN_VISIBILIDAD):
        h = Historial(familia_id=1, entidad=entidad, entidad_id=1, accion="crear", usuario_id=m.uid["dueno"])
        db.add(h)
        db.flush()
        ids[entidad] = h.id
    db.commit()
    return ids


@pytest.mark.parametrize("quien", USUARIOS)
def test_una_entidad_inventada_no_la_ve_nadie_ni_el_admin(client, quien):
    m = construir(client, "familia")
    with SesionTest() as db:
        ids = _sembrar(db, m)
        ctx = _ctx(db, m, quien)
        visibles = set(db.scalars(select(Historial.id).where(vis.condicion_historial(ctx))))
        assert ids[INVENTADA] not in visibles
        if quien != "ajeno":  # las demas entidades de la lista blanca se ven igual que antes (la otra familia, nada)
            assert {ids[e] for e in CONOCIDAS_SIN_VISIBILIDAD} <= visibles
        else:
            assert not (set(ids.values()) & visibles)


def test_la_entidad_inventada_tampoco_sale_por_la_api_del_historial_ni_la_bitacora(client):
    m = construir(client, "familia")
    with SesionTest() as db:
        ids = _sembrar(db, m)
    r = client.get("/api/historial", headers=m.h["admin"])
    assert r.status_code == 200
    assert INVENTADA not in {x["entidad"] for x in r.json()["items"]}
    assert ids["categoria"] in {x["id"] for x in r.json()["items"]}
    assert INVENTADA not in client.get("/api/bitacora", headers=m.h["admin"]).text


@pytest.mark.parametrize("quien", USUARIOS)
def test_exigir_ver_entidad_responde_404_para_una_entidad_desconocida(client, quien):
    m = construir(client, "familia")
    with SesionTest() as db:
        with pytest.raises(HTTPException) as e:
            vis.exigir_ver_entidad(db, _ctx(db, m, quien), INVENTADA, 1)
        assert e.value.status_code == 404


@pytest.mark.parametrize("entidad", CONOCIDAS_SIN_VISIBILIDAD)
def test_exigir_ver_entidad_no_bloquea_las_entidades_sin_visibilidad(client, entidad):
    m = construir(client, "solo_yo")
    with SesionTest() as db:
        vis.exigir_ver_entidad(db, _ctx(db, m, "otro"), entidad, 1)  # no lanza


def test_las_entidades_con_visibilidad_siguen_igual(client):
    """Un gasto 'solo yo' sigue oculto para el admin y visible para el dueno, en historial y en la cadena."""
    m = construir(client, "solo_yo")
    with SesionTest() as db:
        for quien, esperado in (("dueno", True), ("admin", False), ("otro", False)):
            ctx = _ctx(db, m, quien)
            hay = db.scalar(
                select(Historial.id).where(
                    vis.condicion_historial(ctx), Historial.entidad == "movimiento", Historial.entidad_id == m.mov
                ).limit(1)
            )
            assert (hay is not None) is esperado
    assert client.get(f"/api/historial?entidad=movimiento&entidad_id={m.mov}", headers=m.h["admin"]).status_code == 404
    assert client.get(f"/api/historial?entidad=movimiento&entidad_id={m.mov}", headers=m.h["dueno"]).status_code == 200
