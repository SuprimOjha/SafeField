from app.services.soilgrids_client import _extract_layer_mean_percent


def test_soilgrids_mean_is_converted_from_scaled_value():
    layer = {"depths": [{"values": {"mean": 325}}]}
    assert _extract_layer_mean_percent(layer) == 32.5


def test_missing_soilgrids_mean_remains_missing():
    assert _extract_layer_mean_percent({"depths": [{"values": {"mean": None}}]}) is None


def test_missing_depth_does_not_create_default_texture_value():
    assert _extract_layer_mean_percent({"depths": []}) is None


def test_invalid_or_out_of_range_soilgrids_mean_is_rejected():
    assert _extract_layer_mean_percent({"depths": [{"values": {"mean": "unknown"}}]}) is None
    assert _extract_layer_mean_percent({"depths": [{"values": {"mean": 1200}}]}) is None
