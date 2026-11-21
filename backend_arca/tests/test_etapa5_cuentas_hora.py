"""Cuentas - HORA de los movimientos (migracion 0009): hora LOCAL de La Paz, opcional, sin zona.

`fecha` sigue mandando (filtros, periodos); la hora solo ordena dentro del dia y se muestra.
Orden: fecha DESC, hora DESC NULLS LAST, id DESC. Lo antiguo (sin hora) va al final de su dia.
"""
from datetime import datetime, time, timedelta, timezone

import pytest
from sqlalchemy import update

from app.modulos.cuentas.models import CuentaMovimiento
from app.modulos.periodos import calculo
from app.modulos.periodos.calculo import hoy_la_paz
from tests.conftest import SesionTest
from tests.util_cuentas import cuenta, mov, mundo, traspaso

HOY = hoy_la_paz()
AYER = (HOY - timedelta(days=1)).isoformat()
HACE_3 = (HOY - timedelta(days=3)).isoformat()


def _fijar_hora(mov_id: int, hora: time | None) -> None:
    """Pone la hora directo en la base (simula datos viejos o una hora concreta)."""
    with SesionTest() as db:
        db.execute(update(CuentaMovimiento).where(CuentaMovimiento.id == mov_id).values(hora=hora))
        db.commit()


def _ids(client, h, cuenta_id=None):
    url = f"/api/cuentas/{cuenta_id}/movimientos" if cuenta_id else "/api/cuentas/movimientos"
    r = client.get(url, headers=h)
    assert r.status_code == 200, r.text
    return [x["id"] for x in r.json()]


# ------------------------------------------------------------------ lectura y orden
def test_la_salida_trae_la_hora_como_hh_mm_o_nula(client):
    m = mundo(client)
    d = m.h["dueno"]
    a = cuenta(client, d, saldo_inicial="100")["id"]
    dep = mov(client, d, a, "depositos", monto="5", fecha=AYER)
    _fijar_hora(dep["id"], time(9, 5))
    viejo = mov(client, d, a, "depositos", monto="6", fecha=AYER)
    _fijar_hora(viejo["id"], None)
    por_id = {x["id"]: x for x in client.get(f"/api/cuentas/{a}/movimientos", headers=d).json()}
    assert por_id[dep["id"]]["hora"] == "09:05"
    assert por_id[viejo["id"]]["hora"] is None
    assert client.get(f"/api/cuentas/movimientos/{dep['id']}", headers=d).json()["hora"] == "09:05"


def test_orden_fecha_desc_hora_desc_nulas_al_final_del_dia_y_luego_id(client):
    m = mundo(client)
    d = m.h["dueno"]
    a = cuenta(client, d, saldo_inicial="100")["id"]
    # mismo dia (ayer): una sin hora registrada PRIMERO, dos con hora y otra sin hora registrada despues
    sin_hora_1 = mov(client, d, a, "depositos", monto="1", fecha=AYER)["id"]
    temprano = mov(client, d, a, "depositos", monto="2", fecha=AYER)["id"]
    tarde = mov(client, d, a, "depositos", monto="3", fecha=AYER)["id"]
    sin_hora_2 = mov(client, d, a, "depositos", monto="4", fecha=AYER)["id"]
    # un dia anterior con hora muy tarde: la fecha manda sobre la hora
    antes = mov(client, d, a, "depositos", monto="5", fecha=HACE_3)["id"]
    _fijar_hora(sin_hora_1, None)
    _fijar_hora(sin_hora_2, None)
    _fijar_hora(temprano, time(8, 0))
    _fijar_hora(tarde, time(20, 30))
    _fijar_hora(antes, time(23, 59))
    esperado = [tarde, temprano, sin_hora_2, sin_hora_1, antes]
    assert _ids(client, d, a) == esperado
    assert _ids(client, d) == esperado  # la lista global usa el mismo orden


def test_misma_fecha_y_hora_desempata_por_id(client):
    m = mundo(client)
    d = m.h["dueno"]
    a = cuenta(client, d, saldo_inicial="100")["id"]
    x = mov(client, d, a, "depositos", monto="1", fecha=AYER)["id"]
    y = mov(client, d, a, "depositos", monto="2", fecha=AYER)["id"]
    _fijar_hora(x, time(10, 0))
    _fijar_hora(y, time(10, 0))
    assert _ids(client, d, a) == [y, x]


def test_datos_viejos_sin_hora_conservan_el_orden_de_antes(client):
    """Sin ninguna hora, el orden es exactamente el anterior a la 0009: fecha DESC, id DESC."""
    m = mundo(client)
    d = m.h["dueno"]
    a = cuenta(client, d, saldo_inicial="100")["id"]
    ids = [mov(client, d, a, "depositos", monto="1", fecha=f)["id"] for f in (HACE_3, AYER, HACE_3, AYER)]
    for i in ids:
        _fijar_hora(i, None)
    assert _ids(client, d, a) == [ids[3], ids[1], ids[2], ids[0]]


# ------------------------------------------------------------------ alta
# Reloj fijo: 18:37:45 UTC del 20 = 14:37 del 20 en La Paz (UTC-4)
INSTANTE = datetime(2026, 11, 20, 18, 37, 45, tzinfo=timezone.utc)
DIA = "2026-11-20"


@pytest.fixture
def reloj(monkeypatch):
    def fijar(instante: datetime):
        monkeypatch.setattr(calculo, "ahora_utc", lambda: instante)

    fijar(INSTANTE)
    return fijar


def _crear_todos(client, h, a, b, expect=201, **kw):
    """Un movimiento de cada tipo con los mismos campos de fecha/hora."""
    return [
        mov(client, h, a, "depositos", expect=expect, monto="5", **kw),
        mov(client, h, a, "retiros", expect=expect, monto="1", **kw),
        mov(client, h, a, "ajustes", expect=expect, saldo_declarado=str(900 + len(_ids(client, h, a))), **kw),
        traspaso(client, h, a, b, "1", expect=expect, **kw),
    ]


def test_hoy_sin_hora_pone_la_hora_actual_de_la_paz_en_todos_los_tipos(client, reloj):
    m = mundo(client)
    d = m.h["dueno"]
    a, b = cuenta(client, d, saldo_inicial="100")["id"], cuenta(client, d, nombre="Banco")["id"]
    for x in _crear_todos(client, d, a, b, fecha=DIA):
        assert (x["fecha"], x["hora"]) == (DIA, "14:37"), x["tipo"]
    # sin fecha: es hoy (La Paz) y tambien lleva la hora actual
    x = mov(client, d, a, "depositos", monto="5")
    assert (x["fecha"], x["hora"]) == (DIA, "14:37")


def test_hoy_con_hora_pasada_o_igual_se_guarda_por_minutos(client, reloj):
    m = mundo(client)
    d = m.h["dueno"]
    a, b = cuenta(client, d, saldo_inicial="100")["id"], cuenta(client, d, nombre="Banco")["id"]
    for x in _crear_todos(client, d, a, b, fecha=DIA, hora="09:15:59"):
        assert x["hora"] == "09:15", x["tipo"]
    assert mov(client, d, a, "depositos", monto="5", fecha=DIA, hora="14:37")["hora"] == "14:37"  # el minuto actual vale


def test_hoy_con_hora_futura_es_422_en_todos_los_tipos(client, reloj):
    m = mundo(client)
    d = m.h["dueno"]
    a, b = cuenta(client, d, saldo_inicial="100")["id"], cuenta(client, d, nombre="Banco")["id"]
    for x in _crear_todos(client, d, a, b, expect=422, fecha=DIA, hora="14:38"):
        assert "hora" in x["detail"].lower()
    assert _ids(client, d, a) == []  # no se guardo nada


def test_dia_pasado_sin_hora_queda_nula_y_con_hora_cualquiera_vale(client, reloj):
    m = mundo(client)
    d = m.h["dueno"]
    a = cuenta(client, d, saldo_inicial="100")["id"]
    assert mov(client, d, a, "depositos", monto="5", fecha="2026-11-19")["hora"] is None
    assert mov(client, d, a, "depositos", monto="5", fecha="2026-11-19", hora="23:59")["hora"] == "23:59"


def test_fecha_futura_sigue_siendo_422(client, reloj):
    m = mundo(client)
    d = m.h["dueno"]
    a = cuenta(client, d, saldo_inicial="100")["id"]
    r = mov(client, d, a, "depositos", expect=422, monto="5", fecha="2026-11-21", hora="01:00")
    assert "fecha" in r["detail"].lower()


def test_cerca_de_medianoche_manda_el_dia_de_la_paz_no_el_de_utc(client, reloj):
    reloj(datetime(2026, 11, 21, 3, 59, 30, tzinfo=timezone.utc))  # 23:59 del 20 en La Paz; en UTC ya es el 21
    m = mundo(client)
    d = m.h["dueno"]
    a = cuenta(client, d, saldo_inicial="100")["id"]
    x = mov(client, d, a, "depositos", monto="5")
    assert (x["fecha"], x["hora"]) == (DIA, "23:59")
    mov(client, d, a, "depositos", expect=422, monto="5", fecha="2026-11-21")  # el 21 aun es futuro en La Paz


def test_hora_invalida_o_con_zona_es_422(client, reloj):
    m = mundo(client)
    d = m.h["dueno"]
    a = cuenta(client, d, saldo_inicial="100")["id"]
    for mala in ("25:00", "12:60", "mediodia", "10:00+02:00"):
        mov(client, d, a, "depositos", expect=422, monto="5", fecha="2026-11-19", hora=mala)


def test_la_hora_entra_en_la_foto_del_historial(client, reloj):
    m = mundo(client)
    d = m.h["dueno"]
    a = cuenta(client, d, saldo_inicial="100")["id"]
    x = mov(client, d, a, "depositos", monto="5", fecha=DIA, hora="08:05")
    it = client.get(f"/api/historial?entidad=cuenta_mov&entidad_id={x['id']}", headers=d).json()["items"]
    assert it[0]["accion"] == "crear" and it[0]["cambios"]["hora"] == {"antes": None, "despues": "08:05"}
    # sin hora (dia pasado) la foto no la incluye
    y = mov(client, d, a, "depositos", monto="5", fecha="2026-11-19")
    it = client.get(f"/api/historial?entidad=cuenta_mov&entidad_id={y['id']}", headers=d).json()["items"]
    assert "hora" not in it[0]["cambios"]


def test_reenvio_con_el_mismo_uuid_no_cambia_la_hora(client, reloj):
    m = mundo(client)
    d = m.h["dueno"]
    a = cuenta(client, d, saldo_inicial="100")["id"]
    u = "6f1d2c1e-1111-4222-8333-944455556666"
    x = mov(client, d, a, "depositos", monto="5", uuid_cliente=u)
    reloj(datetime(2026, 11, 20, 19, 10, tzinfo=timezone.utc))  # 15:10
    y = mov(client, d, a, "depositos", expect=200, monto="5", uuid_cliente=u)
    assert (y["id"], y["hora"]) == (x["id"], "14:37")


# ------------------------------------------------------------------ cambiar fecha y hora
def _patch(client, h, x, **cuerpo):
    return client.patch(f"/api/cuentas/movimientos/{x['id']}", headers=h, json={"version_base": x["version"], **cuerpo})


def _ultimo_historial(client, h, mov_id):
    """La entrada mas reciente (el reloj de la prueba esta fijo: se elige por id, no por instante)."""
    items = client.get(f"/api/historial?entidad=cuenta_mov&entidad_id={mov_id}", headers=h).json()["items"]
    return max(items, key=lambda i: i["id"])


def test_cambiar_solo_la_hora_registra_solo_la_hora(client, reloj):
    m = mundo(client)
    d = m.h["dueno"]
    a = cuenta(client, d, saldo_inicial="100")["id"]
    x = mov(client, d, a, "depositos", monto="5", fecha="2026-11-18", hora="10:00")
    r = _patch(client, d, x, fecha="2026-11-18", hora="11:30")
    assert r.status_code == 200, r.text
    assert (r.json()["fecha"], r.json()["hora"], r.json()["version"]) == ("2026-11-18", "11:30", x["version"] + 1)
    it = _ultimo_historial(client, d, x["id"])
    assert it["accion"] == "editar" and it["cambios"] == {"hora": {"antes": "10:00", "despues": "11:30"}}


def test_cambiar_fecha_y_hora_registra_ambas(client, reloj):
    m = mundo(client)
    d = m.h["dueno"]
    a = cuenta(client, d, saldo_inicial="100")["id"]
    x = mov(client, d, a, "depositos", monto="5", fecha="2026-11-18")  # viejo: sin hora
    r = _patch(client, d, x, fecha="2026-11-17", hora="07:45")
    assert (r.json()["fecha"], r.json()["hora"]) == ("2026-11-17", "07:45")
    assert _ultimo_historial(client, d, x["id"])["cambios"] == {
        "fecha": {"antes": "2026-11-18", "despues": "2026-11-17"}, "hora": {"antes": None, "despues": "07:45"},
    }


def test_sin_hora_en_el_cuerpo_se_conserva_la_que_tenia(client, reloj):
    m = mundo(client)
    d = m.h["dueno"]
    a = cuenta(client, d, saldo_inicial="100")["id"]
    x = mov(client, d, a, "depositos", monto="5", fecha="2026-11-18", hora="10:00")
    r = _patch(client, d, x, fecha="2026-11-16")
    assert (r.json()["fecha"], r.json()["hora"]) == ("2026-11-16", "10:00")
    assert _ultimo_historial(client, d, x["id"])["cambios"] == {"fecha": {"antes": "2026-11-18", "despues": "2026-11-16"}}


def test_hora_null_la_quita(client, reloj):
    m = mundo(client)
    d = m.h["dueno"]
    a = cuenta(client, d, saldo_inicial="100")["id"]
    x = mov(client, d, a, "depositos", monto="5", fecha="2026-11-18", hora="10:00")
    r = _patch(client, d, x, fecha="2026-11-18", hora=None)
    assert r.json()["hora"] is None
    assert _ultimo_historial(client, d, x["id"])["cambios"] == {"hora": {"antes": "10:00", "despues": None}}


def test_misma_fecha_y_hora_no_cambia_nada(client, reloj):
    m = mundo(client)
    d = m.h["dueno"]
    a = cuenta(client, d, saldo_inicial="100")["id"]
    x = mov(client, d, a, "depositos", monto="5", fecha="2026-11-18", hora="10:00")
    r = _patch(client, d, x, fecha="2026-11-18", hora="10:00:30")  # mismo minuto
    assert r.json()["version"] == x["version"]
    assert _ultimo_historial(client, d, x["id"])["accion"] == "crear"


def test_no_se_puede_llevar_a_una_hora_futura_de_hoy(client, reloj):
    m = mundo(client)
    d = m.h["dueno"]
    a = cuenta(client, d, saldo_inicial="100")["id"]
    x = mov(client, d, a, "depositos", monto="5", fecha="2026-11-18", hora="20:00")
    assert _patch(client, d, x, fecha=DIA, hora="14:38").status_code == 422
    # pasar a hoy conservando una hora que hoy aun no llego (20:00 > 14:37) tambien es 422
    assert _patch(client, d, x, fecha=DIA).status_code == 422
    assert _patch(client, d, x, fecha="2026-11-21", hora="00:00").status_code == 422  # fecha futura
    r = _patch(client, d, x, fecha=DIA, hora="14:37")
    assert r.status_code == 200 and (r.json()["fecha"], r.json()["hora"]) == (DIA, "14:37")


def test_pasar_a_hoy_un_movimiento_sin_hora_no_inventa_la_hora(client, reloj):
    m = mundo(client)
    d = m.h["dueno"]
    a = cuenta(client, d, saldo_inicial="100")["id"]
    x = mov(client, d, a, "depositos", monto="5", fecha="2026-11-18")
    r = _patch(client, d, x, fecha=DIA)
    assert (r.json()["fecha"], r.json()["hora"]) == (DIA, None)


def test_la_hora_de_un_ajuste_tampoco_se_cambia(client, reloj):
    m = mundo(client)
    d = m.h["dueno"]
    a = cuenta(client, d, saldo_inicial="100")["id"]
    x = mov(client, d, a, "ajustes", saldo_declarado="50", fecha="2026-11-18", hora="10:00")
    r = _patch(client, d, x, fecha="2026-11-18", hora="09:00")
    assert r.status_code == 422 and "ajuste" in r.json()["detail"]


def test_cambiar_la_hora_reordena_dentro_del_dia_y_no_toca_el_saldo(client, reloj):
    m = mundo(client)
    d = m.h["dueno"]
    a = cuenta(client, d, saldo_inicial="100")["id"]
    x = mov(client, d, a, "depositos", monto="5", fecha="2026-11-18", hora="08:00")
    y = mov(client, d, a, "retiros", monto="2", fecha="2026-11-18", hora="09:00")
    assert _ids(client, d, a) == [y["id"], x["id"]]
    _patch(client, d, x, fecha="2026-11-18", hora="10:00")
    assert _ids(client, d, a) == [x["id"], y["id"]]
    assert client.get(f"/api/cuentas/{a}", headers=d).json()["saldo"] == "103.00"
