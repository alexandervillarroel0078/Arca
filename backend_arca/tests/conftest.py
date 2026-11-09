"""Pruebas: usan SOLO la base arca_test (nunca arca2)."""
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

from app.core.config import settings
from app.core.db import Base, get_db
from app.main import app
from app.modulos import registry  # noqa: F401

if not settings.test_database_url.rstrip("/").endswith("/arca_test"):
    raise RuntimeError("TEST_DATABASE_URL debe apuntar a la base arca_test")

engine_test = create_engine(settings.test_database_url, pool_pre_ping=True)
SesionTest = sessionmaker(bind=engine_test, autoflush=False, expire_on_commit=False)


@pytest.fixture(scope="session", autouse=True)
def crear_tablas():
    Base.metadata.drop_all(engine_test)
    Base.metadata.create_all(engine_test)
    yield
    Base.metadata.drop_all(engine_test)


@pytest.fixture(autouse=True)
def limpiar_datos():
    # IMPORTANTE: `historial` tiene un trigger que rechaza UPDATE y DELETE. La limpieza de las pruebas
    # usa SIEMPRE TRUNCATE ... CASCADE (o recrear el esquema), nunca DELETE. No debilitar ni quitar el trigger.
    yield
    tablas = ", ".join(t.name for t in Base.metadata.sorted_tables)
    with engine_test.begin() as c:
        c.execute(text(f"TRUNCATE {tablas} RESTART IDENTITY CASCADE"))


@pytest.fixture(autouse=True)
def reiniciar_limite_de_login():
    """El limitador de intentos es global (en memoria): cada prueba parte de cero."""
    from app.core import limite
    from app.modulos.bitacora import registro

    limite.reiniciar()
    registro.reiniciar()
    yield


@pytest.fixture
def client():
    def _db():
        db = SesionTest()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = _db
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


def registrar(client, email="admin@t.com", nombre="Admin", familia="Fam"):
    r = client.post(
        "/api/auth/registro",
        json={"nombre": nombre, "email": email, "password": "secreto1", "nombre_familia": familia},
    )
    assert r.status_code == 201, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.fixture
def admin(client):
    return registrar(client)


@pytest.fixture
def miembro(client, admin):
    r = client.post(
        "/api/familia/invitar",
        headers=admin,
        json={"nombre": "Miembro", "email": "m@t.com", "password": "secreto1"},
    )
    assert r.status_code == 201, r.text
    login = client.post("/api/auth/login", json={"email": "m@t.com", "password": "secreto1"})
    return {"Authorization": f"Bearer {login.json()['access_token']}"}


@pytest.fixture
def categoria_id(client, admin):
    return client.get("/api/categorias", headers=admin).json()[0]["id"]
