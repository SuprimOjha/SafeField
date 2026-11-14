import json

from app.content_packs.loader import validate_content


def source(official=True, year=2025):
    return {
        "title": "Agriculture source", "authority": "Agriculture Office",
        "year": year, "url": "https://example.gov.np/guide",
        "accessed": "2026-11-14", "official": official, "language": "en",
    }


def fertilizer(**changes):
    record = {
        "id": "rice-001", "crop": "Rice", "varietyType": "Listed varieties",
        "region": "Koshi", "nutrientOrProduct": "Urea",
        "basis": "product", "valueMin": 1.0, "valueMax": 2.0,
        "unitAsPrinted": "kg/ropani", "timingSplit": "As stated in source",
        "sourceKey": "source-a", "secondSourceKey": None, "year": 2025,
        "page": "p. 4", "shortQuote": "Short exact quote.",
        "confidence": "single-source", "verified": True,
        "reviewStatus": "not-expert-reviewed", "reviewer": None,
    }
    record.update(changes)
    return record


def remedy(**changes):
    record = {
        "id": "remedy-001", "crop": "Rice", "problem": "Reported leaf issue",
        "remedyText": "Consult the source and local extension staff.",
        "quantitiesAsPrinted": None, "preparationNotesAsPrinted": None,
        "sourceKey": "source-a", "evidence": "official", "verified": True,
        "safetyNotes": "Follow general safe handling precautions.",
        "reviewStatus": "not-expert-reviewed", "reviewer": None,
    }
    record.update(changes)
    return record


def write_pack(tmp_path, sources=None, fertilizers=None, remedies=None, conversions=None):
    (tmp_path / "sources.json").write_text(json.dumps(sources or {"source-a": source()}), encoding="utf-8")
    packs = [
        ("fertilizer_reference.json", fertilizers or []),
        ("home_remedies.json", remedies or []),
        ("conversions.json", conversions or []),
    ]
    for filename, records in packs:
        (tmp_path / filename).write_text(json.dumps({"records": records}), encoding="utf-8")


def test_two_source_confidence_requires_second_source_key(tmp_path):
    write_pack(tmp_path, fertilizers=[fertilizer(confidence="two-sources")])
    assert validate_content(tmp_path)["fertilizer_references"] == 0


def test_two_source_confidence_accepts_two_official_sources(tmp_path):
    write_pack(
        tmp_path,
        sources={"source-a": source(), "source-b": source()},
        fertilizers=[fertilizer(confidence="two-sources", secondSourceKey="source-b")],
    )
    assert validate_content(tmp_path)["fertilizer_references"] == 1


def test_two_source_confidence_rejects_unofficial_second_source(tmp_path):
    write_pack(
        tmp_path,
        sources={"source-a": source(), "source-b": source(False)},
        fertilizers=[fertilizer(confidence="two-sources", secondSourceKey="source-b")],
    )
    assert validate_content(tmp_path)["fertilizer_references"] == 0


def test_single_source_confidence_rejects_second_source_key(tmp_path):
    write_pack(tmp_path, sources={"source-a": source(), "source-b": source()}, fertilizers=[fertilizer(secondSourceKey="source-b")])
    assert validate_content(tmp_path)["fertilizer_references"] == 0


def test_negative_fertilizer_reference_bound_is_rejected(tmp_path):
    write_pack(tmp_path, fertilizers=[fertilizer(valueMin=-1)])
    assert validate_content(tmp_path)["fertilizer_references"] == 0


def test_reversed_fertilizer_reference_bounds_are_rejected(tmp_path):
    write_pack(tmp_path, fertilizers=[fertilizer(valueMin=3, valueMax=2)])
    assert validate_content(tmp_path)["fertilizer_references"] == 0


def test_fertilizer_reference_year_must_match_cited_source(tmp_path):
    write_pack(tmp_path, sources={"source-a": source(year=2024)}, fertilizers=[fertilizer(year=2025)])
    assert validate_content(tmp_path)["fertilizer_references"] == 0


def test_fertilizer_reference_requires_at_least_one_bound(tmp_path):
    write_pack(tmp_path, fertilizers=[fertilizer(valueMin=None, valueMax=None)])
    assert validate_content(tmp_path)["fertilizer_references"] == 0


def test_fertilizer_timing_split_cannot_hide_a_rate(tmp_path):
    write_pack(tmp_path, fertilizers=[fertilizer(timingSplit="Apply 2 kg per hectare")])
    assert validate_content(tmp_path)["fertilizer_references"] == 0


def test_area_conversion_requires_official_source(tmp_path):
    conversion = {"unit": "ropani", "toHectare": 0.05, "sourceKey": "source-a", "verified": True}
    write_pack(tmp_path, sources={"source-a": source(False)}, conversions=[conversion])
    assert validate_content(tmp_path)["conversions"] == 0


def test_unverified_area_conversion_is_not_loaded(tmp_path):
    conversion = {"unit": "ropani", "toHectare": 0.05, "sourceKey": "source-a", "verified": False}
    write_pack(tmp_path, conversions=[conversion])
    assert validate_content(tmp_path)["conversions"] == 0


def test_official_remedy_label_requires_official_source(tmp_path):
    write_pack(tmp_path, sources={"source-a": source(False)}, remedies=[remedy()])
    assert validate_content(tmp_path)["home_remedies"] == 0


def test_non_official_remedy_cannot_show_official_evidence(tmp_path):
    write_pack(tmp_path, sources={"source-a": source(False)}, remedies=[remedy(evidence="official")])
    assert validate_content(tmp_path)["home_remedies"] == 0


def test_unverified_remedy_is_not_loaded(tmp_path):
    write_pack(tmp_path, remedies=[remedy(verified=False)])
    assert validate_content(tmp_path)["home_remedies"] == 0


def test_remedy_bag_rate_is_rejected_from_free_text(tmp_path):
    write_pack(tmp_path, remedies=[remedy(remedyText="Apply 2 bags per ropani to the crop.")])
    assert validate_content(tmp_path)["home_remedies"] == 0


def test_remedy_teaspoon_quantity_is_rejected_from_free_text(tmp_path):
    write_pack(tmp_path, remedies=[remedy(remedyText="Mix 2 teaspoons into water.")])
    assert validate_content(tmp_path)["home_remedies"] == 0


def test_remedy_missing_source_is_not_loaded(tmp_path):
    write_pack(tmp_path, remedies=[remedy(sourceKey="missing-source")])
    assert validate_content(tmp_path)["home_remedies"] == 0


def test_remedy_requires_nontrivial_safety_notes(tmp_path):
    write_pack(tmp_path, remedies=[remedy(safetyNotes="OK")])
    assert validate_content(tmp_path)["home_remedies"] == 0


def test_two_source_confidence_rejects_same_source_twice(tmp_path):
    write_pack(tmp_path, fertilizers=[fertilizer(confidence="two-sources", secondSourceKey="source-a")])
    assert validate_content(tmp_path)["fertilizer_references"] == 0


def test_two_source_confidence_rejects_unknown_second_source(tmp_path):
    write_pack(tmp_path, fertilizers=[fertilizer(confidence="two-sources", secondSourceKey="missing-source")])
    assert validate_content(tmp_path)["fertilizer_references"] == 0


def test_area_conversion_rejects_non_official_source(tmp_path):
    conversion = {"unit": "bigha", "toHectare": 0.13, "sourceKey": "source-a", "verified": True}
    write_pack(tmp_path, sources={"source-a": source(False)}, conversions=[conversion])
    report = validate_content(tmp_path)
    assert report["conversions"] == 0
    assert report["skipped"]["conversion"] == 1


def test_home_remedy_official_evidence_requires_official_source(tmp_path):
    write_pack(tmp_path, sources={"source-a": source(False)}, remedies=[remedy(evidence="official")])
    report = validate_content(tmp_path)
    assert report["home_remedies"] == 0
    assert report["skipped"]["remedy"] == 1


def test_home_remedy_research_evidence_can_use_non_official_source(tmp_path):
    write_pack(tmp_path, sources={"source-a": source(False)}, remedies=[remedy(evidence="research")])
    assert validate_content(tmp_path)["home_remedies"] == 1


def test_fertilizer_reference_rejects_year_mismatch_even_with_valid_source(tmp_path):
    write_pack(tmp_path, sources={"source-a": source(year=2024)}, fertilizers=[fertilizer(year=2025)])
    report = validate_content(tmp_path)
    assert report["fertilizer_references"] == 0
    assert report["skipped"]["fertilizer"] == 1


def test_non_finite_fertilizer_reference_values_are_rejected(tmp_path):
    write_pack(tmp_path, fertilizers=[fertilizer(valueMin=float("inf"))])
    assert validate_content(tmp_path)["fertilizer_references"] == 0


def test_source_accessed_field_requires_a_real_calendar_date(tmp_path):
    bad_source = source()
    bad_source["accessed"] = "2026-02-30"
    write_pack(tmp_path, sources={"source-a": bad_source}, fertilizers=[fertilizer()])
    report = validate_content(tmp_path)
    assert report["sources"] == 0
    assert report["fertilizer_references"] == 0
