"""Cuentas - montos y monedas, saldos, traspasos, ajustes (con concurrencia), anulaciones y reglas de datos."""
import threading
import time
from datetime import date

import pytest
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError

from app.modulos.cuentas.models import Cuenta, CuentaMovimiento
from app.modulos.historial.models import Historial
from tests.conftest import SesionTest
from tests.util_cuentas import cuenta, mov, mundo, saldo, traspaso


# ------------------------------------------------------------------ decimales por moneda
def test_bs_rechaza_3_decimales_y_acepta_2(client):
    m = mundo(client)
    d = m.h["dueno"]
    a = cuenta(client, d, moneda="BS")["id"]
    r = client.post(f"/api/cuentas/{a}/depositos", headers=d, json={"monto": "10.005"})
    assert r.status_code == 422 and "2 decimales" in r.text
    assert saldo(client, d, a) == "0.00"  # no se redondeo ni se guardo nada
    assert mov(client, d, a, "depositos", monto="10.05")["monto"] == "10.05"
    assert mov(client, d, a, "depositos", monto="10.050")["monto"] == "10.05"  # ceros finales no son decimales
    cuenta(client, d, expect=422, saldo_inicial="1.234")
    # USD igual que BS
    u = cuenta(client, d, moneda="USD")["id"]
    assert client.post(f"/api/cuentas/{u}/retiros", headers=d, json={"monto": "0.001"}).status_code == 422


def test_btc_acepta_8_decimales_rechaza_9_y_ida_y_vuelta_sin_perdida(client):
    m = mundo(client)
    d = m.h["dueno"]
    c = cuenta(client, d, tipo="cripto", moneda="BTC", banco="Binance", saldo_inicial="0.00000001")
    assert c["saldo_inicial"] == "0.00000001"
    a = c["id"]
    r = client.post(f"/api/cuentas/{a}/depositos", headers=d, json={"monto": "0.123456789"})
    assert r.status_code == 422 and "8 decimales" in r.text
    dep = mov(client, d, a, "depositos", monto="0.00012345")
    assert dep["monto"] == "0.00012345" and isinstance(dep["monto"], str)  # texto, no float
    # sumas exactas: 0.1 + 0.2 no da 0.30000000000000004
    mov(client, d, a, "depositos", monto="0.1")
    mov(client, d, a, "depositos", monto="0.2")
    assert saldo(client, d, a) == "0.30012346"  # 0.00000001 + 0.00012345 + 0.1 + 0.2
    assert client.get(f"/api/cuentas/movimientos/{dep['id']}", headers=d).json()["monto"] == "0.00012345"
    # entrada como numero JSON tambien llega exacta
    r = client.post(f"/api/cuentas/{a}/depositos", headers=d, json={"monto": 0.00000007})
    assert r.status_code == 201 and r.json()["monto"] == "0.00000007"
    # con USDT tambien 8
    t = cuenta(client, d, tipo="cripto", moneda="USDT", banco="Bybit")["id"]
    assert mov(client, d, t, "depositos", monto="1234567.12345678")["monto"] == "1234567.12345678"


def test_montos_invalidos(client):
    m = mundo(client)
    d = m.h["dueno"]
    a = cuenta(client, d)["id"]
    for monto in ("0", "-5", "abc", "1e400", "NaN", "Infinity", "99999999999999999"):
        r = client.post(f"/api/cuentas/{a}/depositos", headers=d, json={"monto": monto})
        assert r.status_code == 422, (monto, r.status_code)
    cuenta(client, d, expect=422, saldo_inicial="-1")  # saldo inicial no negativo


# ------------------------------------------------------------------ matriz tipo/moneda y datos bancarios
def test_matriz_tipo_moneda_y_datos_de_la_cuenta(client):
    m = mundo(client)
    d = m.h["dueno"]
    cuenta(client, d, expect=422, tipo="cripto", moneda="BS", banco="Binance")
    cuenta(client, d, expect=422, tipo="cripto", moneda="USD", banco="Binance")
    cuenta(client, d, expect=422, tipo="ahorro", moneda="BTC", banco="Banco Unión")
    cuenta(client, d, expect=422, tipo="efectivo", moneda="USDT")
    cuenta(client, d, expect=422, tipo="ahorro", moneda="BS")  # falta el banco
    cuenta(client, d, expect=422, tipo="ahorro", moneda="BS", banco="Banco Inventado")
    cuenta(client, d, expect=422, tipo="efectivo", moneda="BS", banco="Banco Unión")  # efectivo sin banco
    cuenta(client, d, expect=422, tipo="efectivo", moneda="BS", ultimos4="1234")  # ni ultimos 4
    cuenta(client, d, expect=422, tipo="ahorro", moneda="BS", banco="Banco Unión", ultimos4="12345")  # solo 4 digitos
    cuenta(client, d, expect=422, tipo="ahorro", moneda="BS", banco="Banco Unión", ultimos4="12a4")
    cuenta(client, d, expect=422, tipo="ahorro", moneda="BS", banco="Otro")  # «Otro» pide el nombre
    cuenta(client, d, expect=422, tipo="ahorro", moneda="BS", banco="Banco Unión", banco_otro="X")
    cuenta(client, d, expect=422, tipo="oro", moneda="BS")
    cuenta(client, d, tipo="corriente", moneda="USD", banco="Otro", banco_otro="Banco Pequeño", ultimos4="0042")
    cuenta(client, d, tipo="cripto", moneda="USDT", banco="Trust Wallet", ultimos4="5678")
    cuenta(client, d, tipo="efectivo", moneda="USD")


def test_la_base_tambien_hace_cumplir_la_matriz_y_los_ultimos_4(client):
    m = mundo(client)
    with SesionTest() as db:
        for valores in (
            "tipo='cripto', moneda='BS'", "tipo='efectivo', banco='X'", "ultimos4='12ab'",
        ):
            ok = dict(tipo="ahorro", moneda="BS", banco="Banco Unión", ultimos4="1234")
            campos = {**ok, **{k.strip(): v.strip().strip("'") for k, v in (p.split("=") for p in valores.split(","))}}
            with pytest.raises(IntegrityError):
                db.execute(
                    text(
                        "insert into cuentas (familia_id, usuario_id, nombre, tipo, moneda, banco, ultimos4, visibilidad) "
                        "values (1, :u, 'x', :tipo, :moneda, :banco, :ultimos4, 'familia')"
                    ),
                    {"u": m.uid["dueno"], **campos},
                )
            db.rollback()


# ------------------------------------------------------------------ traspasos: misma moneda, mismo monto
def test_traspaso_entre_monedas_distintas_rechazado_por_la_api_y_por_la_base(client):
    m = mundo(client)
    d = m.h["dueno"]
    bs = cuenta(client, d, nombre="Bs", moneda="BS", saldo_inicial="100")["id"]
    usd = cuenta(client, d, nombre="Usd", moneda="USD", saldo_inicial="100")["id"]
    r = client.post("/api/cuentas/traspasos", headers=d, json={"cuenta_id": bs, "cuenta_destino_id": usd, "monto": "10"})
    assert r.status_code == 422 and "misma moneda" in r.text
    assert (saldo(client, d, bs), saldo(client, d, usd)) == ("100.00", "100.00")
    traspaso(client, d, bs, bs, "1", expect=422)  # misma cuenta
    # la base lo rechaza aunque alguien se salte la API (FK compuesta con la moneda)
    with SesionTest() as db:
        for moneda in ("BS", "USD"):
            with pytest.raises(IntegrityError):
                db.execute(
                    text(
                        "insert into cuenta_movimientos (familia_id, usuario_id, cuenta_id, cuenta_destino_id, moneda, tipo, "
                        "monto, fecha) values (1, :u, :o, :d, :mon, 'traspaso', 10, current_date)"
                    ),
                    {"u": m.uid["dueno"], "o": bs, "d": usd, "mon": moneda},
                )
            db.rollback()
        with pytest.raises(IntegrityError):  # traspaso sin destino / deposito con destino
            db.execute(
                text(
                    "insert into cuenta_movimientos (familia_id, usuario_id, cuenta_id, moneda, tipo, monto, fecha) "
                    "values (1, :u, :o, 'BS', 'traspaso', 10, current_date)"
                ),
                {"u": m.uid["dueno"], "o": bs},
            )
        db.rollback()


def test_traspaso_mueve_el_mismo_monto_y_no_cuenta_como_entrada_ni_salida(client):
    m = mundo(client)
    d = m.h["dueno"]
    antes = (client.get("/api/reportes/resumen", headers=d).json(), client.get("/api/actividad", headers=d).json())
    a = cuenta(client, d, nombre="A", saldo_inicial="100.50")["id"]
    b = cuenta(client, d, nombre="B", saldo_inicial="3")["id"]
    t = traspaso(client, d, a, b, "40.25")
    assert t["monto"] == "40.25" and t["tipo"] == "traspaso"
    assert (saldo(client, d, a), saldo(client, d, b)) == ("60.25", "43.25")
    total = {x["moneda"]: x["total"] for x in client.get("/api/cuentas", headers=d).json()["totales"]}
    assert total == {"BS": "103.50"}  # 100.50 + 3: el traspaso no crea ni destruye dinero
    en_a = client.get(f"/api/cuentas/{a}/movimientos", headers=d).json()
    en_b = client.get(f"/api/cuentas/{b}/movimientos", headers=d).json()
    assert [x["efecto"] for x in en_a] == ["-40.25"] and [x["efecto"] for x in en_b] == ["40.25"]
    # el traspaso no es un ingreso ni un gasto: los reportes no se enteran
    despues = (client.get("/api/reportes/resumen", headers=d).json(), client.get("/api/actividad", headers=d).json())
    assert despues == antes  # reportes y actividad idénticos: Cuentas no es ingreso, gasto ni apoyo


def test_traspaso_a_cuenta_cripto_de_la_misma_moneda_con_8_decimales(client):
    m = mundo(client)
    d = m.h["dueno"]
    a = cuenta(client, d, tipo="cripto", moneda="BTC", banco="Binance", saldo_inicial="1")["id"]
    b = cuenta(client, d, tipo="cripto", moneda="BTC", banco="Ledger")["id"]
    traspaso(client, d, a, b, "0.00000001")
    assert (saldo(client, d, a), saldo(client, d, b)) == ("0.99999999", "0.00000001")
    traspaso(client, d, a, b, "0.000000001", expect=422)


# ------------------------------------------------------------------ retiros cripto y comision
def test_comision_de_red_solo_en_retiros_de_cripto_y_se_descuenta_ademas_del_monto(client):
    m = mundo(client)
    d = m.h["dueno"]
    c = cuenta(client, d, tipo="cripto", moneda="USDT", banco="Binance", saldo_inicial="100")["id"]
    r = mov(client, d, c, "retiros", monto="30", comision="1.5")
    assert r["comision"] == "1.50000000" and r["saldo_resultante"] == "68.50000000" and r["deja_saldo_negativo"] is False
    assert saldo(client, d, c) == "68.50000000"
    mov(client, d, c, "retiros", monto="10")  # sin comision
    assert saldo(client, d, c) == "58.50000000"
    assert client.post(f"/api/cuentas/{c}/retiros", headers=d, json={"monto": "1", "comision": "0.000000001"}).status_code == 422
    assert client.post(f"/api/cuentas/{c}/retiros", headers=d, json={"monto": "1", "comision": "-1"}).status_code == 422
    bs = cuenta(client, d, moneda="BS", saldo_inicial="50")["id"]
    assert client.post(f"/api/cuentas/{bs}/retiros", headers=d, json={"monto": "1", "comision": "0.5"}).status_code == 422
    # la comision no existe en depositos (se ignora el campo desconocido): el saldo solo sube el monto
    mov(client, d, bs, "depositos", monto="1", comision="0.5")
    assert saldo(client, d, bs) == "51.00"


def test_saldo_negativo_se_permite_y_se_avisa(client):
    m = mundo(client)
    d = m.h["dueno"]
    a = cuenta(client, d, saldo_inicial="10")["id"]
    r = mov(client, d, a, "retiros", monto="25")
    assert r["saldo_resultante"] == "-15.00" and r["deja_saldo_negativo"] is True
    ficha = client.get(f"/api/cuentas/{a}", headers=d).json()
    assert ficha["saldo"] == "-15.00" and ficha["saldo_negativo"] is True
    tot = client.get("/api/cuentas", headers=d).json()["totales"]
    assert tot[0]["total"] == "-15.00" and tot[0]["hay_negativas"] is True


# ------------------------------------------------------------------ ajuste por conteo
def test_ajuste_registra_la_diferencia_con_saldo_previo_y_declarado(client):
    m = mundo(client)
    d = m.h["dueno"]
    a = cuenta(client, d, saldo_inicial="100")["id"]
    mov(client, d, a, "retiros", monto="30")  # saldo 70
    aj = mov(client, d, a, "ajustes", saldo_declarado="65.50", nota="conté el cajón")
    assert (aj["monto"], aj["sentido"], aj["saldo_previo"], aj["saldo_declarado"]) == ("4.50", "salida", "70.00", "65.50")
    assert saldo(client, d, a) == "65.50"
    aj2 = mov(client, d, a, "ajustes", saldo_declarado="100")
    assert (aj2["monto"], aj2["sentido"]) == ("34.50", "entrada") and saldo(client, d, a) == "100.00"
    mov(client, d, a, "ajustes", saldo_declarado="100", expect=422)  # nada que ajustar
    mov(client, d, a, "ajustes", saldo_declarado="-5")  # un saldo real negativo es posible (deuda): se acepta
    assert saldo(client, d, a) == "-5.00"
    mov(client, d, a, "ajustes", saldo_declarado="1.005", expect=422)
    # queda en el historial, con la nota, para quien ve la cuenta
    it = client.get(f"/api/historial?entidad=cuenta_mov&entidad_id={aj['id']}", headers=m.h["admin"])
    assert it.status_code == 200  # la cuenta es de la familia por defecto
    c = it.json()["items"][0]["cambios"]
    assert c["nota"]["despues"] == "conté el cajón" and c["saldo_previo"]["despues"] == "Bs 70.00"
    # anular un ajuste revierte su efecto
    assert saldo(client, d, a) == "-5.00"
    client.post(f"/api/cuentas/movimientos/{aj2['id']}/anular", headers=d, json={})  # revierte la entrada de 34.50
    assert saldo(client, d, a) == "-39.50"


def test_ajuste_con_concurrencia_espera_al_movimiento_en_curso(client):
    """Otro proceso tiene la cuenta bloqueada y mete un deposito de 40; el ajuste debe esperar y calcular sobre 140."""
    m = mundo(client)
    d = m.h["dueno"]
    a = cuenta(client, d, saldo_inicial="100")["id"]
    bloqueada, resultado = threading.Event(), {}

    def otro_proceso():
        with SesionTest() as s:
            s.execute(select(Cuenta).where(Cuenta.id == a).with_for_update()).scalar_one()
            bloqueada.set()
            time.sleep(1.2)  # el ajuste llega mientras tanto
            s.add(CuentaMovimiento(
                familia_id=1, usuario_id=m.uid["dueno"], cuenta_id=a, moneda="BS", tipo="deposito", monto=40,
                fecha=date.today(),
            ))
            s.commit()

    hilo = threading.Thread(target=otro_proceso)
    hilo.start()
    assert bloqueada.wait(5)
    t0 = time.monotonic()
    r = client.post(f"/api/cuentas/{a}/ajustes", headers=d, json={"saldo_declarado": "150"})
    resultado["espera"] = time.monotonic() - t0
    hilo.join()
    assert r.status_code == 201, r.text
    aj = r.json()
    assert resultado["espera"] >= 0.8  # espero el bloqueo
    assert aj["saldo_previo"] == "140.00" and aj["monto"] == "10.00" and aj["sentido"] == "entrada"  # 140, no 100
    assert saldo(client, d, a) == "150.00"


def test_dos_ajustes_simultaneos_no_se_pisan(client):
    m = mundo(client)
    d = m.h["dueno"]
    a = cuenta(client, d, saldo_inicial="100")["id"]
    resp = []

    def ajustar(valor):
        resp.append(client.post(f"/api/cuentas/{a}/ajustes", headers=d, json={"saldo_declarado": valor}))

    hilos = [threading.Thread(target=ajustar, args=(v,)) for v in ("120", "130")]
    [h.start() for h in hilos]
    [h.join() for h in hilos]
    assert sorted(r.status_code for r in resp) == [201, 201]
    previos = sorted(r.json()["saldo_previo"] for r in resp)
    assert previos[0] == "100.00"  # el segundo vio el resultado del primero, no 100
    assert saldo(client, d, a) in ("120.00", "130.00")


# ------------------------------------------------------------------ saldos y totales: anulados fuera
def test_saldos_y_totales_excluyen_movimientos_anulados(client):
    m = mundo(client)
    d = m.h["dueno"]
    a = cuenta(client, d, saldo_inicial="100")["id"]
    dep = mov(client, d, a, "depositos", monto="50")["id"]
    ret = mov(client, d, a, "retiros", monto="20")["id"]
    assert saldo(client, d, a) == "130.00"
    client.post(f"/api/cuentas/movimientos/{dep}/anular", headers=d, json={"motivo": "duplicado"})
    assert saldo(client, d, a) == "80.00"
    assert client.get("/api/cuentas", headers=d).json()["totales"][0]["total"] == "80.00"
    visibles = [x["id"] for x in client.get(f"/api/cuentas/{a}/movimientos", headers=d).json()]
    assert visibles == [ret]  # los anulados se ocultan por defecto
    todos = client.get(f"/api/cuentas/{a}/movimientos?ver_anulados=true", headers=d).json()
    assert {x["id"] for x in todos} == {dep, ret} and [x for x in todos if x["id"] == dep][0]["anulado"] is True
    client.post(f"/api/cuentas/movimientos/{dep}/reactivar", headers=d, json={})
    assert saldo(client, d, a) == "130.00"
    assert client.post(f"/api/cuentas/movimientos/{dep}/reactivar", headers=d, json={}).status_code == 400
    # y la anulacion deja su entrada en el historial
    acciones = [x["accion"] for x in client.get(f"/api/historial?entidad=cuenta_mov&entidad_id={dep}", headers=d).json()["items"]]
    assert acciones == ["crear", "anular", "reactivar"]


def test_los_totales_excluyen_cuentas_anuladas_pero_la_cuenta_conserva_su_saldo(client):
    m = mundo(client)
    d = m.h["dueno"]
    a = cuenta(client, d, nombre="A", saldo_inicial="100")["id"]
    b = cuenta(client, d, nombre="B", saldo_inicial="40")["id"]
    cuenta(client, d, nombre="U", moneda="USD", saldo_inicial="9")
    assert {t["moneda"]: t["total"] for t in client.get("/api/cuentas", headers=d).json()["totales"]} == {"BS": "140.00", "USD": "9.00"}
    r = client.post(f"/api/cuentas/{b}/anular", headers=d, json={"motivo": "cerrada"})
    assert r.status_code == 200 and r.json()["anulado"] is True and r.json()["saldo"] == "40.00"
    lista = client.get("/api/cuentas", headers=d).json()
    assert [c["id"] for c in lista["cuentas"]] == [a, lista["cuentas"][1]["id"]] and b not in {c["id"] for c in lista["cuentas"]}
    assert {t["moneda"]: t["total"] for t in lista["totales"]} == {"BS": "100.00", "USD": "9.00"}
    con = client.get("/api/cuentas?ver_anuladas=true", headers=d).json()
    assert b in {c["id"] for c in con["cuentas"]}
    assert {t["moneda"]: t["total"] for t in con["totales"]} == {"BS": "100.00", "USD": "9.00"}  # tampoco ahi
    # no se registra en una cuenta anulada hasta reactivarla
    assert client.post(f"/api/cuentas/{b}/depositos", headers=d, json={"monto": "1"}).status_code == 400
    traspaso(client, d, a, b, "1", expect=400)
    assert client.post(f"/api/cuentas/{b}/reactivar", headers=d, json={}).status_code == 200
    mov(client, d, b, "depositos", monto="1")
    assert {t["moneda"]: t["total"] for t in client.get("/api/cuentas", headers=d).json()["totales"]}["BS"] == "141.00"


def test_totales_separados_por_moneda_sin_conversion(client):
    m = mundo(client)
    d = m.h["dueno"]
    cuenta(client, d, moneda="BS", saldo_inicial="10")
    cuenta(client, d, moneda="USD", saldo_inicial="10")
    cuenta(client, d, tipo="cripto", moneda="BTC", banco="Binance", saldo_inicial="0.5")
    cuenta(client, d, tipo="cripto", moneda="USDT", banco="Binance", saldo_inicial="10")
    tot = {t["moneda"]: t for t in client.get("/api/cuentas", headers=d).json()["totales"]}
    assert {k: v["total"] for k, v in tot.items()} == {
        "BS": "10.00", "USD": "10.00", "BTC": "0.50000000", "USDT": "10.00000000"
    }


# ------------------------------------------------------------------ cuenta: edicion, persona, idempotencia, ayuda
def test_no_se_cambia_moneda_tipo_ni_saldo_inicial_con_movimientos(client):
    m = mundo(client)
    d = m.h["dueno"]
    a = cuenta(client, d, saldo_inicial="10")["id"]
    assert client.patch(f"/api/cuentas/{a}", headers=d, json={"moneda": "USD", "saldo_inicial": "20"}).status_code == 200
    mov(client, d, a, "depositos", monto="1")
    for cambio in ({"moneda": "BS"}, {"saldo_inicial": "5"}, {"tipo": "ahorro", "banco": "Banco Unión"}):
        r = client.patch(f"/api/cuentas/{a}", headers=d, json=cambio)
        assert r.status_code == 400 and "ajuste por conteo" in r.text, cambio
    assert client.patch(f"/api/cuentas/{a}", headers=d, json={"nombre": "Nueva"}).json()["nombre"] == "Nueva"
    assert client.patch(f"/api/cuentas/{a}", headers=d, json={"saldo_inicial": "20"}).status_code == 200  # sin cambio real


def test_persona_miembro_otra_persona_o_sin_identificar(client):
    m = mundo(client)
    d = m.h["dueno"]
    a = cuenta(client, d)["id"]
    x = mov(client, d, a, "depositos", monto="1", persona_tipo="miembro", persona_usuario_id=m.uid["otro"])
    assert x["persona_nombre"] == "otro" and x["persona_usuario_id"] == m.uid["otro"]
    y = mov(client, d, a, "depositos", monto="1", persona_tipo="otra", persona_nombre="  Tía Rosa ")
    assert y["persona_nombre"] == "Tía Rosa" and y["persona_usuario_id"] is None  # sin crear usuario
    z = mov(client, d, a, "depositos", monto="1")
    assert z["persona_tipo"] == "sin_identificar" and z["persona_nombre"] is None
    mov(client, d, a, "depositos", monto="1", persona_tipo="miembro", persona_usuario_id=m.uid["ajeno"], expect=422)
    mov(client, d, a, "depositos", monto="1", persona_tipo="miembro", expect=422)
    mov(client, d, a, "depositos", monto="1", persona_tipo="otra", expect=422)
    mov(client, d, a, "depositos", monto="1", persona_tipo="sin_identificar", persona_nombre="X", expect=422)
    with SesionTest() as db:
        assert db.scalars(select(CuentaMovimiento.persona_tipo).order_by(CuentaMovimiento.id)).all() == [
            "miembro", "otra", "sin_identificar"
        ]


def test_idempotencia_por_uuid_cliente(client):
    m = mundo(client)
    d = m.h["dueno"]
    u = "3f2b8c1e-0a4d-4a55-9d6e-1b2c3d4e5f60"
    c1 = client.post("/api/cuentas", headers=d, json={"nombre": "X", "tipo": "efectivo", "moneda": "BS", "uuid_cliente": u})
    c2 = client.post("/api/cuentas", headers=d, json={"nombre": "X", "tipo": "efectivo", "moneda": "BS", "uuid_cliente": u})
    assert (c1.status_code, c2.status_code, c1.json()["id"]) == (201, 200, c2.json()["id"])
    # otro usuario que NO ve la cuenta no puede reclamar ese UUID ni averiguar nada
    oculta = cuenta(client, d, visibilidad="solo_yo", uuid_cliente="aaaaaaaa-0a4d-4a55-9d6e-1b2c3d4e5f60")
    r = client.post("/api/cuentas", headers=m.h["otro"], json={"nombre": "Y", "tipo": "efectivo", "moneda": "BS", "uuid_cliente": "aaaaaaaa-0a4d-4a55-9d6e-1b2c3d4e5f60"})
    assert r.status_code == 409 and "Caja" not in r.text and str(oculta["id"]) not in r.text
    a = c1.json()["id"]
    v = "bbbbbbbb-0a4d-4a55-9d6e-1b2c3d4e5f60"
    m1 = client.post(f"/api/cuentas/{a}/depositos", headers=d, json={"monto": "5", "uuid_cliente": v})
    m2 = client.post(f"/api/cuentas/{a}/depositos", headers=d, json={"monto": "5", "uuid_cliente": v})
    assert (m1.status_code, m2.status_code) == (201, 200) and saldo(client, d, a) == "5.00"


def test_el_campo_de_ayuda_sobre_las_notas_y_el_catalogo(client):
    m = mundo(client)
    cat = client.get("/api/cuentas/catalogo", headers=m.h["dueno"]).json()
    assert "frases semilla" in cat["aviso_nota"]
    assert cat["monedas"] == {"BS": 2, "USD": 2, "USDT": 8, "BTC": 8}
    assert cat["monedas_por_tipo"]["cripto"] == ["USDT", "BTC"] and "BTC" not in cat["monedas_por_tipo"]["ahorro"]
    esquemas = client.get("/openapi.json").json()["components"]["schemas"]
    for nombre in ("DepositoCrear", "RetiroCrear", "AjusteCrear", "TraspasoCrear"):
        nota = esquemas[nombre]["properties"]["nota"]
        assert "frases semilla" in nota["description"] and "frases semilla" in nota["ayuda"], nombre
    assert "últimos 4" in esquemas["CuentaCrear"]["properties"]["ultimos4"]["ayuda"].lower()


def test_nunca_se_guardan_nombres_de_cuenta_en_el_historial(client):
    m = mundo(client)
    d = m.h["dueno"]
    a = cuenta(client, d, nombre="NombreUnico123", saldo_inicial="5")["id"]
    b = cuenta(client, d, nombre="OtroUnico456")["id"]
    traspaso(client, d, a, b, "1")
    client.patch(f"/api/cuentas/{a}", headers=d, json={"nombre": "Renombrada789"})
    with SesionTest() as db:
        movs = db.scalars(select(Historial).where(Historial.entidad == "cuenta_mov")).all()
        assert movs and all("Unico" not in str(h.cambios) and "Renombrada" not in str(h.cambios) for h in movs)
    # y si la cuenta se renombra, el historial del movimiento muestra el nombre ACTUAL (se resuelve al leer)
    t = client.get("/api/cuentas/movimientos", headers=d).json()[0]["id"]
    it = client.get(f"/api/historial?entidad=cuenta_mov&entidad_id={t}", headers=d).json()["items"][0]
    assert it["cambios"]["cuenta"]["despues"] == "Renombrada789"
