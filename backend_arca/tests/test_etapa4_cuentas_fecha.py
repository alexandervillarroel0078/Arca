"""Cuentas - corregir SOLO la fecha de un movimiento (PATCH /cuentas/movimientos/{id}) y fechas futuras al crear."""
from datetime import timedelta

from app.modulos.periodos.calculo import hoy_la_paz
from tests.util_cuentas import cuenta, mov, mundo, saldo, traspaso

HOY = hoy_la_paz()
HACE_5 = (HOY - timedelta(days=5)).isoformat()
HACE_9 = (HOY - timedelta(days=9)).isoformat()
MANANA = (HOY + timedelta(days=1)).isoformat()


def _patch(client, h, mov_id, fecha, version_base=None):
    cuerpo = {"fecha": fecha}
    if version_base is not None:
        cuerpo["version_base"] = version_base
    return client.patch(f"/api/cuentas/movimientos/{mov_id}", headers=h, json=cuerpo)


def _historial(client, h, mov_id):
    r = client.get(f"/api/historial?entidad=cuenta_mov&entidad_id={mov_id}", headers=h)
    assert r.status_code == 200, r.text
    return r.json()["items"]


# ------------------------------------------------------------------ permisos
def test_el_dueno_cambia_la_fecha(client):
    m = mundo(client)
    d = m.h["dueno"]
    a = cuenta(client, d, saldo_inicial="100")["id"]
    dep = mov(client, d, a, "depositos", monto="20", fecha=HACE_5)
    r = _patch(client, d, dep["id"], HACE_9, dep["version"])
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["fecha"] == HACE_9
    assert out["version"] == dep["version"] + 1
    assert out["editado_por_nombre"] and out["editado_en"]
    # el resto del movimiento no cambia
    assert (out["tipo"], out["monto"], out["anulado"]) == ("deposito", "20.00", False)


def test_el_encargado_cambia_la_fecha(client):
    m = mundo(client)
    a = cuenta(client, m.h["dueno"], visibilidad="solo_yo", encargado_id=m.uid["otro"])["id"]
    dep = mov(client, m.h["dueno"], a, "depositos", monto="5", fecha=HACE_5)
    r = _patch(client, m.h["otro"], dep["id"], HACE_9, dep["version"])
    assert r.status_code == 200, r.text
    assert r.json()["fecha"] == HACE_9


def test_otro_usuario_que_no_ve_la_cuenta_recibe_404(client):
    m = mundo(client)
    a = cuenta(client, m.h["dueno"], visibilidad="solo_yo")["id"]
    dep = mov(client, m.h["dueno"], a, "depositos", monto="5", fecha=HACE_5)
    for quien in ("otro", "admin", "elegido", "ajeno"):
        r = _patch(client, m.h[quien], dep["id"], HACE_9)
        assert r.status_code == 404, (quien, r.text)
    # nada cambio
    assert client.get(f"/api/cuentas/movimientos/{dep['id']}", headers=m.h["dueno"]).json()["fecha"] == HACE_5


def test_quien_ve_la_cuenta_pero_no_registra_recibe_403(client):
    m = mundo(client)
    a = cuenta(client, m.h["dueno"], visibilidad="familia")["id"]
    dep = mov(client, m.h["dueno"], a, "depositos", monto="5", fecha=HACE_5)
    r = _patch(client, m.h["otro"], dep["id"], HACE_9)
    assert r.status_code == 403, r.text


def test_traspaso_exige_permiso_en_ambas_cuentas(client):
    m = mundo(client)
    d, o = m.h["dueno"], m.h["otro"]
    origen = cuenta(client, d, saldo_inicial="50", encargado_id=m.uid["otro"])["id"]
    destino = cuenta(client, d)["id"]  # de familia: "otro" la ve, pero no es su encargado
    t = traspaso(client, d, origen, destino, "10", fecha=HACE_5)
    assert _patch(client, o, t["id"], HACE_9).status_code == 403
    assert _patch(client, d, t["id"], HACE_9).status_code == 200


# ------------------------------------------------------------------ version, ajustes, anulados, fechas futuras
def test_409_si_la_version_no_coincide(client):
    m = mundo(client)
    d = m.h["dueno"]
    a = cuenta(client, d)["id"]
    dep = mov(client, d, a, "depositos", monto="5", fecha=HACE_5)
    assert _patch(client, d, dep["id"], HACE_9, dep["version"]).status_code == 200
    r = _patch(client, d, dep["id"], HACE_5, dep["version"])  # version vieja
    assert r.status_code == 409, r.text
    cuerpo = r.json()["detail"]
    assert cuerpo["codigo"] == "conflicto_version"
    assert cuerpo["actual"]["fecha"] == HACE_9


def test_no_se_cambia_la_fecha_de_un_ajuste(client):
    m = mundo(client)
    d = m.h["dueno"]
    a = cuenta(client, d, saldo_inicial="100")["id"]
    aj = mov(client, d, a, "ajustes", saldo_declarado="90", fecha=HACE_5)
    r = _patch(client, d, aj["id"], HACE_9, aj["version"])
    assert r.status_code == 422, r.text
    assert "ajuste por conteo" in r.json()["detail"]
    assert client.get(f"/api/cuentas/movimientos/{aj['id']}", headers=d).json()["fecha"] == HACE_5


def test_no_se_cambia_la_fecha_de_un_movimiento_anulado(client):
    m = mundo(client)
    d = m.h["dueno"]
    a = cuenta(client, d)["id"]
    dep = mov(client, d, a, "depositos", monto="5", fecha=HACE_5)
    assert client.post(f"/api/cuentas/movimientos/{dep['id']}/anular", headers=d, json={}).status_code == 200
    r = _patch(client, d, dep["id"], HACE_9)
    assert r.status_code == 400 and "anulado" in r.text


def test_rechaza_fecha_futura_al_corregir(client):
    m = mundo(client)
    d = m.h["dueno"]
    a = cuenta(client, d)["id"]
    dep = mov(client, d, a, "depositos", monto="5", fecha=HACE_5)
    r = _patch(client, d, dep["id"], MANANA, dep["version"])
    assert r.status_code == 422 and "posterior a hoy" in r.text
    # hoy si se puede
    assert _patch(client, d, dep["id"], HOY.isoformat(), dep["version"]).status_code == 200


def test_rechaza_fecha_futura_al_crear_cualquier_movimiento(client):
    m = mundo(client)
    d = m.h["dueno"]
    a = cuenta(client, d, saldo_inicial="100")["id"]
    b = cuenta(client, d)["id"]
    for que, cuerpo in (("depositos", {"monto": "5"}), ("retiros", {"monto": "5"}), ("ajustes", {"saldo_declarado": "1"})):
        r = client.post(f"/api/cuentas/{a}/{que}", headers=d, json={**cuerpo, "fecha": MANANA})
        assert r.status_code == 422 and "posterior a hoy" in r.text, (que, r.text)
    traspaso(client, d, a, b, "5", expect=422, fecha=MANANA)
    assert saldo(client, d, a) == "100.00"  # no se guardo nada
    assert client.get(f"/api/cuentas/{a}/movimientos", headers=d).json() == []
    # sin fecha sigue siendo hoy
    assert mov(client, d, a, "depositos", monto="1")["fecha"] == HOY.isoformat()


# ------------------------------------------------------------------ historial y saldo
def test_historial_registra_antes_y_despues_y_el_saldo_no_cambia(client):
    m = mundo(client)
    d = m.h["dueno"]
    a = cuenta(client, d, saldo_inicial="100")["id"]
    b = cuenta(client, d)["id"]
    dep = mov(client, d, a, "depositos", monto="20", fecha=HACE_5)
    ret = mov(client, d, a, "retiros", monto="7.50", fecha=HACE_5)
    t = traspaso(client, d, a, b, "10", fecha=HACE_5)
    antes_a, antes_b = saldo(client, d, a), saldo(client, d, b)
    for x in (dep, ret, t):
        assert _patch(client, d, x["id"], HACE_9, x["version"]).status_code == 200
    assert (saldo(client, d, a), saldo(client, d, b)) == (antes_a, antes_b) == ("102.50", "10.00")

    entradas = _historial(client, d, dep["id"])
    editar = [e for e in entradas if e["accion"] == "editar"]
    assert len(editar) == 1
    assert editar[0]["cambios"] == {"fecha": {"antes": HACE_5, "despues": HACE_9}}
    assert editar[0]["usuario_nombre"]
    # la misma fecha otra vez: no hay cambio real, no se agrega nada ni sube la version
    actual = client.get(f"/api/cuentas/movimientos/{dep['id']}", headers=d).json()
    r = _patch(client, d, dep["id"], HACE_9, actual["version"])
    assert r.status_code == 200 and r.json()["version"] == actual["version"]
    assert len(_historial(client, d, dep["id"])) == len(entradas)


def test_el_cambio_de_fecha_mueve_el_movimiento_de_mes_en_la_lista(client):
    m = mundo(client)
    d = m.h["dueno"]
    a = cuenta(client, d)["id"]
    dep = mov(client, d, a, "depositos", monto="5", fecha=HACE_5)
    _patch(client, d, dep["id"], HACE_9, dep["version"])
    solo_hace_5 = client.get(f"/api/cuentas/{a}/movimientos?desde={HACE_5}&hasta={HACE_5}", headers=d).json()
    solo_hace_9 = client.get(f"/api/cuentas/{a}/movimientos?desde={HACE_9}&hasta={HACE_9}", headers=d).json()
    assert solo_hace_5 == [] and [x["id"] for x in solo_hace_9] == [dep["id"]]
