# Economía de liga, mercado compartido, cartas y desafíos diarios

Este documento explica cómo está construida la nueva economía (versión 2) sobre la aplicación que ya existía, qué conflictos aparecieron con la arquitectura anterior y cómo se resolvieron.

## 1. Mapa de la aplicación antes del cambio (auditoría)

| Área | Situación encontrada |
| --- | --- |
| Frontend | React 19 + Vite + TanStack Query + Tailwind v4 (`client/`). Mercado libre con filtros, Mi equipo, Alineación con arrastrar y soltar, Ligas, Admin. |
| Backend | Express 5 + Prisma 6 (`server/`). Servicios por dominio (`squad`, `lineup`, `scoring`, `price`, `league`…), validación con zod, planificador de tareas propio. |
| Base de datos | SQLite en local y PostgreSQL en producción, generado desde el mismo `schema.prisma`. Los cambios de esquema se aplican con `prisma db push` (no hay carpeta de migraciones). |
| Auth | JWT + bcrypt. Roles `USER` / `ADMIN`. |
| Equipos | **Un equipo por usuario** (`FantasyTeam.userId` único), compartido por todas sus ligas. |
| Ligas | Solo agrupan equipos para las clasificaciones (global, privadas, públicas…). No tenían economía propia. |
| Jugadores | Datos reales de la API de Fantasy Premier League (658 jugadores). Precio oficial en décimas de millón. |
| Mercado | Libre y global: cualquiera podía fichar a cualquier jugador; varios equipos podían tener al mismo jugador. |
| Puntuación | Motor configurable por reglas + sustituciones automáticas + capitán/vicecapitán (`domain/lineup.ts`). |
| Precios | Subidas/bajadas de ±£0.1M por rendimiento y demanda al cerrar cada jornada. |
| Entrenadores | No existían. La API de FPL no los incluye. |
| Cartas / minijuegos | No existían. |
| Dinero | Enteros en décimas de millón (`budget`) con registro en `transactions`. |

## 2. Conflictos con la especificación y solución adoptada

### 2.1 Propiedad y mercado «por liga» frente a un único equipo por usuario

La especificación pide que cada liga tenga su propio mercado y que la propiedad de un jugador sea única **dentro de cada liga**. La aplicación tiene un solo equipo por usuario, y ese equipo alimenta la alineación, la puntuación, las clasificaciones y el dashboard. Rehacerlo como «un equipo por liga» habría obligado a reescribir casi todo el backend y el frontend.

**Solución.** Cada equipo juega la economía de **una** liga, su «partida» (`FantasyTeam.economyLeagueId`):

- Dentro de esa liga, la propiedad es única gracias a la restricción `league_player_ownerships (leagueId, playerId)`. En otra liga, el mismo jugador puede pertenecer a otro equipo.
- El equipo sigue compitiendo en las clasificaciones del resto de sus ligas y en la liga global, igual que antes.
- Al crear una liga, o al unirse a una, un equipo que todavía no juega ninguna partida recibe automáticamente su equipo inicial y su presupuesto.
- Si el equipo ya juega en otra liga, entra solo para la clasificación, y la página de la liga lo explica.

### 2.2 Unidad monetaria

El sistema antiguo guarda el dinero en décimas de millón (£0.1M), así que premios como £750.000 no se pueden representar.

**Solución.** La economía de liga usa **miles de libras (k£)** en columnas nuevas:

- `FantasyTeam.wallet` es el monedero de la liga.
- `Player.marketValue` y `Coach.marketValue` guardan los valores de la liga.
- `MarketListing.listingPrice` guarda el precio fijo de cada anuncio.

Las columnas antiguas (`budget`, `price`) no se tocan. Cada movimiento de `transactions` indica su moneda (`currency`: `TENTHS` o `K`). Si un equipo del sistema clásico gana un premio, se le abona redondeado a la baja a £0.1M.

### 2.3 Valores de mercado frente al precio oficial de FPL

El precio oficial de FPL va de £4M a £15M; la especificación pide estrellas de £90M a £200M.

**Solución.** Cada jugador recibe un valor propio de liga (`marketValue`) calculado a partir de su precio real con una curva configurable:

`valor inicial = base × (precio FPL / 4,0) ^ exponente`

Con la base (£10M) y el exponente (2,5) por defecto, los valores iniciales quedan así:

| Jugador | Valor inicial |
| --- | --- |
| Saka | ≈ £87M |
| Palmer | ≈ £92M |
| Bruno Fernandes | ≈ £156M |
| Haaland | £250M (máximo configurado) |

Desde ahí, el valor evoluciona con la fórmula de rendimiento (apartado 5). El precio oficial de FPL se conserva para el sistema clásico.

### 2.4 Entrenadores reales

FPL no publica entrenadores. Se obtienen de la API oficial de la Premier League (`footballapi.pulselive.com`): el «Manager» activo de cada club en la temporada. Los clubes se enlazan por el código Opta, que es el mismo `code` que usa FPL.

- La sincronización se hace al arrancar si no hay entrenadores, una vez al día si la sincronización automática está activa, y desde Administración → Economía.
- El valor inicial de un entrenador es un porcentaje configurable del valor medio de los 11 jugadores más valiosos de su club.
- Un entrenador suma puntos según los resultados reales de su club (victoria, empate, derrota, portería a cero, goles a favor; todo configurable). Cuenta el entrenador que el equipo tenía antes del primer partido de su club en la jornada, igual que ocurre con los jugadores.

### 2.5 Tamaño de plantilla y alineación

El equipo inicial tiene 13 jugadores (11 titulares y 2 suplentes, configurable). La plantilla puede crecer hasta 18, con máximos por posición configurables.

El motor de alineación existente se reutiliza sin cambios: el banquillo admite hasta 4 suplentes y el resto de la plantilla queda fuera de la convocatoria, igual que antes. Para vender un jugador, la plantilla tiene que poder seguir formando un once válido.

## 3. Entidades nuevas

| Especificación | Implementación (`server/prisma/schema.prisma`) |
| --- | --- |
| LeagueMarket | Campos de `League`: `economyVersion`, `marketTimezone`, `marketResetMinute`, `marketPityCounter`, `economyStartedAt` |
| MarketCycle | `MarketCycle`, único por `(leagueId, startsAt)` |
| MarketListing | `MarketListing`, con precio fijo `listingPrice` y estado `AVAILABLE` / `SOLD` |
| LeaguePlayerOwnership | `LeaguePlayerOwnership`, único por `(leagueId, playerId)` y por `(teamId, playerId)`, y `LeagueCoachOwnership` para entrenadores |
| Enfriamiento tras la venta | `LeagueAssetCooldown` |
| PlayerValuationHistory / CoachValuationHistory | `PlayerValuation` / `CoachValuation`, únicos por `(jugador, jornada, motivo)` |
| PowerUpCard / UserCardInventory | `PowerUpCard` / `TeamCard`, con `sourceRef` único para que una concesión nunca se duplique |
| AppliedCard / CardUsage | `CardActivation`, con `requestId` único, y `CardUsageLog` |
| DailyChallenge / Attempt / Reward / Streak | `DailyChallenge` `(type, date)`, `DailyChallengeAttempt` `(userId, date, type)`, `DailyChallengeReward` `(attemptId)` y `DailyStreak` `(userId, type)` |
| EconomyTransaction | Se amplía la tabla existente `transactions` con `currency`, `balanceBefore`, `userId`, `leagueId`, `reference` y `operationId`. La unicidad de `operationId` la garantiza la tabla nueva `economy_operation_keys`, para no añadir una restricción única a una tabla con datos (eso bloquearía el `db push` del despliegue). |
| MarketAuditLog | `MarketAuditLog`. Se conserva aunque se borre la liga. |

Todos los cambios del esquema son **aditivos**: tablas nuevas y columnas con valor por defecto. No se ha borrado ni transformado ningún dato existente.

## 4. Mercado diario compartido

- **Ciclo diario.** Por defecto, la hora de reinicio de cada liga es la hora local en que se creó; se puede cambiar desde la página de la liga (su administrador) o desde Administración. Las fechas se guardan en UTC y el reinicio se calcula con la zona horaria IANA de la liga, horario de verano incluido. Es el servidor quien decide el ciclo vigente; el reloj del navegador no interviene.
- **Generación.** El ciclo se crea al abrir el mercado o desde la tarea que corre cada minuto. Si dos peticiones lo generan a la vez, la restricción única `(leagueId, startsAt)` hace que solo una prospere y la otra reutiliza su resultado.
- **Selección.** Hay N jugadores (10 por defecto) y entre 1 y 2 entrenadores. Primero se elige la rareza según las probabilidades configuradas y después un jugador al azar de esa rareza.
  - Se excluyen los jugadores que ya tienen dueño en la liga y los que están en enfriamiento tras una venta.
  - Un límite de diversidad restringe cuántos jugadores pueden compartir posición; si no hay alternativa, el límite se relaja.
- **Protección contra la mala suerte (pity).** Cada día sin un jugador de rareza alta, las rarezas altas multiplican su peso (+25 % por día, hasta ×4). Al llegar al número de días configurado (7 por defecto) se garantiza uno. El contador vuelve a 0 cuando aparece.
- **Precio fijo.** El precio de cada anuncio es el valor del jugador en el momento de generar el mercado y no cambia durante el ciclo.

### Compra atómica

Todo ocurre dentro de **una transacción** (`market.service.ts → buyListing`):

1. El usuario pertenece a la liga y a su partida, y el mercado está abierto y vigente.
2. *Compare-and-set* sobre el anuncio: `UPDATE … WHERE id = ? AND status = 'AVAILABLE'`. Solo una transacción puede cambiarlo a `SOLD`.
3. Débito condicional del monedero (`WHERE wallet >= precio`). Esto bloquea la fila del equipo hasta el final de la transacción.
4. Reglas de plantilla (tamaño, posición, club), comprobadas con los datos ya bloqueados.
5. Propiedad única por liga (restricción `leagueId + playerId`).
6. Movimiento económico con una clave de idempotencia (`economy_operation_keys`) y registro de auditoría.

Si falla cualquier paso, se deshace todo. Con dos compras simultáneas solo una consigue el jugador; la otra recibe *«Este jugador acaba de ser comprado por otro usuario.»* y no se le cobra nada. Los rechazos quedan en la auditoría.

Los demás mánagers ven el anuncio como vendido en un máximo de 15 segundos. La pantalla del mercado se consulta periódicamente mientras está visible (la aplicación no usa WebSockets) y se refresca al momento si una compra falla por conflicto o termina el ciclo.

### Venta

- La venta se hace al banco, al valor actual por el porcentaje configurable (100 % por defecto).
- Se borra la propiedad con un borrado condicional, de modo que una doble venta simultánea solo cobra una vez.
- El jugador sale de las alineaciones que aún no están cerradas y entra en un enfriamiento de 48 horas (configurable) antes de poder volver al mercado de esa liga.
- Un jugador cuyo partido de la jornada ya ha empezado no se puede vender.

## 5. Valoración dinámica

```
nuevoValor = valorActual × (1 + variación)
variación  = sensibilidad × (wÚltima·zÚltima + wPromedio·zPromedio + wTendencia·zTendencia)
             × amortiguación por irregularidad × elasticidad del valor
z          = (puntos − esperados) / escala
```

- **Puntos esperados.** Es la media real de los jugadores de su misma rareza en las últimas jornadas.
- **Suavizado.** La última jornada pesa un 40 % y el resto viene del promedio y la tendencia, así que un solo partido no dispara el valor.
- **Irregularidad.** Cuanto más irregular es un jugador, menos se mueve su valor.
- **Elasticidad.** Los valores altos cambian menos en porcentaje.
- **Límites.** La variación está limitada a [−8 %, +8 %] por jornada y el valor final a [£0.5M, £250M]. Si el club no jugó, el valor no cambia.
- **Idempotencia.** Se marca `Gameweek.valuationsUpdated` y el historial es único por (jugador, jornada, motivo).

Todos los parámetros se editan en Administración → Configuración → Valoración. La rareza se recalcula tras cada jornada con los percentiles combinados de valor, puntos de la temporada y forma reciente.

## 6. Cartas

- Cada carta es de un solo uso (`TeamCard`) y se activa para la próxima jornada **antes de su cierre** (`Gameweek.deadline`). Hasta el cierre se puede desactivar; después queda bloqueada.
- **Idempotencia.** Cada activación lleva un `requestId` (UUID generado al abrir el formulario) y el paso de `AVAILABLE` a `ACTIVE` es condicional: un doble clic no gasta dos cartas.
- **Límites.** Hay un máximo de cartas activas por jornada, un máximo por efecto y un máximo de cartas de presión por jugador rival. Las activaciones se serializan bloqueando la fila del equipo.
- **Doble puntos.** Se usa sobre un jugador de la plantilla propia.
- **Presión (-20 %).** Se usa sobre un jugador de un rival con el que se comparte una liga (sin contar la global). Solo resta puntos Fantasy positivos; las estadísticas reales no cambian.
- **Obtención.** Por premios de racha, desafíos, eventos o concesión desde administración. No hay compra con dinero real.

### Orden de los modificadores (documentado y probado)

1. Puntos base del jugador (motor de puntuación con estadísticas reales).
2. Cartas de penalización (presión): un % de los puntos positivos, acumulable hasta el 100 %.
3. Cartas de potenciación (doble puntos): se aplica el mayor multiplicador; no se acumulan entre sí.
4. Capitán y reglas existentes. El ajuste `card_captain_stacking` decide qué pasa si el capitán tiene doble puntos:
   - `MAX` (por defecto): se usa el mayor multiplicador, así que un capitán con doble puntos sigue siendo ×2 y no ×4.
   - `STACK`: los multiplicadores se acumulan.
5. Los suplentes que no entran no suman, tengan o no cartas.

Al cerrar la jornada, las activaciones pasan a `APPLIED` con su efecto en puntos y la carta a `USED`. Los rivales afectados reciben una notificación. Volver a procesar la jornada no duplica el efecto.

## 7. Desafíos diarios (Wordle)

- **Palabra del día.** El servidor calcula la fecha en la zona horaria configurada. La palabra es la misma para todos (`DailyChallenge (WORDLE, fecha)`) y se elige al azar de la lista editable, evitando repetir las recientes.
- **La palabra no sale del servidor.** Se envía al cliente solo cuando la partida termina; cada intento se evalúa en el servidor.
- **Una partida al día.** Hay una partida por usuario, fecha y tipo (restricción única). Recargar, cerrar sesión, cambiar la hora del PC o manipular el frontend no la reinicia.
- **Intentos.** Cada intento se registra con *compare-and-set* sobre el número de intentos: peticiones simultáneas no cuentan doble.
- **Recompensa.**
  - Se abona en la misma transacción en que se marca la victoria, con el `operationId` `challenge:<intento>`.
  - La tabla de recompensas tiene una fila única por partida.
  - Premios por defecto: £1M en los intentos 1–2, £750K en los intentos 3–4, £600K en el 5.º, £500K en el 6.º y nada si no se acierta.
- **Racha.** Cuenta los días que se acierta (configurable a «días jugados») y se reinicia si se salta un día. Los hitos (3, 7, 14 y 30 días) dan dinero y/o cartas, y son configurables en JSON.
- **Palabras.** Se aceptan palabras de 5 letras (con Ñ) sin diccionario de validación. La lista de soluciones se edita en Administración.
- **Nuevos desafíos.** La arquitectura es común para cualquier tipo: basta con añadir un tipo a `CHALLENGE_TYPES` y su servicio.

## 8. Migración del sistema antiguo

- No se borra nada automáticamente. Los equipos existentes siguen en la economía clásica (`economyVersion = 1`) con su mercado libre, su presupuesto y su plantilla.
- Los equipos y ligas nuevos usan la economía de liga, según los ajustes `economy_v2_new_teams` y `economy_v2_new_leagues`.
- **Por equipo.** Desde la página de una liga con economía, el mánager puede pasar su equipo clásico a esa partida, con una confirmación explícita. La plantilla anterior queda en la auditoría (`ECONOMY_JOINED.previous`).
- **Por liga.** Administración → Economía → «Migrar a economía de liga». La liga global no se migra: sigue siendo la clasificación general.
- **REINICIALIZAR ECONOMÍA DE LIGA.** Es una acción administrativa que exige escribir `REINICIALIZAR`.
  - Antes de hacer nada guarda una instantánea completa en la auditoría.
  - Después libera las plantillas y monederos, borra el mercado vigente y reparte equipos iniciales nuevos.
  - Conserva las jornadas, los puntos, los mercados anteriores y los movimientos económicos.

## 9. Configuración (Administración → Configuración)

Todos los parámetros se validan antes de guardar; por ejemplo, las rarezas no pueden sumar más del 100 %, la zona horaria tiene que ser IANA y los premios de racha tienen que ser un JSON válido. Están organizados en estos grupos:

- **Economía de liga**, **Equipo inicial**, **Mercado de liga** (incluye las probabilidades y la protección pity), **Rareza** y **Valoración**.
- **Entrenadores**, **Cartas** y **Desafíos diarios**.

Las cartas (nombre, rareza, efecto, límites, si se pueden activar y si se pueden conseguir) se editan en Administración → Economía → Cartas.

## 10. Pruebas

`npm test` (servidor) ejecuta 66 pruebas:

- `tests/domain.test.ts`: las 21 pruebas anteriores de puntuación, alineaciones y precios.
- `tests/economy.test.ts`: 27 pruebas unitarias de dominio.
  - Equipo inicial: 13 jugadores con la formación correcta, sin repetidos, ponderado y sin estrellas cuando su peso es 0.
  - Mercado: 10 jugadores sin duplicados y sin comprados, rareza, pity, diversidad y entre 1 y 2 entrenadores.
  - Rarezas y valoración: subida, bajada, límites, suavizado y elasticidad.
  - Zonas horarias y horario de verano, Wordle (evaluación, tildes y Ñ, premios), rachas, modificadores de cartas y puntos de entrenador.
- `tests/economy.integration.test.ts`: 18 pruebas contra una copia de la base de datos real.
  - Equipo inicial y £100M para cuatro mánagers, y propiedad única.
  - Ciclo único ante 5 peticiones simultáneas.
  - Compra simultánea con un único ganador y sin cobro al perdedor.
  - Rechazo por falta de presupuesto con reversión de la transacción.
  - Venta con enfriamiento.
  - Wordle: intentos simultáneos, 6 intentos como máximo, sin reinicio y premio único ante peticiones repetidas.
  - Cartas: activación idempotente, carrera de activaciones, presión con límite y bloqueo tras el cierre.
  - Doble puntos aplicada dentro del motor de puntuación real, idempotente al reprocesar la jornada.
  - Valoración por jornada idempotente.
  - Salida de la partida y reinicio de la economía.

**Límite de las pruebas.** La concurrencia se ha probado sobre SQLite, que serializa las escrituras. En PostgreSQL, las mismas garantías vienen de las actualizaciones condicionales (`UPDATE … WHERE status = 'AVAILABLE'`, `WHERE wallet >= precio`) y de las restricciones únicas, que son seguras en `READ COMMITTED`. No hay una prueba automática contra PostgreSQL.
