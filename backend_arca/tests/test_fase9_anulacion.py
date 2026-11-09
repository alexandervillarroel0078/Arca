"""Fase 9: anular/reactivar/editar movimientos, apoyos y devoluciones; permisos; idempotencia."""
import uuid
from datetime import date

from app.main import app

HOY = date.today().isoformat()
MES = date.today().strftime("%Y-%m")


def gasto(client, h, cat, monto=100, **extra):
    r = client.post("/api/movimientos", headers=h, json={"tipo": "gasto", "monto": monto, "categoria_id": cat, **extra})
    assert r.status_code == 201, r.text
    return r.json()


def ingreso(client, h, monto=1000, **extra):
    r = client.post("/api/movimientos", headers=h, json={"tipo": "ingreso", "monto": monto, **extra})
    assert r.status_code == 201, r.text
    return r.json()


def apoyo(client, h, monto=500, quien="Tia Rosa", **extra):
    r = client.post("/api/apoyos", headers=h, json={"beneficiario": quien, "monto": monto, **extra})
    assert r.status_code == 201, r.text
    return r.json()


def dev(client, h, apoyo_id, monto, **extra):
    return client.post(f"/api/apoyos/{apoyo_id}/devoluciones", headers=h, json={"monto": monto, **extra})


def anular(client, h, ruta, motivo=None):
    return client.post(f"{ruta}/anular", headers=h, json={"motivo": motivo} if motivo else {})


def reactivar(client, h, ruta):
    return client.post(f"{ruta}/reactivar", headers=h)


def resumen(client, h, mes=MES):
    return client.get(f"/api/reportes/resumen?mes={mes}", headers=h).json()


def apoyo_por_id(client, h, apoyo_id, ver_anulados=True):
    lista = client.get(f"/api/apoyos?ver_anulados={str(ver_anulados).lower()}", headers=h).json()
    return next(a for a in lista if a["id"] == apoyo_id)


# ---------------------------------------------------------------- no existe DELETE
def test_no_existe_ningun_delete(client, admin, categoria_id):
    for ruta in app.routes:
        assert "DELETE" not in getattr(ruta, "methods", set()), ruta.path
    m = gasto(client, admin, categoria_id)
    a = apoyo(client, admin)
    assert client.delete(f"/api/movimientos/{m['id']}", headers=admin).status_code == 405
    assert client.delete(f"/api/apoyos/{a['id']}", headers=admin).status_code == 405
    assert client.delete(f"/api/apoyos/{a['id']}/devoluciones/1", headers=admin).status_code == 405
    assert client.delete(f"/api/categorias/{categoria_id}", headers=admin).status_code == 405
    assert client.delete("/api/familia/miembros/1", headers=admin).status_code == 405


# ---------------------------------------------------------------- movimientos
def test_anular_movimiento_no_cuenta_y_se_reactiva(client, admin, categoria_id):
    ingreso(client, admin, 1000)
    g = gasto(client, admin, categoria_id, 300)
    assert resumen(client, admin)["saldo"] == 700

    r = anular(client, admin, f"/api/movimientos/{g['id']}", "Se registro dos veces")
    assert r.status_code == 200
    assert r.json()["anulado"] is True and r.json()["motivo_anulacion"] == "Se registro dos veces"
    assert r.json()["anulado_por_nombre"] == "Admin" and r.json()["anulado_en"]

    assert resumen(client, admin)["saldo"] == 1000  # lo anulado no cuenta
    assert resumen(client, admin)["gastos"] == 0
    assert client.get("/api/reportes/por-categoria", headers=admin).json()["total_gastos"] == 0
    assert len(client.get("/api/movimientos", headers=admin).json()) == 1  # oculto por defecto
    con = client.get("/api/movimientos?ver_anulados=true", headers=admin).json()
    assert len(con) == 2 and sum(1 for m in con if m["anulado"]) == 1

    assert anular(client, admin, f"/api/movimientos/{g['id']}").status_code == 400  # ya anulado
    r = reactivar(client, admin, f"/api/movimientos/{g['id']}")
    assert r.status_code == 200 and r.json()["anulado"] is False and r.json()["anulado_por_nombre"] is None
    assert resumen(client, admin)["saldo"] == 700
    assert reactivar(client, admin, f"/api/movimientos/{g['id']}").status_code == 400  # no estaba anulado


def test_anulado_no_cuenta_en_reportes_por_miembro_y_tendencia(client, admin, categoria_id):
    g = gasto(client, admin, categoria_id, 50)
    anular(client, admin, f"/api/movimientos/{g['id']}")
    pm = client.get(f"/api/reportes/por-miembro?mes={MES}", headers=admin).json()["miembros"][0]
    assert pm["gastos"] == 0
    assert client.get("/api/reportes/tendencia-mensual", headers=admin).json()["meses"][-1]["gastos"] == 0


def test_permisos_movimientos_miembro_vs_admin(client, admin, miembro, categoria_id):
    del_admin = gasto(client, admin, categoria_id)["id"]
    del_miembro = gasto(client, miembro, categoria_id)["id"]
    # el miembro NO toca lo del admin (editar, anular, reactivar)
    assert client.patch(f"/api/movimientos/{del_admin}", headers=miembro, json={"monto": 1}).status_code == 403
    assert anular(client, miembro, f"/api/movimientos/{del_admin}").status_code == 403
    anular(client, admin, f"/api/movimientos/{del_admin}")
    assert reactivar(client, miembro, f"/api/movimientos/{del_admin}").status_code == 403
    # el miembro si toca lo suyo
    assert client.patch(f"/api/movimientos/{del_miembro}", headers=miembro, json={"monto": 5}).status_code == 200
    assert anular(client, miembro, f"/api/movimientos/{del_miembro}").status_code == 200
    assert reactivar(client, miembro, f"/api/movimientos/{del_miembro}").status_code == 200
    # el admin toca todo
    assert client.patch(f"/api/movimientos/{del_miembro}", headers=admin, json={"monto": 9}).status_code == 200
    assert anular(client, admin, f"/api/movimientos/{del_miembro}").status_code == 200
    assert reactivar(client, admin, f"/api/movimientos/{del_miembro}").status_code == 200
    assert reactivar(client, admin, f"/api/movimientos/{del_admin}").status_code == 200


def test_editar_movimiento_campos_tipo_y_auditoria(client, admin, categoria_id):
    otra = client.get("/api/categorias", headers=admin).json()[1]["id"]
    g = gasto(client, admin, categoria_id, 80, nota="a")
    assert g["editado_por_nombre"] is None
    r = client.patch(
        f"/api/movimientos/{g['id']}", headers=admin,
        json={"monto": 95.5, "fecha": "2025-01-15", "categoria_id": otra, "nota": "b"},
    ).json()
    assert (r["monto"], r["fecha"], r["categoria_id"], r["nota"]) == (95.5, "2025-01-15", otra, "b")
    assert r["editado_por_nombre"] == "Admin" and r["editado_en"]

    # gasto -> ingreso limpia la categoria
    r = client.patch(f"/api/movimientos/{g['id']}", headers=admin, json={"tipo": "ingreso"}).json()
    assert r["tipo"] == "ingreso" and r["categoria_id"] is None
    # ingreso -> gasto sin categoria no se puede; con categoria si
    assert client.patch(f"/api/movimientos/{g['id']}", headers=admin, json={"tipo": "gasto"}).status_code == 422
    r = client.patch(f"/api/movimientos/{g['id']}", headers=admin, json={"tipo": "gasto", "categoria_id": otra})
    assert r.status_code == 200 and r.json()["tipo"] == "gasto"
    # el editado queda registrado quien lo edito
    assert client.patch(f"/api/movimientos/{g['id']}", headers=admin, json={"monto": 0}).status_code == 422


def test_no_se_edita_un_movimiento_anulado(client, admin, categoria_id):
    g = gasto(client, admin, categoria_id)
    anular(client, admin, f"/api/movimientos/{g['id']}")
    assert client.patch(f"/api/movimientos/{g['id']}", headers=admin, json={"monto": 5}).status_code == 400


def test_categoria_desactivada(client, admin, categoria_id):
    otra = client.get("/api/categorias", headers=admin).json()[1]["id"]
    g = gasto(client, admin, categoria_id, 40)
    p = client.patch(f"/api/categorias/{categoria_id}", headers=admin, json={"activa": False})
    assert p.json()["activa"] is False
    # el historial la conserva y puede seguir editandose con ella
    assert client.get("/api/movimientos", headers=admin).json()[0]["categoria_nombre"] == "Transporte"
    assert client.patch(f"/api/movimientos/{g['id']}", headers=admin, json={"monto": 41}).status_code == 200
    # pero no se puede elegir para registros nuevos
    r = client.post("/api/movimientos", headers=admin, json={"tipo": "gasto", "monto": 5, "categoria_id": categoria_id})
    assert r.status_code == 422
    n = gasto(client, admin, otra, 5)
    assert client.patch(f"/api/movimientos/{n['id']}", headers=admin, json={"categoria_id": categoria_id}).status_code == 422
    # sigue en la lista de categorias (con activa=false) y se puede reactivar y renombrar
    cats = client.get("/api/categorias", headers=admin).json()
    assert any(c["id"] == categoria_id and not c["activa"] for c in cats)
    r = client.patch(f"/api/categorias/{categoria_id}", headers=admin, json={"activa": True, "nombre": "Pasajes", "icono": "car"})
    assert r.json()["activa"] is True and r.json()["nombre"] == "Pasajes" and r.json()["icono"] == "car"
    assert gasto(client, admin, categoria_id, 5)


# ---------------------------------------------------------------- apoyos
def test_anular_apoyo_no_cuenta_en_nada(client, admin):
    a = apoyo(client, admin, 500)
    dev(client, admin, a["id"], 200)
    assert resumen(client, admin)["apoyos_entregados"] == 500
    assert client.get("/api/apoyos/resumen", headers=admin).json()["total_pendiente"] == 300

    r = anular(client, admin, f"/api/apoyos/{a['id']}", "Error de digitacion")
    assert r.status_code == 200 and r.json()["estado"] == "Anulado" and r.json()["anulado"] is True
    res = resumen(client, admin)
    assert (res["apoyos_entregados"], res["devoluciones"], res["saldo"], res["apoyos_pendientes_total"]) == (0, 0, 0, 0)
    ap = client.get("/api/apoyos/resumen", headers=admin).json()
    assert ap["beneficiarios"] == [] and ap["total_entregado"] == 0 and ap["total_pendiente"] == 0
    assert client.get("/api/apoyos", headers=admin).json() == []
    assert len(client.get("/api/apoyos?ver_anulados=true", headers=admin).json()) == 1


def test_anulacion_en_cascada_y_reactivacion_selectiva(client, admin):
    a = apoyo(client, admin, 500)
    d1 = dev(client, admin, a["id"], 100).json()["devoluciones"][0]["id"]
    d2 = dev(client, admin, a["id"], 150).json()["devoluciones"][1]["id"]
    d3 = dev(client, admin, a["id"], 50).json()["devoluciones"][2]["id"]
    # d3 se anula por separado ANTES de anular el apoyo
    assert anular(client, admin, f"/api/apoyos/{a['id']}/devoluciones/{d3}", "mal").status_code == 200
    assert apoyo_por_id(client, admin, a["id"])["devoluciones_activas"] == 2

    r = anular(client, admin, f"/api/apoyos/{a['id']}").json()
    assert r["devoluciones_activas"] == 0
    por = {d["id"]: d for d in r["devoluciones"]}
    assert por[d1]["anulado"] and por[d1]["anulada_con_apoyo"]
    assert por[d2]["anulado"] and por[d2]["anulada_con_apoyo"]
    assert por[d3]["anulado"] and not por[d3]["anulada_con_apoyo"]

    # no se opera sobre un apoyo anulado
    assert dev(client, admin, a["id"], 10).status_code == 400
    assert client.post(f"/api/apoyos/{a['id']}/consumir", headers=admin).status_code == 400
    assert client.patch(f"/api/apoyos/{a['id']}", headers=admin, json={"monto": 900}).status_code == 400
    assert reactivar(client, admin, f"/api/apoyos/{a['id']}/devoluciones/{d1}").status_code == 400

    r = reactivar(client, admin, f"/api/apoyos/{a['id']}").json()
    assert r["anulado"] is False and r["estado"] == "Pendiente"
    por = {d["id"]: d for d in r["devoluciones"]}
    assert not por[d1]["anulado"] and not por[d2]["anulado"]  # vuelven las de la cascada
    assert por[d3]["anulado"]  # la anulada aparte NO vuelve
    assert r["devuelto"] == 250 and r["pendiente"] == 250


def test_estado_ignora_devoluciones_anuladas(client, admin):
    a = apoyo(client, admin, 300)
    d = dev(client, admin, a["id"], 300).json()
    assert d["estado"] == "Saldado"
    did = d["devoluciones"][0]["id"]
    r = anular(client, admin, f"/api/apoyos/{a['id']}/devoluciones/{did}").json()
    assert (r["estado"], r["pendiente"], r["devuelto"]) == ("Pendiente", 300, 0)
    assert resumen(client, admin)["devoluciones"] == 0
    r = reactivar(client, admin, f"/api/apoyos/{a['id']}/devoluciones/{did}").json()
    assert r["estado"] == "Saldado"


def test_reactivar_devolucion_no_puede_superar_el_monto(client, admin):
    a = apoyo(client, admin, 100)
    d1 = dev(client, admin, a["id"], 60).json()["devoluciones"][0]["id"]
    anular(client, admin, f"/api/apoyos/{a['id']}/devoluciones/{d1}")
    dev(client, admin, a["id"], 60)  # ahora hay 60 activos
    r = reactivar(client, admin, f"/api/apoyos/{a['id']}/devoluciones/{d1}")
    assert r.status_code == 400 and "superaría" in r.json()["detail"]
    # con consumido tambien: se anula la segunda, se consume todo y no hay espacio
    ap = apoyo_por_id(client, admin, a["id"])
    d2 = ap["devoluciones"][1]["id"]
    anular(client, admin, f"/api/apoyos/{a['id']}/devoluciones/{d2}")
    client.post(f"/api/apoyos/{a['id']}/consumir", headers=admin)  # consume 100
    assert reactivar(client, admin, f"/api/apoyos/{a['id']}/devoluciones/{d1}").status_code == 400
    # al reabrir hay espacio otra vez
    assert client.post(f"/api/apoyos/{a['id']}/reabrir", headers=admin).status_code == 200
    assert reactivar(client, admin, f"/api/apoyos/{a['id']}/devoluciones/{d1}").status_code == 200


def test_editar_apoyo_monto_minimo(client, admin):
    a = apoyo(client, admin, 500)
    dev(client, admin, a["id"], 200)
    client.post(f"/api/apoyos/{a['id']}/consumir", headers=admin)  # consume 300
    r = client.patch(f"/api/apoyos/{a['id']}", headers=admin, json={"monto": 499.99})
    assert r.status_code == 400 and "500.00" in r.json()["detail"]
    r = client.patch(
        f"/api/apoyos/{a['id']}", headers=admin,
        json={"monto": 500, "beneficiario": "Rosa Mamani", "fecha": "2025-02-01", "nota": "n"},
    )
    assert r.status_code == 200
    j = r.json()
    assert (j["beneficiario"], j["fecha"], j["nota"]) == ("Rosa Mamani", "2025-02-01", "n")
    assert j["editado_por_nombre"] == "Admin" and j["estado"] == "Cerrado"
    # subir el monto: el aumento queda pendiente
    r = client.patch(f"/api/apoyos/{a['id']}", headers=admin, json={"monto": 600}).json()
    assert r["pendiente"] == 100 and r["estado"] == "Pendiente"


def test_editar_devolucion_limites(client, admin):
    a = apoyo(client, admin, 500)
    d1 = dev(client, admin, a["id"], 100).json()["devoluciones"][0]["id"]
    dev(client, admin, a["id"], 150)
    client.post(f"/api/apoyos/{a['id']}/consumir", headers=admin)  # consume 250
    # monto 500 = d1 100 + d2 150 + consumido 250: d1 no puede crecer (maximo = 500 - 250 - 150 = 100)
    ruta = f"/api/apoyos/{a['id']}/devoluciones/{d1}"
    assert client.patch(ruta, headers=admin, json={"monto": 101}).status_code == 400
    assert client.patch(ruta, headers=admin, json={"monto": 60, "nota": "x", "fecha": "2025-03-03"}).status_code == 200
    r = client.get(f"/api/apoyos/{a['id']}", headers=admin).json()
    assert r["devuelto"] == 210 and r["consumido"] == 250 and r["pendiente"] == 40
    # el maximo sigue siendo 100 aunque ahora valga 60
    assert client.patch(ruta, headers=admin, json={"monto": 101}).status_code == 400
    ok = client.patch(ruta, headers=admin, json={"monto": 100}).json()
    assert ok["pendiente"] == 0
    assert ok["devoluciones"][0]["editado_por_nombre"] == "Admin"
    # nunca devuelto + consumido > monto
    assert ok["devuelto"] + ok["consumido"] <= ok["monto"]


def test_reabrir_apoyo_consumido(client, admin):
    a = apoyo(client, admin, 400)
    dev(client, admin, a["id"], 100)
    assert client.post(f"/api/apoyos/{a['id']}/reabrir", headers=admin).status_code == 400  # nada consumido
    client.post(f"/api/apoyos/{a['id']}/consumir", headers=admin)
    assert resumen(client, admin)["consumido"] == 300
    r = client.post(f"/api/apoyos/{a['id']}/reabrir", headers=admin).json()
    assert (r["estado"], r["consumido"], r["pendiente"]) == ("Pendiente", 0, 300)
    assert resumen(client, admin)["consumido"] == 0
    assert r["editado_por_nombre"] == "Admin"


def test_permisos_apoyos_y_devoluciones(client, admin, miembro):
    a_admin = apoyo(client, admin, 300)["id"]
    a_mio = apoyo(client, miembro, 300)["id"]
    base = f"/api/apoyos/{a_admin}"
    # el miembro no modifica el apoyo del admin
    assert client.patch(base, headers=miembro, json={"nota": "x"}).status_code == 403
    assert anular(client, miembro, base).status_code == 403
    assert client.post(f"{base}/consumir", headers=miembro).status_code == 403
    assert client.post(f"{base}/reabrir", headers=miembro).status_code == 403
    anular(client, admin, base)
    assert reactivar(client, miembro, base).status_code == 403
    reactivar(client, admin, base)

    # cualquier miembro puede registrar una devolucion; edita/anula solo la suya
    d_miembro = dev(client, miembro, a_admin, 50).json()["devoluciones"][0]["id"]
    d_admin = dev(client, admin, a_admin, 40).json()["devoluciones"][1]["id"]
    r_m, r_a = f"{base}/devoluciones/{d_miembro}", f"{base}/devoluciones/{d_admin}"
    assert client.patch(r_m, headers=miembro, json={"monto": 55}).status_code == 200
    assert client.patch(r_a, headers=miembro, json={"monto": 1}).status_code == 403
    assert anular(client, miembro, r_a).status_code == 403
    assert anular(client, miembro, r_m).status_code == 200
    assert reactivar(client, miembro, r_m).status_code == 200
    # el admin toca todo
    assert anular(client, admin, r_m).status_code == 200
    assert reactivar(client, admin, r_m).status_code == 200
    assert client.patch(r_m, headers=admin, json={"monto": 50}).status_code == 200
    # el miembro si gestiona su propio apoyo
    mio = f"/api/apoyos/{a_mio}"
    assert client.post(f"{mio}/consumir", headers=miembro).status_code == 200
    assert client.post(f"{mio}/reabrir", headers=miembro).status_code == 200
    assert anular(client, miembro, mio).status_code == 200
    assert reactivar(client, miembro, mio).status_code == 200


def test_aislamiento_de_familias_en_acciones_nuevas(client, admin, categoria_id):
    from tests.conftest import registrar

    otro = registrar(client, email="otro@t.com", familia="Otra")
    m = gasto(client, admin, categoria_id)
    a = apoyo(client, admin)
    assert anular(client, otro, f"/api/movimientos/{m['id']}").status_code == 404
    assert reactivar(client, otro, f"/api/movimientos/{m['id']}").status_code == 404
    assert anular(client, otro, f"/api/apoyos/{a['id']}").status_code == 404
    assert client.post(f"/api/apoyos/{a['id']}/reabrir", headers=otro).status_code == 404
    assert client.get(f"/api/movimientos/{m['id']}", headers=otro).status_code == 404


# ---------------------------------------------------------------- idempotencia
def test_idempotencia_movimientos(client, admin, categoria_id):
    u = str(uuid.uuid4())
    cuerpo = {"tipo": "gasto", "monto": 20, "categoria_id": categoria_id, "uuid_cliente": u}
    r1 = client.post("/api/movimientos", headers=admin, json=cuerpo)
    r2 = client.post("/api/movimientos", headers=admin, json={**cuerpo, "monto": 999})
    assert r1.status_code == 201 and r2.status_code == 200
    assert r1.json()["id"] == r2.json()["id"] and r2.json()["monto"] == 20
    assert len(client.get("/api/movimientos", headers=admin).json()) == 1
    # otro UUID = otro registro; sin UUID siempre crea
    cuerpo["uuid_cliente"] = str(uuid.uuid4())
    assert client.post("/api/movimientos", headers=admin, json=cuerpo).status_code == 201
    assert len(client.get("/api/movimientos", headers=admin).json()) == 2
    assert client.post("/api/movimientos", headers=admin, json={"tipo": "gasto", "monto": 1, "categoria_id": categoria_id, "uuid_cliente": "no-es-uuid"}).status_code == 422


def test_anulado_no_se_reactiva_al_reenviar(client, admin, categoria_id):
    u = str(uuid.uuid4())
    cuerpo = {"tipo": "gasto", "monto": 20, "categoria_id": categoria_id, "uuid_cliente": u}
    mid = client.post("/api/movimientos", headers=admin, json=cuerpo).json()["id"]
    anular(client, admin, f"/api/movimientos/{mid}")
    r = client.post("/api/movimientos", headers=admin, json=cuerpo)
    assert r.status_code == 200 and r.json()["anulado"] is True
    assert client.get("/api/movimientos", headers=admin).json() == []
    assert resumen(client, admin)["gastos"] == 0
    # apoyos igual
    ua = str(uuid.uuid4())
    cuerpo_a = {"beneficiario": "Luis", "monto": 80, "uuid_cliente": ua}
    aid = client.post("/api/apoyos", headers=admin, json=cuerpo_a).json()["id"]
    anular(client, admin, f"/api/apoyos/{aid}")
    r = client.post("/api/apoyos", headers=admin, json=cuerpo_a)
    assert r.status_code == 200 and r.json()["anulado"] is True and r.json()["id"] == aid
    assert len(client.get("/api/apoyos?ver_anulados=true", headers=admin).json()) == 1


def test_idempotencia_apoyos_y_devoluciones(client, admin):
    ua = str(uuid.uuid4())
    c = {"beneficiario": "Luis", "monto": 200, "uuid_cliente": ua}
    a1 = client.post("/api/apoyos", headers=admin, json=c)
    a2 = client.post("/api/apoyos", headers=admin, json=c)
    assert (a1.status_code, a2.status_code) == (201, 200) and a1.json()["id"] == a2.json()["id"]
    aid = a1.json()["id"]

    ud = str(uuid.uuid4())
    d1 = dev(client, admin, aid, 50, uuid_cliente=ud)
    d2 = dev(client, admin, aid, 50, uuid_cliente=ud)
    assert (d1.status_code, d2.status_code) == (201, 200)
    assert d2.json()["devuelto"] == 50 and len(d2.json()["devoluciones"]) == 1

    # una devolucion anulada que se reenvia no se reactiva ni se duplica
    did = d1.json()["devoluciones"][0]["id"]
    anular(client, admin, f"/api/apoyos/{aid}/devoluciones/{did}")
    d3 = dev(client, admin, aid, 50, uuid_cliente=ud)
    assert d3.status_code == 200 and d3.json()["devuelto"] == 0
    assert apoyo_por_id(client, admin, aid)["devoluciones_activas"] == 0


# ---------------------------------------------------------------- lista completa
def test_lista_completa_filtros_y_paginacion(client, admin, miembro, categoria_id):
    otra = client.get("/api/categorias", headers=admin).json()[1]["id"]
    gasto(client, admin, categoria_id, 10, fecha=f"{MES}-01", nota="g1")
    gasto(client, miembro, otra, 20, fecha=f"{MES}-02", nota="g2")
    ingreso(client, admin, 500, fecha=f"{MES}-03")
    apoyo(client, miembro, 100, "Luis", fecha=f"{MES}-04")
    gasto(client, admin, categoria_id, 5, fecha="2020-01-10", nota="viejo")

    todo = client.get("/api/actividad?limite=100", headers=admin).json()
    assert todo["total"] == 5 and not todo["hay_mas"]
    assert [i["fecha"] for i in todo["items"]] == sorted((i["fecha"] for i in todo["items"]), reverse=True)

    def pedir(q):
        return client.get(f"/api/actividad?{q}", headers=admin).json()

    assert pedir(f"mes={MES}")["total"] == 4
    assert pedir("mes=2020-01")["total"] == 1
    assert [i["tipo"] for i in pedir(f"mes={MES}&tipo=apoyo")["items"]] == ["apoyo"]
    assert pedir(f"mes={MES}&tipo=ingreso")["total"] == 1
    assert pedir(f"mes={MES}&tipo=gasto")["total"] == 2
    cat = pedir(f"categoria={categoria_id}")
    assert cat["total"] == 2 and all(i["clase"] == "movimiento" for i in cat["items"])
    uid = client.get("/api/auth/yo", headers=miembro).json()["id"]
    mio = pedir(f"usuario={uid}")
    assert mio["total"] == 2 and {i["usuario_nombre"] for i in mio["items"]} == {"Miembro"}

    p1 = pedir("limite=2&desplazamiento=0")
    p2 = pedir("limite=2&desplazamiento=2")
    p3 = pedir("limite=2&desplazamiento=4")
    assert (len(p1["items"]), p1["hay_mas"]) == (2, True)
    assert (len(p2["items"]), p2["hay_mas"]) == (2, True)
    assert (len(p3["items"]), p3["hay_mas"]) == (1, False)
    ids = [(i["clase"], i["id"]) for p in (p1, p2, p3) for i in p["items"]]
    assert len(set(ids)) == 5  # sin repetidos entre paginas


def test_lista_completa_ver_anulados(client, admin, categoria_id):
    g = gasto(client, admin, categoria_id, 10, nota="x")
    a = apoyo(client, admin, 100, "Luis")
    anular(client, admin, f"/api/movimientos/{g['id']}", "duplicado")
    anular(client, admin, f"/api/apoyos/{a['id']}")
    assert client.get("/api/actividad", headers=admin).json()["total"] == 0
    r = client.get("/api/actividad?ver_anulados=true", headers=admin).json()
    assert r["total"] == 2 and all(i["anulado"] for i in r["items"])
    mov = next(i for i in r["items"] if i["clase"] == "movimiento")
    assert mov["anulado_por_nombre"] == "Admin" and mov["motivo_anulacion"] == "duplicado" and mov["anulado_en"]
    apo = next(i for i in r["items"] if i["clase"] == "apoyo")
    assert apo["estado"] == "Anulado"


# ---------------------------------------------------------------- miembros y perfil
def crear_miembro(client, admin, email, nombre="Otro", rol="miembro", password="secreto1"):
    r = client.post("/api/familia/invitar", headers=admin, json={"nombre": nombre, "email": email, "password": password, "rol": rol})
    assert r.status_code == 201, r.text
    return r.json()["usuario_id"]


def login(client, email, password="secreto1"):
    return client.post("/api/auth/login", json={"email": email, "password": password})


def test_cambiar_rol_y_ultimo_admin(client, admin):
    miembros = client.get("/api/familia/miembros", headers=admin).json()
    yo_id = miembros[0]["usuario_id"]
    # unico admin: no se puede degradar ni desactivar
    assert client.patch(f"/api/familia/miembros/{yo_id}", headers=admin, json={"rol": "miembro"}).status_code == 400
    assert client.patch(f"/api/familia/miembros/{yo_id}", headers=admin, json={"activo": False}).status_code == 400
    otro = crear_miembro(client, admin, "dos@t.com")
    r = client.patch(f"/api/familia/miembros/{otro}", headers=admin, json={"rol": "admin"})
    assert r.status_code == 200 and r.json()["rol"] == "admin"
    # con dos admins se puede degradar a uno...
    assert client.patch(f"/api/familia/miembros/{yo_id}", headers=admin, json={"rol": "miembro"}).status_code == 200
    # ...pero el que queda es el ultimo (el "admin" original ya es miembro y pierde permisos)
    h2 = {"Authorization": f"Bearer {login(client, 'dos@t.com').json()['access_token']}"}
    assert client.patch(f"/api/familia/miembros/{otro}", headers=h2, json={"rol": "miembro"}).status_code == 400
    assert client.patch(f"/api/familia/miembros/{otro}", headers=h2, json={"activo": False}).status_code == 400
    assert client.patch(f"/api/familia/miembros/{yo_id}", headers=admin, json={"activo": False}).status_code == 403  # ya no es admin


def test_ultimo_admin_activo_cuenta_solo_activos(client, admin):
    yo_id = client.get("/api/familia/miembros", headers=admin).json()[0]["usuario_id"]
    otro = crear_miembro(client, admin, "dos@t.com", rol="admin")
    assert client.patch(f"/api/familia/miembros/{otro}", headers=admin, json={"activo": False}).status_code == 200
    # el otro admin esta desactivado: yo vuelvo a ser el ultimo admin activo
    assert client.patch(f"/api/familia/miembros/{yo_id}", headers=admin, json={"activo": False}).status_code == 400
    assert client.patch(f"/api/familia/miembros/{yo_id}", headers=admin, json={"rol": "miembro"}).status_code == 400


def test_miembro_desactivado_no_entra_y_sus_datos_cuentan(client, admin, categoria_id):
    uid = crear_miembro(client, admin, "hijo@t.com", nombre="Hijo")
    h = {"Authorization": f"Bearer {login(client, 'hijo@t.com').json()['access_token']}"}
    gasto(client, h, categoria_id, 70, nota="del hijo")
    apoyo(client, h, 30, "Luis")
    antes = resumen(client, admin)
    assert antes["gastos"] == 70

    r = client.patch(f"/api/familia/miembros/{uid}", headers=admin, json={"activo": False})
    assert r.status_code == 200 and r.json()["activo"] is False
    l = login(client, "hijo@t.com")
    assert l.status_code == 403 and "desactivada" in l.json()["detail"]
    assert client.get("/api/auth/yo", headers=h).status_code == 401  # su token deja de servir
    assert client.get("/api/movimientos", headers=h).status_code == 401

    # sus datos se conservan y cuentan igual
    despues = resumen(client, admin)
    assert despues["gastos"] == 70 and despues["apoyos_entregados"] == 30
    movs = client.get("/api/movimientos", headers=admin).json()
    assert movs[0]["usuario_nombre"] == "Hijo"
    miembros = client.get("/api/familia/miembros", headers=admin).json()
    assert any(m["usuario_id"] == uid and not m["activo"] for m in miembros)
    pm = client.get(f"/api/reportes/por-miembro?mes={MES}", headers=admin).json()["miembros"]
    assert any(m["nombre"] == "Hijo" and m["gastos"] == 70 for m in pm)

    # reactivar
    assert client.patch(f"/api/familia/miembros/{uid}", headers=admin, json={"activo": True}).json()["activo"] is True
    assert login(client, "hijo@t.com").status_code == 200


def test_permisos_de_gestion_de_miembros(client, admin, miembro):
    miembros = client.get("/api/familia/miembros", headers=admin).json()
    admin_id, miembro_id = miembros[0]["usuario_id"], miembros[1]["usuario_id"]
    assert client.patch(f"/api/familia/miembros/{admin_id}", headers=miembro, json={"activo": False}).status_code == 403
    assert client.patch(f"/api/familia/miembros/{miembro_id}", headers=miembro, json={"rol": "admin"}).status_code == 403
    assert client.post(f"/api/familia/miembros/{admin_id}/restablecer-clave", headers=miembro).status_code == 403
    assert client.patch("/api/familia/miembros/99999", headers=admin, json={"activo": False}).status_code == 404


def test_miembros_de_otra_familia_no_se_tocan(client, admin):
    from tests.conftest import registrar

    otro = registrar(client, email="otro@t.com", familia="Otra")
    ajeno = client.get("/api/familia/miembros", headers=otro).json()[0]["usuario_id"]
    assert client.patch(f"/api/familia/miembros/{ajeno}", headers=admin, json={"activo": False}).status_code == 404
    assert client.post(f"/api/familia/miembros/{ajeno}/restablecer-clave", headers=admin).status_code == 404


def test_restablecer_clave_temporal(client, admin):
    uid = crear_miembro(client, admin, "hijo@t.com")
    r = client.post(f"/api/familia/miembros/{uid}/restablecer-clave", headers=admin)
    assert r.status_code == 200
    temporal = r.json()["clave_temporal"]
    assert len(temporal) >= 6
    assert login(client, "hijo@t.com", "secreto1").status_code == 401  # la anterior ya no sirve
    assert login(client, "hijo@t.com", temporal).status_code == 200


def test_perfil_cambiar_nombre_y_clave(client, admin):
    r = client.patch("/api/auth/yo", headers=admin, json={"nombre": "Nuevo Nombre"})
    assert r.status_code == 200 and r.json()["nombre"] == "Nuevo Nombre"
    assert client.get("/api/auth/yo", headers=admin).json()["nombre"] == "Nuevo Nombre"
    assert client.patch("/api/auth/yo", headers=admin, json={"nombre": ""}).status_code == 422

    mala = client.post("/api/auth/cambiar-clave", headers=admin, json={"clave_actual": "incorrecta", "clave_nueva": "otraclave1"})
    assert mala.status_code == 400  # 400, no 401: no cierra la sesion
    assert client.get("/api/auth/yo", headers=admin).status_code == 200
    corta = client.post("/api/auth/cambiar-clave", headers=admin, json={"clave_actual": "secreto1", "clave_nueva": "123"})
    assert corta.status_code == 422
    ok = client.post("/api/auth/cambiar-clave", headers=admin, json={"clave_actual": "secreto1", "clave_nueva": "otraclave1"})
    assert ok.status_code == 204
    assert login(client, "admin@t.com", "secreto1").status_code == 401
    assert login(client, "admin@t.com", "otraclave1").status_code == 200
    assert client.post("/api/auth/cambiar-clave", json={"clave_actual": "a", "clave_nueva": "bbbbbbb"}).status_code == 401
