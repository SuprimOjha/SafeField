from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, model_validator


class EvidenceReference(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str = Field(min_length=3, max_length=240)
    organization: str = Field(min_length=2, max_length=160)
    url: str = Field(min_length=8, max_length=2048)
    published_date: str | None = None
    accessed_date: str | None = None
    evidence_note: str = Field(min_length=10, max_length=1000)


class GuidanceItem(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str = Field(pattern=r"^[a-z0-9][a-z0-9-]{2,63}$")
    crop: str = Field(min_length=2, max_length=100)
    stage: str = Field(min_length=2, max_length=100)
    concern: str = Field(min_length=5, max_length=300)
    title_en: str = Field(min_length=3, max_length=180)
    title_ne: str | None = None
    action_en: str = Field(min_length=10, max_length=2000)
    action_ne: str | None = None
    warnings_en: list[str] = Field(default_factory=list)
    warnings_ne: list[str] = Field(default_factory=list)
    evidence: list[EvidenceReference] = Field(min_length=1)
    expert_review_status: Literal["NOT_REVIEWED", "IN_REVIEW", "APPROVED"] = "NOT_REVIEWED"
    reviewed_by: str | None = None
    reviewed_at: str | None = None

    @model_validator(mode="after")
    def approved_items_need_reviewer(self):
        if self.expert_review_status == "APPROVED" and (not self.reviewed_by or not self.reviewed_at):
            raise ValueError("Approved guidance requires reviewer identity and review date")
        return self


class ContentPack(BaseModel):
    model_config = ConfigDict(extra="forbid")
    pack_id: str = Field(pattern=r"^[a-z0-9][a-z0-9-]{2,63}$")
    version: str = Field(pattern=r"^\\d+\\.\\d+\\.\\d+$")
    language: Literal["en", "ne", "en-ne"]
    region: str = Field(min_length=2, max_length=120)
    status: Literal["DRAFT", "REVIEW", "PUBLISHED"] = "DRAFT"
    description: str = Field(min_length=10, max_length=1000)
    items: list[GuidanceItem] = Field(default_factory=list)

    @model_validator(mode="after")
    def published_pack_requires_approved_items(self):
        if self.status == "PUBLISHED":
            if not self.items:
                raise ValueError("Published content packs must contain at least one reviewed item")
            if any(item.expert_review_status != "APPROVED" for item in self.items):
                raise ValueError("Every item in a published pack must be expert-approved")
        return self
