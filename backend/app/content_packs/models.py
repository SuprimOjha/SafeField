from typing import Literal
from pydantic import BaseModel, ConfigDict, Field


class SourceRecord(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str = Field(min_length=3)
    authority: str = Field(min_length=2)
    year: int = Field(ge=1900)
    url: str = Field(min_length=8)
    accessed: str = Field(min_length=10)
    official: bool
    language: str = Field(min_length=2)


class FertilizerReference(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str
    crop: str
    varietyType: str
    region: str
    nutrientOrProduct: str
    basis: Literal["nutrient", "product"]
    valueMin: float | None
    valueMax: float | None
    unitAsPrinted: str
    timingSplit: str
    sourceKey: str
    year: int
    page: str
    shortQuote: str
    confidence: Literal["single-source", "two-sources"]
    verified: bool
    reviewStatus: Literal["not-expert-reviewed", "expert-reviewed"]
    reviewer: str | None


class AreaConversion(BaseModel):
    model_config = ConfigDict(extra="forbid")
    unit: Literal["ropani", "bigha", "kattha", "hectare"]
    toHectare: float | None
    sourceKey: str
    verified: bool


class HomeRemedy(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str
    crop: str
    problem: str
    remedyText: str
    quantitiesAsPrinted: str | None
    preparationNotesAsPrinted: str | None
    sourceKey: str
    evidence: Literal["official", "research", "extension"]
    verified: bool
    safetyNotes: str
    reviewStatus: Literal["not-expert-reviewed", "expert-reviewed"]
