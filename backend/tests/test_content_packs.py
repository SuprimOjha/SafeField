import json
from app.content_packs.loader import validate_content


def source(official=True):
    return {
        "title": "Official agriculture guidance",
        "authority": "Agriculture Office",
        "year": 2025,
        "url": "https://example.gov.np/guidance",
        "accessed": "2026-11-14",
        "official": official,
        "language": "en",
    }


def fertilizer(source_key="official-guide"):
    return {
        "id": "rice-ref-001", "crop": "Rice", "varietyType": "All listed varieties",
        "region": "Eastern Nepal", "nutrientOrProduct": "Product name copied from source",
        "basis": "product", "valueMin": 1.0, "valueMax": 2.0,
        "unitAsPrinted": "unit exactly as printed", "timingSplit": "As printed in source",
        "sourceKey": source_key, "year": 2025, "page": "p. 10",
        "shortQuote": "A short excerpt from the official source.", "confidence": "single-source",
        "verified": True, "reviewStatus": "not-expert-reviewed", "reviewer": None,
    }


def write_pack(tmp_path, sources=None, fertilizer_records=None, conversion_records=None, remedy_records=None):
    (tmp_path / "sources.json").write_text(json.dumps(sources if sources is not None else {"official-guide": source(), "_example": source()}), encoding="utf-8")
    for filename, records in [
        ("fertilizer_reference.json", fertilizer_records or []),
        ("conversions.json", conversion_records or []),
        ("home_remedies.json", remedy_records or []),
    ]:
        (tmp_path / filename).write_text(json.dumps({"records": records, "_example": {"ignored": True}}), encoding="utf-8")


def test_empty_drop_in_templates_load_without_advice(tmp_path):
    write_pack(tmp_path)
    report = validate_content(tmp_path)
    assert report["status"] == "ok"
    assert report["fertilizer_references"] == 0
    assert report["home_remedies"] == 0


def test_fertilizer_requires_verified_official_source(tmp_path):
    item = fertilizer()
    item["verified"] = False
    write_pack(tmp_path, fertilizer_records=[item])
    report = validate_content(tmp_path)
    assert report["fertilizer_references"] == 0
    assert report["skipped"]["fertilizer"] == 1


def test_fertilizer_rejects_non_official_source(tmp_path):
    item = fertilizer()
    write_pack(tmp_path, sources={"unofficial": source(False)}, fertilizer_records=[{**item, "sourceKey": "unofficial"}])
    report = validate_content(tmp_path)
    assert report["fertilizer_references"] == 0


def test_remedy_quantities_are_hidden_for_non_official_sources(tmp_path):
    remedy = {
        "id": "remedy-001", "crop": "Rice", "problem": "Source-reported pest issue",
        "remedyText": "Follow the source text and consult local extension.",
        "quantitiesAsPrinted": "2 kg per ropani", "preparationNotesAsPrinted": "As printed",
        "sourceKey": "extension", "evidence": "extension", "verified": True,
        "safetyNotes": "Use general protective handling precautions.",
        "reviewStatus": "not-expert-reviewed", "reviewer": None,
    }
    write_pack(tmp_path, sources={"extension": source(False)}, remedy_records=[remedy])
    report = validate_content(tmp_path)
    assert report["home_remedies"] == 1
    assert report["remedies"][0]["quantitiesAsPrinted"] is None
    assert any("quantity hidden" in warning for warning in report["warnings"])


def test_dose_like_text_in_remedy_description_is_rejected(tmp_path):
    remedy = {
        "id": "remedy-001", "crop": "Rice", "problem": "Source-reported pest issue",
        "remedyText": "Apply 2 kg per ropani to the crop.",
        "quantitiesAsPrinted": None, "preparationNotesAsPrinted": None,
        "sourceKey": "official-guide", "evidence": "official", "verified": True,
        "safetyNotes": "Use general protective handling precautions.",
        "reviewStatus": "not-expert-reviewed",
    }
    write_pack(tmp_path, remedy_records=[remedy])
    report = validate_content(tmp_path)
    assert report["home_remedies"] == 0


def test_conversion_requires_verified_source_and_value(tmp_path):
    conversion = {"unit": "ropani", "toHectare": None, "sourceKey": "official-guide", "verified": True}
    write_pack(tmp_path, conversion_records=[conversion])
    report = validate_content(tmp_path)
    assert report["conversions"] == 0



def test_expert_review_status_requires_a_named_reviewer(tmp_path):
    item = fertilizer()
    item.update(reviewStatus="expert-reviewed", reviewer=None)
    write_pack(tmp_path, fertilizer_records=[item])
    report = validate_content(tmp_path)
    assert report["fertilizer_references"] == 0
    assert report["skipped"]["fertilizer"] == 1
