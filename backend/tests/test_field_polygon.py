import pytest
from fastapi import HTTPException
from app.api.routes import parse_field_polygon


def test_polygon_parser_closes_valid_ring():
    result = parse_field_polygon("[[85.0,27.0],[85.1,27.0],[85.1,27.1],[85.0,27.1]]")
    assert result is not None
    assert result[0] == result[-1]
    assert len(result) == 5


def test_polygon_parser_rejects_coordinates_outside_nepal():
    with pytest.raises(HTTPException) as error:
        parse_field_polygon("[[90,27],[90.1,27],[90.1,27.1]]")
    assert error.value.status_code == 422


def test_polygon_parser_rejects_malformed_json():
    with pytest.raises(HTTPException):
        parse_field_polygon("not-json")


def test_polygon_parser_accepts_missing_polygon_for_point_selection():
    assert parse_field_polygon(None) is None
