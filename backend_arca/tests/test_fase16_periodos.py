"""Fase 16 - Periodos: calculo puro (tablas de casos), zona horaria La Paz, filtros desde/hasta, saldo del
periodo, comparacion con el anterior y el dia de inicio del mes de la familia."""
from datetime import date, datetime, timedelta, timezone

import pytest

from app.modulos.periodos import calculo
from app.modulos.periodos.calculo import PeriodoInvalido, anterior, calcular, etiqueta, siguiente

D = date.fromisoformat


# ------------------------------------------------------------------ funciones puras
CASOS_MES = [
    # (dia_inicio_mes, referencia, desde, hasta)
    (1, "2026-11-08", "2026-11-01", "2026-11-30"),
    (1, "2026-11-01", "2026-11-01", "2026-11-30"),  # primer dia
    (1, "2026-11-30", "2026-11-01", "2026-11-30"),  # ultimo dia
    (1, "2026-12-31", "2026-12-01", "2026-12-31"),  # diciembre
    (1, "2027-01-01", "2027-01-01", "2027-01-31"),  # cambio de anio
    (1, "2026-02-14", "2026-02-01", "2026-02-28"),  # febrero comun
    (1, "2028-02-29", "2028-02-01", "2028-02-29"),  # bisiesto
    (1, "2100-02-10", "2100-02-01", "2100-02-28"),  # 2100 NO es bisiesto
    (15, "2026-11-14", "2026-10-15", "2026-11-14"),  # ultimo dia de su periodo
    (15, "2026-11-15", "2026-11-15", "2026-12-14"),  # primer dia del siguiente
    (15, "2026-12-20", "2026-12-15", "2027-01-14"),  # cruza el anio hacia adelante
    (15, "2027-01-10", "2026-12-15", "2027-01-14"),  # cruza el anio hacia atras
    (15, "2026-01-01", "2025-12-15", "2026-01-14"),
    (15, "2026-02-20", "2026-02-15", "2026-03-14"),
    (28, "2026-02-27", "2026-01-28", "2026-02-27"),  # febrero: termina el 27
    (28, "2026-02-28", "2026-02-28", "2026-03-27"),
    (28, "2028-02-28", "2028-02-28", "2028-03-27"),  # bisiesto: el 29 sigue dentro
    (28, "2028-02-29", "2028-02-28", "2028-03-27"),
    (28, "2026-12-28", "2026-12-28", "2027-01-27"),
    (28, "2027-01-27", "2026-12-28", "2027-01-27"),
    (28, "2026-11-08", "2026-10-28", "2026-11-27"),
]


@pytest.mark.parametrize("dia,ref,desde,hasta", CASOS_MES)
def test_mes_con_dia_de_inicio(dia, ref, desde, hasta):
    assert calcular("mes", D(ref), dia) == (D(desde), D(hasta))


CASOS_SEMANA = [
    ("2026-11-08", "2026-11-02", "2026-11-08"),  # domingo: cierra su semana
    ("2026-11-02", "2026-11-02", "2026-11-08"),  # lunes: la abre
    ("2026-11-05", "2026-11-02", "2026-11-08"),
    ("2026-10-29", "2026-10-26", "2026-11-01"),  # cruza de mes
    ("2026-12-31", "2026-12-28", "2027-01-03"),  # cruza de anio
    ("2028-02-29", "2028-02-28", "2028-03-05"),  # bisiesto
]


@pytest.mark.parametrize("ref,desde,hasta", CASOS_SEMANA)
def test_semana_de_lunes_a_domingo(ref, desde, hasta):
    d, h = calcular("semana", D(ref))
    assert (d, h) == (D(desde), D(hasta))
    assert d.weekday() == 0 and h.weekday() == 6


@pytest.mark.parametrize(
    "ref,desde,hasta",
    [("2026-11-08", "2026-01-01", "2026-12-31"), ("2028-02-29", "2028-01-01", "2028-12-31"), ("2026-01-01", "2026-01-01", "2026-12-31"), ("2026-12-31", "2026-01-01", "2026-12-31")],
)
def test_anio(ref, desde, hasta):
    assert calcular("anio", D(ref)) == (D(desde), D(hasta))
    assert calcular("anio", D(ref), 15) == (D(desde), D(hasta))  # el dia de inicio no cambia el anio


def test_dia_y_rango():
    assert calcular("dia", D("2026-11-08")) == (D("2026-11-08"), D("2026-11-08"))
    assert calcular("rango", D("2026-01-01"), 1, D("2026-10-01"), D("2026-11-15")) == (D("2026-10-01"), D("2026-11-15"))
    assert calcular("rango", D("2026-01-01"), 1, D("2026-10-01"), D("2026-10-01")) == (D("2026-10-01"), D("2026-10-01"))


@pytest.mark.parametrize(
    "args",
    [
        ("rango", D("2026-11-08"), 1, None, None),
        ("rango", D("2026-11-08"), 1, D("2026-11-02"), None),
        ("rango", D("2026-11-08"), 1, D("2026-11-09"), D("2026-11-08")),  # desde > hasta
        ("mes", D("2026-11-08"), 0),
        ("mes", D("2026-11-08"), 29),
        ("mes", D("2026-11-08"), -3),
        ("trimestre", D("2026-11-08"), 1),
    ],
)
def test_periodos_invalidos(args):
    with pytest.raises(PeriodoInvalido):
        calcular(*args)


def test_anterior_y_siguiente_por_tipo():
    # mes calendario, cambio de anio
    assert anterior("mes", D("2026-01-01"), D("2026-01-31")) == (D("2025-12-01"), D("2025-12-31"))
    assert siguiente("mes", D("2026-12-01"), D("2026-12-31")) == (D("2027-01-01"), D("2027-01-31"))
    # mes con dia de inicio 15 y 28
    assert anterior("mes", D("2026-10-15"), D("2026-11-14"), 15) == (D("2026-09-15"), D("2026-10-14"))
    assert siguiente("mes", D("2026-10-15"), D("2026-11-14"), 15) == (D("2026-11-15"), D("2026-12-14"))
    assert anterior("mes", D("2026-03-28"), D("2026-04-27"), 28) == (D("2026-02-28"), D("2026-03-27"))
    # febrero y bisiesto
    assert siguiente("mes", D("2028-01-01"), D("2028-01-31")) == (D("2028-02-01"), D("2028-02-29"))
    assert anterior("mes", D("2028-03-01"), D("2028-03-31")) == (D("2028-02-01"), D("2028-02-29"))
    # semana, dia, anio
    assert anterior("semana", D("2026-11-02"), D("2026-11-08")) == (D("2026-10-26"), D("2026-11-01"))
    assert siguiente("semana", D("2026-12-28"), D("2027-01-03")) == (D("2027-01-04"), D("2027-01-10"))
    assert anterior("dia", D("2026-03-01"), D("2026-03-01")) == (D("2026-02-28"), D("2026-02-28"))
    assert siguiente("dia", D("2026-12-31"), D("2026-12-31")) == (D("2027-01-01"), D("2027-01-01"))
    assert anterior("anio", D("2026-01-01"), D("2026-12-31")) == (D("2025-01-01"), D("2025-12-31"))
    assert siguiente("anio", D("2026-01-01"), D("2026-12-31")) == (D("2027-01-01"), D("2027-12-31"))
    # rango: mismo largo, pegado
    assert anterior("rango", D("2026-11-10"), D("2026-11-19")) == (D("2026-10-31"), D("2026-11-09"))
    assert siguiente("rango", D("2026-11-10"), D("2026-11-19")) == (D("2026-11-20"), D("2026-11-29"))


@pytest.mark.parametrize("dia", [1, 15, 28])
@pytest.mark.parametrize("tipo", ["dia", "semana", "mes", "anio"])
def test_los_periodos_encajan_sin_huecos_ni_solapes(tipo, dia):
    """Para cada dia de 4 anios (con 2028 bisiesto): el periodo lo contiene y el siguiente del anterior es el mismo."""
    ref = D("2026-01-01")
    paso = 1 if tipo in ("dia", "semana", "mes") else 7
    while ref < D("2030-01-01"):
        d, h = calcular(tipo, ref, dia)
        assert d <= ref <= h
        ad, ah = anterior(tipo, d, h, dia)
        assert ah == d - timedelta(days=1)
        assert siguiente(tipo, ad, ah, dia) == (d, h)
        sd, sh = siguiente(tipo, d, h, dia)
        assert sd == h + timedelta(days=1)
        assert anterior(tipo, sd, sh, dia) == (d, h)
        ref += timedelta(days=paso)


def test_mismo_largo_anterior():
    assert calculo.mismo_largo_anterior(D("2026-11-01"), D("2026-11-30")) == (D("2026-10-02"), D("2026-10-31"))
    assert calculo.mismo_largo_anterior(D("2026-11-08"), D("2026-11-08")) == (D("2026-11-07"), D("2026-11-07"))


def test_etiquetas_legibles():
    assert etiqueta("mes", D("2026-11-01"), D("2026-11-30")) == "Noviembre 2026"
    assert etiqueta("mes", D("2026-10-28"), D("2026-11-27"), 28) == "28 oct - 27 nov"
    assert etiqueta("anio", D("2026-01-01"), D("2026-12-31")) == "2026"
    assert etiqueta("dia", D("2026-11-08"), D("2026-11-08")) == "8 nov 2026"
    assert etiqueta("semana", D("2026-11-02"), D("2026-11-08")) == "2 nov - 8 nov 2026"
    assert etiqueta("rango", D("2026-10-01"), D("2026-11-15")) == "1 oct - 15 nov 2026"
    assert etiqueta("rango", D("2026-12-20"), D("2027-01-05")) == "20 dic 2026 - 5 ene 2027"


# ------------------------------------------------------------------ zona horaria (America/La_Paz = UTC-4)
UTC = timezone.utc


@pytest.mark.parametrize(
    "instante_utc,dia_local",
    [
        (datetime(2026, 11, 9, 1, 0, tzinfo=UTC), "2026-11-08"),  # 21:00 del 8 en La Paz (en UTC ya es el 9)
        (datetime(2026, 11, 8, 4, 30, tzinfo=UTC), "2026-11-08"),  # 00:30 del 8 en La Paz
        (datetime(2026, 11, 8, 3, 59, tzinfo=UTC), "2026-11-07"),  # 23:59 del 7
        (datetime(2026, 11, 8, 4, 0, tzinfo=UTC), "2026-11-08"),  # 00:00 del 8
        (datetime(2027, 1, 1, 3, 0, tzinfo=UTC), "2026-12-31"),  # cambio de anio visto desde La Paz
        (datetime(2026, 11, 8, 23, 59, tzinfo=UTC), "2026-11-08"),
    ],
)
def test_fecha_local_de_la_paz(instante_utc, dia_local):
    assert calculo.fecha_local(instante_utc) == D(dia_local)


def test_fecha_local_acepta_otra_zona_y_naive_como_utc():
    mexico = timezone(timedelta(hours=-6))
    assert calculo.fecha_local(datetime(2026, 11, 8, 21, 30, tzinfo=mexico)) == D("2026-11-08")  # 23:30 del 8 en La Paz
    assert calculo.fecha_local(datetime(2026, 11, 8, 23, 30, tzinfo=mexico)) == D("2026-11-09")  # 01:30 del 9 en La Paz
    assert calculo.fecha_local(datetime(2026, 11, 9, 1, 0)) == D("2026-11-08")


@pytest.fixture
def reloj(monkeypatch):
    """Fija el reloj del servidor: reloj(datetime_utc)."""

    def fijar(instante: datetime):
        monkeypatch.setattr(calculo, "ahora_utc", lambda: instante)

    return fijar


def test_hoy_usa_la_paz_y_no_utc(reloj):
    reloj(datetime(2026, 11, 9, 1, 0, tzinfo=UTC))  # 21:00 del 8 en La Paz
    assert calculo.hoy_la_paz() == D("2026-11-08")
    reloj(datetime(2026, 11, 8, 4, 30, tzinfo=UTC))  # 00:30 del 8
    assert calculo.hoy_la_paz() == D("2026-11-08")


@pytest.mark.parametrize(
    "instante_utc,dia_local",
    [(datetime(2026, 11, 9, 1, 0, tzinfo=UTC), "2026-11-08"), (datetime(2026, 11, 8, 4, 30, tzinfo=UTC), "2026-11-08")],
)
def test_movimiento_sin_fecha_cae_en_el_dia_local(client, admin, categoria_id, reloj, instante_utc, dia_local):
    """A las 21:00 y a las 00:30 de La Paz el movimiento sin fecha explicita queda en el dia LOCAL."""
    reloj(instante_utc)
    r = client.post("/api/movimientos", headers=admin, json={"tipo": "gasto", "monto": 10, "categoria_id": categoria_id})
    assert r.status_code == 201
    assert r.json()["fecha"] == dia_local
    a = client.post("/api/apoyos", headers=admin, json={"beneficiario": "Tia", "monto": 10}).json()
    assert a["fecha"] == dia_local
    # y cae dentro del "hoy" y del mes de La Paz
    p = client.get("/api/periodos/actual?tipo=dia", headers=admin).json()
    assert p["desde"] == dia_local == p["hasta"]
    lista = client.get(f"/api/movimientos?desde={p['desde']}&hasta={p['hasta']}", headers=admin).json()
    assert len(lista) == 1


def test_el_mes_de_la_paz_no_salta_al_mes_utc(client, admin, categoria_id, reloj):
    reloj(datetime(2026, 12, 1, 2, 0, tzinfo=UTC))  # 22:00 del 30 de noviembre en La Paz
    p = client.get("/api/periodos/actual?tipo=mes", headers=admin).json()
    assert (p["desde"], p["hasta"], p["etiqueta"]) == ("2026-11-01", "2026-11-30", "Noviembre 2026")
    assert p["hoy"] == "2026-11-30" and p["es_actual"] is True
    r = client.get("/api/reportes/resumen", headers=admin).json()
    assert r["mes"] == "2026-11"


# ------------------------------------------------------------------ GET /periodos/actual
def test_periodos_actual_mes(client, admin, reloj):
    reloj(datetime(2026, 11, 8, 15, 0, tzinfo=UTC))
    p = client.get("/api/periodos/actual?tipo=mes", headers=admin).json()
    assert p["etiqueta"] == "Noviembre 2026" and p["tipo"] == "mes" and p["dia_inicio_mes"] == 1
    assert (p["desde"], p["hasta"]) == ("2026-11-01", "2026-11-30")
    assert p["anterior"] == {"desde": "2026-10-01", "hasta": "2026-10-31", "etiqueta": "Octubre 2026"}
    assert p["siguiente"] == {"desde": "2026-12-01", "hasta": "2026-12-31", "etiqueta": "Diciembre 2026"}
    assert p["es_actual"] is True


def test_periodos_actual_con_referencia_y_sin_ella(client, admin, reloj):
    reloj(datetime(2026, 11, 8, 15, 0, tzinfo=UTC))
    p = client.get("/api/periodos/actual?tipo=mes&referencia=2026-08-20", headers=admin).json()
    assert (p["desde"], p["hasta"], p["es_actual"]) == ("2026-08-01", "2026-08-31", False)
    p = client.get("/api/periodos/actual", headers=admin).json()  # por defecto: mes de hoy
    assert (p["tipo"], p["etiqueta"]) == ("mes", "Noviembre 2026")
    s = client.get("/api/periodos/actual?tipo=semana", headers=admin).json()
    assert (s["desde"], s["hasta"]) == ("2026-11-02", "2026-11-08")
    d = client.get("/api/periodos/actual?tipo=dia", headers=admin).json()
    assert (d["desde"], d["hasta"], d["etiqueta"]) == ("2026-11-08", "2026-11-08", "8 nov 2026")
    a = client.get("/api/periodos/actual?tipo=anio&referencia=2025-06-01", headers=admin).json()
    assert (a["desde"], a["hasta"], a["etiqueta"], a["es_actual"]) == ("2025-01-01", "2025-12-31", "2025", False)


def test_periodos_actual_rango_y_errores(client, admin):
    r = client.get("/api/periodos/actual?tipo=rango&desde=2026-10-01&hasta=2026-10-10", headers=admin).json()
    assert (r["desde"], r["hasta"]) == ("2026-10-01", "2026-10-10")
    assert (r["anterior"]["desde"], r["anterior"]["hasta"]) == ("2026-09-21", "2026-09-30")
    assert (r["siguiente"]["desde"], r["siguiente"]["hasta"]) == ("2026-10-11", "2026-10-20")
    assert client.get("/api/periodos/actual?tipo=rango", headers=admin).status_code == 422
    assert client.get("/api/periodos/actual?tipo=rango&desde=2026-10-10&hasta=2026-10-01", headers=admin).status_code == 422
    assert client.get("/api/periodos/actual?tipo=trimestre", headers=admin).status_code == 422
    assert client.get("/api/periodos/actual?referencia=no-es-fecha", headers=admin).status_code == 422
    assert client.get("/api/periodos/actual").status_code in (401, 403)


# ------------------------------------------------------------------ dia de inicio del mes (familia)
def test_dia_inicio_mes_por_defecto_es_1(client, admin):
    f = client.get("/api/familia", headers=admin).json()
    assert f["dia_inicio_mes"] == 1 and f["nombre"]


def test_solo_el_admin_cambia_el_dia_de_inicio(client, admin, miembro):
    assert client.patch("/api/familia", headers=miembro, json={"dia_inicio_mes": 15}).status_code == 403
    assert client.get("/api/familia", headers=miembro).json()["dia_inicio_mes"] == 1
    r = client.patch("/api/familia", headers=admin, json={"dia_inicio_mes": 15})
    assert r.status_code == 200 and r.json()["dia_inicio_mes"] == 15
    assert client.get("/api/familia", headers=miembro).json()["dia_inicio_mes"] == 15  # todos lo ven


@pytest.mark.parametrize("valor", [0, 29, 31, -1, "x", None])
def test_dia_de_inicio_fuera_de_rango(client, admin, valor):
    assert client.patch("/api/familia", headers=admin, json={"dia_inicio_mes": valor}).status_code == 422
    assert client.get("/api/familia", headers=admin).json()["dia_inicio_mes"] == 1


@pytest.mark.parametrize("valor", [1, 28])
def test_dia_de_inicio_en_los_extremos(client, admin, valor):
    assert client.patch("/api/familia", headers=admin, json={"dia_inicio_mes": valor}).status_code == 200


def test_cambiar_el_dia_queda_en_el_historial(client, admin, miembro):
    fam = client.get("/api/familia", headers=admin).json()["id"]
    client.patch("/api/familia", headers=admin, json={"dia_inicio_mes": 15})
    client.patch("/api/familia", headers=admin, json={"dia_inicio_mes": 15})  # sin cambio: no deja otra entrada
    client.patch("/api/familia", headers=admin, json={"dia_inicio_mes": 28})
    h = client.get(f"/api/historial?entidad=familia&entidad_id={fam}", headers=admin).json()["items"]
    assert [(i["accion"], i["cambios"]) for i in h] == [
        ("editar", {"dia_inicio_mes": {"antes": 1, "despues": 15}}),
        ("editar", {"dia_inicio_mes": {"antes": 15, "despues": 28}}),
    ]
    assert all(i["usuario_nombre"] == "Admin" for i in h)
    # el miembro no ve la actividad global
    assert client.get("/api/historial", headers=miembro).status_code == 403


def test_el_cambio_aparece_en_la_bitacora_con_titulo_legible(client, admin):
    client.patch("/api/familia", headers=admin, json={"dia_inicio_mes": 15})
    client.patch("/api/familia", headers=admin, json={"dia_inicio_mes": 28})
    b = client.get("/api/bitacora?origen=datos", headers=admin).json()
    textos = [str(i) for i in b["items"] if "periodos" in str(i)]
    assert len(textos) == 2
    assert any("Día de inicio del mes: 15 -> 28" in t for t in textos)


def test_un_cambio_rechazado_no_deja_historial(client, admin, miembro):
    fam = client.get("/api/familia", headers=admin).json()["id"]
    client.patch("/api/familia", headers=miembro, json={"dia_inicio_mes": 15})
    client.patch("/api/familia", headers=admin, json={"dia_inicio_mes": 40})
    assert client.get(f"/api/historial?entidad=familia&entidad_id={fam}", headers=admin).json()["items"] == []


def test_el_dia_de_inicio_cambia_el_periodo_y_el_saldo(client, admin, categoria_id, reloj):
    reloj(datetime(2026, 11, 20, 15, 0, tzinfo=UTC))
    for fecha, tipo, monto in [("2026-11-10", "ingreso", 1000), ("2026-11-20", "ingreso", 200)]:
        body = {"tipo": tipo, "monto": monto, "fecha": fecha}
        assert client.post("/api/movimientos", headers=admin, json=body).status_code == 201
    gasto = {"tipo": "gasto", "monto": 30, "fecha": "2026-11-12", "categoria_id": categoria_id}
    assert client.post("/api/movimientos", headers=admin, json=gasto).status_code == 201

    def saldo():
        p = client.get("/api/periodos/actual?tipo=mes", headers=admin).json()
        r = client.get(f"/api/reportes/resumen?desde={p['desde']}&hasta={p['hasta']}", headers=admin).json()
        return p, r["saldo"]

    p, s = saldo()
    assert (p["desde"], p["hasta"]) == ("2026-11-01", "2026-11-30") and s == 1170
    client.patch("/api/familia", headers=admin, json={"dia_inicio_mes": 15})
    p, s = saldo()
    assert (p["desde"], p["hasta"], p["etiqueta"]) == ("2026-11-15", "2026-12-14", "15 nov - 14 dic")
    assert s == 200  # solo cuenta lo del 15 de noviembre en adelante
    assert p["anterior"]["etiqueta"] == "15 oct - 14 nov"
    # nada se movio ni se cerro: el filtro por mes calendario sigue dando lo mismo que antes
    assert client.get("/api/reportes/resumen?mes=2026-11", headers=admin).json()["saldo"] == 1170


# ------------------------------------------------------------------ desde / hasta en movimientos y lista completa
def _mov(client, h, tipo, monto, fecha, cat=None):
    body = {"tipo": tipo, "monto": monto, "fecha": fecha}
    if cat:
        body["categoria_id"] = cat
    r = client.post("/api/movimientos", headers=h, json=body)
    assert r.status_code == 201, r.text
    return r.json()


@pytest.fixture
def mov_fechas(client, admin, categoria_id):
    for f in ["2026-10-31", "2026-11-01", "2026-11-15", "2026-11-30", "2026-12-01"]:
        _mov(client, admin, "gasto", 10, f, categoria_id)


def fechas(r):
    return sorted(m["fecha"] for m in r.json())


def test_movimientos_desde_hasta_son_inclusivos(client, admin, mov_fechas):
    r = client.get("/api/movimientos?desde=2026-11-01&hasta=2026-11-30", headers=admin)
    assert fechas(r) == ["2026-11-01", "2026-11-15", "2026-11-30"]
    assert fechas(client.get("/api/movimientos?desde=2026-11-15&hasta=2026-11-15", headers=admin)) == ["2026-11-15"]
    assert fechas(client.get("/api/movimientos?desde=2026-11-30", headers=admin)) == ["2026-11-30", "2026-12-01"]
    assert fechas(client.get("/api/movimientos?hasta=2026-11-01", headers=admin)) == ["2026-10-31", "2026-11-01"]


def test_movimientos_mes_sigue_funcionando(client, admin, mov_fechas):
    assert fechas(client.get("/api/movimientos?mes=2026-11", headers=admin)) == ["2026-11-01", "2026-11-15", "2026-11-30"]
    assert len(client.get("/api/movimientos", headers=admin).json()) == 5
    # desde/hasta mandan sobre mes
    r = client.get("/api/movimientos?mes=2026-11&desde=2026-12-01&hasta=2026-12-31", headers=admin)
    assert fechas(r) == ["2026-12-01"]


def test_desde_mayor_que_hasta_es_error(client, admin):
    assert client.get("/api/movimientos?desde=2026-11-10&hasta=2026-11-01", headers=admin).status_code == 422
    assert client.get("/api/reportes/resumen?desde=2026-11-10&hasta=2026-11-01", headers=admin).status_code == 422
    assert client.get("/api/actividad?desde=2026-11-10&hasta=2026-11-01", headers=admin).status_code == 422


def test_lista_completa_con_desde_hasta(client, admin, categoria_id, mov_fechas):
    client.post("/api/apoyos", headers=admin, json={"beneficiario": "Tia", "monto": 50, "fecha": "2026-11-05"})
    client.post("/api/apoyos", headers=admin, json={"beneficiario": "Tia", "monto": 70, "fecha": "2026-12-05"})
    r = client.get("/api/actividad?desde=2026-11-01&hasta=2026-11-30", headers=admin).json()
    assert sorted(i["fecha"] for i in r["items"]) == ["2026-11-01", "2026-11-05", "2026-11-15", "2026-11-30"]
    assert r["total"] == 4
    assert client.get("/api/actividad?mes=2026-11", headers=admin).json()["total"] == 4


def test_movimientos_anulados_siguen_ocultos_en_el_periodo(client, admin, categoria_id):
    m = _mov(client, admin, "gasto", 10, "2026-11-10", categoria_id)
    client.post(f"/api/movimientos/{m['id']}/anular", headers=admin, json={})
    assert client.get("/api/movimientos?desde=2026-11-01&hasta=2026-11-30", headers=admin).json() == []
    assert len(client.get("/api/movimientos?desde=2026-11-01&hasta=2026-11-30&ver_anulados=true", headers=admin).json()) == 1


# ------------------------------------------------------------------ saldo del periodo
@pytest.fixture
def mundo(client, admin, miembro, categoria_id):
    """Un periodo (nov) con ingresos, gastos, apoyos, devoluciones y anulados, y un periodo anterior (oct)."""
    _mov(client, admin, "ingreso", 1000, "2026-11-02")
    _mov(client, miembro, "ingreso", 500, "2026-11-30")
    _mov(client, admin, "gasto", 100, "2026-11-05", categoria_id)
    anulado = _mov(client, admin, "gasto", 777, "2026-11-06", categoria_id)
    client.post(f"/api/movimientos/{anulado['id']}/anular", headers=admin, json={})
    _mov(client, admin, "ingreso", 9999, "2026-10-31")  # fuera por un dia
    _mov(client, admin, "gasto", 9999, "2026-12-01", categoria_id)  # fuera por un dia
    a1 = client.post("/api/apoyos", headers=admin, json={"beneficiario": "Tia", "monto": 200, "fecha": "2026-11-10"}).json()
    client.post(f"/api/apoyos/{a1['id']}/devoluciones", headers=admin, json={"monto": 50, "fecha": "2026-11-20"})
    dev_anulada = client.post(
        f"/api/apoyos/{a1['id']}/devoluciones", headers=admin, json={"monto": 40, "fecha": "2026-11-21"}
    ).json()["devoluciones"][-1]
    client.post(f"/api/apoyos/{a1['id']}/devoluciones/{dev_anulada['id']}/anular", headers=admin, json={})
    # apoyo de octubre devuelto en noviembre: la devolucion cuenta en noviembre, el apoyo en octubre
    a2 = client.post("/api/apoyos", headers=admin, json={"beneficiario": "Luis", "monto": 300, "fecha": "2026-10-15"}).json()
    client.post(f"/api/apoyos/{a2['id']}/devoluciones", headers=admin, json={"monto": 80, "fecha": "2026-11-03"})
    # apoyo anulado: no cuenta
    a3 = client.post("/api/apoyos", headers=admin, json={"beneficiario": "Ana", "monto": 999, "fecha": "2026-11-12"}).json()
    client.post(f"/api/apoyos/{a3['id']}/anular", headers=admin, json={})
    return {"tia": a1["id"], "luis": a2["id"]}


def test_saldo_del_periodo(client, admin, mundo):
    r = client.get("/api/reportes/resumen?desde=2026-11-01&hasta=2026-11-30", headers=admin).json()
    assert r["ingresos"] == 1500 and r["gastos"] == 100
    assert r["apoyos_entregados"] == 200  # solo el de Tia; el de Luis es de octubre, el de Ana esta anulado
    assert r["devoluciones"] == 130  # 50 (Tia) + 80 (Luis, devuelto en noviembre); la anulada no cuenta
    assert r["saldo"] == 1500 - 100 - 200 + 130
    assert (r["desde"], r["hasta"]) == ("2026-11-01", "2026-11-30")


def test_saldo_de_un_periodo_corto(client, admin, mundo):
    r = client.get("/api/reportes/resumen?desde=2026-11-03&hasta=2026-11-05", headers=admin).json()
    assert r["ingresos"] == 0 and r["gastos"] == 100 and r["devoluciones"] == 80 and r["apoyos_entregados"] == 0
    assert r["saldo"] == -100 + 80
    un_dia = client.get("/api/reportes/resumen?desde=2026-11-02&hasta=2026-11-02", headers=admin).json()
    assert un_dia["saldo"] == 1000


def test_el_pendiente_no_se_corta_por_periodo(client, admin, mundo):
    """Tia: 200 - 50 = 150 pendientes; Luis: 300 - 80 = 220. Siempre acumulado, mire el periodo que mire."""
    esperado = 150 + 220
    sin = client.get("/api/reportes/resumen?mes=2026-11", headers=admin).json()
    con = client.get("/api/reportes/resumen?desde=2025-01-01&hasta=2025-01-31", headers=admin).json()  # un periodo vacio
    assert sin["apoyos_pendientes_total"] == con["apoyos_pendientes_total"] == esperado
    assert sin["apoyos_pendientes_cantidad"] == con["apoyos_pendientes_cantidad"] == 2
    for query in ("", "?desde=2026-11-01&hasta=2026-11-30", "?desde=2025-01-01&hasta=2025-01-31"):
        r = client.get(f"/api/apoyos/resumen{query}", headers=admin).json()
        assert r["total_pendiente"] == esperado


def test_apoyos_resumen_filtra_solo_lo_entregado_y_devuelto_del_periodo(client, admin, mundo):
    r = client.get("/api/apoyos/resumen?desde=2026-11-01&hasta=2026-11-30", headers=admin).json()
    por = {b["beneficiario"]: b for b in r["beneficiarios"]}
    assert set(por) == {"Tia", "Luis"}  # Ana esta anulada
    assert por["Tia"]["entregado_periodo"] == 200 and por["Tia"]["devuelto_periodo"] == 50
    assert por["Luis"]["entregado_periodo"] == 0 and por["Luis"]["devuelto_periodo"] == 80  # su apoyo es de octubre
    assert por["Luis"]["entregado"] == 300 and por["Luis"]["pendiente"] == 220  # acumulado intacto
    assert r["total_entregado_periodo"] == 200 and r["total_devuelto_periodo"] == 130
    # octubre: lo de Luis se entrego ahi, Tia no tiene movimiento pero sigue pendiente (no se oculta)
    o = client.get("/api/apoyos/resumen?desde=2026-10-01&hasta=2026-10-31", headers=admin).json()
    po = {b["beneficiario"]: b for b in o["beneficiarios"]}
    assert po["Luis"]["entregado_periodo"] == 300 and po["Luis"]["devuelto_periodo"] == 0
    assert po["Tia"]["entregado_periodo"] == 0 and po["Tia"]["pendiente"] == 150
    assert o["total_entregado_periodo"] == 300


def test_apoyos_resumen_sin_periodo_no_cambia(client, admin, mundo):
    r = client.get("/api/apoyos/resumen", headers=admin).json()
    assert r["total_entregado"] == 500 and r["total_devuelto"] == 130 and r["total_pendiente"] == 370
    assert r["total_entregado_periodo"] == 500 and r["total_devuelto_periodo"] == 130  # sin periodo = todo


def test_apoyos_resumen_oculta_saldados_sin_actividad_en_el_periodo(client, admin):
    a = client.post("/api/apoyos", headers=admin, json={"beneficiario": "Saldada", "monto": 10, "fecha": "2026-01-10"}).json()
    client.post(f"/api/apoyos/{a['id']}/devoluciones", headers=admin, json={"monto": 10, "fecha": "2026-01-11"})
    assert [b["beneficiario"] for b in client.get("/api/apoyos/resumen", headers=admin).json()["beneficiarios"]] == ["Saldada"]
    r = client.get("/api/apoyos/resumen?desde=2026-11-01&hasta=2026-11-30", headers=admin).json()
    assert r["beneficiarios"] == []
    r = client.get("/api/apoyos/resumen?desde=2026-01-01&hasta=2026-01-31", headers=admin).json()
    assert [b["beneficiario"] for b in r["beneficiarios"]] == ["Saldada"]


def test_apoyos_listar_por_fecha_de_entrega_o_de_devolucion(client, admin, mundo):
    nov = client.get("/api/apoyos?desde=2026-11-01&hasta=2026-11-30", headers=admin).json()
    assert sorted(a["beneficiario"] for a in nov) == ["Luis", "Tia"]  # Luis entra por su devolucion de noviembre
    octubre = client.get("/api/apoyos?desde=2026-10-01&hasta=2026-10-31", headers=admin).json()
    assert [a["beneficiario"] for a in octubre] == ["Luis"]
    dic = client.get("/api/apoyos?desde=2026-12-01&hasta=2026-12-31", headers=admin).json()
    assert dic == []
    assert len(client.get("/api/apoyos", headers=admin).json()) == 2  # sin periodo: todos (menos anulados)


def test_el_periodo_no_cambia_ningun_permiso(client, admin, miembro, mundo):
    # un miembro ve lo mismo que el admin y un periodo viejo no bloquea editar ni anular nada
    r1 = client.get("/api/reportes/resumen?desde=2026-11-01&hasta=2026-11-30", headers=miembro).json()
    r2 = client.get("/api/reportes/resumen?desde=2026-11-01&hasta=2026-11-30", headers=admin).json()
    assert r1 == r2
    m = client.get("/api/movimientos?desde=2026-11-01&hasta=2026-11-30", headers=admin).json()
    suyo = next(x for x in m if x["usuario_nombre"] == "Miembro")
    assert client.patch(f"/api/movimientos/{suyo['id']}", headers=miembro, json={"monto": 600}).status_code == 200
    ajeno = next(x for x in m if x["usuario_nombre"] == "Admin")
    assert client.patch(f"/api/movimientos/{ajeno['id']}", headers=miembro, json={"monto": 1}).status_code == 403
    assert client.patch(f"/api/movimientos/{ajeno['id']}", headers=admin, json={"monto": 1}).status_code == 200


# ------------------------------------------------------------------ comparacion con el periodo anterior
def test_comparacion_con_anterior_distinto_de_cero(client, admin, categoria_id):
    _mov(client, admin, "ingreso", 1000, "2026-10-10")
    _mov(client, admin, "gasto", 200, "2026-10-12", categoria_id)
    _mov(client, admin, "ingreso", 1120, "2026-11-10")
    _mov(client, admin, "gasto", 100, "2026-11-12", categoria_id)
    r = client.get("/api/reportes/resumen?desde=2026-11-01&hasta=2026-11-30", headers=admin).json()
    c = r["comparacion"]
    # el anterior tiene el mismo largo (30 dias): del 2 al 31 de octubre
    assert (c["desde"], c["hasta"]) == ("2026-10-02", "2026-10-31")
    assert c["ingresos"] == {"anterior": 1000, "diferencia": 120, "porcentaje": 12.0}
    assert c["gastos"] == {"anterior": 200, "diferencia": -100, "porcentaje": -50.0}
    assert c["saldo"] == {"anterior": 800, "diferencia": 220, "porcentaje": 27.5}


def test_comparacion_con_anterior_en_cero_no_divide(client, admin, categoria_id):
    _mov(client, admin, "ingreso", 500, "2026-11-10")
    _mov(client, admin, "gasto", 80, "2026-11-12", categoria_id)
    r = client.get("/api/reportes/resumen?desde=2026-11-01&hasta=2026-11-30", headers=admin)
    assert r.status_code == 200
    c = r.json()["comparacion"]
    assert c["ingresos"] == {"anterior": 0, "diferencia": 500, "porcentaje": None}
    assert c["gastos"] == {"anterior": 0, "diferencia": 80, "porcentaje": None}
    assert c["saldo"]["porcentaje"] is None


def test_comparacion_ambos_en_cero(client, admin):
    c = client.get("/api/reportes/resumen?desde=2026-11-01&hasta=2026-11-30", headers=admin).json()["comparacion"]
    assert c["ingresos"] == {"anterior": 0, "diferencia": 0, "porcentaje": None}


def test_comparacion_por_categoria(client, admin):
    cats = {c["nombre"]: c["id"] for c in client.get("/api/categorias", headers=admin).json()}
    _mov(client, admin, "gasto", 100, "2026-10-20", cats["Comida"])
    _mov(client, admin, "gasto", 40, "2026-10-21", cats["Transporte"])
    _mov(client, admin, "gasto", 150, "2026-11-10", cats["Comida"])
    _mov(client, admin, "gasto", 30, "2026-11-11", cats["Otros"])  # no tenia nada antes
    anulado = _mov(client, admin, "gasto", 5000, "2026-10-22", cats["Comida"])
    client.post(f"/api/movimientos/{anulado['id']}/anular", headers=admin, json={})  # lo anulado no cuenta
    r = client.get("/api/reportes/por-categoria?desde=2026-11-01&hasta=2026-11-30", headers=admin).json()
    por = {c["categoria"]: c["comparacion"] for c in r["categorias"]}
    assert por["Comida"] == {"anterior": 100, "diferencia": 50, "porcentaje": 50.0}
    assert por["Otros"] == {"anterior": 0, "diferencia": 30, "porcentaje": None}
    assert "Transporte" not in por  # solo se listan las categorias con gasto en este periodo
    assert r["comparacion"] == {"anterior": 140, "diferencia": 40, "porcentaje": 28.6}
    assert r["total_gastos"] == 180 and (r["desde"], r["hasta"]) == ("2026-11-01", "2026-11-30")


def test_comparacion_usa_el_mismo_largo_en_un_rango(client, admin, categoria_id):
    _mov(client, admin, "ingreso", 100, "2026-11-09")  # dentro del tramo anterior (7 al 9)
    _mov(client, admin, "ingreso", 100, "2026-11-08")
    _mov(client, admin, "ingreso", 250, "2026-11-12")
    _mov(client, admin, "ingreso", 7, "2026-11-06")  # fuera del tramo anterior
    r = client.get("/api/reportes/resumen?desde=2026-11-10&hasta=2026-11-12", headers=admin).json()
    assert (r["comparacion"]["desde"], r["comparacion"]["hasta"]) == ("2026-11-07", "2026-11-09")
    assert r["comparacion"]["ingresos"] == {"anterior": 200, "diferencia": 50, "porcentaje": 25.0}


def test_reportes_compatibilidad_con_el_filtro_por_mes(client, admin, categoria_id):
    _mov(client, admin, "ingreso", 100, "2026-11-10")
    _mov(client, admin, "gasto", 30, "2026-11-11", categoria_id)
    por_mes = client.get("/api/reportes/resumen?mes=2026-11", headers=admin).json()
    por_fechas = client.get("/api/reportes/resumen?desde=2026-11-01&hasta=2026-11-30", headers=admin).json()
    assert por_mes["mes"] == "2026-11" and por_mes["saldo"] == 70
    for campo in ("ingresos", "gastos", "saldo", "desde", "hasta", "apoyos_entregados", "devoluciones"):
        assert por_mes[campo] == por_fechas[campo]
    assert client.get("/api/reportes/por-categoria?mes=2026-11", headers=admin).json()["total_gastos"] == 30
    assert len(client.get("/api/reportes/por-miembro?mes=2026-11", headers=admin).json()["miembros"]) == 1
    assert client.get("/api/reportes/por-miembro?desde=2026-11-01&hasta=2026-11-30", headers=admin).status_code == 200
    assert client.get("/api/reportes/tendencia-mensual", headers=admin).status_code == 200


def test_reportes_exigen_las_dos_fechas(client, admin):
    assert client.get("/api/reportes/resumen?desde=2026-11-01", headers=admin).status_code == 422
    assert client.get("/api/reportes/por-categoria?hasta=2026-11-30", headers=admin).status_code == 422


def test_aislamiento_entre_familias_en_periodos(client, admin):
    from tests.conftest import registrar

    otra = registrar(client, email="otra@t.com", nombre="Otra", familia="Otra familia")
    client.patch("/api/familia", headers=admin, json={"dia_inicio_mes": 20})
    assert client.get("/api/familia", headers=otra).json()["dia_inicio_mes"] == 1
    _mov(client, admin, "ingreso", 100, "2026-11-10")
    assert client.get("/api/reportes/resumen?desde=2026-11-01&hasta=2026-11-30", headers=otra).json()["ingresos"] == 0
    assert client.get("/api/movimientos?desde=2026-11-01&hasta=2026-11-30", headers=otra).json() == []


def test_el_modulo_de_calculo_no_toca_la_base():
    """Las funciones de calculo son puras: el modulo no importa SQLAlchemy ni nada de la app."""
    import inspect

    fuente = inspect.getsource(calculo)
    assert "sqlalchemy" not in fuente and "from app" not in fuente and "import app" not in fuente


def test_la_tabla_compartida_con_el_frontend_esta_al_dia():
    """`compartido/periodos_casos.json` la lee tambien el frontend para comprobar que calcula lo mismo.
    Si cambia el calculo hay que regenerarla (tests/generar_casos_periodos.py)."""
    import json

    from tests.generar_casos_periodos import RUTA, generar

    assert json.loads(RUTA.read_text(encoding="utf-8")) == generar(), "Regenera compartido/periodos_casos.json"


# ------------------------------------------------------------------ comparacion: periodo anterior DEL MISMO TIPO
CASOS_COMPARACION = [
    # (tipo, dia_inicio_mes, desde, hasta, comparacion_desde, comparacion_hasta, etiqueta)
    ("mes", 1, "2026-11-01", "2026-11-30", "2026-10-01", "2026-10-31", "vs octubre 2026"),  # 30 contra 31 dias
    ("mes", 1, "2026-10-01", "2026-10-31", "2026-09-01", "2026-09-30", "vs septiembre 2026"),  # 31 contra 30
    ("mes", 1, "2026-03-01", "2026-03-31", "2026-02-01", "2026-02-28", "vs febrero 2026"),  # 31 contra 28
    ("mes", 1, "2026-02-01", "2026-02-28", "2026-01-01", "2026-01-31", "vs enero 2026"),  # 28 contra 31
    ("mes", 1, "2028-03-01", "2028-03-31", "2028-02-01", "2028-02-29", "vs febrero 2028"),  # bisiesto: 29 dias
    ("mes", 1, "2028-02-01", "2028-02-29", "2028-01-01", "2028-01-31", "vs enero 2028"),
    ("mes", 1, "2027-01-01", "2027-01-31", "2026-12-01", "2026-12-31", "vs diciembre 2026"),  # cambio de anio
    ("mes", 15, "2026-11-15", "2026-12-14", "2026-10-15", "2026-11-14", "vs 15 oct - 14 nov"),
    ("mes", 15, "2026-12-15", "2027-01-14", "2026-11-15", "2026-12-14", "vs 15 nov - 14 dic"),
    ("mes", 15, "2027-01-15", "2027-02-14", "2026-12-15", "2027-01-14", "vs 15 dic - 14 ene"),  # cruza el anio
    ("mes", 28, "2026-10-28", "2026-11-27", "2026-09-28", "2026-10-27", "vs 28 sep - 27 oct"),
    ("mes", 28, "2026-01-28", "2026-02-27", "2025-12-28", "2026-01-27", "vs 28 dic - 27 ene"),
    ("mes", 28, "2026-02-28", "2026-03-27", "2026-01-28", "2026-02-27", "vs 28 ene - 27 feb"),  # periodo de 28 dias
    ("mes", 28, "2028-02-28", "2028-03-27", "2028-01-28", "2028-02-27", "vs 28 ene - 27 feb"),  # bisiesto
    ("semana", 1, "2026-11-02", "2026-11-08", "2026-10-26", "2026-11-01", "vs 26 oct - 1 nov 2026"),
    ("semana", 15, "2026-12-28", "2027-01-03", "2026-12-21", "2026-12-27", "vs 21 dic - 27 dic 2026"),
    ("anio", 1, "2026-01-01", "2026-12-31", "2025-01-01", "2025-12-31", "vs 2025"),
    ("anio", 28, "2028-01-01", "2028-12-31", "2027-01-01", "2027-12-31", "vs 2027"),  # 366 contra 365 dias
    ("anio", 1, "2029-01-01", "2029-12-31", "2028-01-01", "2028-12-31", "vs 2028"),
    ("dia", 1, "2026-11-08", "2026-11-08", "2026-11-07", "2026-11-07", "vs 7 nov 2026"),
    ("dia", 15, "2026-03-01", "2026-03-01", "2026-02-28", "2026-02-28", "vs 28 feb 2026"),
    # rango: mismo largo inmediatamente antes
    ("rango", 1, "2026-11-10", "2026-11-19", "2026-10-31", "2026-11-09", "vs 31 oct - 9 nov 2026"),
    ("rango", 15, "2026-11-10", "2026-11-10", "2026-11-09", "2026-11-09", "vs 9 nov 2026"),
    ("rango", 1, "2027-01-03", "2027-01-05", "2026-12-31", "2027-01-02", "vs 31 dic 2026 - 2 ene 2027"),
    # un tramo que NO es exactamente un periodo de su tipo cae al mismo largo (no se inventa un mes)
    ("mes", 1, "2026-11-05", "2026-11-20", "2026-10-20", "2026-11-04", "vs 20 oct - 4 nov 2026"),
]


@pytest.mark.parametrize("tipo,dia,desde,hasta,c_desde,c_hasta,texto", CASOS_COMPARACION)
def test_periodo_de_comparacion_por_tipo(tipo, dia, desde, hasta, c_desde, c_hasta, texto):
    assert calculo.periodo_comparacion(tipo, D(desde), D(hasta), dia) == (D(c_desde), D(c_hasta))
    assert calculo.etiqueta_comparacion(tipo, D(desde), D(hasta), dia) == texto


@pytest.mark.parametrize("dia", [1, 15, 28])
def test_la_comparacion_de_mes_semana_y_anio_es_la_flecha_anterior(dia):
    ref = D("2026-01-01")
    while ref < D("2029-01-01"):
        for tipo in ("mes", "semana", "anio"):
            d, h = calcular(tipo, ref, dia)
            assert calculo.periodo_comparacion(tipo, d, h, dia) == anterior(tipo, d, h, dia)
        ref += timedelta(days=5)


def test_api_comparacion_de_mes_usa_el_mes_anterior_completo(client, admin, categoria_id):
    _mov(client, admin, "ingreso", 1000, "2026-10-01")  # primer dia de octubre: con "mismo largo" (30 dias) NO entraba
    _mov(client, admin, "ingreso", 1200, "2026-11-10")
    r = client.get("/api/reportes/resumen?desde=2026-11-01&hasta=2026-11-30&tipo=mes", headers=admin).json()
    c = r["comparacion"]
    assert (c["desde"], c["hasta"], c["etiqueta"]) == ("2026-10-01", "2026-10-31", "vs octubre 2026")
    assert c["ingresos"] == {"anterior": 1000, "diferencia": 200, "porcentaje": 20.0}
    # sin tipo (rango suelto) se mantiene el mismo largo: 2 al 31 de octubre
    s = client.get("/api/reportes/resumen?desde=2026-11-01&hasta=2026-11-30", headers=admin).json()["comparacion"]
    assert (s["desde"], s["hasta"]) == ("2026-10-02", "2026-10-31") and s["ingresos"]["anterior"] == 0


def test_api_comparacion_de_mes_respeta_dia_inicio_mes(client, admin):
    client.patch("/api/familia", headers=admin, json={"dia_inicio_mes": 15})
    _mov(client, admin, "ingreso", 400, "2026-10-15")
    _mov(client, admin, "ingreso", 500, "2026-11-20")
    r = client.get("/api/reportes/resumen?desde=2026-11-15&hasta=2026-12-14&tipo=mes", headers=admin).json()["comparacion"]
    assert (r["desde"], r["hasta"], r["etiqueta"]) == ("2026-10-15", "2026-11-14", "vs 15 oct - 14 nov")
    assert r["ingresos"]["anterior"] == 400 and r["ingresos"]["porcentaje"] == 25.0


def test_api_comparacion_semana_anio_dia_y_rango(client, admin):
    _mov(client, admin, "ingreso", 100, "2025-06-01")
    _mov(client, admin, "ingreso", 300, "2026-06-01")
    anio = client.get("/api/reportes/resumen?desde=2026-01-01&hasta=2026-12-31&tipo=anio", headers=admin).json()["comparacion"]
    assert (anio["desde"], anio["hasta"], anio["etiqueta"]) == ("2025-01-01", "2025-12-31", "vs 2025")
    assert anio["ingresos"] == {"anterior": 100, "diferencia": 200, "porcentaje": 200.0}
    sem = client.get("/api/reportes/resumen?desde=2026-11-02&hasta=2026-11-08&tipo=semana", headers=admin).json()["comparacion"]
    assert (sem["desde"], sem["hasta"]) == ("2026-10-26", "2026-11-01")
    dia = client.get("/api/reportes/resumen?desde=2026-11-08&hasta=2026-11-08&tipo=dia", headers=admin).json()["comparacion"]
    assert (dia["desde"], dia["hasta"], dia["etiqueta"]) == ("2026-11-07", "2026-11-07", "vs 7 nov 2026")
    rng = client.get("/api/reportes/resumen?desde=2026-11-10&hasta=2026-11-19&tipo=rango", headers=admin).json()["comparacion"]
    assert (rng["desde"], rng["hasta"]) == ("2026-10-31", "2026-11-09")


def test_api_comparacion_por_categoria_nombra_el_periodo(client, admin):
    cats = {c["nombre"]: c["id"] for c in client.get("/api/categorias", headers=admin).json()}
    _mov(client, admin, "gasto", 100, "2026-10-01", cats["Comida"])
    _mov(client, admin, "gasto", 150, "2026-11-10", cats["Comida"])
    r = client.get("/api/reportes/por-categoria?desde=2026-11-01&hasta=2026-11-30&tipo=mes", headers=admin).json()
    assert r["periodo_anterior"] == {"desde": "2026-10-01", "hasta": "2026-10-31", "etiqueta": "vs octubre 2026"}
    assert r["categorias"][0]["comparacion"] == {"anterior": 100, "diferencia": 50, "porcentaje": 50.0}
    assert r["comparacion"]["anterior"] == 100


def test_api_comparacion_con_mes_legacy_y_tipo_invalido(client, admin):
    r = client.get("/api/reportes/resumen?mes=2026-03", headers=admin).json()["comparacion"]
    assert (r["desde"], r["hasta"], r["etiqueta"]) == ("2026-02-01", "2026-02-28", "vs febrero 2026")  # mes calendario completo
    assert client.get("/api/reportes/resumen?desde=2026-11-01&hasta=2026-11-30&tipo=trimestre", headers=admin).status_code == 422
