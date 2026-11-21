# Formato `.seq` / SysEx del TD-3 (M0)

Evidencia: 3 archivos reales exportados de SynthTribe en `tools/td3/seq/` (`koxo-A.seq`, `acidiction.seq`, `bass_line_16.seq`) + código de Acid Injector (echolevel, `script.js`). Lo marcado **[verificado]** se comprobó contra los archivos reales; **[referencia]** viene solo de Acid Injector.

## Archivo `.seq` (146 bytes)

| Offset | Bytes | Significado |
|---|---|---|
| 0 | `23 98 54 76` | magic [verificado] |
| 4 | u32 BE = 8, luego UTF-16BE `"TD-3"` | modelo [verificado] |
| 16 | u32 BE = 10, luego UTF-16BE p. ej. `"1.3.7"` | firmware; los reales traen `1.3.7` y `1.2.6` [verificado] |
| 30 | u32 BE = 112 | largo de lo que sigue [verificado] |
| 34 | `00 00` | relleno [verificado] |
| 36 | 110 bytes | cuerpo del patrón [verificado] |

## Cuerpo (110 bytes, "nibblizado")

Cada valor de 8 bits se guarda como 2 bytes `hi, lo` con un nibble cada uno (todos los bytes del cuerpo son `< 0x10`) [verificado].

| Offset cuerpo | Campo | Tamaño |
|---|---|---|
| 0 | pitch × 16 | 32 |
| 32 | accent × 16 (0/1) | 32 |
| 64 | slide × 16 (0/1) | 32 |
| 96 | triplet (0/1) | 2 |
| 98 | length 1–16 (16 → `01 00`, 8 → `00 08`) | 2 |
| 100 | relleno `00 00` | 2 |
| 102 | tie mask | 4 |
| 106 | rest mask | 4 |

### Cola de notas (estilo TB-303) [verificado]

pitch/accent/slide **no** son por paso: son una cola de notas en orden. Solo los pasos que disparan nota consumen la siguiente entrada. Entradas sin usar: pitch `0x18`, accent 0, slide 0. Evidencia: la cantidad de bits "nota" de la tie mask = cantidad de pitches no-relleno (7, 8, 16).

### Pitch [verificado]

`valor = 24 + 12·octave + semitono` (C=0 … B=11). `0x18` = C sin transposición. Modelo: octave −1/0/1 → valores 12–47. La C aguda del teclado sin transposición = 36 = C con octave +1. Fuera del modelo: valores < 12 o > 47 (p. ej. 48 = C aguda + transpose up) → error al decodificar.

### Máscaras tie / rest

16 bits, 4 bytes, solo el nibble bajo de cada uno. Byte 0 = pasos 5–8, byte 1 = pasos 1–4, byte 2 = pasos 13–16, byte 3 = pasos 9–12; dentro del nibble, bit 0 = primer paso del grupo. Equivale a `(b0<<4|b1)` = pasos 1–8 y `(b2<<4|b3)` = pasos 9–16, LSB = primer paso [verificado con los 3 archivos].

- tie bit `1` = el paso dispara nota nueva; `0` = ligado (prolonga) [verificado por conteo].
- rest bit `1` = silencio [referencia; ningún archivo real tiene silencios].
- Un silencio se escribe con tie `1` y rest `1` y no consume nota [referencia: Acid Injector deja tie en 1].
- Pasos más allá de `length`: tie 0, rest 0 (como `acidiction.seq`) [verificado].

### Mapeo al modelo (Step.gate)

| rest | tie | gate | consume nota |
|---|---|---|---|
| 1 | x | `off` | no |
| 0 | 1 | `on` | sí |
| 0 | 0 | `tie` | no |

Decodificar: un paso `tie` toma la nota del último `on` (o C si no hay); un `off` es C octave 0; ninguno de los dos lleva accent/slide. Codificar: accent/slide/note de pasos `tie`/`off` se ignoran (en el hardware pertenecen a la nota).

## SysEx [referencia, no verificado en hardware]

`F0 00 20 32 00 01 0A 78 <group 0–3> <slot> 00 00` + cuerpo de 110 bytes + `F7` (123 bytes). Slot según el comentario de Acid Injector: "0-7 (A) 9-15 (B)" (¿errata de 8–15?); confirmar con el equipo antes de enviar.
