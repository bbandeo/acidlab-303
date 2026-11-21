import copy
import json
from pathlib import Path
from typing import Any

import pytest
from pydantic import ValidationError

from td3 import Bank, BankError, Step, load_bank

EXAMPLE = Path(__file__).parent.parent / "examples" / "f-phrygian-rominimal.json"


def good() -> dict[str, Any]:
    step = {"note": "F"}
    return {
        "version": 1,
        "name": "demo",
        "patterns": {k: {"steps": [dict(step) for _ in range(16)]} for k in "ABCD"},
    }


def test_valid_defaults() -> None:
    bank = Bank.model_validate(good())
    s = bank.patterns.A.steps[0]
    assert (s.octave, s.accent, s.slide, s.gate) == (0, False, False, "on")
    assert bank.intent is None


def test_example_is_valid() -> None:
    assert load_bank(EXAMPLE).name == "f-phrygian-rominimal"


@pytest.mark.parametrize(
    ("flat", "sharp"), [("Db", "C#"), ("Eb", "D#"), ("Gb", "F#"), ("Ab", "G#"), ("Bb", "A#")]
)
def test_flat_normalization(flat: str, sharp: str) -> None:
    assert Step.model_validate({"note": flat}).note == sharp


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("note", "H"),
        ("note", "Cb"),
        ("octave", 2),
        ("accent", "yes"),
        ("slide", 1),
        ("gate", "hold"),
    ],
)
def test_invalid_step_field(field: str, value: object) -> None:
    with pytest.raises(ValidationError):
        Step.model_validate({"note": "C", field: value})


def test_missing_note() -> None:
    with pytest.raises(ValidationError):
        Step.model_validate({})


@pytest.mark.parametrize(
    "mutate",
    [
        lambda d: d.update(extra=1),
        lambda d: d["patterns"].update(E=d["patterns"]["A"]),
        lambda d: d["patterns"]["A"].update(extra=1),
        lambda d: d["patterns"]["A"]["steps"][0].update(extra=1),
    ],
)
def test_extra_fields_rejected(mutate: Any) -> None:
    data = good()
    mutate(data)
    with pytest.raises(ValidationError):
        Bank.model_validate(data)


@pytest.mark.parametrize("count", [0, 15, 17])
def test_wrong_step_count(count: int) -> None:
    data = good()
    data["patterns"]["C"]["steps"] = [{"note": "F"}] * count
    with pytest.raises(ValidationError):
        Bank.model_validate(data)


def test_missing_variation() -> None:
    data = good()
    del data["patterns"]["D"]
    with pytest.raises(ValidationError):
        Bank.model_validate(data)


@pytest.mark.parametrize("name", ["", "Upper", "-x", "a_b", "a" * 65])
def test_invalid_name(name: str) -> None:
    data = good()
    data["name"] = name
    with pytest.raises(ValidationError):
        Bank.model_validate(data)


def test_invalid_version() -> None:
    data = good()
    data["version"] = 2
    with pytest.raises(ValidationError):
        Bank.model_validate(data)


def test_load_bank_error_path(tmp_path: Path) -> None:
    data = copy.deepcopy(good())
    data["patterns"]["B"]["steps"][3]["note"] = "H"
    f = tmp_path / "b.json"
    f.write_text(json.dumps(data))
    with pytest.raises(BankError) as info:
        load_bank(f)
    assert info.value.errors == ["patterns.B.steps.3.note: valor inválido 'H'"]


def test_load_bank_missing_and_bad_json(tmp_path: Path) -> None:
    with pytest.raises(BankError):
        load_bank(tmp_path / "nope.json")
    bad = tmp_path / "bad.json"
    bad.write_text("{not json")
    with pytest.raises(BankError):
        load_bank(bad)


@pytest.mark.parametrize("field,value", [("version", True), ("octave", True)])
def test_bool_rejected_for_int_fields(field: str, value: bool) -> None:
    from td3.domain import Bank, Step

    step = {"note": "C"}
    bank: dict[str, object] = {
        "version": 1,
        "name": "x",
        "patterns": {k: {"steps": [step] * 16} for k in "ABCD"},
    }
    if field == "version":
        bank["version"] = value
        with pytest.raises(ValidationError):
            Bank.model_validate(bank)
    else:
        with pytest.raises(ValidationError):
            Step.model_validate({"note": "C", "octave": value})
