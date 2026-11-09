# Arca - SPEC v1

Sistema de control de gastos familiares, multi-usuario, con captura rapida desde el celular (PWA).
Prototipo visual: https://claude.ai/artifact/4gujuR9ShsrhkvhvjcjEzj (3 pantallas: Inicio, Nuevo movimiento, Apoyos).

## Instrucciones para Claude Code
- Lee este archivo completo y construye por fases, en orden.
- No te detengas a preguntar: si falta un dato, decide lo mas simple y anotalo en NOTAS.md.
- Al terminar cada fase corre las pruebas y el criterio de "Terminado". Solo pasa a la siguiente si cumple.
- Todo el texto de la interfaz, mensajes de error y comentarios en espanol.

## Stack
- Backend: `backend_arca/` - FastAPI, SQLAlchemy, Alembic, PostgreSQL, login JWT, pytest.
- Frontend: `web_arca/` - React + Vite + TypeScript + TailwindCSS, PWA con vite-plugin-pwa.
- Arquitectura modular por dominio en ambos (backend: `app/modulos/<dominio>/`, frontend: `src/modulos/<dominio>/`), cada modulo autocontenido.
- Moneda: Bs (boliviano), monto con 2 decimales (`Numeric(12,2)`).

## Reglas de negocio
1. Una **familia** agrupa usuarios y comparte categorias.
2. Cada miembro registra lo suyo. Desde la Fase 17 cada movimiento y apoyo tiene una **visibilidad** (`solo_yo`, `familia` o `elegidas`); por defecto es `familia`, asi que lo que ya existia lo sigue viendo toda la familia. El admin NO ve lo privado de otros.
3. Roles: `admin` (crea categorias, invita miembros, edita cualquier movimiento) y `miembro` (edita solo los suyos).
4. Tipos de movimiento: **gasto**, **ingreso**, **apoyo** (dinero entregado a un familiar) y **devolucion** (ligada a un apoyo).
5. Un apoyo NO es gasto ni prestamo. Estado derivado:
   - `pendiente = monto - devuelto - consumido`
   - `Pendiente`: pendiente > 0
   - `Saldado`: pendiente = 0 y consumido = 0
   - `Cerrado`: pendiente = 0 y consumido > 0
6. "Marcar consumido" pasa todo el pendiente a `consumido`. En reportes, lo consumido se cuenta como gasto familiar, en una linea aparte.
7. Una devolucion no es ingreso normal: no entra en el total de ingresos.
8. Saldo de efectivo del mes = ingresos - gastos - apoyos entregados + devoluciones. Mostrar el desglose en Inicio.
9. Registro sin internet: se guarda local y se sincroniza al volver la conexion (crear, editar, anular y reactivar: ver Fase 12).

## Modelo de datos
- `usuarios`: id, nombre, email (unico), password_hash, creado_en
- `familias`: id, nombre
- `miembros`: id, usuario_id, familia_id, rol (`admin`|`miembro`)
- `categorias`: id, familia_id, nombre, icono, activa
- `movimientos`: id, familia_id, usuario_id, tipo (`gasto`|`ingreso`), monto, fecha, categoria_id (null en ingreso), nota, creado_en
- `apoyos`: id, familia_id, usuario_id (quien entrega), beneficiario (texto), monto, fecha, nota, monto_consumido (default 0), creado_en
- `devoluciones`: id, apoyo_id, monto, fecha, nota

Categorias iniciales (por familia): Transporte, Comida, Antojos, Servicios, Gasolina, Otros.

## API (prefijo `/api`, todo requiere JWT salvo auth)
- `POST /auth/registro` (crea usuario + familia nueva como admin), `POST /auth/login`, `GET /auth/yo`
- `POST /familia/invitar`, `GET /familia/miembros`
- `GET/POST /categorias`, `PATCH /categorias/{id}`
- `GET/POST /movimientos` (filtros: mes o desde/hasta, usuario, tipo, categoria), `PATCH /movimientos/{id}` (no hay DELETE: ver Fase 9)
- `GET/POST /apoyos`, `GET /apoyos/resumen` (por beneficiario: entregado, devuelto, consumido, pendiente, estado)
- `POST /apoyos/{id}/devoluciones`, `POST /apoyos/{id}/consumir`
- `GET /reportes/resumen?mes=` (o `desde=&hasta=`), `/reportes/por-categoria`, `/reportes/por-miembro`, `/reportes/tendencia-mensual`

## Pantallas (ver prototipo)
1. Login / registro
2. **Inicio**: saldo del mes, ingresos y gastos, aviso de apoyos pendientes, ultimos movimientos, boton "+"
3. **Nuevo movimiento**: monto, selector Gasto/Ingreso/Apoyo, categorias con iconos grandes (o beneficiario si es apoyo), fecha (hoy por defecto), nota opcional. Meta: registrar en 5 segundos.
4. **Apoyos**: totales y una tarjeta por beneficiario con barra de progreso, "Registrar devolucion" y "Marcar consumido"
5. **Reportes**: por categoria, por mes, por persona
6. **Familia**: categorias y miembros

Diseno: mobile first (390px), touch targets de 44px o mas, verde #0E6B58 como color principal, naranja #A8470A para apoyos, fuentes Inter y Space Grotesk. Navegacion inferior: Inicio, Apoyos, Reportes, Familia.

## Fases
1. **Estructura y BD**: carpetas, entorno, conexion a PostgreSQL, modelos y migraciones. Terminado: migraciones corren limpias y las tablas existen.
2. **Auth y familia**: registro, login, miembros, categorias iniciales. Terminado: pruebas de punta a punta pasan.
3. **Movimientos**: gastos e ingresos con filtros. Terminado: pruebas de crear, listar, editar y borrar pasan.
4. **Apoyos**: apoyos, devoluciones, consumir, resumen y estados derivados. Terminado: pruebas cubren Pendiente, Saldado y Cerrado.
5. **Reportes**: los 4 endpoints. Terminado: pruebas con datos de ejemplo.
6. **Frontend base**: login, Inicio, Nuevo movimiento, Apoyos, conectados a la API. Terminado: flujo completo en el navegador.
7. **PWA**: manifest, iconos, service worker, cola offline con sincronizacion. Terminado: instalable y registra sin internet.
8. **Reportes y Familia en el frontend**. Terminado: todas las pantallas funcionan.
9. **Correcciones, anulacion y administracion** (ver seccion siguiente). Terminado: pruebas de backend por cada permiso y regla, y flujo crear/editar/anular/reactivar verificado en el navegador a 390px para movimientos, apoyos y devoluciones.
10. **Historial completo** (ver seccion siguiente). Terminado: pruebas de backend (cada operacion deja su entrada, atomicidad, solo agregar, permisos, sin secretos) y flujo editar/anular/reactivar + "Ver historial" verificado en el navegador a 390px.
11. **Pruebas automaticas del frontend** (ver seccion siguiente). Terminado: `npm test` (Vitest) y `npm run test:e2e` (Playwright a 390px contra `arca_test`) pasan DOS veces seguidas sin fallos intermitentes, junto con las pruebas del backend.
12. **Editar y anular sin internet** (ver seccion siguiente). Terminado: pruebas de backend (idempotencia por operacion, 409 por version, orden de aplicacion, historial con fecha del cliente), unitarias de la cola (fusion, orden, conflicto, rechazo, reintento) y E2E con `context.setOffline` (crear, editar y anular sin conexion, reconectar, totales correctos sin duplicados, conflicto entre dos usuarios, reintento automatico), todo pasando junto con las fases anteriores.
13. **Listo para produccion** (ver seccion siguiente). Terminado: la app NO arranca en produccion con una configuracion insegura; registro cerrado con primer admin, limite de intentos de login, CORS estricto y `e2e` nunca cargable desde `app.main`, todo con pruebas; el frontend tolera el arranque en frio del servidor y avisa de las versiones nuevas (probado con la app compilada); `DESPLIEGUE.md`; backend, unitarias y E2E pasan DOS veces seguidas y `npm run build` compila.
14. **Diseno y usabilidad** (ver seccion siguiente). Terminado: sistema de diseno aplicado en toda la app, Familia como menu con pantallas propias, Inicio y Lista renovados, estados vacio y de carga; capturas a 390px revisadas (sin texto cortado, sin desborde, sin nada tapado por la barra inferior); la fase NO cambia logica, API ni permisos; backend, unitarias y E2E pasan DOS veces seguidas.
15. **Bitacora** (ver seccion siguiente). Terminado: tabla `bitacora` de solo agregar (trigger) con migracion que sube y baja, cada evento de acceso deja su entrada sin guardar jamas claves ni tokens, `GET /bitacora` (+ `/resumen` y `/exportar.csv`) solo admin y aislado por familia que mezcla bitacora e historial con paginacion estable, pantalla "Bitacora" dentro de Familia (solo admin) a 390px; backend, unitarias y E2E (las anteriores incluidas) pasan DOS veces seguidas y hay capturas en `capturas/`.
16. **Periodos** (ver seccion siguiente). Terminado: `familias.dia_inicio_mes` (1 a 28) con migracion que sube y baja y cambio solo del admin (queda en historial); un unico modulo de calculo de periodos (funciones puras, zona America/La_Paz) con tabla de casos compartida con el frontend; `GET /periodos/actual`; movimientos, apoyos, lista completa, reportes y saldo aceptan `desde`/`hasta` (el filtro por `mes` sigue funcionando); reportes comparan con el periodo anterior sin dividir por cero; selector de periodo comun en Inicio, Lista, Reportes y Apoyos, Familia > Mi familia, cache por periodo y aviso sin conexion, a 390px; backend, unitarias y E2E (las anteriores incluidas) pasan DOS veces seguidas y hay capturas en `capturas/`.
17. **Privacidad** (ver seccion siguiente). Terminado: `visibilidad` en movimientos y apoyos (`solo_yo`|`familia`|`elegidas`, por defecto `familia`), preferencia por miembro y tabla `compartidos`, con migracion `0007` que sube y baja; UN modulo de visibilidad por el que pasa toda lectura; lo que no ves responde 404 (nunca 403) con el mismo cuerpo que un id inexistente; totales, reportes, historial y bitacora filtrados tambien para el admin; el 409 y los rechazos de sincronizacion no filtran datos; la copia sin conexion olvida lo que dejo de ser visible; selector "Quien lo ve", pantalla Privacidad y aviso honesto; una prueba de matriz recorre TODAS las rutas de la API; backend, unitarias y E2E (las anteriores incluidas) pasan DOS veces seguidas y hay capturas en `capturas/`.

## Fase 9 - Correcciones, anulacion y administracion
**Principio: nunca se borra nada de la base. Todo se ANULA o se DESACTIVA y se puede reactivar.** No existe ningun `DELETE` en la API.

- **Anular** (movimientos, apoyos, devoluciones): columnas `anulado`, `anulado_por`, `anulado_en`, `motivo_anulacion`, `editado_por`, `editado_en`. Endpoints `POST .../anular` (motivo opcional) y `POST .../reactivar`. Lo anulado no cuenta en saldos, totales, estados ni reportes; las listas lo ocultan salvo con el filtro "Ver anulados" (gris, tachado, con quien y cuando).
- **Cascada**: anular un apoyo anula sus devoluciones activas (aviso previo con la cantidad); al reactivar el apoyo vuelven solo las que se anularon con el. Reactivar una devolucion no puede dejar `devuelto + consumido > monto`.
- **Editar**: movimientos (monto, fecha, categoria, nota, tipo); apoyos (beneficiario, monto, fecha, nota; el monto no baja de `devuelto + consumido`); devoluciones (monto, fecha, nota; `devoluciones + consumido <= monto`); "Reabrir apoyo" deshace lo consumido. Siempre se guarda `editado_por` y `editado_en`.
- **Categorias**: crear, renombrar, cambiar icono, desactivar y reactivar. Una desactivada sigue en el historial pero no en el selector de Nuevo movimiento.
- **Miembros** (solo admin): cambiar rol, desactivar y reactivar, restablecer clave temporal. Nunca se desactiva ni degrada al ultimo admin. Un miembro desactivado no entra; sus movimientos se conservan y cuentan igual.
- **Perfil**: cada usuario cambia su nombre y su clave (pidiendo la clave actual).
- **Permisos** (validados en el backend): el miembro edita, anula y reactiva solo lo suyo; el admin todo.
- **Lista completa**: "Ver todos" en Inicio, con filtros (mes, persona, tipo, categoria, ver anulados) y paginacion. Desde ella se edita, anula y reactiva.
- **Idempotencia offline**: cada registro creado en el cliente lleva un UUID (`uuid_cliente`); si llega dos veces el backend devuelve el existente. Aplica a movimientos, apoyos y devoluciones. Un registro anulado que llega de nuevo no se reactiva.
- **UX**: acciones de 44px o mas, menu "..." por fila, confirmacion al anular (nombre, monto, motivo opcional) y aviso "Anulado. Reactivar".

## Fase 10 - Historial completo
Tabla `historial` **de solo agregar** (no se edita ni se borra; ademas de no existir rutas para ello, la base lo impide con un trigger): `id`, `familia_id`, `entidad` (movimiento|apoyo|devolucion|categoria|miembro|usuario), `entidad_id`, `accion` (crear|editar|anular|reactivar|consumir|reabrir|cambiar_rol|desactivar|reactivar|restablecer_clave|cambiar_clave), `usuario_id` (quien lo hizo), `fecha`, `cambios` (JSON `campo: {antes, despues}`) y `motivo` opcional.

- Se escribe en la **misma transaccion** que el cambio: si falla una, fallan las dos. Cubre todas las operaciones que modifican datos, incluida la cascada de anular un apoyo (una entrada por devolucion afectada) y su reactivacion.
- **Nunca** se guardan claves, hashes ni JWT. En cambios de clave solo se registra "clave cambiada".
- `GET /historial?entidad=&entidad_id=`: cadena de un registro (cualquier miembro de la familia, orden cronologico). `GET /historial`: actividad global, **solo admin**, con filtros (entidad, accion, usuario, desde, hasta) y paginacion.
- Interfaz: "Ver historial" en cada movimiento, apoyo y devolucion (quien, cuando, que cambio, de X a Y). El admin tiene la pantalla "Actividad de la familia" dentro de Familia.
- Los registros anteriores a la Fase 10 no tienen historial previo: no se inventa nada, solo se registra desde ahora.

## Fase 11 - Pruebas automaticas del frontend
Esta fase **solo agrega pruebas**; no cambia el comportamiento de la app (solo ajustes minimos para poder probar, como atributos `data-testid`).

- **Unitarias y de componentes**: Vitest + Testing Library (`npm test`). Cubren formularios, estados de apoyos (Pendiente/Saldado/Cerrado/Anulado), totales y saldo mostrados, permisos que ocultan el menu "...", el historial y la cola de registros sin internet.
- **Extremo a extremo**: Playwright a 390px de ancho (`npm run test:e2e`) contra un backend de prueba conectado **solo a la base `arca_test`** (nunca `arca2` ni `arca`). Los servidores de prueba (backend y frontend) los levanta la propia configuracion en puertos propios.
- Flujos minimos: login; crear gasto; crear apoyo, devolucion y consumir; editar; anular y reactivar; un miembro sin permiso sobre lo del admin; ver historial; Familia (categorias y miembros); registro sin internet y sincronizacion sin duplicados.
- Cada prueba E2E prepara sus datos y deja la base limpia para poder repetirse. La limpieza usa solo `TRUNCATE ... CASCADE` o recrear el esquema: **nunca DELETE** (el trigger de `historial` rechaza UPDATE y DELETE y no se debilita).
- Criterio: todo pasa dos veces seguidas. Una prueba inestable se arregla, no se quita.

## Fase 12 - Editar y anular sin internet
**Alcance**: crear, editar, anular y reactivar movimientos, apoyos y devoluciones funcionan sin conexion y se sincronizan al volver. Ademas Inicio, Apoyos, Lista, Reportes y Familia cargan sin internet con los ultimos datos.

- **Lecturas offline**: se guarda en IndexedDB la ultima respuesta correcta de cada pantalla y se muestra el aviso "Datos de hace X min, sin conexión". Las operaciones pendientes se aplican encima del cache para que el usuario las vea de inmediato.
- **Cola de operaciones**: cada operacion (crear, editar, anular, reactivar) tiene su propio UUID de operacion, se guarda en IndexedDB y se envia EN ORDEN al volver la conexion. El backend es idempotente por UUID de operacion (la misma operacion dos veces = un solo efecto).
- **Fusion**: editar o anular algo creado sin internet que aun no se sincroniza se fusiona con la creacion pendiente (la creacion sale ya con el valor final) en vez de mandar dos operaciones. Una devolucion de un apoyo creado sin internet funciona porque el UUID lo genera el cliente.
- **Conflictos**: columna `version` (entero que sube con cada cambio) en movimientos, apoyos y devoluciones, con migracion. Cada edicion o anulacion envia la version en la que se baso; si en el servidor cambio mientras tanto, responde 409; el cliente conserva la operacion "en conflicto" y muestra ambas versiones con "Usar la mía" y "Usar la del servidor". Nunca se pierde un dato en silencio.
- **Rechazos**: si el servidor rechaza una operacion (403 permisos, 422/400 regla de negocio como una devolucion superior al pendiente), se revierte localmente y aparece en la lista "No se pudo sincronizar" con el motivo. Nunca se descarta una operacion sin avisar.
- **Indicador visible**: "N cambios pendientes", estado de sincronizacion y boton "Sincronizar ahora"; reintento automatico cada 30 s y al volver la conexion.
- **Historial**: registra la fecha real en que el usuario hizo la accion (`fecha_cliente`, aparte de la fecha de sincronizacion).
- **Seguridad**: el cache y la cola se borran al cerrar sesion; el backend sigue validando permisos siempre.
- **Pruebas**: backend (idempotencia por operacion, 409 por version, orden de aplicacion, historial); unitarias de la cola; E2E con `context.setOffline` (crear/editar/anular sin conexion, reconectar, totales sin duplicados, conflicto entre dos usuarios, reintento automatico de la cola).
- La limpieza de datos de las pruebas sigue usando solo `TRUNCATE ... CASCADE` o recrear el esquema (nunca DELETE sobre `historial`); no se debilita el trigger; nada destructivo sobre `arca` ni `arca2`.

## Fase 13 - Listo para produccion
Objetivo: desplegar con Neon (base), Render (backend) y Vercel (frontend). **Nada de secretos en archivos versionados.** No se toca ni se debilita el trigger de `historial`; ninguna prueba destructiva sobre `arca` ni `arca2`.

**Backend**
- Configuracion solo por variables de entorno: `DATABASE_URL` (acepta `sslmode=require`), `JWT_SECRET`, `CORS_ORIGENES` (lista separada por comas), `ENTORNO`, `REGISTRO_ABIERTO` (por defecto `true` en desarrollo y `false` en produccion). El archivo `.env` es opcional y solo de desarrollo.
- Con `ENTORNO=produccion`: la app NO arranca si `JWT_SECRET` falta, es un valor de ejemplo o tiene menos de 32 caracteres; el seed se niega a correr; `/docs`, `/redoc` y `/openapi.json` desaparecen; el CORS usa solo `CORS_ORIGENES`.
- `REGISTRO_ABIERTO=false`: `/auth/registro` responde 403 con un mensaje claro, **salvo** que la tabla de usuarios este vacia (primer admin; despues se cierra sola).
- Login: 5 fallos por IP y correo en 10 minutos -> 429 (en memoria). Clave minima de 8 caracteres.
- `requirements.txt` con versiones fijas. Arranque de produccion: `alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port $PORT`.
- `GET /api/salud` sin autenticacion y sin datos internos.
- Las rutas `/__e2e__` y el codigo de `backend_arca/e2e` nunca se pueden cargar desde `app.main`.

**Frontend**
- La URL de la API sale de `VITE_API_URL` (con `.env.example`); sin URLs fijas a localhost.
- Arranque en frio del servidor (hasta 1 minuto): primera peticion con espera de ~90 s, aviso "Despertando el servidor..." si pasa de 5 s, y la cola sin conexion reintenta sin marcar el error como rechazo definitivo.
- `vercel.json`: reglas para que las rutas de la SPA funcionen al recargar y cabeceras sin cache largo para el service worker y el manifest.
- Actualizacion del service worker: aviso "Hay una version nueva, actualizar" (los usuarios no quedan pegados a la vieja), probado con la app compilada (`npm run build` + `npm run preview`), incluida la carga sin conexion despues de instalar.
- `npm audit --omit=dev`: se corrige lo que no rompa nada (sin `--force`) y se informa el resto.

**Documentacion**: `DESPLIEGUE.md` (variables de cada servicio sin valores reales, comando de arranque, respaldo de la base). `.gitignore` excluye `.env`, `.venv` y `node_modules`.

## Fase 14 - Diseno y usabilidad
Solo interfaz y navegacion: **no cambia logica, API ni permisos**. Se conservan los `data-testid`; si cambia un texto o una ruta se actualizan las pruebas.

**Sistema de diseno** (variables CSS y config de Tailwind): fondo #F4F6F5, tarjetas #FFFFFF con radio de 16 a 20 px, texto #12201C, secundario #4A5A56, bordes #E1E7E5; verde #0E6B58 (tinte #E3F1EC); apoyos naranja #A8470A (tinte #FBEBDD, texto #6E3207); error en rojo con icono y texto (nunca solo color). Inter para texto y Space Grotesk para titulos y montos. Base de 390 px, areas tactiles de 44 px o mas, barra inferior de 72 px.
- Botones: el principal relleno verde de ancho completo (56 px) para la accion de la pantalla; secundarios con borde; destructivos (anular) en rojo suave.
- Formularios: etiqueta arriba, campos de 52 px, borde de 1,5 px, radio de 14 px, foco verde visible, errores debajo del campo, boton mostrar/ocultar en las claves.

**Navegacion por opciones**: Familia es un MENU de tarjetas grandes (icono, titulo, descripcion y flecha `>`); cada opcion abre su propia ruta con encabezado "< Volver": Miembros, Categorias, Actividad de la familia (solo admin: al miembro la opcion no le aparece), Mi perfil y Cerrar sesion (con confirmacion). "Agregar miembro" y "Agregar categoria" son un boton principal fijo abajo que abre su propia pantalla de formulario. El avatar de Inicio abre "Mi perfil". El boton atras del telefono/navegador y recargar en cualquier ruta funcionan.

**Otras pantallas**: Inicio (tarjeta verde con el saldo, ingresos y gastos debajo, tarjeta naranja de apoyos pendientes, "Ultimos movimientos" con menu "..." y los mismos permisos que la lista, reutilizando el componente de la lista, "+" flotante); Lista (filtros como chips deslizables que abren una lista de opciones, interruptor "Ver anulados", filas con "..." de 44 px, anulados en gris y tachados); Apoyos (tarjeta por persona con barra de progreso y chip de estado); todas con estado vacio amable con una accion y estado de carga con esqueletos.

**Prueba visual**: Playwright a 390 px guarda capturas de Inicio, Lista, Apoyos, menu de Familia, Miembros, Categorias, Mi perfil y Nuevo movimiento en `capturas/` (en `.gitignore`) y comprueba sin desborde horizontal, sin texto cortado y sin elementos tapados por la barra inferior.

## Fase 15 - Bitacora unificada
Una sola pantalla con DOS origenes en orden cronologico: (a) **accesos y seguridad**, tabla nueva `bitacora`; (b) **cambios de datos**, que ya viven en `historial` (crear, editar, anular, reactivar, consumir, reabrir, cambios de rol y de categorias...). Las filas del historial NO se copian a la bitacora ni se escribe dos veces: la pantalla las mezcla al leer. No se toca ni se debilita el trigger de `historial`; ninguna prueba destructiva sobre `arca` ni `arca2` (limpieza solo con `TRUNCATE ... CASCADE` o recreando el esquema).

**Backend**
- Tabla `bitacora` de solo agregar, con un trigger de PostgreSQL que rechaza UPDATE y DELETE (igual que `historial`): `id`, `familia_id` (nulo si no hubo identificacion), `usuario_id` (nulo si no existe), `correo_intentado` (solo eventos de login, en minusculas), `evento`, `resultado` (`ok`|`fallo`), `ip`, `dispositivo` (user-agent recortado a 200 caracteres), `fecha` (servidor, UTC), `detalle` (JSON corto). Migracion nueva que sube y baja.
- Eventos: `login_ok`, `login_fallido`, `login_bloqueado` (429), `logout`, `registro`, `cambio_clave_ok`, `cambio_clave_fallido`, `restablecer_clave`, `usuario_desactivado`, `usuario_reactivado`, `cambio_rol`, `acceso_denegado` (403 por permisos o por usuario desactivado), `token_invalido` (401 en rutas protegidas; maximo uno por IP cada minuto), `sincronizacion_rechazada` (operacion de la cola rechazada por 403, 409 o regla de negocio).
- **Nunca** se guardan claves, hashes, JWT, cuerpos de peticiones ni la clave temporal generada (una prueba revisa que ninguna columna ni detalle los contenga).
- IP real respetando la configuracion de proxy existente (`FORWARDED_ALLOW_IPS`): no se lee `X-Forwarded-For` a mano.
- Escritura: los eventos que cambian datos (clave, rol, desactivacion) van en la misma transaccion; login fallido, bloqueado y acceso denegado en una sesion aparte, para que quede el registro aunque la peticion falle. Si escribir en la bitacora falla, no tumba el login ni la peticion, pero deja el error en el log del servidor (nunca en silencio).
- `GET /bitacora` (solo admin, solo su familia): mezcla bitacora e historial por fecha descendente, con campo `origen` (`acceso`|`datos`), paginacion estable por (fecha, id) sin repetidos ni saltos y filtros: origen, evento o accion, resultado, persona, rango de fechas, ip. No carga todo en memoria (cada tabla aporta un tope por pagina). Los eventos sin familia solo los ve un admin si el correo intentado pertenece a un usuario de su familia. Un miembro recibe 403 (y queda como `acceso_denegado`).
- Los eventos de datos muestran detalle legible ("Anulo gasto Transporte Bs 50.00", "Monto: Bs 45.00 -> Bs 60.00"), quien lo hizo y la fecha real de la accion (si fue sin internet, la del cliente, y la de sincronizacion aparte). El anular se muestra como "Anulado" con el motivo si lo hay: el sistema no borra nada.
- `GET /bitacora/exportar.csv` (solo admin, mismos filtros, tope de 5000 filas, columna `origen`) con proteccion contra inyeccion de formulas (los campos que empiezan con `=`, `+`, `-` o `@` llevan una comilla simple delante).
- `GET /bitacora/resumen` (solo admin): ultimo login ok por usuario, fallos de login de los ultimos 7 dias, e IP o dispositivos nuevos por usuario.

**Frontend**
- En el menu de Familia, opcion "Bitacora" solo para admin (al miembro no le aparece y la URL directa lo redirige). Pantalla propia con "< Volver": resumen arriba en tarjetas (ultimo acceso por persona, fallos de la semana); chips Todo | Accesos | Datos y chips de Evento, Resultado, Persona y Fechas; lista cronologica con icono y color segun origen y resultado, siempre acompanado de texto; IP y dispositivo en una linea secundaria; "Cargar mas", estado vacio amable, esqueletos de carga y boton "Exportar CSV".
- Con el sistema de diseno actual, a 390px, sin desborde horizontal, areas tactiles de 44px o mas.

**Pruebas**: backend (cada evento deja su entrada; el trigger rechaza UPDATE y DELETE; ninguna ruta edita ni borra; sin claves ni tokens; solo admin; aislamiento entre familias; filtros; mezcla ordenada y paginacion sin repetidos; limite de 5000 filas; escape del CSV; un fallo al escribir la bitacora no rompe el login; un cambio hecho sin internet muestra su fecha real); frontend unitarias (filtros, vacio, permisos) y E2E (fallar la clave y luego entrar bien y verlo en la bitacora junto a un cambio de datos; un miembro no ve la opcion ni entra por URL directa); capturas de la pantalla nueva en `capturas/`.

## Fase 16 - Periodos
**Principio: el periodo es una VISTA (un filtro de fechas), no un candado.** No se cierran ni se bloquean periodos y no cambia ningun permiso: lo de un periodo viejo se puede editar, anular y reactivar igual que antes. No se toca ni se debilita el trigger de `historial` ni el de `bitacora`; ninguna prueba destructiva sobre `arca` ni `arca2` (limpieza solo con `TRUNCATE ... CASCADE` o recreando el esquema).

**Backend**
- Columna `familias.dia_inicio_mes` (entero de 1 a 28, por defecto 1; `CHECK` en la base), con migracion que sube y baja. Solo el admin la cambia (`PATCH /familia`, `{"dia_inicio_mes": n}`; `GET /familia` la lee) y el cambio queda en el historial (entidad `familia`, accion `editar`, campo `dia_inicio_mes`).
- UN unico modulo de calculo (`app/modulos/periodos/calculo.py`, funciones puras sin base de datos): dado un tipo (`dia`, `semana`, `mes`, `anio`, `rango`), una fecha de referencia y el `dia_inicio_mes`, devuelve `(desde, hasta)` inclusivo. Semana de lunes a domingo. Mes: del `dia_inicio_mes` de un mes al dia anterior del siguiente (con 1 es el mes calendario). Anio: del 1 de enero al 31 de diciembre. "Hoy" y toda referencia usan la zona America/La_Paz (UTC-4), nunca UTC.
- `GET /periodos/actual?tipo=&referencia=` (y `desde`/`hasta` para `rango`) devuelve `desde`, `hasta`, `etiqueta` legible ("Noviembre 2026", "28 oct - 27 nov"), `es_actual`, `hoy`, `dia_inicio_mes` y los periodos `anterior` y `siguiente`.
- `GET /movimientos`, `/actividad` (lista completa), `/apoyos`, `/apoyos/resumen` y `/reportes/*` aceptan `desde` y `hasta` (inclusivos). El filtro `mes=AAAA-MM` (mes calendario) sigue funcionando por compatibilidad; si vienen `desde`/`hasta` mandan sobre `mes`.
- `/reportes/resumen` y `/reportes/por-categoria` agregan la **comparacion con el periodo anterior**: para mes, semana y anio es el periodo ANTERIOR DEL MISMO TIPO (el mismo que usa la flecha "anterior"; el mes respeta `dia_inicio_mes`); solo para dia y rango es un tramo del mismo largo inmediatamente antes. Se pide con `tipo=` junto a `desde`/`hasta` y la respuesta nombra el periodo (`etiqueta`: "vs octubre 2026", "vs 28 sep - 27 oct"). Diferencia en Bs y en porcentaje para ingresos, gastos y saldo, y por categoria; si el anterior es 0 el porcentaje es nulo (nunca se divide por cero).
- Saldo del periodo = ingresos - gastos - apoyos entregados + devoluciones, cada uno por su propia fecha dentro del periodo; lo anulado no cuenta. Los apoyos pendientes NO se cortan por periodo: el total pendiente (y el estado de cada beneficiario) siempre es acumulado; `desde`/`hasta` solo filtran lo entregado y devuelto dentro del periodo (`entregado_periodo`, `devuelto_periodo`).

**Frontend**
- Selector de periodo comun (UN componente) en Inicio, Lista, Reportes y Apoyos: chips Hoy | Semana | Mes | Anio | Rango, flechas anterior y siguiente (la siguiente se desactiva si el periodo contiene hoy) y la etiqueta visible. "Rango" abre una pantalla con dos campos de fecha. El periodo elegido se conserva al navegar entre pantallas y se reinicia a "Mes actual" al cerrar sesion.
- Inicio: la tarjeta de saldo muestra la etiqueta del periodo; si no es el actual, un aviso discreto "Viendo un periodo anterior". Reportes: tarjetas de comparacion con flecha y texto ("12 % mas que el periodo anterior"), nunca solo color. Apoyos: el total pendiente es acumulado y lo dice ("Pendiente total, no depende del periodo"); el selector filtra solo lo entregado y devuelto en el periodo.
- Familia > Mi familia (solo el admin ve el control): campo "Dia de inicio del mes" (1 a 28) con una nota que explica el efecto y un ejemplo.
- Sin conexion: el cache de lecturas (Fase 12) se guarda por periodo y la cola no cambia; un periodo que nunca se abrio muestra "Sin datos guardados para este periodo".
- Con el sistema de diseno actual, a 390px, sin desborde horizontal, areas tactiles de 44px o mas, estados vacios y esqueletos.

**Pruebas**: backend (funciones puras con tablas de casos: limites del mes con dia de inicio 1, 15 y 28, primer y ultimo dia, cambio de anio, febrero y bisiesto, semana que cruza de mes, zona horaria de La Paz a las 21:00 y a las 00:30; saldo con apoyos, devoluciones y anulados; comparacion con anterior en 0 y distinto de 0; compatibilidad con `mes`; solo el admin cambia el dia; el historial lo registra); frontend unitarias (selector, flechas, rango, desactivar siguiente, conservar al navegar, reinicio al salir, comparacion, Mi familia) y E2E (cambiar a un periodo anterior, cambiar el dia de inicio como admin y ver el efecto en el saldo, un miembro no ve el control, periodo sin datos sin conexion); capturas en `capturas/`.

## Fase 17 - Privacidad
**Principio: la privacidad es entre las personas que usan la app; el que administra el servidor puede acceder tecnicamente a la base de datos y la interfaz lo dice.** No se toca ni se debilita el trigger de `historial` ni el de `bitacora`; ninguna prueba destructiva sobre `arca` ni `arca2` (limpieza solo con `TRUNCATE ... CASCADE` o recreando el esquema).

**Modelo y reglas**
- `movimientos.visibilidad` y `apoyos.visibilidad` (`solo_yo` | `familia` | `elegidas`, por defecto `familia`, `CHECK` en la base); `miembros.visibilidad_defecto` (`solo_yo` | `familia`); tabla `compartidos` (`entidad`, `entidad_id`, `usuario_id`, unica por trio) para `elegidas`. Las devoluciones NO tienen columna: heredan la del apoyo. Migracion `0007` que sube y baja.
- Ve un registro: su dueno, mas toda la familia si es `familia`, mas los elegidos si es `elegidas`. **El admin no ve lo privado ni lo compartido de otros.**
- Edita: el dueno; el admin solo lo que ve y es de `familia` (como antes). Lo compartido con personas es de solo lectura para todos menos el dueno. Devolucion: en un apoyo de `familia` cualquier miembro la registra (como antes); en uno privado o compartido, solo su dueno.
- Compartir solo con miembros ACTIVOS de la misma familia; cambiar la visibilidad sube la `version` y deja entrada `cambiar_visibilidad` en el historial, que solo ve el dueno.

**Backend**
- UN modulo `app/modulos/visibilidad/` (`service.py`: `condicion`, `filtrar`, `puede_ver`, `exigir_ver`, `condicion_historial`; `cambios.py`: escritura). PROHIBIDO escribir reglas de visibilidad sueltas en un endpoint.
- **404 en vez de 403**: lo que no puedes ver (privado de otro, de otra familia o inexistente) responde igual: mismo codigo, mismo cuerpo, sin diferencia de tiempo apreciable. Solo lo que SI ves pero no puedes modificar responde 403.
- Filtrados por visibilidad (tambien para el admin): `/movimientos`, `/actividad`, `/apoyos`, `/apoyos/resumen`, `/reportes/*` (los totales de cada persona son distintos; la respuesta trae `incluye_privados` con cuantos privados propios incluye), `/historial` (por registro y global, con la visibilidad ACTUAL del registro), `/bitacora` y su CSV.
- 409 por version y rechazos de sincronizacion: nunca llevan datos de un registro que ya no puedes ver; un UUID de cliente ya usado por un registro ajeno responde 409 generico.
- `GET/PATCH /privacidad` (preferencia), `POST /privacidad/aplicar-defecto` (pide `confirmar: true` y la `cantidad` vista), `PATCH /movimientos/{id}/visibilidad`, `PATCH /apoyos/{id}/visibilidad`, `GET /sincronizacion/visibles` (solo ids de lo que ves ahora).

**Frontend**
- Selector "Quien lo ve" (Solo yo | Familia | Personas...) en Nuevo movimiento y al editar, y "Compartir..." en el menu "..."; pantalla para elegir personas; candado con texto ("Solo tu", "Compartido con 2", "Compartido por Ana") nunca solo con icono; "Incluye tus N registros privados" bajo los totales; Mi perfil > Privacidad con la preferencia, "Aplicar a mis registros anteriores" (con confirmacion y cantidad) y la tarjeta "Que protege y que no".
- Sin conexion: al reconectar el telefono pide `/sincronizacion/visibles` y OLVIDA, tambien de su cache local, lo que dejo de ser visible (y los totales guardados que lo sumaban); lo pendiente en la cola no se toca.

**Pruebas**: backend (casos concretos y una MATRIZ que recorre todas las rutas y verifica que ninguna marca de un registro oculto aparece en ninguna respuesta, para dueno, admin, otro miembro, elegido y otra familia, con visibilidad solo_yo, familia y elegidas; una prueba falla si aparece una ruta nueva sin clasificar); unitarias (selector, etiquetas, preferencia, copia local) y E2E (`e2e/privacidad.spec.ts`: lo privado no lo ve el admin ni por URL, compartir y dejar de compartir, apoyo privado, pantalla Privacidad, copia sin conexion, dos familias); capturas 37 a 42 en `capturas/`.

## Fuera de v1
Notificaciones, presupuestos por categoria, fotos de facturas, exportar a Excel, multi-moneda.
