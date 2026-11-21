# ADR-0005: Codec `.seq` verificado; el modelo por paso se conserva y el codec traduce a la cola de notas

**Estado:** Aceptada (2026-11-21).

## Contexto

M0 se cerró con 3 `.seq` reales exportados de SynthTribe (`koxo-A.seq`, `acidiction.seq`, `bass_line_16.seq`) y el código de Acid Injector como referencia. Los archivos mostraron que el formato guarda pitch/accent/slide como una cola de notas estilo TB-303 (solo los pasos que disparan nota consumen entradas), no como valores por paso. También traen `length` (`acidiction.seq` usa 8 pasos) y `triplet`. Detalle byte a byte en [`FORMAT.md`](../FORMAT.md).

## Decisión

1. **Codec `.seq` verificado byte a byte** contra los 3 archivos reales, que son las fixtures de los tests.
2. **El modelo por paso del contrato se conserva.** El agente sigue escribiendo 16 `Step`; el codec traduce a la cola de notas al codificar y la reconstruye al decodificar.
3. **`Pattern` gana `length` (1–16, default 16) y `triplet` (default `false`)**, opcionales: los bancos existentes siguen siendo válidos.
4. **SysEx implementado en el codec, pero no expuesto en la CLI ni verificado hasta M3.** Viene solo de Acid Injector; no hay hardware para probarlo.

## Alternativas descartadas

- **Cambiar el contrato JSON a cola de notas:** replica el formato interno y es peor para el agente, que razona por paso (qué suena en el paso 7), no por orden de notas.
- **Ignorar `length`:** perdería patrones como `acidiction.seq` (8 pasos) al importar y exportar.

## Consecuencias

- `accent`, `slide` y `note` en pasos `tie`/`off` se ignoran al codificar: en el hardware pertenecen a la nota.
- `rest` no tiene evidencia real (ningún archivo lo usa); se apoya en Acid Injector.
- La C aguda con transpose up (valor 48) no es representable y falla al decodificar.
- Enviar al equipo sigue bloqueado (ADR-0003); hoy el flujo termina en `.seq` cargado desde SynthTribe.
