# Análisis de bancos en las notas de Pancake

Muestra revisada el 4 de noviembre de 2026: 600 conversaciones recientes,
572 con notas. Es una muestra, no un inventario completo. Se conservaron
únicamente estadísticas y etiquetas; no se guardaron datos de clientes,
cuentas bancarias ni credenciales.

## Nombres encontrados y normalización propuesta

| Nombre a mostrar | Variantes encontradas (conversaciones con cada etiqueta) |
| --- | --- |
| BCP | BCP (329) |
| BBVA | BBVA (296) |
| Interbank | IBK (167), INTERBANK (5), ITB (1) |
| Scotiabank | SCOTIA (41), SCOTIABANK (31), SCO (29), SCOTI (4), SCOT (4) |
| BanBif | BANBIF (15) |
| CMR | CMR (84) |
| iO | IO (11) |
| Ripley | RIPLEY (21) |
| Diners Club | DINERS (10) |
| SIP | SIP (7) |
| Cencosud | CENCOSUD (5) |

Un mismo registro puede contener varios bancos o variantes; no sumar las
frecuencias como si fueran clientes distintos.

El usuario confirmó expresamente ITB e IBK como Interbank. Las variantes
SCO / SCOT / SCOTI / SCOTIA se proponen como Scotiabank.

## Formatos que afectan al reconocimiento de cuentas

- Se detectaron 47 notas con la etiqueta CCI. CCI es un tipo de identificador,
  no un banco. No debe mezclarse silenciosamente con la cuenta normal.
- Hay 18 líneas con varias menciones de bancos. Deben reconocerse todos los
  pares banco/número en cada línea; el parser actual se detiene en el primer
  banco encontrado en la línea y puede perder o asociar mal otras cuentas.
- Apareció un nombre de banco pegado al número sin separación. Un límite de
  palabra convencional entre letras y dígitos no reconoce ese formato.
- El parser actual reconoce IBK e INTERBANK, pero todavía no ITB; para
  Scotiabank reconoce SCO y SCOTIABANK, pero no todas las otras variantes.

## Implementación local

El usuario confirmó que deben mostrarse tanto la cuenta normal como el CCI
del mismo banco, con etiquetas separadas. La página local ahora reconoce las
variantes anteriores, conserva ceros iniciales, elimina duplicados y muestra
varias cuentas/CCI en una misma nota. Se conservan también identificadores con
etiqueta de cuenta/CCI que no tengan un banco identificable, sin asignarles uno
por suposición.

Las terminaciones de tarjeta se muestran por separado: `1234 BCP` corresponde
a una tarjeta BCP terminada en 1234, aunque no haya cuenta. Se reconocen varias
tarjetas separadas por `/`, en otras líneas o en otras notas, y se eliminan
duplicados del mismo banco y terminación. Los ceros iniciales se conservan.
Los números completos de cuenta o CCI, sus grupos de dígitos, fechas y teléfonos
no se convierten en terminaciones de tarjeta.

Cada tarjeta o cuenta de un banco reconocido ofrece «Usar banco» para completar
la calculadora. El selector incluye únicamente bancos y tarjetas mencionados en
las notas actuales, incluso si solo se registró el banco o los cuatro dígitos.
Las terminaciones se incluyen también en el nombre de las opciones. El campo de
plazo se muestra exclusivamente para Scotiabank y BanBif.

«Actualizar notas» consulta de nuevo los datos de Pancake para el DNI actual y
actualiza notas, tarjetas, cuentas, bancos y el perfil derivado de ellas sin
volver a introducir el DNI ni cambiar la identidad mostrada. Se conserva el
monto y, si sigue registrado, el banco elegido. Si el banco desaparece, se
limpia la selección y el cálculo anterior. Si falla la consulta, se conservan
los datos anteriores y se muestra un aviso. Las respuestas que llegan después
de cambiar de DNI se descartan.

Las consultas siguen requiriendo una sesión administradora y se realizan sin
caché mediante el endpoint existente; no se almacena una copia local de las
notas ni se escriben cambios en Pancake. Los números de cuenta y CCI solo se
muestran; la calculadora realiza el desglose local sin enviar operaciones.

Las reglas de tarifas por banco se guardaron en COMISIONES.md.
