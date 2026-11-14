from app.decision.fertilizer_engine import FertilizerDecisionEngine


def valid_inputs(**overrides):
    values = {
        "rain_last_72h_mm": 2.0,
        "expected_rain_next_48h_mm": 0.0,
        "soil_wetness": 0.45,
        "sand_percent": 35.0,
        "slope_percent": 1.0,
        "fertilizer_type": "Urea",
        "crop_stage": "Vegetative / Tillering",
        "priority_save_money": True,
    }
    values.update(overrides)
    return values


def test_missing_input_requires_local_review_instead_of_zero_fallback():
    result = FertilizerDecisionEngine().evaluate_timing(**valid_inputs(rain_last_72h_mm=None))
    assert result.signal == "LOCAL REVIEW NEEDED"
    assert result.confidence == "CAUTION"
    assert any("not treated as zero" in rule.explanation for rule in result.rule_contributions)


def test_heavy_forecast_triggers_wait_and_recheck():
    result = FertilizerDecisionEngine().evaluate_timing(
        **valid_inputs(expected_rain_next_48h_mm=25.0)
    )
    assert result.signal == "WAIT AND RECHECK"
    assert result.wait_days_recommended >= 1


def test_sandy_terrain_requires_local_review_not_split_rate_advice():
    result = FertilizerDecisionEngine().evaluate_timing(
        **valid_inputs(sand_percent=60.0)
    )
    assert result.signal == "LOCAL REVIEW NEEDED"
    assert "Do not infer a smaller fertilizer dose" in result.detailed_explanation


def test_save_money_preference_does_not_change_signal_or_warnings():
    engine = FertilizerDecisionEngine()
    selected = engine.evaluate_timing(**valid_inputs(priority_save_money=True))
    not_selected = engine.evaluate_timing(**valid_inputs(priority_save_money=False))
    assert selected.signal == not_selected.signal
    assert selected.primary_reason == not_selected.primary_reason
    assert selected.rule_contributions[-1].impact == "NEUTRAL"


def test_all_rule_thresholds_are_disclosed_as_assumptions():
    result = FertilizerDecisionEngine().evaluate_timing(**valid_inputs())
    assert all(
        "PENDING EXPERT REVIEW" in rule.evidence_status
        for rule in result.rule_contributions[:-1]
    )
    assert "not a safety certification" in result.disclaimer
