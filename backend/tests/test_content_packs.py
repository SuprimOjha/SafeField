import json
from pathlib import Path
import pytest
from pydantic import ValidationError
from app.content_packs.models import ContentPack


def _valid_item():
    return {
        "id": "rice-general-check",
        "crop": "Rice",
        "stage": "Before application",
        "concern": "Check field conditions and the product label before use.",
        "title_en": "Check local conditions first",
        "action_en": "Consult the local agricultural technician and follow the product label.",
        "evidence": [{
            "title": "Example extension guidance",
            "organization": "Local agriculture office",
            "url": "https://example.gov.np/guidance",
            "evidence_note": "Placeholder used only to test required provenance fields."
        }],
    }


def test_draft_template_is_valid_and_contains_no_unreviewed_advice():
    path = Path(__file__).parents[1] / "app" / "content_packs" / "template.nepal.json"
    pack = ContentPack.model_validate_json(path.read_text(encoding="utf-8"))
    assert pack.status == "DRAFT"
    assert pack.items == []


def test_published_pack_rejects_unreviewed_items():
    with pytest.raises(ValidationError):
        ContentPack.model_validate({
            "pack_id": "nepal-guidance", "version": "1.0.0", "language": "en",
            "region": "Nepal", "status": "PUBLISHED", "description": "Reviewed content.",
            "items": [_valid_item()],
        })


def test_approved_item_requires_reviewer_and_review_date():
    item = _valid_item()
    item["expert_review_status"] = "APPROVED"
    with pytest.raises(ValidationError):
        ContentPack.model_validate({
            "pack_id": "nepal-guidance", "version": "1.0.0", "language": "en",
            "region": "Nepal", "status": "REVIEW", "description": "Reviewed content.",
            "items": [item],
        })


def test_published_pack_accepts_explicitly_reviewed_item():
    item = _valid_item()
    item.update(expert_review_status="APPROVED", reviewed_by="Agronomist", reviewed_at="2026-11-14")
    pack = ContentPack.model_validate({
        "pack_id": "nepal-guidance", "version": "1.0.0", "language": "en",
        "region": "Nepal", "status": "PUBLISHED", "description": "Reviewed content.",
        "items": [item],
    })
    assert pack.items[0].expert_review_status == "APPROVED"
