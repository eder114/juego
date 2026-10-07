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

### 2.1 Un equipo por usuario y liga

La especificación pide que cada liga tenga su propio mercado y que la propiedad de un jugador sea única **dentro de cada liga**. La aplicación nació con un solo equipo por usuario, y ese equipo alimentaba alineación, puntuación, clasificaciones y dashboard.

**Solución.** La unidad del juego es ahora **usuario + liga = equipo**:

- `fantasy_teams` tiene `leagueId` y la restricción `UNIQUE(userId, leagueId)`: un usuario tiene como mucho un equipo en cada liga, y tantos equipos como ligas juegue.
- El equipo creado al registrarse vive en la **liga global** y mantiene el sistema clásico (`economyVersion 1`, presupuesto en décimas de millón).
- Al unirse a una liga con economía se crea un equipo nuevo para esa liga, con sus 13 jugadores iniciales y su monedero de £100M. Nada de lo que ocurre allí toca a los demás equipos del usuario.
- Presupuesto, plantilla, alineación, cartas, fichajes, historial de movimientos y estadísticas son independientes por equipo, es decir, por liga.
- La propiedad es única dentro de cada liga gracias a `league_player_ownerships (leagueId, playerId)`. El mismo jugador puede pertenecer a mánagers distintos en ligas distintas, y un mánager puede tener al mismo jugador en dos de sus ligas.
- Cada liga tiene su propio ciclo de mercado (`market_cycles`), con su horario y su zona horaria: los mercados nunca se comparten entre ligas.
- Al abandonar una liga se elimina el equipo de esa liga (con una instantánea previa en la auditoría) y se liberan sus jugadores. El equipo de la liga global nunca se puede borrar así.
- La clasificación global es la de la liga global; la de cada liga sólo incluye los equipos de esa liga.
- El frontend guarda la liga activa (`LeagueContext` + `pf_active_league`) y la envía como `?league=` en cada petición de equipo. Al cambiar de liga se descarta la caché de consultas para no mostrar datos de la liga anterior.

#### Migración de los datos existentes

Los equipos anteriores no se borran: al arrancar, `ensureTeamLeagues()` asigna a cada equipo sin liga su `economyLeagueId` o, si no jugaba ninguna economía, la liga global, y garantiza su pertenencia a esa liga. La columna `economyLeagueId` se mantiene como campo obsoleto para no romper los datos históricos.

Como consecuencia, el ajuste `economy_v2_new_teams` desaparece: la economía de un equipo la decide la liga en la que se crea, no un interruptor global.

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
| Auction | `MarketListing`: cada anuncio ES la subasta. `listingPrice` es el precio de salida, `topBid` / `topBidTeamId` la puja más alta viva, `bidCount` / `bidderCount` la actividad y `finalPrice` / `buyerTeamId` / `settledAt` el resultado. Estados: `AVAILABLE` (abierta), `SOLD` (adjudicada), `UNSOLD` (desierta). |
| AuctionBid | `MarketBid`, único por `(listingId, teamId, amount)` para que un doble clic no duplique una puja. Las pujas anteriores nunca se sobrescriben: pasan a `OUTBID`, y tras el cierre a `WON` / `LOST`. |
| BudgetReservation | `BudgetReservation`, única por `(teamId, listingId)`, con estados `HELD` / `RELEASED` / `SPENT`. La suma de las reservas vivas de un equipo es su columna `fantasy_teams.reserved`. |
| LeaguePlayerOwnership | `LeaguePlayerOwnership`, único por `(leagueId, playerId)` y por `(teamId, playerId)`, y `LeagueCoachOwnership` para entrenadores |
| Enfriamiento tras la venta | `LeagueAssetCooldown` |
| PlayerValuationHistory / CoachValuationHistory | `PlayerValuation` / `CoachValuation`, únicos por `(jugador, jornada, motivo)` |
| PowerUpCard / UserCardInventory | `PowerUpCard` / `TeamCard`, con `sourceRef` único para que una concesión nunca se duplique |
| AppliedCard / CardUsage | `CardActivation`, con `requestId` único, y `CardUsageLog` |
| DailyChallenge / Attempt / Reward / Streak | `DailyChallenge` `(type, date)`, `DailyChallengeAttempt` `(userId, date, type)`, `DailyChallengeReward` `(attemptId)` y `DailyStreak` `(userId, type)` |
| EconomyTransaction | Se amplía la tabla existente `transactions` con `currency`, `balanceBefore`, `userId`, `leagueId`, `reference` y `operationId`. La unicidad de `operationId` la garantiza la tabla nueva `economy_operation_keys`, para no añadir una restricción única a una tabla con datos (eso bloquearía el `db push` del despliegue). |
| MarketAuditLog | `MarketAuditLog`. Se conserva aunque se borre la liga. |

Todos los cambios del esquema son **aditivos**: tablas nuevas y columnas con valor por defecto. No se ha borrado ni transformado ningún dato existente.

## 4. Mercado de subastas compartido

El mercado de cada liga es un **mercado de subastas**: los jugadores no se compran, se pujan. Todas las subastas
de un mercado abren y cierran exactamente con su ciclo, así que no hay temporizadores por jugador ni prórrogas.

```
LIGA ─▶ MERCADO (24 h) ─┬─▶ SUBASTA Salah ─┬─▶ pujas
                        ├─▶ SUBASTA Saka  ─┤
                        └─▶ SUBASTA Palmer─┘
                                 │
                        cierre simultáneo
                                 ▼
             adjudicar · cobrar · devolver · generar el mercado siguiente
```

### El ciclo

- **Duración.** 24 horas por defecto (`market_cycle_hours`). La hora de reinicio de cada liga es la hora local en
  que se creó y se puede cambiar desde la página de la liga o desde Administración. Las fechas se guardan en UTC y
  el reinicio se calcula con la zona horaria IANA de la liga, horario de verano incluido. Con 24 h exactas el
  siguiente cierre es la misma hora local del día siguiente, de modo que el cambio de hora no desplaza el mercado.
- **Quién decide la hora.** Siempre el servidor. La respuesta del mercado incluye `serverTime` y el navegador
  corrige su desfase con él: cambiar la hora del ordenador no adelanta ni retrasa nada.
- **Generación.** El ciclo se crea al abrir el mercado o desde la tarea que corre cada minuto. Si dos peticiones lo
  generan a la vez, la restricción única `(leagueId, startsAt)` hace que solo una prospere y la otra reutiliza su
  resultado. Antes de generar uno nuevo se liquida el anterior, de modo que el dinero retenido se resuelve antes
  de que empiecen las pujas siguientes.
- **Selección.** Hay N jugadores (10 por defecto) y entre 1 y 2 entrenadores, idénticos para todos los mánagers de
  la liga. Primero se elige la rareza según las probabilidades configuradas y después un jugador al azar de esa
  rareza. Se excluyen los que ya tienen dueño en la liga y los que están en enfriamiento tras una venta, y un
  límite de diversidad restringe cuántos pueden compartir posición.
- **Protección contra la mala suerte (pity).** Cada día sin un jugador de rareza alta, las rarezas altas multiplican
  su peso (+25 % por día, hasta ×4). Al llegar al número de días configurado (7 por defecto) se garantiza uno.

### Precio de salida y precio final

El **precio de salida** (`listingPrice`) es un porcentaje configurable del valor del jugador (90 % por defecto),
acotado entre un mínimo y un máximo. El **precio final** es la puja más alta al cerrar el mercado, así que puede
quedar muy por encima del valor:

| Campo | Significado |
| --- | --- |
| `Player.marketValue` | Valor del jugador según su rendimiento real |
| `MarketListing.listingPrice` | Precio de salida de la subasta |
| `MarketListing.topBid` | Puja más alta viva |
| `MarketListing.finalPrice` | Precio pagado por el ganador |
| `bidCount` / `bidderCount` | Cuántas pujas y cuántos mánagers distintos |

### Pujar (`auction.service.ts → placeBid`)

Una puja tiene que superar a la actual en al menos la **subida mínima** configurada (£0.5M por defecto); la primera
tiene que alcanzar el precio de salida. Todo se decide en **una transacción**:

1. El usuario pertenece a la liga, tiene equipo en ella y el mercado está abierto y vigente (`now < cycle.endsAt`).
2. El jugador cabría en su plantilla contando **también las subastas que ya va ganando**: así nadie puede liderar
   más pujas de las que podría llegar a fichar.
3. Se lee el estado real de la subasta dentro de la transacción y se escribe con una comparación condicional sobre
   esa misma puja (`WHERE topBid = <la leída> AND topBidTeamId = <el leído> AND status = 'AVAILABLE'`). Si otro
   mánager pujó entremedias, la escritura no afecta a ninguna fila y la petición se rechaza con un 409.
4. El importe se compara con el mínimo calculado a partir del estado recién leído, nunca con lo que dijera el
   navegador.
5. **Dinero.** Se retiene la diferencia respecto a lo que ese equipo ya tuviera comprometido en esa misma subasta
   (subir de £80M a £95M retiene £15M más, no £95M). La retención se hace con un `UPDATE … WHERE wallet - reserved
   >= <importe>`, de modo que la base de datos impide comprometer más dinero del disponible aunque lleguen varias
   pujas a la vez. Al líder anterior se le libera su reserva en el acto.
6. La puja se guarda en el historial y las anteriores pasan a `OUTBID`. Un doble clic con el mismo importe choca
   con la restricción única `(listingId, teamId, amount)` y no duplica nada.

Al mánager superado le llega un aviso con la puja que le ha pasado por delante.

### Dinero disponible y dinero retenido

`fantasy_teams.wallet` es el saldo total y `fantasy_teams.reserved` lo comprometido en pujas vivas. Lo que se puede
gastar es **`wallet − reserved`**, y es lo que muestran la cabecera, el mercado, la plantilla y la página de
movimientos. Cualquier cargo del sistema (fichajes, cartas, ajustes) pasa por el mismo `UPDATE` condicional, así que
el dinero retenido en una subasta no se puede gastar en ninguna otra cosa.

### Cierre y liquidación (`auction.service.ts → settleCycle`)

Al vencer `cycle.endsAt` ya no se admite ninguna puja más. La liquidación recorre las subastas del ciclo y cierra
cada una **en su propia transacción**, de modo que una incidencia puntual no bloquea al resto:

- **Con ganador:** se marca `SOLD` con una escritura condicional (`WHERE status = 'AVAILABLE'`), se cobra al ganador
  el dinero que ya tenía retenido (baja `wallet` y `reserved` a la vez), se crea la propiedad única de la liga y la
  ficha en su plantilla, su reserva pasa a `SPENT`, las pujas perdedoras a `LOST` y sus reservas se liberan.
- **Sin pujas:** la subasta queda `UNSOLD`; no se cobra ni se adjudica nada y el jugador podrá volver a salir otro
  día en esa liga.
- **Si el ganador ya no tiene hueco** (llenó su plantilla entretanto) la subasta se anula: no se le cobra, se le
  avisa y el jugador queda libre.

Todo es **idempotente**: el cambio de estado es condicional y el cobro lleva clave de idempotencia
(`auction:<listingId>` en `economy_operation_keys`), así que repetir la liquidación no cobra ni adjudica dos veces.
Ganadores y perdedores reciben su aviso, y el resultado queda en la auditoría (`AUCTION_WON`, `AUCTION_UNSOLD`,
`AUCTION_VOID`). El cierre lo dispara la tarea que corre cada 30 segundos y también la generación del ciclo
siguiente, que no se produce hasta que el anterior está liquidado.

### Actualización en vivo

La aplicación no usa WebSockets: el mercado se mantiene al día con **consultas periódicas**, igual que el resto de
la aplicación. La vista completa se pide cada 15 segundos y, además, hay un **latido** mucho más ligero
(`GET /market/league/pulse`) que cada 5 segundos devuelve solo lo que cambia: hora del servidor, saldo, dinero
retenido y, por subasta, la puja más alta, si la lideras, tu puja y el mínimo siguiente. Con eso la tarjeta pasa
sola a «Oferta superada» sin recargar, y el latido sigue corriendo aunque la pestaña no tenga el foco. Al llegar el
cierre la página vuelve a pedirlo todo para mostrar el resultado y el mercado nuevo.

### Estados que ve el mánager

`VAS GANANDO` · `OFERTA SUPERADA` · `SIN OFERTAS` · `SUBASTA FINALIZADA` (adjudicada o desierta). Cada tarjeta
muestra el precio de salida o la oferta actual, tu oferta, cuántas pujas lleva, el contador común del mercado y el
historial completo de la subasta.

### Venta

La venta sigue siendo al banco (las subastas son solo del mercado diario):

- Se vende al valor actual por el porcentaje configurable (100 % por defecto).
- Se borra la propiedad con un borrado condicional, de modo que una doble venta simultánea solo cobra una vez.
- El jugador sale de las alineaciones que aún no están cerradas y entra en un enfriamiento de 48 horas
  (configurable) antes de poder volver al mercado de esa liga.
- Un jugador cuyo partido de la jornada ya ha empezado no se puede vender.

### Abandonar la liga con pujas vivas

Al salir de una liga (o al reinicializar su economía) se cancelan las pujas de ese equipo, se libera su dinero y las
subastas que lideraba vuelven a quedar sin oferta, para que el resto de mánagers pueda seguir pujando por ellas.

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
- Las ligas nuevas usan la economía de liga según el ajuste `economy_v2_new_leagues`; cada equipo hereda la economía de la liga en la que se crea.
- **Por equipo.** Desde la página de una liga con economía, el mánager puede pasar su equipo clásico a esa partida, con una confirmación explícita. La plantilla anterior queda en la auditoría (`ECONOMY_JOINED.previous`).
- **Por liga.** Administración → Economía → «Migrar a economía de liga». La liga global no se migra: sigue siendo la clasificación general.
- **REINICIALIZAR ECONOMÍA DE LIGA.** Es una acción administrativa que exige escribir `REINICIALIZAR`.
  - Antes de hacer nada guarda una instantánea completa en la auditoría.
  - Después libera las plantillas y monederos, borra el mercado vigente y reparte equipos iniciales nuevos.
  - Conserva las jornadas, los puntos, los mercados anteriores y los movimientos económicos.

## 9. Configuración (Administración → Configuración)

Todos los parámetros se validan antes de guardar; por ejemplo, las rarezas no pueden sumar más del 100 %, la zona horaria tiene que ser IANA y los premios de racha tienen que ser un JSON válido. Están organizados en estos grupos:

- **Economía de liga**, **Equipo inicial**, **Mercado de liga** y **Rareza** y **Valoración**.
- En **Mercado de liga** están, además de las probabilidades y la protección pity: la duración del ciclo
  (`market_cycle_hours`), la subida mínima entre pujas (`market_min_increment`), el precio de salida como porcentaje
  del valor (`market_start_percent`) y sus topes (`market_start_min`, `market_start_max`), cuántos jugadores y
  entrenadores salen cada día y el enfriamiento tras una venta. La hora de cierre y la zona horaria son de cada
  liga. Aunque hoy el ciclo sea de 24 horas, la duración ya es un ajuste: cambiarla afecta al mercado siguiente.
- **Entrenadores**, **Cartas** y **Desafíos diarios**.

Las cartas (nombre, rareza, efecto, límites, si se pueden activar y si se pueden conseguir) se editan en Administración → Economía → Cartas.

## 9 bis. Presentación del equipo inicial

Cuando el backend reparte el equipo inicial, el usuario no entra directamente al dashboard: primero ve una presentación en la que sus 13 jugadores se revelan uno a uno.

- **Estado en el servidor.** `joinEconomy` guarda el reparto (`FantasyTeam.initialSquad`: formación, titulares y suplentes) dentro de la misma transacción que asigna los jugadores, y deja `initialRevealedAt` vacío. Los estados son: sin partida (`NOT_ASSIGNED`), repartido y pendiente de ver (`PENDING`) y ya visto (`COMPLETED`).
- **API.** `GET /api/leagues/:id/initial-team` devuelve el estado, los jugadores reales en orden de revelación (titulares y después suplentes), la formación, el presupuesto y el valor del equipo. `POST /api/leagues/:id/initial-team/complete` marca la presentación como vista y es idempotente. Ninguna de las dos asigna jugadores.
- **Entrada automática.** `/auth/me` indica si hay una presentación pendiente, y mientras lo esté el usuario entra en la pantalla de presentación en lugar del dashboard.
- **La pantalla no asigna nada.** Solo muestra lo que el backend ya guardó: foto, nombre, apellidos, club con escudo, posición, valor, puntos y si es titular o suplente. Si la API falla, se muestra un error con «Reintentar» y nunca jugadores inventados.
- **Recargar durante la animación** no reparte otro equipo: la presentación vuelve a empezar, pero los 13 jugadores y el presupuesto son los mismos (la asignación ya ocurrió una sola vez).
- **Al terminar** (o al pulsar «Saltar presentación») se marca como vista y se entra en «Mi equipo». Al volver a la liga no reaparece.
- **Animación.** Revelación de tarjeta, destello, progreso («Jugador 4 de 11» / «Suplente 1 de 2»), transición de «Suplentes» y resumen final. Si el jugador más valioso del reparto destaca mucho sobre el resto, su revelación lleva un realce extra; esto no cambia qué jugadores toca. Con `prefers-reduced-motion` se muestra el resumen completo sin animaciones ni avances automáticos.

## 10. Pruebas

`npm test` (servidor) ejecuta 92 pruebas:

- `tests/domain.test.ts`: las 21 pruebas anteriores de puntuación, alineaciones y precios.
- `tests/economy.test.ts`: 27 pruebas unitarias de dominio.
  - Equipo inicial: 13 jugadores con la formación correcta, sin repetidos, ponderado y sin estrellas cuando su peso es 0.
  - Mercado: 10 jugadores sin duplicados y sin comprados, rareza, pity, diversidad y entre 1 y 2 entrenadores.
  - Rarezas y valoración: subida, bajada, límites, suavizado y elasticidad.
  - Zonas horarias y horario de verano, Wordle (evaluación, tildes y Ñ, premios), rachas, modificadores de cartas y puntos de entrenador.
- `tests/economy.integration.test.ts`: 44 pruebas contra una copia de la base de datos real.
  - Equipo inicial y £100M para cuatro mánagers, y propiedad única.
  - Ciclo único ante 5 peticiones simultáneas.
  - Pujas simultáneas: solo una se convierte en la oferta más alta y solo ella retiene dinero.
  - Rechazo por falta de dinero disponible, sin tocar la subasta.
  - Subastas de principio a fin: primera puja al precio de salida, superación con devolución inmediata, subir la
    propia puja retiendo solo la diferencia, doble clic sin duplicar, no comprometer dinero ya reservado, no pujar
    desde fuera de la liga, estado intacto al recargar, cierre con adjudicación y cobro al ganador, devolución
    íntegra a los perdedores, liquidación idempotente, rechazo de pujas tras el cierre, subastas desiertas sin
    cobro, generación automática del mercado siguiente y el mismo jugador subastado en otra liga con presupuestos
    independientes.
  - Venta con enfriamiento.
  - Wordle: intentos simultáneos, 6 intentos como máximo, sin reinicio y premio único ante peticiones repetidas.
  - Cartas: activación idempotente, carrera de activaciones, presión con límite y bloqueo tras el cierre.
  - Doble puntos aplicada dentro del motor de puntuación real, idempotente al reprocesar la jornada.
  - Valoración por jornada idempotente.
  - Salida de la partida y reinicio de la economía.
  - Presentación del equipo inicial: queda pendiente tras el reparto, coincide exactamente con la plantilla guardada, marcarla como vista es idempotente y no toca jugadores ni presupuesto, y tras reinicializar la liga vuelve a quedar pendiente.
  - Equipos independientes por liga: la segunda liga reparte una plantilla propia; el mismo jugador puede tener dueños distintos en ligas distintas pero nunca dos en la misma; comprar o vender en una liga no altera la otra; alineaciones, cartas e historial separados; cada liga recupera su equipo y su ciclo de mercado; la clasificación de una liga sólo incluye sus equipos.

**Límite de las pruebas.** La concurrencia se ha probado sobre SQLite, que serializa las escrituras. En PostgreSQL, las mismas garantías vienen de las actualizaciones condicionales (`UPDATE … WHERE status = 'AVAILABLE'`, `WHERE wallet >= precio`) y de las restricciones únicas, que son seguras en `READ COMMITTED`. No hay una prueba automática contra PostgreSQL.
