from datetime import date
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, HttpUrl, model_validator


class SourceRecord(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    title: str = Field(min_length=3)
    authority: str = Field(min_length=2)
    year: int = Field(ge=1900)
    url: HttpUrl
    accessed: date
    official: bool
    language: str = Field(min_length=2)


class FertilizerReference(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    id: str
    crop: str
    varietyType: str
    region: str
    nutrientOrProduct: str
    basis: Literal["nutrient", "product"]
    valueMin: float | None = Field(default=None, ge=0)
    valueMax: float | None = Field(default=None, ge=0)
    unitAsPrinted: str = Field(min_length=1)
    timingSplit: str
    sourceKey: str
    secondSourceKey: str | None = None
    year: int = Field(ge=1900)
    page: str
    shortQuote: str
    confidence: Literal["single-source", "two-sources"]
    verified: bool
    reviewStatus: Literal["not-expert-reviewed", "expert-reviewed"]
    reviewer: str | None = None

    @model_validator(mode="after")
    def validate_reference_bounds(self):
        if self.valueMin is None and self.valueMax is None:
            raise ValueError("at least one printed reference bound is required")
        if self.valueMin is not None and self.valueMax is not None and self.valueMin > self.valueMax:
            raise ValueError("valueMin cannot exceed valueMax")
        if self.reviewStatus == "expert-reviewed" and not self.reviewer:
            raise ValueError("expert-reviewed fertilizer reference requires reviewer")
        if self.confidence == "two-sources" and not self.secondSourceKey:
            raise ValueError("two-sources confidence requires secondSourceKey")
        if self.confidence == "single-source" and self.secondSourceKey:
            raise ValueError("single-source confidence cannot include secondSourceKey")
        return self


class AreaConversion(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    unit: Literal["ropani", "bigha", "kattha", "hectare"]
    toHectare: float | None = Field(default=None, gt=0)
    sourceKey: str
    verified: bool


class HomeRemedy(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    id: str
    crop: str
    problem: str
    remedyText: str = Field(min_length=5)
    quantitiesAsPrinted: str | None
    preparationNotesAsPrinted: str | None
    sourceKey: str
    evidence: Literal["official", "research", "extension"]
    verified: bool
    safetyNotes: str = Field(min_length=5)
    reviewStatus: Literal["not-expert-reviewed", "expert-reviewed"]
    reviewer: str | None = None

    @model_validator(mode="after")
    def expert_review_requires_reviewer(self):
        if self.reviewStatus == "expert-reviewed" and not self.reviewer:
            raise ValueError("expert-reviewed home remedy requires reviewer")
        return self
