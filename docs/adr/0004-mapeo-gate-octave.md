# ADR-0004: Mapeo de `gate` y `octave` al modelo del TD-3

**Estado:** Aceptada (2026-11-21). Pregunta de la C aguda resuelta en M0.

## Contexto

El requisito define cada paso con `note`, `octave`, `accent`, `slide`, `gate`. El TD-3 no tiene un "gate" nativo: cada paso es nota, silencio (rest) o ligadura (tie), y el registro se ajusta con transpose down / none / up.

## Decisión

| Campo | Valor | Equivalente TD-3 |
|---|---|---|
| `gate` | `on` | nota (suena) |
| `gate` | `off` | rest (silencio) |
| `gate` | `tie` | tie (prolonga la nota anterior) |
| `octave` | `-1` / `0` / `1` | transpose down / none / up |

`accent` y `slide` se mantienen como booleanos. La validación es solo estructural: no se prohíbe, por ejemplo, `tie` en el paso 1.

## Alternativas descartadas

- **`gate` booleano:** no puede expresar tie.
- **`octave` como número libre u offset en semitonos:** el equipo solo ofrece tres posiciones.
- **Reglas musicales en el validador:** serían requisitos inventados.

## Consecuencias

- El contrato JSON es legible para el agente y mapea 1:1 a lo que el equipo puede representar.
- **Resuelta (M0):** la C aguda del TD-3 (13ª tecla) sin transposición es C con `octave` +1, valor 36 en el `.seq`; es representable. Solo la C aguda con transpose up (valor 48) queda fuera del modelo. Ver [ADR-0005](0005-formato-seq-cola-de-notas.md) y [`FORMAT.md`](../FORMAT.md). Cualquier cambio al contrato requiere un ADR nuevo.
