"""Cuentas - ENMASCARADO del nombre de una cuenta que el lector no ve, en las 4 salidas (API, historial, bitacora y CSV),
y permisos de traspaso sobre AMBAS cuentas."""
from sqlalchemy import select

from app.modulos.cuentas.models import Cuenta
from app.modulos.historial.models import Historial
from tests.conftest import SesionTest
from tests.util_cuentas import OTRA, cuenta, mov, mundo, saldo, traspaso

SECRETO = "ZZ-NombreSecreto"
PUBLICO = "ZZ-NombrePublico"


def _escenario(client):
    """El dueno traspasa de una cuenta PRIVADA (A) a una de la FAMILIA (B). Admin y 'otro' solo ven B."""
    m = mundo(client)
    d = m.h["dueno"]
    a = cuenta(client, d, nombre=SECRETO, visibilidad="solo_yo", saldo_inicial="100")["id"]
    b = cuenta(client, d, nombre=PUBLICO, visibilidad="familia", saldo_inicial="10")["id"]
    t = traspaso(client, d, a, b, "40", nota="mover")
    return m, a, b, t["id"]


def test_la_api_de_cuentas_enmascara_la_cuenta_que_no_ves(client):
    m, a, b, t = _escenario(client)
    for quien in ("admin", "otro", "elegido"):
        h = m.h[quien]
        ficha = client.get(f"/api/cuentas/movimientos/{t}", headers=h).json()
        assert ficha["cuenta_nombre"] == OTRA and ficha["cuenta_id"] is None  # ni siquiera el id
        assert ficha["cuenta_destino_nombre"] == PUBLICO and ficha["cuenta_destino_id"] == b
        assert ficha["puede_registrar"] is False
        for ruta in (f"/api/cuentas/{b}/movimientos", "/api/cuentas/movimientos", f"/api/cuentas/movimientos/{t}", "/api/cuentas"):
            r = client.get(ruta, headers=h)
            assert SECRETO not in r.text, (quien, ruta)
        # el efecto sobre la cuenta que si ves
        en_b = client.get(f"/api/cuentas/{b}/movimientos", headers=h).json()
        assert [x["efecto"] for x in en_b] == ["40.00"]
    # el dueno ve los dos nombres reales
    mio = client.get(f"/api/cuentas/movimientos/{t}", headers=m.h["dueno"]).json()
    assert (mio["cuenta_nombre"], mio["cuenta_destino_nombre"]) == (SECRETO, PUBLICO)
    # y la ruta de la cuenta oculta sigue siendo 404
    assert client.get(f"/api/cuentas/{a}/movimientos", headers=m.h["otro"]).status_code == 404


def test_el_historial_guarda_ids_no_nombres_y_resuelve_el_nombre_al_leer(client):
    m, a, b, t = _escenario(client)
    with SesionTest() as db:
        fila = db.scalars(select(Historial).where(Historial.entidad == "cuenta_mov", Historial.entidad_id == t)).one()
        assert fila.cambios["cuenta_id"]["despues"] == a and fila.cambios["cuenta_destino_id"]["despues"] == b
        assert SECRETO not in str(fila.cambios) and PUBLICO not in str(fila.cambios)  # en la base, solo ids
    cadena = lambda quien: client.get(f"/api/historial?entidad=cuenta_mov&entidad_id={t}", headers=m.h[quien])  # noqa: E731
    for quien in ("admin", "otro"):
        r = cadena(quien)
        assert r.status_code == 200 and SECRETO not in r.text
        it = r.json()["items"][0]
        assert it["cambios"]["cuenta"]["despues"] == OTRA and it["cambios"]["cuenta_destino"]["despues"] == PUBLICO
        assert "cuenta_id" not in it["cambios"] and "cuenta_destino_id" not in it["cambios"]
        assert SECRETO not in it["etiqueta"] and PUBLICO in it["etiqueta"] and OTRA in it["etiqueta"]
    it = cadena("dueno").json()["items"][0]
    assert it["cambios"]["cuenta"]["despues"] == SECRETO and it["cambios"]["cuenta_destino"]["despues"] == PUBLICO
    # actividad global del admin
    g = client.get("/api/historial?entidad=cuentas", headers=m.h["admin"])
    assert SECRETO not in g.text and PUBLICO in g.text


def test_la_bitacora_y_el_csv_enmascaran_igual(client):
    m, a, b, t = _escenario(client)
    ad = m.h["admin"]
    lista = client.get("/api/bitacora?origen=datos&entidad=cuentas", headers=ad)
    assert lista.status_code == 200 and SECRETO not in lista.text and PUBLICO in lista.text
    textos = " ".join(x["titulo"] + " ".join(x["detalle"]) for x in lista.json()["items"])
    assert OTRA in textos
    csv = client.get("/api/bitacora/exportar.csv?entidad=cuentas", headers=ad).text
    assert SECRETO not in csv and PUBLICO in csv and OTRA in csv
    # sin filtro de grupo (todo mezclado) tampoco
    assert SECRETO not in client.get("/api/bitacora", headers=ad).text
    assert SECRETO not in client.get("/api/bitacora/exportar.csv", headers=ad).text
    # el dueno-admin del caso inverso: si el admin fuera el dueno, veria el nombre real
    with SesionTest() as db:
        db.execute(Cuenta.__table__.update().where(Cuenta.id == a).values(usuario_id=m.uid["admin"]))
        db.commit()
    assert SECRETO in client.get("/api/bitacora/exportar.csv?entidad=cuentas", headers=ad).text


def test_ni_los_ultimos_4_digitos_ni_los_saldos_llegan_a_las_etiquetas_ni_al_historial(client):
    m = mundo(client)
    a = cuenta(client, m.h["dueno"], tipo="ahorro", banco="Banco Unión", ultimos4="4821", saldo_inicial="777.77")["id"]
    mov(client, m.h["dueno"], a, "depositos", monto="12.34")
    mov(client, m.h["dueno"], a, "ajustes", saldo_declarado="1000", nota="conteo")
    client.patch(f"/api/cuentas/{a}", headers=m.h["dueno"], json={"ultimos4": "9999", "nombre": "Renombrada"})
    for ruta in (f"/api/historial?entidad=cuentas", "/api/bitacora?origen=datos&entidad=cuentas"):
        for quien in ("admin",):
            txt = client.get(ruta, headers=m.h[quien]).text
            assert "4821" not in txt and "9999" not in txt, ruta
    etiquetas = [x["etiqueta"] for x in client.get("/api/historial?entidad=cuentas", headers=m.h["admin"]).json()["items"]]
    assert etiquetas and not any(s in e for e in etiquetas for s in ("777.77", "1000", "4821"))
    cadena = client.get(f"/api/historial?entidad=cuenta&entidad_id={a}", headers=m.h["dueno"]).json()["items"]
    assert not any(s in x["etiqueta"] for x in cadena for s in ("777.77", "1000", "4821"))
    # el dueno si ve los ultimos 4 en su ficha
    assert client.get(f"/api/cuentas/{a}", headers=m.h["dueno"]).json()["ultimos4"] == "9999"


# ------------------------------------------------------------------ permisos de traspaso sobre AMBAS cuentas
def test_traspaso_exige_ser_dueno_o_encargado_de_las_dos_cuentas(client):
    m = mundo(client)
    d, o = m.h["dueno"], m.h["otro"]
    a = cuenta(client, d, nombre="A", visibilidad="familia", saldo_inicial="100")["id"]
    b = cuenta(client, o, nombre="B", visibilidad="familia", saldo_inicial="0")["id"]
    for quien in ("dueno", "otro", "admin", "elegido"):  # solo duenos/encargados de AMBAS: nadie todavia
        traspaso(client, m.h[quien], a, b, "10", expect=403)
        traspaso(client, m.h[quien], b, a, "10", expect=403)
    assert saldo(client, d, a) == "100.00" and saldo(client, o, b) == "0.00"
    # 'otro' pasa a ser encargado de A: ahora si puede mover en las dos direcciones
    client.patch(f"/api/cuentas/{a}", headers=d, json={"encargado_id": m.uid["otro"]})
    t = traspaso(client, o, a, b, "30")
    assert t["puede_registrar"] is True and saldo(client, d, a) == "70.00" and saldo(client, o, b) == "30.00"
    traspaso(client, o, b, a, "5")
    # ... pero el dueno de A todavia no es encargado de B: 403
    traspaso(client, d, a, b, "1", expect=403)


def test_anular_y_reactivar_un_traspaso_exigen_permiso_sobre_ambas_cuentas(client):
    m = mundo(client)
    d, o = m.h["dueno"], m.h["otro"]
    a = cuenta(client, d, nombre="A", saldo_inicial="100")["id"]
    b = cuenta(client, d, nombre="B", saldo_inicial="0", encargado_id=m.uid["otro"])["id"]
    t = traspaso(client, d, a, b, "25")["id"]
    # 'otro' es encargado de B pero no de A: ve el traspaso y NO puede anularlo
    assert client.get(f"/api/cuentas/movimientos/{t}", headers=o).json()["puede_registrar"] is False
    assert client.post(f"/api/cuentas/movimientos/{t}/anular", headers=o, json={}).status_code == 403
    assert client.post(f"/api/cuentas/movimientos/{t}/anular", headers=m.h["admin"], json={}).status_code == 403
    assert (saldo(client, d, a), saldo(client, d, b)) == ("75.00", "25.00")
    # el dueno de las dos si; se mueve el MISMO monto de vuelta
    r = client.post(f"/api/cuentas/movimientos/{t}/anular", headers=d, json={"motivo": "error"})
    assert r.status_code == 200 and r.json()["anulado"] is True
    assert (saldo(client, d, a), saldo(client, d, b)) == ("100.00", "0.00")
    assert client.post(f"/api/cuentas/movimientos/{t}/reactivar", headers=o, json={}).status_code == 403
    assert client.post(f"/api/cuentas/movimientos/{t}/reactivar", headers=d, json={}).status_code == 200
    assert (saldo(client, d, a), saldo(client, d, b)) == ("75.00", "25.00")


def test_quien_solo_ve_el_destino_no_puede_anular_y_la_respuesta_no_revela_el_origen(client):
    m, a, b, t = _escenario(client)
    r = client.post(f"/api/cuentas/movimientos/{t}/anular", headers=m.h["otro"], json={})
    assert r.status_code == 403 and SECRETO not in r.text
    assert saldo(client, m.h["dueno"], a) == "60.00"  # nada cambio


def test_el_403_no_deja_el_nombre_ni_el_id_de_cuentas_privadas_en_la_bitacora(client):
    m, a, b, t = _escenario(client)
    client.post(f"/api/cuentas/movimientos/{t}/anular", headers=m.h["otro"], json={})  # 403 -> 'acceso_denegado'
    txt = client.get("/api/bitacora", headers=m.h["admin"]).text
    assert "acceso_denegado" in txt and f"/api/cuentas/movimientos/{t}" not in txt and SECRETO not in txt
