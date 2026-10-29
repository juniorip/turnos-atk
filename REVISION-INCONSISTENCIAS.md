# Revisión de inconsistencias — 29 de septiembre de 2026

Alcance: revisión del código de estadísticas, finalización, estados, numeración, autenticación e integración. Se ejecutaron los handlers reales con dependencias y datos simulados para reproducir los casos indicados. No se consultó la base de producción ni se modificó la lógica de la aplicación. No se afirma que los casos ya hayan ocurrido en producción.

## Prioridad alta

### 1. Finalización concurrente duplica operaciones e historial

En `app/api/tickets/[id]/complete/route.ts`, la comprobación de `IN_SERVICE` ocurre antes de la transacción. La actualización final solo filtra por ID. Dos solicitudes pueden validar el mismo estado y ambas registrar operaciones, historial y eventualmente ejecutar la integración externa.

Reproducción simulada: dos solicitudes simultáneas respondieron 200 y crearon dos operaciones y dos entradas finales para un solo ticket. El bloqueo corregido en claim/dispatch protege la asignación, no esta finalización.

Corrección propuesta: adquirir de forma atómica el derecho a finalizar dentro de la transacción, comprobando estado y propietario antes de guardar operaciones. La segunda solicitud debe responder 409 o devolver el resultado previo sin repetir efectos.

### 2. Atenciones fallidas pueden aumentar volumen, utilidad y conversión

`app/page.tsx`, función `finish`, envía las operaciones tanto para éxito como para fallo. El endpoint complete las guarda sin condicionar por `successful`. También escribe la marca de escalamiento para fallidos. `app/api/dashboard/route.ts` suma operaciones de todos los estados y calcula conversiones por marcas en notas, sin exigir éxito.

Reproducción simulada: una consulta fallida aportó 100 de volumen, 10 de utilidad y una conversión a Registro. El ticket promedio mezcla estos importes con un denominador de solo atenciones completadas.

Decisión funcional necesaria: establecer si un fallo puede tener operaciones parciales válidas. Si puede, distinguirlas explícitamente; si no, impedir su registro y excluirlas de los indicadores. No eliminar datos históricos automáticamente.

### 3. Respuestas de API exponen hashes de contraseñas

`app/api/tickets/route.ts`, GET, incluye `assignedTo:true` y devuelve los tickets completos. El modelo User contiene `passwordHash`. `app/api/admin/route.ts`, GET, también devuelve usuarios completos; varias mutaciones devuelven el usuario completo creado o actualizado.

No son contraseñas en texto plano, pero los hashes no deben enviarse al navegador. Usar una selección explícita de los campos necesarios en todas las respuestas de usuarios. La consulta del dashboard también carga el usuario completo, aunque allí no devuelve directamente esa colección de tickets.

### 4. La sesión conserva permisos de usuarios desactivados o modificados

`lib/auth.ts` verifica la firma y los roles del JWT, pero no vuelve a consultar el estado, rol ni sede actuales del usuario. El JWT dura 12 horas. Desactivar un usuario, cambiar su rol/sede o cambiar su contraseña no revoca por sí solo una sesión existente.

Corrección propuesta: verificar el usuario actual en la autorización y definir una estrategia de revocación para cambios de credenciales. Los filtros de disponibilidad de la cola no resuelven el acceso a las demás API.

## Estadísticas y reportes

### 5. El rendimiento histórico omite trabajadores desactivados o trasladados

En dashboard, el total de atenciones incluye todos los tickets, pero las filas solo se construyen a partir de trabajadores activos de la sede actual y con rol actual WORKER/MANAGER. Un trabajador desactivado, trasladado o con otro rol deja de aparecer en el histórico correspondiente.

Reproducción simulada: dos atenciones completadas en el total; solo una en la tabla, con participación de 50 %. La pantalla afirma que las filas suman 100 %. Los servicios desactivados tienen un problema equivalente en la distribución de tickets.

Corrección propuesta: obtener los participantes históricos de los tickets y separar el catálogo de personas/servicios disponibles del utilizado para los reportes.

### 6. “Finalizados en el periodo” se calcula por fecha de llegada

Dashboard filtra el conjunto completo por `arrivedAt` y luego cuenta su estado actual. Un ticket llegado ayer y finalizado hoy no entra en los finalizados de hoy. Si se consulta ayer, aparece como completado, aunque se cerró hoy. Volumen y utilidad siguen esa misma selección, no la fecha de operación.

Además, los contadores waiting/inService son actuales y no usan el rango histórico. Los textos “hoy” y “MI JORNADA” utilizan datos del rango seleccionado cuando un jefe cambia el periodo.

Decisión funcional necesaria: distinguir tickets recibidos por fecha de llegada, atenciones realizadas por fecha de cierre y operaciones por fecha de registro. Si se desea medir una cohorte de llegadas, los rótulos deben explicitarlo.

### 7. Fechas dependientes de la zona horaria del servidor

Dashboard, claim, dispatch y numeración usan `setHours(0,0,0,0)` sin fijar la zona de negocio. Analysis interpreta la fecha inicial con `new Date('YYYY-MM-DD')` y la final con una fecha/hora sin zona; dashboard usa fecha/hora sin zona en ambos límites.

Consecuencia: el corte diario, reparto del día y numeración pueden variar entre entornos. Si el servidor usa UTC, el día cambia a las 19:00 de Lima. No se verificó la zona efectiva del despliegue.

Corrección propuesta: una única función de rangos de negocio en America/Lima, con intervalos desde inclusivo/hasta exclusivo y validación de fechas.

### 8. Análisis ignora “hasta” solo y trunca el historial

`app/api/analysis/route.ts` solo construye el filtro temporal cuando existe `from`. Reproducción: `?to=2026-09-01` produjo una consulta sin filtro de fechas. También limita a 300 registros sin total, paginación ni aviso en la interfaz. El límite final termina en 23:59:59.000 y omite las fracciones restantes de ese segundo.

Corrección propuesta: validar ambos límites independientemente, paginar y comunicar el total.

### 9. Participación comercial rotulada por operaciones pero calculada por tickets

En `app/page.tsx`, el porcentaje comercial usa `item.tickets / totalCommercialTickets`, pero el texto dice “% de operaciones”. Un ticket con diez operaciones pesa igual que uno con una operación.

Corrección propuesta: cambiar el rótulo a participación por tickets o usar el número de operaciones, según el indicador deseado.

### 10. La tendencia no representa todos los ingresos del día

Dashboard solo genera intervalos desde 09:00 hasta 19:00 inclusive (el último incluye hasta antes de 19:30). Los endpoints permiten crear tickets fuera de ese horario. Esos tickets entran en el total diario pero pueden faltar en la gráfica. `LineTrend` muestra “cada 30 min” también cuando la serie es diaria.

Corrección propuesta: explicitar el horario mostrado o cubrir todo el día, y adaptar la leyenda a la agrupación.

## Operación e integración

### 11. Numeración duplicable al crear tickets simultáneos

`lib/ticket.ts` calcula el siguiente número con count + 1; ambos endpoints de creación lo consultan antes de insertar. No hay contador atómico ni restricción única para el código dentro de sede/día en el esquema. Dos solicitudes pueden recibir el mismo código, aunque tengan IDs distintos.

Corrección propuesta: definir numeración por sede, prefijo y día de negocio y reservar el número atómicamente. Requiere planificar la compatibilidad con los datos existentes.

### 12. Cambios simultáneos del estado de un llamado pueden sobrescribirse

`app/api/tickets/[id]/status/route.ts` comprueba CALLED fuera de la transacción y luego actualiza solo por ID. Dos solicitudes de IN_SERVICE y FAILED pueden pasar la validación e insertar historial incompatible. Una solicitud retrasada puede sobrescribir un estado posterior.

Corrección propuesta: transición condicional y registro de historial en la misma transacción, verificando que la transición realmente ocurrió.

### 13. Error de integración puede presentarse como error de finalización

Complete confirma la transacción local antes de llamar a `sendToRegistrosAtK`. Si fetch lanza un error de red, el catch devuelve 500 aunque el ticket ya esté cerrado y las operaciones guardadas. Un reintento normal encuentra el ticket cerrado. No hay estado persistente de sincronización ni mecanismo de reintento en este código.

Corrección propuesta: separar el éxito local del resultado de integración y persistir una tarea de sincronización con reintentos e idempotencia.

### 14. El llamado manual puede superar lo que muestra la pantalla pública

Dispatch limita los CALLED a tres; claim no aplica ese límite. La pantalla pública devuelve únicamente tres CALLED, ordenados por actualización descendente. Cuatro llamados manuales para distintos asesores pueden dejar uno fuera de la pantalla pública. El bloqueo por sede resuelve simultaneidad, pero conserva esta diferencia funcional existente.

Decisión funcional necesaria: acordar si tres es un límite global o solo del despacho automático; alternativamente permitir a la pantalla mostrar todos los llamados.

## Definiciones comerciales que requieren confirmación

- En Efectivización y Pago de deuda se guarda como amount el neto después de comisión; en otros servicios se guarda el monto ingresado. El panel lo denomina “Monto total procesado”. Confirmar si volumen significa bruto o neto antes de modificarlo.
- Las reglas de comisión pueden bajar al cruzar ciertos umbrales: por ejemplo, IO/ATK_1 aplica 30 por debajo de 1000 y 10 al llegar a 1000. Está confirmado por la fórmula, pero no se dispone de la regla comercial autorizada para afirmar que sea incorrecta.
- El formulario permite finalizar un trámite comercial sin operaciones y el servidor acepta un arreglo vacío. Confirmar si una atención comercial exitosa exige una operación.

## Orden de corrección sugerido

1. Restringir campos de usuario y revalidar permisos.
2. Hacer atómicas e idempotentes las finalizaciones/transiciones y la numeración.
3. Acordar el tratamiento de fallidos, fecha de cada indicador y bruto/neto.
4. Corregir rangos, históricos, filtros y rótulos con pruebas de regresión.
5. Separar la sincronización externa del cierre local y resolver el límite visible de llamados.
