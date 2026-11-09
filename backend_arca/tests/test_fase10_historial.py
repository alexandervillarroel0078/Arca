"""Fase 10: historial de solo agregar, escrito en la misma transaccion que cada cambio."""
import json
import uuid
from datetime import date, timedelta

import pytest
from sqlalchemy import select, text
from sqlalchemy.exc import DBAPIError

from app.main import app
from app.modulos.historial import service as historial_service
from app.modulos.historial.models import Historial
from tests.conftest import SesionTest, engine_test, registrar

HOY = date.today().isoformat()


# ---------------------------------------------------------------- ayudas
def filas() -> list[dict]:
    """Todas las filas de historial directo de la base de pruebas, en orden de insercion."""
    with SesionTest() as db:
        return [
            dict(entidad=h.entidad, entidad_id=h.entidad_id, accion=h.accion, usuario_id=h.usuario_id,
                 cambios=h.cambios, motivo=h.motivo, familia_id=h.familia_id)
            for h in db.scalars(select(Historial).order_by(Historial.id))
        ]


def de(entidad, entidad_id=None):
    return [f for f in filas() if f["entidad"] == entidad and (entidad_id is None or f["entidad_id"] == entidad_id)]


def acciones(entidad, entidad_id):
    return [f["accion"] for f in de(entidad, entidad_id)]


def cadena(client, h, entidad, entidad_id):
    r = client.get(f"/api/historial?entidad={entidad}&entidad_id={entidad_id}", headers=h)
    assert r.status_code == 200, r.text
    return r.json()["items"]


def gasto(client, h, cat, monto=100, **extra):
    r = client.post("/api/movimientos", headers=h, json={"tipo": "gasto", "monto": monto, "categoria_id": cat, **extra})
    assert r.status_code == 201, r.text
    return r.json()


def apoyo(client, h, monto=500, quien="Tia Rosa", **extra):
    r = client.post("/api/apoyos", headers=h, json={"beneficiario": quien, "monto": monto, **extra})
    assert r.status_code == 201, r.text
    return r.json()


def dev(client, h, apoyo_id, monto, **extra):
    r = client.post(f"/api/apoyos/{apoyo_id}/devoluciones", headers=h, json={"monto": monto, **extra})
    assert r.status_code in (200, 201), r.text
    return r.json()


def post(client, h, ruta, cuerpo=None):
    return client.post(ruta, headers=h, json=cuerpo if cuerpo is not None else {})


def yo_id(client, h):
    return client.get("/api/auth/yo", headers=h).json()["id"]


# ---------------------------------------------------------------- cada operacion deja su entrada
def test_registro_deja_usuario_miembro_y_categorias(client):
    registrar(client, email="ana@t.com", nombre="Ana")
    f = filas()
    assert [(x["entidad"], x["accion"]) for x in f[:2]] == [("usuario", "crear"), ("miembro", "crear")]
    assert f[0]["cambios"]["nombre"] == {"antes": None, "despues": "Ana"}
    assert f[0]["cambios"]["email"] == {"antes": None, "despues": "ana@t.com"}
    assert f[1]["cambios"]["rol"]["despues"] == "admin"
    cats = [x for x in f if x["entidad"] == "categoria"]
    assert len(cats) == 6 and all(c["accion"] == "crear" and c["motivo"] == "Categoría inicial" for c in cats)
    assert {c["usuario_id"] for c in f} == {f[0]["usuario_id"]}  # los hizo el propio usuario


def test_movimiento_cadena_completa(client, admin, categoria_id):
    otra = client.get("/api/categorias", headers=admin).json()[1]
    m = gasto(client, admin, categoria_id, 100, nota="almuerzo")
    mid = m["id"]
    client.patch(f"/api/movimientos/{mid}", headers=admin, json={"monto": 150.5, "categoria_id": otra["id"], "nota": "cena"})
    post(client, admin, f"/api/movimientos/{mid}/anular", {"motivo": "duplicado"})
    post(client, admin, f"/api/movimientos/{mid}/reactivar")

    items = cadena(client, admin, "movimiento", mid)
    assert [i["accion"] for i in items] == ["crear", "editar", "anular", "reactivar"]  # cronologico
    assert all(i["usuario_nombre"] == "Admin" and i["fecha"] for i in items)
    crear, editar, anular, reactivar = items
    assert crear["cambios"]["monto"] == {"antes": None, "despues": "100.00"}
    assert crear["cambios"]["categoria"]["despues"] == "Transporte"
    assert editar["cambios"] == {
        "monto": {"antes": "100.00", "despues": "150.50"},
        "categoria": {"antes": "Transporte", "despues": otra["nombre"]},
        "nota": {"antes": "almuerzo", "despues": "cena"},
    }
    assert anular["motivo"] == "duplicado" and anular["cambios"] == {"anulado": {"antes": False, "despues": True}}
    assert reactivar["cambios"] == {"anulado": {"antes": True, "despues": False}}
    assert crear["etiqueta"].startswith("Gasto: cena")


def test_editar_tipo_y_fecha_quedan_en_el_historial(client, admin, categoria_id):
    m = gasto(client, admin, categoria_id, 20)
    client.patch(f"/api/movimientos/{m['id']}", headers=admin, json={"tipo": "ingreso", "fecha": "2025-01-02"})
    e = cadena(client, admin, "movimiento", m["id"])[-1]
    assert e["cambios"]["tipo"] == {"antes": "gasto", "despues": "ingreso"}
    assert e["cambios"]["categoria"] == {"antes": "Transporte", "despues": None}
    assert e["cambios"]["fecha"]["despues"] == "2025-01-02"


def test_apoyo_cadena_completa(client, admin):
    a = apoyo(client, admin, 500, nota="inicial")
    aid = a["id"]
    client.patch(f"/api/apoyos/{aid}", headers=admin, json={"monto": 600, "beneficiario": "Rosa M."})
    post(client, admin, f"/api/apoyos/{aid}/consumir")
    post(client, admin, f"/api/apoyos/{aid}/reabrir")
    post(client, admin, f"/api/apoyos/{aid}/anular", {"motivo": "error"})
    post(client, admin, f"/api/apoyos/{aid}/reactivar")

    items = cadena(client, admin, "apoyo", aid)
    assert [i["accion"] for i in items] == ["crear", "editar", "consumir", "reabrir", "anular", "reactivar"]
    assert items[1]["cambios"] == {
        "beneficiario": {"antes": "Tia Rosa", "despues": "Rosa M."},
        "monto": {"antes": "500.00", "despues": "600.00"},
    }
    assert items[2]["cambios"]["monto_consumido"] == {"antes": "0.00", "despues": "600.00"}
    assert items[3]["cambios"]["monto_consumido"] == {"antes": "600.00", "despues": "0.00"}
    assert items[4]["motivo"] == "error"


def test_devolucion_cadena_completa(client, admin):
    a = apoyo(client, admin, 500)
    d_id = dev(client, admin, a["id"], 100)["devoluciones"][0]["id"]
    base = f"/api/apoyos/{a['id']}/devoluciones/{d_id}"
    client.patch(base, headers=admin, json={"monto": 120, "nota": "parcial"})
    post(client, admin, f"{base}/anular", {"motivo": "mal monto"})
    post(client, admin, f"{base}/reactivar")
    items = cadena(client, admin, "devolucion", d_id)
    assert [i["accion"] for i in items] == ["crear", "editar", "anular", "reactivar"]
    assert items[1]["cambios"]["monto"] == {"antes": "100.00", "despues": "120.00"}
    assert items[2]["motivo"] == "mal monto"
    assert items[0]["etiqueta"].startswith("Devolución de Tia Rosa")


def test_cascada_deja_una_entrada_por_devolucion_afectada(client, admin):
    a = apoyo(client, admin, 500)
    aid = a["id"]
    d1 = dev(client, admin, aid, 100)["devoluciones"][0]["id"]
    d2 = dev(client, admin, aid, 150)["devoluciones"][1]["id"]
    d3 = dev(client, admin, aid, 50)["devoluciones"][2]["id"]
    post(client, admin, f"/api/apoyos/{aid}/devoluciones/{d3}/anular", {"motivo": "aparte"})
    antes = len(filas())

    post(client, admin, f"/api/apoyos/{aid}/anular", {"motivo": "error"})
    nuevas = filas()[antes:]
    assert sorted((n["entidad"], n["entidad_id"], n["accion"]) for n in nuevas) == sorted(
        [("apoyo", aid, "anular"), ("devolucion", d1, "anular"), ("devolucion", d2, "anular")]
    )  # d3 ya estaba anulada: no se toca ni se registra
    assert all(n["motivo"] == "Anulada junto con el apoyo" for n in nuevas if n["entidad"] == "devolucion")
    assert [n["motivo"] for n in nuevas if n["entidad"] == "apoyo"] == ["error"]

    antes = len(filas())
    post(client, admin, f"/api/apoyos/{aid}/reactivar")
    nuevas = filas()[antes:]
    assert sorted((n["entidad"], n["entidad_id"], n["accion"]) for n in nuevas) == sorted(
        [("apoyo", aid, "reactivar"), ("devolucion", d1, "reactivar"), ("devolucion", d2, "reactivar")]
    )  # d3 NO vuelve y por eso no aparece
    assert acciones("devolucion", d3) == ["crear", "anular"]
    assert acciones("devolucion", d1) == ["crear", "anular", "reactivar"]


def test_categorias_historial(client, admin):
    r = client.post("/api/categorias", headers=admin, json={"nombre": "Ropa", "icono": "shirt"})
    cid = r.json()["id"]
    client.patch(f"/api/categorias/{cid}", headers=admin, json={"nombre": "Vestimenta", "icono": "gift"})
    client.patch(f"/api/categorias/{cid}", headers=admin, json={"activa": False})
    client.patch(f"/api/categorias/{cid}", headers=admin, json={"activa": True})
    client.patch(f"/api/categorias/{cid}", headers=admin, json={"activa": False, "nombre": "Ropa 2"})
    items = cadena(client, admin, "categoria", cid)
    assert [i["accion"] for i in items] == ["crear", "editar", "desactivar", "reactivar", "desactivar"]
    assert items[1]["cambios"] == {
        "nombre": {"antes": "Ropa", "despues": "Vestimenta"}, "icono": {"antes": "shirt", "despues": "gift"},
    }
    assert items[2]["cambios"] == {"activa": {"antes": True, "despues": False}}
    assert set(items[4]["cambios"]) == {"activa", "nombre"}  # un solo PATCH con dos cambios: una entrada
    n = len(filas())
    client.patch(f"/api/categorias/{cid}", headers=admin, json={"nombre": "Ropa 2"})  # sin cambios reales
    assert len(filas()) == n


def test_miembros_historial(client, admin):
    r = client.post("/api/familia/invitar", headers=admin, json={"nombre": "Hijo", "email": "h@t.com", "password": "secreto1"})
    uid = r.json()["usuario_id"]
    client.patch(f"/api/familia/miembros/{uid}", headers=admin, json={"rol": "admin"})
    client.patch(f"/api/familia/miembros/{uid}", headers=admin, json={"activo": False})
    client.patch(f"/api/familia/miembros/{uid}", headers=admin, json={"activo": True})
    client.patch(f"/api/familia/miembros/{uid}", headers=admin, json={"rol": "miembro", "activo": False})  # dos acciones
    n = len(filas())
    client.patch(f"/api/familia/miembros/{uid}", headers=admin, json={"activo": False})  # ya estaba: nada que registrar
    assert len(filas()) == n
    tmp = client.post(f"/api/familia/miembros/{uid}/restablecer-clave", headers=admin).json()["clave_temporal"]

    assert [(x["entidad"], x["accion"]) for x in de("usuario", uid)] == [("usuario", "crear")]
    assert acciones("miembro", uid) == [
        "crear", "cambiar_rol", "desactivar", "reactivar", "cambiar_rol", "desactivar", "restablecer_clave",
    ]
    miembro = de("miembro", uid)
    assert miembro[1]["cambios"] == {"rol": {"antes": "miembro", "despues": "admin"}}
    assert miembro[2]["cambios"] == {"activo": {"antes": True, "despues": False}}
    assert miembro[-1]["cambios"] == {"clave": "clave cambiada"}
    assert tmp not in json.dumps(filas())  # la temporal no queda en ningun lado
    # el rechazo por "ultimo admin" no deja entrada
    admin_id = yo_id(client, admin)
    n = len(filas())
    assert client.patch(f"/api/familia/miembros/{admin_id}", headers=admin, json={"activo": False}).status_code == 400
    assert len(filas()) == n


def test_perfil_historial(client, admin):
    client.patch("/api/auth/yo", headers=admin, json={"nombre": "Nuevo Nombre"})
    client.post("/api/auth/cambiar-clave", headers=admin, json={"clave_actual": "secreto1", "clave_nueva": "otraclave1"})
    uid = yo_id(client, admin)
    items = cadena(client, admin, "usuario", uid)
    assert [i["accion"] for i in items] == ["crear", "editar", "cambiar_clave"]
    assert items[1]["cambios"] == {"nombre": {"antes": "Admin", "despues": "Nuevo Nombre"}}
    assert items[2]["cambios"] == {"clave": "clave cambiada"}
    # clave actual incorrecta: no cambia nada y no deja entrada
    n = len(filas())
    r = client.post("/api/auth/cambiar-clave", headers=admin, json={"clave_actual": "mala", "clave_nueva": "otraclave2"})
    assert r.status_code == 400 and len(filas()) == n


# ---------------------------------------------------------------- nunca claves, hashes ni tokens
def test_el_historial_nunca_guarda_secretos(client):
    r = client.post(
        "/api/auth/registro",
        json={"nombre": "Ana", "email": "ana@t.com", "password": "ClaveSecretaUno1", "nombre_familia": "F"},
    )
    token = r.json()["access_token"]
    h = {"Authorization": f"Bearer {token}"}
    inv = client.post("/api/familia/invitar", headers=h, json={"nombre": "Hijo", "email": "h@t.com", "password": "ClaveTempHijo9"})
    uid = inv.json()["usuario_id"]
    client.post("/api/auth/cambiar-clave", headers=h, json={"clave_actual": "ClaveSecretaUno1", "clave_nueva": "ClaveNuevaDos22"})
    temporal = client.post(f"/api/familia/miembros/{uid}/restablecer-clave", headers=h).json()["clave_temporal"]
    login = client.post("/api/auth/login", json={"email": "ana@t.com", "password": "ClaveNuevaDos22"}).json()

    with SesionTest() as db:
        hashes = [row[0] for row in db.execute(text("select password_hash from usuarios"))]
    volcado = json.dumps(filas()) + json.dumps(client.get("/api/historial", headers=h).json())
    secretos = ["ClaveSecretaUno1", "ClaveTempHijo9", "ClaveNuevaDos22", temporal, token, login["access_token"], "$2b$", *hashes]
    for s in secretos:
        assert s not in volcado, f"el historial contiene un secreto: {s[:12]}..."
    for fila in filas():
        assert not ({"password", "password_hash", "token", "access_token", "clave_actual", "clave_nueva"} & set(fila["cambios"]))


def test_registrar_rechaza_campos_de_clave(client, admin):
    with SesionTest() as db:
        for campo in ("password", "password_hash", "token", "clave_nueva"):
            with pytest.raises(ValueError):
                historial_service.registrar(db, 1, 1, "usuario", 1, "editar", {campo: {"antes": "a", "despues": "b"}})
        # el texto fijo "clave cambiada" si se admite
        historial_service.registrar(db, 1, 1, "usuario", 1, "cambiar_clave", {"clave": "clave cambiada"})
        db.rollback()


# ---------------------------------------------------------------- idempotencia y rechazos
def test_reenvio_con_el_mismo_uuid_no_duplica_historial(client, admin, categoria_id):
    u = str(uuid.uuid4())
    c = {"tipo": "gasto", "monto": 20, "categoria_id": categoria_id, "uuid_cliente": u}
    mid = client.post("/api/movimientos", headers=admin, json=c).json()["id"]
    n = len(filas())
    assert client.post("/api/movimientos", headers=admin, json=c).status_code == 200
    assert len(filas()) == n and acciones("movimiento", mid) == ["crear"]
    post(client, admin, f"/api/movimientos/{mid}/anular")
    n = len(filas())
    assert client.post("/api/movimientos", headers=admin, json=c).json()["anulado"] is True
    assert len(filas()) == n  # el reenvio de un anulado no reactiva ni deja entrada
    ua = str(uuid.uuid4())
    aid = client.post("/api/apoyos", headers=admin, json={"beneficiario": "L", "monto": 9, "uuid_cliente": ua}).json()["id"]
    ud = str(uuid.uuid4())
    dev(client, admin, aid, 5, uuid_cliente=ud)
    n = len(filas())
    client.post("/api/apoyos", headers=admin, json={"beneficiario": "L", "monto": 9, "uuid_cliente": ua})
    dev(client, admin, aid, 5, uuid_cliente=ud)
    assert len(filas()) == n


def test_operaciones_rechazadas_no_dejan_entrada(client, admin, miembro, categoria_id):
    m = gasto(client, admin, categoria_id)
    a = apoyo(client, admin, 100)
    n = len(filas())
    assert post(client, miembro, f"/api/movimientos/{m['id']}/anular").status_code == 403
    assert client.patch(f"/api/movimientos/{m['id']}", headers=miembro, json={"monto": 1}).status_code == 403
    assert post(client, miembro, f"/api/apoyos/{a['id']}/consumir").status_code == 403
    assert dev(client, admin, a["id"], 1)
    n += 1
    assert client.post(f"/api/apoyos/{a['id']}/devoluciones", headers=admin, json={"monto": 9999}).status_code == 400
    assert client.patch(f"/api/movimientos/{m['id']}", headers=admin, json={"monto": -5}).status_code == 422
    assert client.post("/api/categorias", headers=miembro, json={"nombre": "X"}).status_code == 403
    assert client.post("/api/movimientos", headers=admin, json={"tipo": "gasto", "monto": 5}).status_code == 422
    assert len(filas()) == n


# ---------------------------------------------------------------- misma transaccion
class _Falla(RuntimeError):
    pass


def _fallar(*a, **k):
    raise _Falla("falla simulada del historial")


def test_si_falla_el_historial_fallan_las_dos_cosas(client, admin, categoria_id, monkeypatch):
    m = gasto(client, admin, categoria_id, 100, nota="orig")
    a = apoyo(client, admin, 500)
    d_id = dev(client, admin, a["id"], 100)["devoluciones"][0]["id"]
    cat_id = categoria_id
    n_hist = len(filas())

    monkeypatch.setattr(historial_service, "registrar", _fallar)
    intentos = [
        lambda: client.post("/api/movimientos", headers=admin, json={"tipo": "gasto", "monto": 5, "categoria_id": cat_id}),
        lambda: client.patch(f"/api/movimientos/{m['id']}", headers=admin, json={"monto": 999}),
        lambda: post(client, admin, f"/api/movimientos/{m['id']}/anular"),
        lambda: client.post("/api/apoyos", headers=admin, json={"beneficiario": "Nuevo", "monto": 5}),
        lambda: post(client, admin, f"/api/apoyos/{a['id']}/anular"),  # cascada incluida
        lambda: post(client, admin, f"/api/apoyos/{a['id']}/consumir"),
        lambda: dev(client, admin, a["id"], 10),
        lambda: client.patch(f"/api/apoyos/{a['id']}/devoluciones/{d_id}", headers=admin, json={"monto": 50}),
        lambda: post(client, admin, f"/api/apoyos/{a['id']}/devoluciones/{d_id}/anular"),
        lambda: client.patch(f"/api/categorias/{cat_id}", headers=admin, json={"nombre": "Cambiada"}),
        lambda: client.post("/api/categorias", headers=admin, json={"nombre": "Nueva cat"}),
        lambda: client.post("/api/familia/invitar", headers=admin, json={"nombre": "X", "email": "x@t.com", "password": "secreto1"}),
        lambda: client.patch("/api/auth/yo", headers=admin, json={"nombre": "Otro"}),
        lambda: client.post("/api/auth/cambiar-clave", headers=admin, json={"clave_actual": "secreto1", "clave_nueva": "otraclave1"}),
        lambda: client.post("/api/auth/registro", json={"nombre": "Z", "email": "z@t.com", "password": "secreto1"}),
    ]
    for intento in intentos:
        with pytest.raises(_Falla):
            intento()
    monkeypatch.undo()

    # nada cambio: ni los datos ni el historial
    assert len(filas()) == n_hist
    lista = client.get("/api/movimientos?ver_anulados=true", headers=admin).json()
    assert len(lista) == 1 and lista[0]["monto"] == 100 and lista[0]["anulado"] is False
    ap = client.get("/api/apoyos?ver_anulados=true", headers=admin).json()
    assert len(ap) == 1 and ap[0]["anulado"] is False and ap[0]["consumido"] == 0
    assert ap[0]["devoluciones"][0]["anulado"] is False and ap[0]["devoluciones"][0]["monto"] == 100
    assert len(ap[0]["devoluciones"]) == 1
    assert client.get("/api/categorias", headers=admin).json()[0]["nombre"] == "Transporte"
    assert len(client.get("/api/categorias", headers=admin).json()) == 6
    assert len(client.get("/api/familia/miembros", headers=admin).json()) == 1
    assert client.get("/api/auth/yo", headers=admin).json()["nombre"] == "Admin"
    assert client.post("/api/auth/login", json={"email": "admin@t.com", "password": "secreto1"}).status_code == 200
    assert client.post("/api/auth/login", json={"email": "z@t.com", "password": "secreto1"}).status_code == 401


def test_si_el_insert_del_historial_falla_en_la_base_tambien_se_revierte_el_cambio(client, admin, categoria_id, monkeypatch):
    """Falla real de la base (entidad demasiado larga), no simulada con una excepcion de Python."""
    m = gasto(client, admin, categoria_id, 100)
    original = historial_service.registrar

    def rota(db, familia_id, usuario_id, entidad, *resto, **kw):
        return original(db, familia_id, usuario_id, "x" * 50, *resto, **kw)

    monkeypatch.setattr(historial_service, "registrar", rota)
    with pytest.raises(DBAPIError):
        client.patch(f"/api/movimientos/{m['id']}", headers=admin, json={"monto": 777})
    monkeypatch.undo()
    assert client.get("/api/movimientos", headers=admin).json()[0]["monto"] == 100


# ---------------------------------------------------------------- solo agregar
def test_no_hay_rutas_que_editen_o_borren_historial(client, admin):
    rutas = [r for r in app.routes if getattr(r, "path", "").startswith("/api/historial")]
    assert rutas
    for r in rutas:
        assert getattr(r, "methods", set()) <= {"GET", "HEAD"}, (r.path, r.methods)
    for metodo in (client.post, client.put, client.patch, client.delete):
        assert metodo("/api/historial", headers=admin).status_code == 405
    assert client.delete("/api/historial/1", headers=admin).status_code in (404, 405)
    assert client.patch("/api/historial/1", headers=admin, json={}).status_code in (404, 405)


def test_la_base_impide_editar_y_borrar_el_historial(client, admin, categoria_id):
    gasto(client, admin, categoria_id)
    n = len(filas())
    assert n > 0
    for sql in ("UPDATE historial SET motivo = 'trampa'", "UPDATE historial SET cambios = '{}'::jsonb",
                "DELETE FROM historial", "DELETE FROM historial WHERE id = 1"):
        with engine_test.begin() as c:
            with pytest.raises(DBAPIError, match="solo agregar"):
                c.execute(text(sql))
    assert len(filas()) == n and all(f["motivo"] != "trampa" for f in filas())


def test_los_registros_no_se_modifican_al_seguir_operando(client, admin, categoria_id):
    m = gasto(client, admin, categoria_id, 10)
    primeras = filas()
    client.patch(f"/api/movimientos/{m['id']}", headers=admin, json={"monto": 11})
    post(client, admin, f"/api/movimientos/{m['id']}/anular")
    assert filas()[: len(primeras)] == primeras  # lo anterior queda intacto, solo se agregan filas


# ---------------------------------------------------------------- permisos y aislamiento
def test_cadena_visible_para_la_familia_pero_aislada_de_otras(client, admin, miembro, categoria_id):
    m = gasto(client, admin, categoria_id, 10)
    mid = m["id"]
    client.patch(f"/api/movimientos/{m['id']}", headers=admin, json={"monto": 12})
    # el miembro (otra persona de la misma familia) ve la cadena de un registro del admin
    assert [i["accion"] for i in cadena(client, miembro, "movimiento", mid)] == ["crear", "editar"]
    # otra familia no ve nada, ni siquiera con el mismo id: 404, como si no existiera (Fase 17)
    otro = registrar(client, email="otro@t.com", familia="Otra")
    assert client.get(f"/api/historial?entidad=movimiento&entidad_id={mid}", headers=otro).status_code == 404


def test_actividad_global_solo_admin(client, admin, miembro, categoria_id):
    gasto(client, admin, categoria_id, 10)
    gasto(client, miembro, categoria_id, 20)
    assert client.get("/api/historial", headers=miembro).status_code == 403
    assert client.get("/api/historial?entidad=movimiento", headers=miembro).status_code == 403  # sin id = global
    assert client.get("/api/historial?accion=crear", headers=miembro).status_code == 403
    assert client.get("/api/historial").status_code == 401
    r = client.get("/api/historial?limite=100", headers=admin)
    assert r.status_code == 200 and r.json()["total"] == len(filas())


def test_actividad_global_aislada_por_familia(client, admin, categoria_id):
    gasto(client, admin, categoria_id, 10)
    otro = registrar(client, email="otro@t.com", familia="Otra")
    mia = client.get("/api/historial?limite=100", headers=admin).json()
    suya = client.get("/api/historial?limite=100", headers=otro).json()
    fam_a = {f["familia_id"] for f in filas() if f["usuario_id"] == yo_id(client, admin)}
    assert len(fam_a) == 1
    assert mia["total"] + suya["total"] == len(filas())
    ids_mios = {i["id"] for i in mia["items"]}
    ids_suyos = {i["id"] for i in suya["items"]}
    assert not (ids_mios & ids_suyos)
    assert all(i["usuario_nombre"] == "Admin" for i in suya["items"])


def test_entidad_id_sin_entidad_es_un_error(client, admin):
    assert client.get("/api/historial?entidad_id=1", headers=admin).status_code == 422
    assert client.get("/api/historial?entidad=cualquiera", headers=admin).status_code == 422


def test_filtros_orden_y_paginacion_de_la_actividad_global(client, admin, miembro, categoria_id):
    g1 = gasto(client, admin, categoria_id, 10)
    gasto(client, miembro, categoria_id, 20)
    a = apoyo(client, admin, 100)
    post(client, admin, f"/api/movimientos/{g1['id']}/anular")
    dev(client, admin, a["id"], 10)
    uid_m = yo_id(client, miembro)

    def pedir(q):
        r = client.get(f"/api/historial?{q}", headers=admin)
        assert r.status_code == 200, r.text
        return r.json()

    todo = pedir("limite=100")
    ids = [i["id"] for i in todo["items"]]
    assert ids == sorted(ids, reverse=True)  # la global va de lo mas nuevo a lo mas viejo
    assert all(i["etiqueta"] for i in todo["items"])
    assert {i["entidad"] for i in pedir("entidad=apoyo&limite=100")["items"]} == {"apoyo"}
    assert pedir("entidad=devolucion")["total"] == 1
    assert pedir("accion=anular")["total"] == 1
    assert {i["accion"] for i in pedir("accion=crear&limite=100")["items"]} == {"crear"}
    assert {i["usuario_id"] for i in pedir(f"usuario={uid_m}&limite=100")["items"]} == {uid_m}
    assert pedir(f"desde={HOY}&hasta={HOY}&limite=100")["total"] == todo["total"]
    futuro = (date.today() + timedelta(days=3)).isoformat()
    assert pedir(f"desde={futuro}")["total"] == 0
    ayer = (date.today() - timedelta(days=1)).isoformat()
    assert pedir(f"hasta={ayer}")["total"] == 0

    total = todo["total"]
    p1, p2 = pedir("limite=5&desplazamiento=0"), pedir("limite=5&desplazamiento=5")
    assert len(p1["items"]) == 5 and p1["hay_mas"] is (total > 5)
    assert not ({i["id"] for i in p1["items"]} & {i["id"] for i in p2["items"]})
    ultimo = pedir(f"limite=5&desplazamiento={total - 1}")
    assert len(ultimo["items"]) == 1 and ultimo["hay_mas"] is False
