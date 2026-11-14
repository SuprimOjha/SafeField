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


def test_polygon_parser_rejects_json_object():
    with pytest.raises(HTTPException):
        parse_field_polygon('{"coordinates": []}')


def test_polygon_parser_rejects_non_numeric_coordinate():
    with pytest.raises(HTTPException):
        parse_field_polygon('[[85,27],["west",27],[85.1,27.1]]')


def test_polygon_parser_rejects_nan_coordinate():
    with pytest.raises(HTTPException):
        parse_field_polygon('[[85,27],[NaN,27],[85.1,27.1]]')


def test_polygon_parser_rejects_infinite_coordinate():
    with pytest.raises(HTTPException):
        parse_field_polygon('[[85,27],[Infinity,27],[85.1,27.1]]')


def test_polygon_parser_rejects_latitude_outside_pilot_bounds():
    with pytest.raises(HTTPException) as error:
        parse_field_polygon('[[85,25],[85.1,25],[85.1,25.1]]')
    assert error.value.status_code == 422


def test_polygon_parser_rejects_more_than_two_hundred_vertices():
    vertices = [[85 + (index % 10) * 0.001, 27 + (index // 10) * 0.001] for index in range(201)]
    with pytest.raises(HTTPException) as error:
        parse_field_polygon(__import__("json").dumps(vertices))
    assert error.value.status_code == 422


def test_polygon_parser_rejects_third_coordinate_dimension():
    with pytest.raises(HTTPException):
        parse_field_polygon('[[85,27,100],[85.1,27,100],[85.1,27.1,100]]')


def test_polygon_parser_rejects_boolean_coordinates():
    with pytest.raises(HTTPException):
        parse_field_polygon('[[true,27],[85.1,27],[85.1,27.1]]')
