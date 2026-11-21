"""Codec `.seq` / SysEx del TD-3 (ver docs/FORMAT.md). Puro: sin I/O."""

import struct

from td3.domain import Note, Pattern, Step

_NOTES: tuple[Note, ...] = ("C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B")
_MAGIC = bytes.fromhex("23985476")
_MODEL = "TD-3"
_FW_CHARS = 5
_BODY_LEN = 110
_SEQ_LEN = 36 + _BODY_LEN
_REST_PITCH = 0x18
_SYSEX_HEAD = bytes.fromhex("f0 00 20 32 00 01 0a 78")


class CodecError(ValueError):
    """Entrada mal formada al codificar o decodificar."""


def _nibbles(values: list[int]) -> bytes:
    return bytes(n for v in values for n in (v >> 4, v & 0xF))


def _mask(bits: list[bool]) -> bytes:
    lo = sum(1 << i for i, b in enumerate(bits[:8]) if b)
    hi = sum(1 << i for i, b in enumerate(bits[8:]) if b)
    return bytes((lo >> 4, lo & 0xF, hi >> 4, hi & 0xF))


def _unmask(raw: bytes) -> list[bool]:
    words = (raw[0] << 4 | raw[1], raw[2] << 4 | raw[3])
    return [bool(w >> i & 1) for w in words for i in range(8)]


def _encode_body(pattern: Pattern) -> bytes:
    pitches: list[int] = []
    accents: list[int] = []
    slides: list[int] = []
    tie: list[bool] = []
    rest: list[bool] = []
    for step in pattern.steps:
        rest.append(step.gate == "off")
        tie.append(step.gate != "tie")
        if step.gate == "on":
            pitches.append(24 + 12 * step.octave + _NOTES.index(step.note))
            accents.append(int(step.accent))
            slides.append(int(step.slide))
    pad = 16 - len(pitches)
    return (
        _nibbles(pitches + [_REST_PITCH] * pad)
        + _nibbles(accents + [0] * pad)
        + _nibbles(slides + [0] * pad)
        + _nibbles([int(pattern.triplet), pattern.length, 0])
        + _mask(tie)
        + _mask(rest)
    )


def _decode_body(body: bytes) -> Pattern:
    if any(b > 0xF for b in body):
        raise CodecError("el cuerpo del patrón tiene bytes que no son nibbles (> 0x0F)")
    vals = [body[i] << 4 | body[i + 1] for i in range(0, 102, 2)]
    pitches, accents, slides = vals[:16], vals[16:32], vals[32:48]
    triplet, length = vals[48], vals[49]
    if triplet > 1 or any(v > 1 for v in accents + slides):
        raise CodecError("triplet, accent y slide deben ser 0 o 1")
    if not 1 <= length <= 16:
        raise CodecError(f"length {length} fuera de 1-16")
    ties, rests = _unmask(body[102:106]), _unmask(body[106:110])

    steps: list[Step] = []
    queue = 0
    last = ("C", 0)
    for tie, rest in zip(ties, rests, strict=True):
        if rest:
            steps.append(Step(note="C", gate="off"))
        elif tie:
            pitch = pitches[queue]
            if not 12 <= pitch <= 47:
                raise CodecError(f"pitch {pitch} fuera del rango 12-47 (octave -1..+1)")
            octave, semitone = divmod(pitch - 24, 12)
            last = (_NOTES[semitone], octave)
            steps.append(
                Step(
                    note=_NOTES[semitone],
                    octave=octave,  # type: ignore[arg-type]
                    accent=bool(accents[queue]),
                    slide=bool(slides[queue]),
                )
            )
            queue += 1
        else:
            steps.append(Step(note=last[0], octave=last[1], gate="tie"))  # type: ignore[arg-type]
    return Pattern(steps=steps, length=length, triplet=bool(triplet))


def _parse(data: bytes) -> tuple[str, bytes]:
    if len(data) != _SEQ_LEN:
        raise CodecError(f"largo {len(data)} inválido: un .seq mide {_SEQ_LEN} bytes")
    if data[:4] != _MAGIC:
        raise CodecError("no es un .seq de TD-3 (magic incorrecto)")
    (model_len,) = struct.unpack(">I", data[4:8])
    (fw_len,) = struct.unpack(">I", data[16:20])
    (body_len,) = struct.unpack(">I", data[30:34])
    if (model_len, fw_len, body_len) != (8, 2 * _FW_CHARS, _BODY_LEN + 2) or data[34:36] != b"\0\0":
        raise CodecError("cabecera del .seq mal formada")
    try:
        model = data[8:16].decode("utf-16-be")
        firmware = data[20:30].decode("utf-16-be")
    except UnicodeDecodeError as exc:
        raise CodecError("cabecera del .seq mal formada (texto inválido)") from exc
    if model != _MODEL:
        raise CodecError(f"modelo {model!r} no soportado (se esperaba {_MODEL!r})")
    return firmware, data[36:]


def encode_seq(pattern: Pattern, firmware: str = "1.3.7") -> bytes:
    if len(firmware) != _FW_CHARS:
        raise CodecError(f"firmware {firmware!r} inválido: debe tener {_FW_CHARS} caracteres")
    head = (
        _MAGIC
        + struct.pack(">I", 8)
        + _MODEL.encode("utf-16-be")
        + struct.pack(">I", 2 * _FW_CHARS)
        + firmware.encode("utf-16-be")
        + struct.pack(">I", _BODY_LEN + 2)
        + b"\0\0"
    )
    return head + _encode_body(pattern)


def decode_seq(data: bytes) -> Pattern:
    return _decode_body(_parse(data)[1])


def seq_firmware(data: bytes) -> str:
    return _parse(data)[0]


def encode_sysex(pattern: Pattern, group: int, slot: int) -> bytes:
    if not 0 <= group <= 3:
        raise CodecError(f"group {group} fuera de 0-3")
    if not 0 <= slot <= 15:
        raise CodecError(f"slot {slot} fuera de 0-15")
    return _SYSEX_HEAD + bytes((group, slot, 0, 0)) + _encode_body(pattern) + b"\xf7"
