# Reglas de comisiones confirmadas

Confirmadas por el usuario el 4 de noviembre de 2026. Implementadas en la
calculadora local de `public/buscar-cliente.html`, con reglas compartidas en
`public/buscar-cliente-utils.js`.

El formulario de efectivización del asesor también usa estas mismas reglas.
`lib/effectivizacion.ts` las reutiliza al guardar, agregar o editar operaciones,
de modo que la comisión y el neto no difieran de la vista previa. Los importes se
redondean a céntimos y se rechazan montos que no dejan un depósito positivo.

## Perfil del cliente en Pancake

Las notas tienen prioridad sobre el alias. Solo existen tres perfiles:

| Perfil | Formas reconocidas |
| --- | --- |
| 0.35% | beto30, luis30, humberto30, ccfvip30, atk30, jack30, martin30, VIP30, Beto35, 0.35%, 0.30%, 0.3% |
| 0.5% | atk50, atk0.5%, 0.5% |
| 1% | remy, atk1%, 1% |

Se aceptan espacios entre nombre y número, mayúsculas y coma decimal. Los otros
porcentajes presentes en las notas no identifican un perfil y se ignoran.
Si aparecen varios perfiles válidos diferentes en las notas, se muestra
«Por confirmar»; no se reemplazan por el alias.

## Tarifa de la operación

El perfil del cliente y la tarifa aplicada al banco son conceptos distintos.
Las tarifas de 1.5%, 2% y 8% siguientes sí se usan para calcular operaciones,
aunque no se usan para clasificar el perfil en Pancake.

| Banco / modalidad | Perfil 0.35% | Perfil 0.5% | Perfil 1% | Mínimo |
| --- | --- | --- | --- | --- |
| BCP / BBVA, mismo día | 0.5% | 0.5% | 1% | S/12 |
| BanBif, siguiente día hábil | 0.35% | 0.5% | 1% | S/12 |
| BanBif, mismo día | 1% | 1% | 1.5% | S/12 |
| Scotiabank, siguiente día hábil | 0.35% | 0.5% | 1% | S/20 |
| Scotiabank, mismo día | 1% | 1% | 1.5% | S/20 |
| Interbank, con código, mismo día | 1.5% | 1.5% | 2% | S/30 |
| CMR, con código, mismo día | 2% | 2% | 2% | S/30 |
| iO | S/30 fijos | S/30 fijos | S/30 fijos | Siempre S/30 |
| SIP / Cencosud / Ripley / Diners, con código, mismo día | 8% | 8% | 8% | S/30 |

Regla general: comisión = máximo(monto × tarifa / 100, mínimo del banco).
Excepción iO: S/30 por operación, independientemente del monto y del perfil;
el usuario confirmó expresamente ejemplos de S/400 y S/20,000. No aplicar 2%.

Para BanBif y Scotiabank, el mínimo se mantiene en ambas modalidades. El punto
donde el porcentaje alcanza ese mínimo se calcula dividiendo el mínimo entre
la tarifa decimal; no se copian los límites redondeados del flyer.

| Perfil | Modalidad | Tarifa | BanBif alcanza S/12 | Scotiabank alcanza S/20 |
| --- | --- | --- | --- | --- |
| 0.35% | Siguiente día hábil | 0.35% | S/3,428.57 aprox. | S/5,714.29 aprox. |
| 0.35% | Mismo día | 1% | S/1,200 | S/2,000 |
| 0.5% | Siguiente día hábil | 0.5% | S/2,400 | S/4,000 |
| 0.5% | Mismo día | 1% | S/1,200 | S/2,000 |
| 1% | Siguiente día hábil | 1% | S/1,200 | S/2,000 |
| 1% | Mismo día | 1.5% | S/800 | S/1,333.33 aprox. |

Los umbrales son puntos de cálculo de la comisión mínima, no montos mínimos
permitidos para operar. La calculadora trabaja en céntimos y redondea la comisión
porcentual al céntimo más cercano (medio céntimo hacia arriba), antes de aplicar
el mínimo. El depósito es el monto de la operación menos la comisión. Se rechazan
los montos que no dejan un depósito positivo.

La entrada acepta coma o punto decimal y formatos como `2,000.50` y `2.000,50`.
El cálculo está expresado en soles. El perfil se carga desde Pancake; si falta
o está por confirmar, el operador debe seleccionar uno de los tres perfiles.

## Bancos en notas

El usuario confirmó que ITB e IBK son variantes de Interbank, y que desea mostrar
tanto la cuenta normal como el CCI con etiquetas separadas. La calculadora ofrece
únicamente bancos y tarjetas presentes en las notas, con sus terminaciones de
cuatro dígitos cuando están registradas. Las variantes
analizadas y los formatos reconocidos se documentan en BANCOS-NOTAS.md.
