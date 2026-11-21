"""Modelo de dominio Bank v1 (ver docs/SPEC.md)."""

import json
from pathlib import Path
from typing import Annotated, Any, Literal, get_args

from pydantic import (
    BaseModel,
    BeforeValidator,
    ConfigDict,
    Field,
    ValidationError,
    field_validator,
)

Note = Literal["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]

_FLATS = {"Db": "C#", "Eb": "D#", "Gb": "F#", "Ab": "G#", "Bb": "A#"}
_NOTES = set(get_args(Note))


def _reject_bool(value: Any) -> Any:
    # bool es subclase de int: sin esto `true` pasaría como 1.
    if isinstance(value, bool):
        raise ValueError("se esperaba un entero, no un booleano")
    return value


StrictInt = BeforeValidator(_reject_bool)


class _Model(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class Step(_Model):
    note: Note
    octave: Annotated[Literal[-1, 0, 1], StrictInt] = 0
    accent: bool = False
    slide: bool = False
    gate: Literal["on", "off", "tie"] = "on"

    @field_validator("note", mode="before")
    @classmethod
    def _normalize_flat(cls, value: Any) -> Any:
        if isinstance(value, str):
            value = _FLATS.get(value, value)
            if value not in _NOTES:
                raise ValueError(f"valor inválido {value!r}")
        return value


class Pattern(_Model):
    steps: Annotated[list[Step], Field(min_length=16, max_length=16)]
    length: Annotated[int, StrictInt, Field(ge=1, le=16)] = 16
    triplet: bool = False


class Patterns(_Model):
    A: Pattern
    B: Pattern
    C: Pattern
    D: Pattern


class Bank(_Model):
    version: Annotated[Literal[1], StrictInt]
    name: Annotated[str, Field(min_length=1, max_length=64, pattern=r"^[a-z0-9][a-z0-9-]*$")]
    intent: str | None = None
    patterns: Patterns


class BankError(Exception):
    """Error de usuario al cargar un banco; `errors` trae una línea por problema."""

    def __init__(self, errors: list[str]) -> None:
        super().__init__("\n".join(errors))
        self.errors = errors


def format_errors(exc: ValidationError) -> list[str]:
    lines = []
    for err in exc.errors():
        path = ".".join(str(p) for p in err["loc"]) or "(raíz)"
        msg = err["msg"].removeprefix("Value error, ")
        lines.append(f"{path}: {msg}")
    return lines


def load_bank(path: str | Path) -> Bank:
    try:
        text = Path(path).read_text(encoding="utf-8")
    except OSError as exc:
        raise BankError([f"{path}: no se puede leer ({exc.strerror})"]) from exc
    except UnicodeDecodeError as exc:
        raise BankError([f"{path}: no es texto UTF-8"]) from exc
    try:
        data = json.loads(text)
    except json.JSONDecodeError as exc:
        raise BankError([f"{path}: JSON mal formado ({exc})"]) from exc
    try:
        return Bank.model_validate(data)
    except ValidationError as exc:
        raise BankError(format_errors(exc)) from exc
