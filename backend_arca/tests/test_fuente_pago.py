"""Fuente de pago (0010): gastos, ingresos y apoyos pagados con Efectivo o con una cuenta (Banco), con confirmacion.

Mundo: familia 1 (admin, dueno, otro, elegido) y familia 2 (ajeno). Ver util_cuentas.mundo.
"""
from datetime import timedelta

import pytest

from app.modulos.periodos.calculo import hoy_la_paz
from tests.util_cuentas import cuenta, mov, mundo, saldo


def banco(client, h, nombre="Banco Uno", saldo_inicial="1000", **kw) -> int:
    return cuenta(client, h, nombre=nombre, tipo="corriente", banco="Banco Unión", saldo_inicial=saldo_inicial, **kw)["id"]


def gasto(client, h, cat, monto="100", expect=201, **kw) -> dict:
    r = client.post("/api/movimientos", headers=h, json={"tipo": "gasto", "monto": monto, "categoria_id": cat, **kw})
    assert r.status_code == expect, r.text
    return r.json()


def ingreso(client, h, monto="100", expect=201, **kw) -> dict:
    r = client.post("/api/movimientos", headers=h, json={"tipo": "ingreso", "monto": monto, **kw})
    assert r.status_code == expect, r.text
    return r.json()


def apoyo(client, h, monto="100", expect=201, **kw) -> dict:
    r = client.post("/api/apoyos", headers=h, json={"beneficiario": "Tía", "monto": monto, **kw})
    assert r.status_code == expect, r.text
    return r.json()


def movs_cuenta(client, h, cid, ver_anulados=True) -> list[dict]:
    r = client.get(f"/api/cuentas/{cid}/movimientos?ver_anulados={str(ver_anulados).lower()}", headers=h)
    assert r.status_code == 200, r.text
    return r.json()


def vinculos(client, h, cid, origen_id, clase="movimiento") -> list[dict]:
    return [
        x for x in movs_cuenta(client, h, cid)
        if x["vinculado"] and x["origen_id"] == origen_id and x["origen_clase"] == clase
    ]


def editar(client, h, mid, expect=200, clase="movimientos", **kw) -> dict:
    r = client.patch(f"/api/{clase}/{mid}", headers=h, json=kw)
    assert r.status_code == expect, r.text
    return r.json()


def accion(client, h, ruta, expect=200, **kw) -> dict:
    r = client.post(ruta, headers=h, json=kw)
    assert r.status_code == expect, r.text
    return r.json()


@pytest.fixture
def m(client):
    return mundo(client)


# ------------------------------------------------------------------ paso 3: cuenta propia, confirmado directo
def test_gasto_ingreso_y_apoyo_con_cuenta_propia_se_registran_confirmados(client, m):
    d = m.h["dueno"]
    b = banco(client, d)
    g = gasto(client, d, m.cat, "100.50", cuenta_id=b, nota="SECRETO-nota")
    assert g["fuente"] == "banco" and g["cuenta_id"] == b and g["cuenta_nombre"] == "Banco Uno"
    assert g["estado_cuenta"] == "confirmado"
    i = ingreso(client, d, "40", cuenta_id=b)
    assert i["estado_cuenta"] == "confirmado"
    a = apoyo(client, d, "9.50", cuenta_id=b)
    assert a["fuente"] == "banco" and a["estado_cuenta"] == "confirmado"
    assert saldo(client, d, b) == "930.00"  # 1000 - 100.50 + 40 - 9.50
    lista = movs_cuenta(client, d, b)
    tipos = {(x["origen_tipo"], x["tipo"], x["monto"]) for x in lista}
    assert tipos == {("gasto", "retiro", "100.50"), ("ingreso", "deposito", "40.00"), ("apoyo", "retiro", "9.50")}
    for x in lista:
        assert x["vinculado"] and x["estado"] == "confirmado" and x["nota"] is None  # la nota nunca pasa a Cuentas
        assert x["puede_registrar"] is False  # solo lectura en Cuentas
    assert "SECRETO-nota" not in client.get("/api/cuentas/movimientos", headers=d).text
    gv = next(x for x in lista if x["origen_tipo"] == "gasto")
    assert gv["origen_id"] == g["id"] and gv["origen_clase"] == "movimiento"


def test_efectivo_por_defecto_y_datos_existentes(client, m):
    d = m.h["dueno"]
    g = client.get(f"/api/movimientos/{m.mov}", headers=d).json()
    assert g["fuente"] == "efectivo" and g["cuenta_id"] is None and g["estado_cuenta"] is None
    a = client.get(f"/api/apoyos/{m.apo}", headers=d).json()
    assert a["fuente"] == "efectivo"


def test_solo_cuentas_de_banco_activas_en_bs(client, m):
    d = m.h["dueno"]
    usd = cuenta(client, d, nombre="Dolares", tipo="ahorro", moneda="USD", banco="Banco Unión")["id"]
    caja = cuenta(client, d, nombre="Caja")["id"]  # tipo efectivo: NO es la fuente "Efectivo" ni un banco
    cripto = cuenta(client, d, nombre="Bin", tipo="cripto", moneda="USDT", banco="Binance")["id"]
    anulada = banco(client, d, nombre="Vieja")
    accion(client, d, f"/api/cuentas/{anulada}/anular")
    for cid in (usd, caja, cripto, anulada, 999999):
        gasto(client, d, m.cat, cuenta_id=cid, expect=422)
    ok = banco(client, d, nombre="Buena")
    fuentes = client.get("/api/cuentas/fuentes", headers=d).json()
    assert [f["id"] for f in fuentes] == [ok]
    assert fuentes[0]["directo"] is True and fuentes[0]["confirma_nombre"] is None
    # nada quedo registrado a medias
    assert all(not movs_cuenta(client, d, c) for c in (usd, caja, cripto))


def test_anulado_sin_conexion_solo_en_efectivo(client, m):
    d = m.h["dueno"]
    b = banco(client, d)
    gasto(client, d, m.cat, cuenta_id=b, anulado=True, expect=422)
    apoyo(client, d, cuenta_id=b, anulado=True, expect=422)


def test_vinculado_es_solo_lectura_en_cuentas(client, m):
    d = m.h["dueno"]
    b = banco(client, d)
    g = gasto(client, d, m.cat, cuenta_id=b)
    a = apoyo(client, d, cuenta_id=b)
    for origen, clase, palabra in ((g["id"], "movimiento", "gasto"), (a["id"], "apoyo", "apoyo")):
        v = vinculos(client, d, b, origen, clase)[0]
        for metodo, ruta, cuerpo in (
            ("POST", f"/api/cuentas/movimientos/{v['id']}/anular", {}),
            ("POST", f"/api/cuentas/movimientos/{v['id']}/reactivar", {}),
            ("PATCH", f"/api/cuentas/movimientos/{v['id']}", {"fecha": str(hoy_la_paz())}),
        ):
            r = client.request(metodo, ruta, headers=d, json=cuerpo)
            assert r.status_code == 422 and r.json()["detail"] == f"Se gestiona desde el {palabra}", r.text
    # confirmar algo ya confirmado (registrado directo): no esta por confirmar
    v = vinculos(client, d, b, g["id"])[0]
    accion(client, d, f"/api/cuentas/movimientos/{v['id']}/confirmar", expect=400)
    # un movimiento registrado en Cuentas no se confirma
    dep = mov(client, d, b, "depositos", monto="5")
    accion(client, d, f"/api/cuentas/movimientos/{dep['id']}/confirmar", expect=400)


def test_historial_del_gasto_muestra_la_fuente_por_nombre(client, m):
    d = m.h["dueno"]
    b = banco(client, d)
    g = gasto(client, d, m.cat, cuenta_id=b)
    h = client.get(f"/api/historial?entidad=movimiento&entidad_id={g['id']}", headers=d).json()["items"]
    crear = next(x for x in h if x["accion"] == "crear")
    assert crear["cambios"]["fuente"]["despues"] == "Banco Uno"


# ------------------------------------------------------------------ paso 4: sincronizacion
def test_editar_monto_fecha_y_nota_sincroniza_el_vinculo(client, m):
    d = m.h["dueno"]
    b = banco(client, d)
    g = gasto(client, d, m.cat, "100", cuenta_id=b)
    ayer = str(hoy_la_paz() - timedelta(days=1))
    editar(client, d, g["id"], monto="70", fecha=ayer, nota="SECRETO-nueva", version_base=g["version"])
    [v] = [x for x in vinculos(client, d, b, g["id"]) if not x["anulado"]]
    assert v["monto"] == "70.00" and v["fecha"] == ayer and v["hora"] is None and v["nota"] is None
    assert saldo(client, d, b) == "930.00"
    assert "SECRETO-nueva" not in client.get(f"/api/cuentas/{b}/movimientos", headers=d).text


def test_cambiar_de_cuenta_a_efectivo_y_de_vuelta(client, m):
    d = m.h["dueno"]
    b1, b2 = banco(client, d, "Uno"), banco(client, d, "Dos")
    g = gasto(client, d, m.cat, "100", cuenta_id=b1)
    g = editar(client, d, g["id"], cuenta_id=b2)
    assert g["cuenta_id"] == b2 and g["estado_cuenta"] == "confirmado"
    assert (saldo(client, d, b1), saldo(client, d, b2)) == ("1000.00", "900.00")
    [viejo] = vinculos(client, d, b1, g["id"])
    assert viejo["anulado"] and viejo["motivo_anulacion"] == "Cambió la fuente de pago"
    g = editar(client, d, g["id"], cuenta_id=None)
    assert g["fuente"] == "efectivo" and g["cuenta_id"] is None
    assert saldo(client, d, b2) == "1000.00"
    g = editar(client, d, g["id"], cuenta_id=b1)
    assert saldo(client, d, b1) == "900.00"
    # solo cambiar la nota no toca la cuenta
    antes = len(vinculos(client, d, b1, g["id"]))
    editar(client, d, g["id"], nota="x")
    assert len(vinculos(client, d, b1, g["id"])) == antes
    h = client.get(f"/api/historial?entidad=movimiento&entidad_id={g['id']}", headers=d).json()["items"]
    fuentes = [(x["cambios"]["fuente"]["antes"], x["cambios"]["fuente"]["despues"]) for x in h if "fuente" in x["cambios"]]
    assert ("Uno", "Dos") in fuentes and ("Dos", "Efectivo") in fuentes and ("Efectivo", "Uno") in fuentes


def test_anular_y_reactivar_el_gasto(client, m):
    d = m.h["dueno"]
    b = banco(client, d)
    g = gasto(client, d, m.cat, "100", cuenta_id=b)
    accion(client, d, f"/api/movimientos/{g['id']}/anular", motivo="error")
    assert saldo(client, d, b) == "1000.00"
    [v] = vinculos(client, d, b, g["id"])
    assert v["anulado"] and v["motivo_anulacion"] == "Anulado junto con su registro"
    r = accion(client, d, f"/api/movimientos/{g['id']}/reactivar")
    assert r["fuente"] == "banco" and r["estado_cuenta"] == "confirmado"
    assert saldo(client, d, b) == "900.00"
    assert len(vinculos(client, d, b, g["id"])) == 2  # el anulado queda como rastro; el nuevo es el vigente


def test_reactivar_con_la_cuenta_anulada_vuelve_a_efectivo(client, m):
    d = m.h["dueno"]
    b = banco(client, d)
    g = gasto(client, d, m.cat, "100", cuenta_id=b)
    accion(client, d, f"/api/movimientos/{g['id']}/anular")
    accion(client, d, f"/api/cuentas/{b}/anular")
    r = accion(client, d, f"/api/movimientos/{g['id']}/reactivar")
    assert r["fuente"] == "efectivo" and not r["anulado"]
    h = client.get(f"/api/historial?entidad=movimiento&entidad_id={g['id']}", headers=d).json()["items"]
    assert any("fuente" in x["cambios"] and "vuelve a efectivo" in (x["motivo"] or "") for x in h)


def test_editar_monto_con_la_cuenta_anulada_pide_pasar_a_efectivo(client, m):
    d = m.h["dueno"]
    b = banco(client, d)
    g = gasto(client, d, m.cat, "100", cuenta_id=b)
    accion(client, d, f"/api/cuentas/{b}/anular")
    editar(client, d, g["id"], monto="50", expect=400)
    g = editar(client, d, g["id"], cuenta_id=None, monto="50")
    assert g["fuente"] == "efectivo" and float(g["monto"]) == 50


def test_gasto_con_banco_no_pasa_a_ingreso(client, m):
    d = m.h["dueno"]
    b = banco(client, d)
    g = gasto(client, d, m.cat, "100", cuenta_id=b)
    editar(client, d, g["id"], tipo="ingreso", categoria_id=None, expect=422)
    i = ingreso(client, d, "10", cuenta_id=b)
    editar(client, d, i["id"], tipo="gasto", categoria_id=m.cat, expect=422)
    # pasandolo a efectivo en la misma edicion, si
    g = editar(client, d, g["id"], tipo="ingreso", cuenta_id=None)
    assert g["tipo"] == "ingreso" and g["fuente"] == "efectivo"
    assert saldo(client, d, b) == "1010.00"


def test_apoyo_sincroniza_monto_anulacion_y_fuente(client, m):
    d = m.h["dueno"]
    b = banco(client, d)
    a = apoyo(client, d, "100", cuenta_id=b)
    editar(client, d, a["id"], clase="apoyos", monto="60")
    assert saldo(client, d, b) == "940.00"
    accion(client, d, f"/api/apoyos/{a['id']}/anular")
    assert saldo(client, d, b) == "1000.00"
    accion(client, d, f"/api/apoyos/{a['id']}/reactivar")
    assert saldo(client, d, b) == "940.00"
    a = editar(client, d, a["id"], clase="apoyos", cuenta_id=None)
    assert a["fuente"] == "efectivo" and saldo(client, d, b) == "1000.00"


# ------------------------------------------------------------------ paso 5: opcion B (cuenta de otra persona)
def _pendiente(client, m, monto="100", **kw):
    """`otro` paga un gasto con la cuenta (de familia) de `dueno`: queda por confirmar."""
    b = kw.pop("b", None) or banco(client, m.h["dueno"])
    g = gasto(client, m.h["otro"], m.cat, monto, cuenta_id=b, **kw)
    [v] = vinculos(client, m.h["dueno"], b, g["id"])
    return b, g, v


def test_cuenta_ajena_queda_pendiente_y_no_suma(client, m):
    b, g, v = _pendiente(client, m)
    assert g["estado_cuenta"] == "pendiente" and g["confirma_nombre"] == "dueno"
    assert v["estado"] == "pendiente" and v["puede_confirmar"] is True and v["confirma_nombre"] == "dueno"
    assert saldo(client, m.h["dueno"], b) == "1000.00"
    f = client.get("/api/cuentas/fuentes", headers=m.h["otro"]).json()
    assert [(x["id"], x["directo"], x["confirma_nombre"]) for x in f] == [(b, False, "dueno")]
    # quien lo registro lo ve en la cuenta pero no lo confirma
    [vo] = vinculos(client, m.h["otro"], b, g["id"])
    assert vo["puede_confirmar"] is False
    accion(client, m.h["otro"], f"/api/cuentas/movimientos/{v['id']}/confirmar", expect=403)


def test_encargado_registra_directo(client, m):
    b = banco(client, m.h["dueno"], encargado_id=m.uid["otro"])
    g = gasto(client, m.h["otro"], m.cat, "100", cuenta_id=b)
    assert g["estado_cuenta"] == "confirmado" and saldo(client, m.h["dueno"], b) == "900.00"


def test_no_se_ofrecen_ni_aceptan_cuentas_solo_yo_de_otros(client, m):
    privada = banco(client, m.h["dueno"], nombre="PRIVADA", visibilidad="solo_yo")
    for quien in ("otro", "admin", "elegido"):
        r = client.get("/api/cuentas/fuentes", headers=m.h[quien])
        assert privada not in [x["id"] for x in r.json()] and "PRIVADA" not in r.text
        r = client.post("/api/movimientos", headers=m.h[quien],
                        json={"tipo": "gasto", "monto": 5, "categoria_id": m.cat, "cuenta_id": privada})
        assert r.status_code == 422 and "PRIVADA" not in r.text
    ajena = banco(client, m.h["ajeno"], nombre="OTRA-FAMILIA")
    gasto(client, m.h["dueno"], m.cat, cuenta_id=ajena, expect=422)


def test_confirmar_toma_la_hora_de_confirmacion(client, m):
    hace3 = str(hoy_la_paz() - timedelta(days=3))
    b, g, v = _pendiente(client, m, fecha=hace3)
    assert v["fecha"] == hace3 and v["hora"] is None
    r = accion(client, m.h["dueno"], f"/api/cuentas/movimientos/{v['id']}/confirmar", version_base=v["version"])
    assert r["estado"] == "confirmado" and r["fecha"] == str(hoy_la_paz()) and r["hora"] is not None
    assert r["hora_registrada"] is None and r["confirmado_por_nombre"] == "dueno"
    assert r["origen_fecha"] == hace3  # el gasto conserva su fecha
    assert saldo(client, m.h["dueno"], b) == "900.00"
    assert client.get(f"/api/movimientos/{g['id']}", headers=m.h["otro"]).json()["estado_cuenta"] == "confirmado"
    # registrado hoy: la hora real queda en hora_registrada
    b2, g2, v2 = _pendiente(client, m, b=b)
    r2 = accion(client, m.h["dueno"], f"/api/cuentas/movimientos/{v2['id']}/confirmar")
    assert r2["hora_registrada"] == v2["hora"]
    h = client.get(f"/api/historial?entidad=cuenta_mov&entidad_id={v['id']}", headers=m.h["dueno"]).json()["items"]
    assert any(x["accion"] == "confirmar" for x in h)
    # ya no esta por confirmar
    accion(client, m.h["dueno"], f"/api/cuentas/movimientos/{v['id']}/confirmar", expect=400)


def test_solo_dueno_o_encargado_confirma_o_rechaza(client, m):
    b, g, v = _pendiente(client, m)
    for quien, codigo in (("admin", 403), ("otro", 403), ("elegido", 403), ("ajeno", 404)):
        for que in ("confirmar", "rechazar"):
            accion(client, m.h[quien], f"/api/cuentas/movimientos/{v['id']}/{que}", expect=codigo)
    assert client.get("/api/cuentas/por-confirmar", headers=m.h["admin"]).json() == []
    assert client.get("/api/cuentas/por-confirmar/resumen", headers=m.h["admin"]).json()["cantidad"] == 0
    # el encargado si
    editar(client, m.h["dueno"], b, clase="cuentas", encargado_id=m.uid["elegido"])
    bandeja = client.get("/api/cuentas/por-confirmar", headers=m.h["elegido"]).json()
    assert [x["id"] for x in bandeja] == [v["id"]]
    accion(client, m.h["elegido"], f"/api/cuentas/movimientos/{v['id']}/confirmar")


def test_bandeja_y_contador(client, m):
    b, g, v = _pendiente(client, m)
    _pendiente(client, m, b=b)
    d = m.h["dueno"]
    assert len(client.get("/api/cuentas/por-confirmar", headers=d).json()) == 2
    assert client.get("/api/cuentas/por-confirmar/resumen", headers=d).json() == {"cantidad": 2, "rechazos": []}
    # anular el gasto lo saca de la bandeja (y confirmarlo despues: ya no aplica)
    accion(client, m.h["otro"], f"/api/movimientos/{g['id']}/anular")
    assert client.get("/api/cuentas/por-confirmar/resumen", headers=d).json()["cantidad"] == 1
    r = client.post(f"/api/cuentas/movimientos/{v['id']}/confirmar", headers=d, json={})
    assert r.status_code == 409 and "Ya no aplica" in r.json()["detail"]
    # reactivarlo vuelve a pedir confirmacion
    accion(client, m.h["otro"], f"/api/movimientos/{g['id']}/reactivar")
    assert client.get("/api/cuentas/por-confirmar/resumen", headers=d).json()["cantidad"] == 2


def test_rechazar_vuelve_a_efectivo_y_avisa_al_autor(client, m):
    b, g, v = _pendiente(client, m)
    r = accion(client, m.h["dueno"], f"/api/cuentas/movimientos/{v['id']}/rechazar", motivo="No era de esta cuenta")
    assert r["estado"] == "rechazado" and r["motivo_rechazo"] == "No era de esta cuenta"
    assert saldo(client, m.h["dueno"], b) == "1000.00"
    go = client.get(f"/api/movimientos/{g['id']}", headers=m.h["otro"]).json()
    assert go["fuente"] == "efectivo" and not go["anulado"]
    assert go["rechazado_por_nombre"] == "dueno" and go["rechazo_cuenta_nombre"] == "Banco Uno"
    res = client.get("/api/cuentas/por-confirmar/resumen", headers=m.h["otro"]).json()
    assert [(x["origen_id"], x["rechazado_por_nombre"], x["motivo"]) for x in res["rechazos"]] == [
        (g["id"], "dueno", "No era de esta cuenta")
    ]
    assert client.get("/api/cuentas/por-confirmar/resumen", headers=m.h["dueno"]).json()["rechazos"] == []
    h = client.get(f"/api/historial?entidad=movimiento&entidad_id={g['id']}", headers=m.h["otro"]).json()["items"]
    assert any(
        x["motivo"] == "Fuente cambiada por rechazo" and x["cambios"]["fuente"]["despues"] == "Efectivo" for x in h
    )
    # sigue visible en la cuenta, sin efecto; no se puede confirmar ni rechazar otra vez
    assert [x["estado"] for x in vinculos(client, m.h["dueno"], b, g["id"])] == ["rechazado"]
    accion(client, m.h["dueno"], f"/api/cuentas/movimientos/{v['id']}/confirmar", expect=409)
    # el autor elige otra fuente: el aviso desaparece
    propia = banco(client, m.h["otro"], nombre="Mia")
    editar(client, m.h["otro"], g["id"], cuenta_id=propia, version_base=go["version"])
    assert client.get("/api/cuentas/por-confirmar/resumen", headers=m.h["otro"]).json()["rechazos"] == []


def test_editar_monto_de_un_confirmado_en_cuenta_ajena_vuelve_a_pendiente(client, m):
    b, g, v = _pendiente(client, m, fecha=str(hoy_la_paz() - timedelta(days=2)))
    accion(client, m.h["dueno"], f"/api/cuentas/movimientos/{v['id']}/confirmar")
    assert saldo(client, m.h["dueno"], b) == "900.00"
    g = editar(client, m.h["otro"], g["id"], monto="80")
    assert g["estado_cuenta"] == "pendiente"
    [v2] = [x for x in vinculos(client, m.h["dueno"], b, g["id"]) if not x["anulado"]]
    assert v2["id"] == v["id"] and v2["estado"] == "pendiente" and v2["monto"] == "80.00"
    assert v2["fecha"] == g["fecha"]  # vuelve a la fecha del gasto
    assert saldo(client, m.h["dueno"], b) == "1000.00"
    # cambiar solo la nota o la fecha de un confirmado no lo devuelve a pendiente ni mueve su fecha de confirmacion
    accion(client, m.h["dueno"], f"/api/cuentas/movimientos/{v['id']}/confirmar")
    g = editar(client, m.h["otro"], g["id"], nota="otra", fecha=str(hoy_la_paz() - timedelta(days=5)))
    assert g["estado_cuenta"] == "confirmado"
    [v3] = [x for x in vinculos(client, m.h["dueno"], b, g["id"]) if not x["anulado"]]
    assert v3["fecha"] == str(hoy_la_paz())


def test_pendiente_sigue_al_gasto_mientras_no_se_confirma(client, m):
    b, g, v = _pendiente(client, m)
    ayer = str(hoy_la_paz() - timedelta(days=1))
    editar(client, m.h["otro"], g["id"], monto="55", fecha=ayer)
    [v2] = vinculos(client, m.h["dueno"], b, g["id"])
    assert (v2["estado"], v2["monto"], v2["fecha"]) == ("pendiente", "55.00", ayer)


def test_no_se_anula_una_cuenta_con_pendientes(client, m):
    b, g, v = _pendiente(client, m)
    r = client.post(f"/api/cuentas/{b}/anular", headers=m.h["dueno"], json={})
    assert r.status_code == 400 and "tiene movimientos por confirmar" in r.json()["detail"]
    accion(client, m.h["dueno"], f"/api/cuentas/movimientos/{v['id']}/rechazar")
    accion(client, m.h["dueno"], f"/api/cuentas/{b}/anular")


def test_el_vinculo_no_filtra_nota_ni_categoria_a_quien_no_ve_el_gasto(client, m):
    d, o = m.h["dueno"], m.h["otro"]
    b = banco(client, d, nombre="Comun")
    cat = client.get("/api/categorias", headers=o).json()[-1]
    g = gasto(client, o, cat["id"], "123.45", cuenta_id=b, nota="SECRETO-nota", visibilidad="solo_yo")
    [v] = client.get("/api/cuentas/por-confirmar", headers=d).json()
    for ruta in ("/api/cuentas/por-confirmar", f"/api/cuentas/{b}/movimientos", "/api/cuentas/movimientos",
                 f"/api/historial?entidad=cuenta_mov&entidad_id={v['id']}", f"/api/cuentas/movimientos/{v['id']}"):
        r = client.get(ruta, headers=d)
        assert r.status_code == 200 and "SECRETO" not in r.text and cat["nombre"] not in r.text, ruta
    assert v["origen_tipo"] == "gasto" and v["origen_id"] is None and v["origen_detalle"] is None
    assert v["origen_fecha"] is None and v["usuario_nombre"] == "otro"
    # quien SI ve el gasto (de familia) ve el enlace y la categoria
    g2 = gasto(client, o, cat["id"], "10", cuenta_id=b, visibilidad="familia")
    v2 = next(x for x in client.get("/api/cuentas/por-confirmar", headers=d).json() if x["origen_id"] == g2["id"])
    assert v2["origen_detalle"] == cat["nombre"] and v2["origen_clase"] == "movimiento"
    assert g["id"] != g2["id"]


def test_el_gasto_no_revela_el_nombre_de_una_cuenta_que_el_lector_no_ve(client, m):
    o = m.h["otro"]
    b = banco(client, o, nombre="CUENTA-PRIVADA", visibilidad="solo_yo")
    g = gasto(client, o, m.cat, "10", cuenta_id=b, visibilidad="familia")
    for quien in ("admin", "elegido", "dueno"):
        r = client.get(f"/api/movimientos/{g['id']}", headers=m.h[quien])
        assert r.json()["cuenta_nombre"] == "otra cuenta" and r.json()["cuenta_id"] is None
        h = client.get(f"/api/historial?entidad=movimiento&entidad_id={g['id']}", headers=m.h[quien])
        assert "CUENTA-PRIVADA" not in h.text
        assert "CUENTA-PRIVADA" not in client.get("/api/movimientos", headers=m.h[quien]).text


def test_reenviar_el_mismo_uuid_no_duplica_el_vinculo(client, m):
    d = m.h["dueno"]
    b = banco(client, d)
    u = "11111111-2222-3333-4444-555555555555"
    gasto(client, d, m.cat, "10", cuenta_id=b, uuid_cliente=u)
    gasto(client, d, m.cat, "10", cuenta_id=b, uuid_cliente=u, expect=200)
    assert len(movs_cuenta(client, d, b)) == 1 and saldo(client, d, b) == "990.00"


def test_admin_edita_monto_de_gasto_de_otro_y_vuelve_a_pendiente(client, m):
    b = banco(client, m.h["otro"], nombre="De otro")
    g = gasto(client, m.h["otro"], m.cat, "100", cuenta_id=b)  # directo: otro es el dueno
    assert g["estado_cuenta"] == "confirmado"
    g = editar(client, m.h["admin"], g["id"], monto="90")
    assert g["estado_cuenta"] == "pendiente"
    assert saldo(client, m.h["otro"], b) == "1000.00"


# ------------------------------------------------------------------ paso 7: reportes
def _reporte(client, h, ruta, fuente=None):
    hoy = hoy_la_paz()
    q = f"desde={hoy.replace(day=1)}&hasta={hoy}" + (f"&fuente={fuente}" if fuente else "")
    r = client.get(f"/api/reportes/{ruta}?{q}", headers=h)
    assert r.status_code == 200, r.text
    return r.json()


def _num(x) -> float:
    return float(x)


def test_reportes_cuentan_todo_y_te_queda_solo_efectivo(client, m):
    d = m.h["dueno"]
    b = banco(client, d)
    base = _reporte(client, d, "resumen")  # el mundo ya trae un gasto, un apoyo y una devolucion en efectivo
    ingreso(client, d, "1000")  # efectivo
    ingreso(client, d, "500", cuenta_id=b)  # al banco
    gasto(client, d, m.cat, "200")  # efectivo
    gasto(client, d, m.cat, "300", cuenta_id=b)  # con banco
    apoyo(client, d, "50", cuenta_id=b)  # con banco
    _pendiente(client, m, "40", b=b)  # de otro, por confirmar: el gasto SI cuenta
    r = _reporte(client, d, "resumen")
    assert _num(r["ingresos"]) - _num(base["ingresos"]) == 1500
    assert _num(r["gastos"]) - _num(base["gastos"]) == 540
    assert _num(r["gastos_banco"]) == 340 and _num(r["apoyos_banco"]) == 50 and _num(r["ingresos_banco"]) == 500
    # Te queda = solo efectivo: 1000 - 200 (lo de antes no cambia)
    assert round(_num(r["saldo_efectivo"]) - _num(base["saldo_efectivo"]), 2) == 800
    # cuadra: ingresos - gastos - apoyos + devoluciones + pagado con banco - ingresado al banco
    cuadre = (_num(r["ingresos"]) - _num(r["gastos"]) - _num(r["apoyos_entregados"]) + _num(r["devoluciones"])
              + _num(r["gastos_banco"]) + _num(r["apoyos_banco"]) - _num(r["ingresos_banco"]))
    assert round(cuadre, 2) == round(_num(r["saldo_efectivo"]), 2)
    assert "saldo_efectivo" in r["comparacion"]


def test_filtro_por_fuente_en_reportes(client, m):
    d = m.h["dueno"]
    b = banco(client, d)
    gasto(client, d, m.cat, "300", cuenta_id=b)
    solo_banco = _reporte(client, d, "resumen", "banco")
    assert _num(solo_banco["gastos"]) == 300 and _num(solo_banco["apoyos_entregados"]) == 0
    assert _num(solo_banco["devoluciones"]) == 0  # las devoluciones son efectivo
    efectivo = _reporte(client, d, "resumen", "efectivo")
    todos = _reporte(client, d, "resumen")
    assert round(_num(efectivo["gastos"]) + 300, 2) == round(_num(todos["gastos"]), 2)
    cats = _reporte(client, d, "por-categoria", "banco")
    assert _num(cats["total_gastos"]) == 300
    miembros = _reporte(client, d, "por-miembro", "banco")
    assert {x["nombre"]: _num(x["gastos"]) for x in miembros["miembros"]}["dueno"] == 300
    t = client.get("/api/reportes/tendencia-mensual?fuente=banco", headers=d).json()["meses"][-1]
    assert _num(t["gastos"]) == 300 and _num(t["gastos_banco"]) == 300
    assert client.get("/api/reportes/resumen?fuente=otra", headers=d).status_code == 422


def test_categorias_y_miembros_incluyen_lo_pagado_con_banco(client, m):
    d = m.h["dueno"]
    b = banco(client, d)
    antes = _reporte(client, d, "por-categoria")["total_gastos"]
    gasto(client, d, m.cat, "300", cuenta_id=b)
    assert round(_num(_reporte(client, d, "por-categoria")["total_gastos"]) - _num(antes), 2) == 300


def test_cambiar_quien_lo_ve_en_un_anulado_no_crea_vinculo(client, m):
    d = m.h["dueno"]
    b = banco(client, d)
    g = gasto(client, d, m.cat, "100", cuenta_id=b)
    a = apoyo(client, d, "50", cuenta_id=b)
    accion(client, d, f"/api/movimientos/{g['id']}/anular")
    accion(client, d, f"/api/apoyos/{a['id']}/anular")
    editar(client, d, g["id"], visibilidad="solo_yo")
    editar(client, d, a["id"], clase="apoyos", visibilidad="solo_yo")
    assert all(x["anulado"] for x in movs_cuenta(client, d, b))
    assert saldo(client, d, b) == "1000.00"
