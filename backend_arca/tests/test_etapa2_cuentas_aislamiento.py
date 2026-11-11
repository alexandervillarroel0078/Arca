"""Cuentas - AISLAMIENTO entre familias y entre usuarios de la misma familia (la prioridad de la etapa 2)."""
import pytest

from tests.test_fase17_matriz import USUARIOS
from tests.util_cuentas import cuenta, mov, mundo, saldo, traspaso

NO_VEN = ("admin", "otro", "elegido", "ajeno")


def _ids(r):
    return {x["id"] for x in r.json()}


def _rutas_con_ids(a, d, b):
    """Todas las rutas de /api/cuentas que reciben un id, con un cuerpo valido: (metodo, ruta, cuerpo)."""
    return [
        ("GET", f"/api/cuentas/{a}", None),
        ("PATCH", f"/api/cuentas/{a}", {"nombre": "x"}),
        ("POST", f"/api/cuentas/{a}/anular", {}),
        ("POST", f"/api/cuentas/{a}/reactivar", {}),
        ("PATCH", f"/api/cuentas/{a}/visibilidad", {"visibilidad": "familia"}),
        ("GET", f"/api/cuentas/{a}/movimientos", None),
        ("POST", f"/api/cuentas/{a}/depositos", {"monto": "1"}),
        ("POST", f"/api/cuentas/{a}/retiros", {"monto": "1"}),
        ("POST", f"/api/cuentas/{a}/ajustes", {"saldo_declarado": "1"}),
        ("GET", f"/api/cuentas/movimientos/{d}", None),
        ("POST", f"/api/cuentas/movimientos/{d}/anular", {}),
        ("POST", f"/api/cuentas/movimientos/{d}/reactivar", {}),
        ("POST", "/api/cuentas/traspasos", {"cuenta_id": a, "cuenta_destino_id": b, "monto": "1"}),
    ]


# ------------------------------------------------------------------ cuenta "solo yo": 404 en todo
def test_cuenta_solo_yo_da_404_a_admin_otro_elegido_y_otra_familia_en_todas_las_rutas(client):
    m = mundo(client)
    d = m.h["dueno"]
    a = cuenta(client, d, nombre="SECRETA", visibilidad="solo_yo", saldo_inicial="500")["id"]
    dep = mov(client, d, a, "depositos", monto="25")["id"]
    for quien in NO_VEN:
        propia = cuenta(client, m.h[quien], nombre=f"de-{quien}")["id"]  # una cuenta del lector, para el traspaso
        for metodo, ruta, cuerpo in _rutas_con_ids(a, dep, propia):
            r = client.request(metodo, ruta, headers=m.h[quien], json=cuerpo)
            assert r.status_code == 404, (quien, metodo, ruta, r.status_code, r.text)
            # el cuerpo es el de una cuenta/movimiento inexistente: no hay forma de saber que existe
            inexistente = ruta.replace(f"/{a}", "/999999").replace(f"/movimientos/{dep}", "/movimientos/999999")
            cuerpo2 = dict(cuerpo or {}, **({"cuenta_id": 999999} if "traspasos" in ruta else {}))
            r2 = client.request(metodo, inexistente, headers=m.h[quien], json=cuerpo2 if cuerpo is not None else None)
            assert r2.status_code == 404 and r2.json() == r.json(), (quien, ruta, r.text, r2.text)
        # listas: ni la cuenta, ni su movimiento, ni su nombre
        lista = client.get("/api/cuentas?ver_anuladas=true", headers=m.h[quien])
        assert a not in _ids_cuentas(lista) and "SECRETA" not in lista.text
        movs = client.get("/api/cuentas/movimientos?ver_anulados=true", headers=m.h[quien])
        assert dep not in _ids(movs) and "SECRETA" not in movs.text
    # el dueno si
    assert client.get(f"/api/cuentas/{a}", headers=d).status_code == 200


def _ids_cuentas(r):
    return {c["id"] for c in r.json()["cuentas"]}


def test_el_historial_de_una_cuenta_solo_yo_no_lo_ve_nadie_mas(client):
    m = mundo(client)
    a = cuenta(client, m.h["dueno"], visibilidad="solo_yo")["id"]
    dep = mov(client, m.h["dueno"], a, "depositos", monto="5")["id"]
    for quien in NO_VEN:
        for ent, i in (("cuenta", a), ("cuenta_mov", dep)):
            r = client.get(f"/api/historial?entidad={ent}&entidad_id={i}", headers=m.h[quien])
            assert r.status_code == 404, (quien, ent, r.text)
    for ent, i in (("cuenta", a), ("cuenta_mov", dep)):
        assert client.get(f"/api/historial?entidad={ent}&entidad_id={i}", headers=m.h["dueno"]).status_code == 200
    # actividad global (solo admin) y bitacora: tampoco aparece, ni siquiera para el admin
    g = client.get("/api/historial?entidad=cuentas", headers=m.h["admin"])
    assert g.status_code == 200 and g.json()["items"] == []
    b = client.get("/api/bitacora?origen=datos&entidad=cuentas", headers=m.h["admin"])
    assert b.status_code == 200 and b.json()["items"] == []
    assert client.get("/api/bitacora/exportar.csv?entidad=cuentas", headers=m.h["admin"]).text.count("\n") <= 2
    g2 = client.get("/api/historial", headers=m.h["admin"])  # sin filtro: tampoco
    assert not {x["entidad"] for x in g2.json()["items"]} & {"cuenta", "cuenta_mov"}


# ------------------------------------------------------------------ entre familias
def test_otra_familia_no_ve_nada_ni_siquiera_con_visibilidad_familia(client):
    m = mundo(client)
    a = cuenta(client, m.h["dueno"], nombre="DeLaFamilia", visibilidad="familia")["id"]
    dep = mov(client, m.h["dueno"], a, "depositos", monto="7")["id"]
    ajena = cuenta(client, m.h["ajeno"], nombre="DeLaOtra")["id"]
    for ruta in (f"/api/cuentas/{a}", f"/api/cuentas/{a}/movimientos", f"/api/cuentas/movimientos/{dep}"):
        assert client.get(ruta, headers=m.h["ajeno"]).status_code == 404
    assert a not in _ids_cuentas(client.get("/api/cuentas", headers=m.h["ajeno"]))
    assert dep not in _ids(client.get("/api/cuentas/movimientos", headers=m.h["ajeno"]))
    assert "DeLaFamilia" not in client.get("/api/cuentas", headers=m.h["ajeno"]).text
    # y al reves
    assert ajena not in _ids_cuentas(client.get("/api/cuentas", headers=m.h["admin"]))
    assert client.get(f"/api/cuentas/{ajena}", headers=m.h["admin"]).status_code == 404
    # el admin de OTRA familia no ve el historial, ni la bitacora, ni el CSV
    otra = client.get("/api/historial?entidad=cuentas", headers=m.h["ajeno"]).json()["items"]
    assert {x["entidad_id"] for x in otra if x["entidad"] == "cuenta"} == {ajena}
    csv = client.get("/api/bitacora/exportar.csv?entidad=cuentas", headers=m.h["ajeno"]).text
    assert "DeLaFamilia" not in csv and "DeLaOtra" in csv
    # traspaso entre cuentas de familias distintas: 404
    traspaso(client, m.h["ajeno"], ajena, a, "1", expect=404)
    traspaso(client, m.h["dueno"], a, ajena, "1", expect=404)


# ------------------------------------------------------------------ personas elegidas
def test_personas_elegidas_ven_pero_no_registran(client):
    m = mundo(client)
    a = cuenta(client, m.h["dueno"], visibilidad="elegidas", compartido_con=[m.uid["elegido"]], saldo_inicial="10")["id"]
    dep = mov(client, m.h["dueno"], a, "depositos", monto="5")["id"]
    e = m.h["elegido"]
    assert client.get(f"/api/cuentas/{a}", headers=e).status_code == 200
    assert client.get(f"/api/cuentas/{a}/movimientos", headers=e).status_code == 200
    assert client.get(f"/api/cuentas/movimientos/{dep}", headers=e).status_code == 200
    assert client.get(f"/api/historial?entidad=cuenta&entidad_id={a}", headers=e).status_code == 200
    ficha = client.get(f"/api/cuentas/{a}", headers=e).json()
    assert ficha["puede_registrar"] is False and ficha["compartido_con"] == []  # la lista solo la ve el dueno
    for que, cuerpo in (("depositos", {"monto": "1"}), ("retiros", {"monto": "1"}), ("ajustes", {"saldo_declarado": "1"})):
        assert client.post(f"/api/cuentas/{a}/{que}", headers=e, json=cuerpo).status_code == 403
    assert client.post(f"/api/cuentas/movimientos/{dep}/anular", headers=e, json={}).status_code == 403
    assert client.patch(f"/api/cuentas/{a}", headers=e, json={"nombre": "x"}).status_code == 403
    assert client.post(f"/api/cuentas/{a}/anular", headers=e, json={}).status_code == 403
    # los demas, nada
    for quien in ("admin", "otro", "ajeno"):
        assert client.get(f"/api/cuentas/{a}", headers=m.h[quien]).status_code == 404
    assert saldo(client, m.h["dueno"], a) == "15.00"


# ------------------------------------------------------------------ encargado
def test_encargado_ve_y_registra_un_tercero_y_el_admin_no(client):
    m = mundo(client)
    a = cuenta(client, m.h["dueno"], visibilidad="solo_yo", encargado_id=m.uid["otro"], saldo_inicial="100")["id"]
    o = m.h["otro"]
    # el encargado SIEMPRE la ve, aunque sea "solo yo"
    ficha = client.get(f"/api/cuentas/{a}", headers=o).json()
    assert ficha["puede_registrar"] is True and ficha["encargado_id"] == m.uid["otro"]
    assert a in _ids_cuentas(client.get("/api/cuentas", headers=o))
    mov(client, o, a, "depositos", monto="20")
    mov(client, o, a, "retiros", monto="5")
    mov(client, o, a, "ajustes", saldo_declarado="120")
    assert client.get(f"/api/historial?entidad=cuenta&entidad_id={a}", headers=o).status_code == 200
    # pero no edita la cuenta, ni cambia su visibilidad ni a su encargado
    assert client.patch(f"/api/cuentas/{a}", headers=o, json={"nombre": "x"}).status_code == 403
    assert client.patch(f"/api/cuentas/{a}/visibilidad", headers=o, json={"visibilidad": "familia"}).status_code == 403
    assert client.patch(f"/api/cuentas/{a}", headers=o, json={"encargado_id": None}).status_code == 403
    # un tercero y el admin: 404 (la cuenta es privada)
    for quien in ("elegido", "admin", "ajeno"):
        assert client.get(f"/api/cuentas/{a}", headers=m.h[quien]).status_code == 404
        assert client.post(f"/api/cuentas/{a}/depositos", headers=m.h[quien], json={"monto": "1"}).status_code == 404
    # quitar al encargado: deja de verla
    assert client.patch(f"/api/cuentas/{a}", headers=m.h["dueno"], json={"encargado_id": None}).status_code == 200
    assert client.get(f"/api/cuentas/{a}", headers=o).status_code == 404


def test_el_admin_no_registra_en_una_cuenta_de_la_familia_aunque_la_vea(client):
    m = mundo(client)
    a = cuenta(client, m.h["dueno"], visibilidad="familia")["id"]
    ad = m.h["admin"]
    assert client.get(f"/api/cuentas/{a}", headers=ad).status_code == 200
    for que, cuerpo in (("depositos", {"monto": "1"}), ("retiros", {"monto": "1"}), ("ajustes", {"saldo_declarado": "9"})):
        assert client.post(f"/api/cuentas/{a}/{que}", headers=ad, json=cuerpo).status_code == 403
    assert client.patch(f"/api/cuentas/{a}", headers=ad, json={"nombre": "x"}).status_code == 403
    assert client.post(f"/api/cuentas/{a}/anular", headers=ad, json={}).status_code == 403
    assert client.patch(f"/api/cuentas/{a}/visibilidad", headers=ad, json={"visibilidad": "solo_yo"}).status_code == 403
    d = mov(client, m.h["dueno"], a, "depositos", monto="3")["id"]
    assert client.post(f"/api/cuentas/movimientos/{d}/anular", headers=ad, json={}).status_code == 403


def test_el_encargado_debe_ser_otro_miembro_activo_de_la_familia(client):
    m = mundo(client)
    d = m.h["dueno"]
    cuenta(client, d, expect=422, encargado_id=m.uid["ajeno"])  # de otra familia
    cuenta(client, d, expect=422, encargado_id=m.uid["dueno"])  # el propio dueno
    cuenta(client, d, expect=422, encargado_id=999999)
    a = cuenta(client, d)["id"]
    assert client.patch(f"/api/cuentas/{a}", headers=d, json={"encargado_id": m.uid["ajeno"]}).status_code == 422


# ------------------------------------------------------------------ cambio de visibilidad
def test_pasar_una_cuenta_a_solo_yo_la_oculta_con_todo_su_historial(client):
    m = mundo(client)
    a = cuenta(client, m.h["dueno"], visibilidad="familia")["id"]
    dep = mov(client, m.h["dueno"], a, "depositos", monto="9")["id"]
    for quien in ("admin", "otro", "elegido"):
        assert client.get(f"/api/cuentas/{a}", headers=m.h[quien]).status_code == 200
        assert client.get(f"/api/cuentas/movimientos/{dep}", headers=m.h[quien]).status_code == 200
    r = client.patch(f"/api/cuentas/{a}/visibilidad", headers=m.h["dueno"], json={"visibilidad": "solo_yo"})
    assert r.status_code == 200 and r.json()["version"] == 2
    for quien in ("admin", "otro", "elegido"):
        assert client.get(f"/api/cuentas/{a}", headers=m.h[quien]).status_code == 404
        assert client.get(f"/api/cuentas/movimientos/{dep}", headers=m.h[quien]).status_code == 404
        assert client.get(f"/api/historial?entidad=cuenta_mov&entidad_id={dep}", headers=m.h[quien]).status_code == 404
    assert client.get("/api/historial?entidad=cuentas", headers=m.h["admin"]).json()["items"] == []
    # la entrada 'cambiar_visibilidad' solo la ve el dueno
    cadena = client.get(f"/api/historial?entidad=cuenta&entidad_id={a}", headers=m.h["dueno"]).json()["items"]
    assert "cambiar_visibilidad" in {x["accion"] for x in cadena}
    # solo el dueno la cambia, y de vuelta a la familia reaparece
    assert client.patch(f"/api/cuentas/{a}/visibilidad", headers=m.h["otro"], json={"visibilidad": "familia"}).status_code == 404
    client.patch(f"/api/cuentas/{a}/visibilidad", headers=m.h["dueno"], json={"visibilidad": "familia"})
    assert client.get(f"/api/cuentas/{a}", headers=m.h["otro"]).status_code == 200
    cadena_otro = client.get(f"/api/historial?entidad=cuenta&entidad_id={a}", headers=m.h["otro"]).json()["items"]
    assert "cambiar_visibilidad" not in {x["accion"] for x in cadena_otro}


def test_los_movimientos_heredan_la_visibilidad_de_su_cuenta(client):
    m = mundo(client)
    a = cuenta(client, m.h["dueno"], visibilidad="elegidas", compartido_con=[m.uid["elegido"]])["id"]
    dep = mov(client, m.h["dueno"], a, "depositos", monto="1")["id"]
    assert dep in _ids(client.get("/api/cuentas/movimientos", headers=m.h["elegido"]))
    assert dep not in _ids(client.get("/api/cuentas/movimientos", headers=m.h["otro"]))
    client.patch(
        f"/api/cuentas/{a}/visibilidad", headers=m.h["dueno"], json={"visibilidad": "elegidas", "compartido_con": [m.uid["otro"]]}
    )
    assert dep not in _ids(client.get("/api/cuentas/movimientos", headers=m.h["elegido"]))
    assert dep in _ids(client.get("/api/cuentas/movimientos", headers=m.h["otro"]))


# ------------------------------------------------------------------ totales
def test_los_totales_solo_suman_cuentas_visibles(client):
    m = mundo(client)
    cuenta(client, m.h["dueno"], nombre="Privada", visibilidad="solo_yo", saldo_inicial="1000")
    cuenta(client, m.h["dueno"], nombre="Publica", visibilidad="familia", saldo_inicial="50")
    cuenta(client, m.h["dueno"], nombre="PrivUSD", visibilidad="solo_yo", saldo_inicial="7", moneda="USD")
    cuenta(client, m.h["ajeno"], nombre="OtraFamilia", saldo_inicial="99999")
    esperado = {
        "dueno": {"BS": "1050.00", "USD": "7.00"}, "admin": {"BS": "50.00"}, "otro": {"BS": "50.00"},
        "elegido": {"BS": "50.00"}, "ajeno": {"BS": "99999.00"},
    }
    for quien in USUARIOS:
        r = client.get("/api/cuentas", headers=m.h[quien]).json()
        assert {t["moneda"]: t["total"] for t in r["totales"]} == esperado[quien], quien
    assert client.get("/api/cuentas", headers=m.h["dueno"]).json()["privadas_propias"] == 2
    assert client.get("/api/cuentas", headers=m.h["admin"]).json()["privadas_propias"] == 0


def test_toda_ruta_de_cuentas_esta_cubierta_por_las_pruebas_de_aislamiento(client):
    """Si agregas un endpoint a /api/cuentas, hay que agregarlo a la matriz Y a `_rutas_con_ids` o a las listas."""
    from fastapi.routing import APIRoute
    from app.main import app
    from tests.test_fase17_matriz import CUENTAS_RUTAS

    reales = {(mt, r.path) for r in app.routes if isinstance(r, APIRoute) and r.path.startswith("/api/cuentas")
              for mt in r.methods - {"HEAD", "OPTIONS"}}
    assert reales == CUENTAS_RUTAS
    probadas = {(mt, ruta.replace("/1", "/{x}")) for mt, ruta, _ in _rutas_con_ids(1, 1, 1)}
    con_id = {(mt, p) for mt, p in reales if "{" in p or p.endswith("/traspasos")}
    assert len(probadas) == len(con_id)  # cada ruta con id tiene su caso en la prueba de 404
