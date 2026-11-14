from app.decision.fertilizer_engine import FertilizerDecisionEngine


def test_decision_engine_triggers_wait_on_incoming_rain():
    engine = FertilizerDecisionEngine()
    res = engine.evaluate_timing(
        rain_last_72h_mm=2.0,
        expected_rain_next_48h_mm=25.0,  # Heavy incoming rain
        soil_wetness=0.45,
        sand_percent=35.0,
        slope_percent=1.0,
        fertilizer_type="Urea",
        crop_stage="Vegetative / Tillering",
        priority_save_money=True,
    )
    assert res.signal == "WAIT"
    assert res.wait_days_recommended >= 2
    assert "incoming heavy rain" in res.detailed_explanation.lower()


def test_decision_engine_triggers_splits_on_sandy_urea():
    engine = FertilizerDecisionEngine()
    res = engine.evaluate_timing(
        rain_last_72h_mm=1.0,
        expected_rain_next_48h_mm=0.0,
        soil_wetness=0.40,
        sand_percent=60.0,  # Sandy soil
        slope_percent=1.0,
        fertilizer_type="Urea",
        crop_stage="Basal / Planting",
        priority_save_money=True,
    )
    assert res.signal == "APPLY IN SMALLER SPLITS"
    assert len(res.rule_contributions) >= 4