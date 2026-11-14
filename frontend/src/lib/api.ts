import { FieldAssessmentResponse } from "@/types/safefield";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "http://127.0.0.1:8000";

export async function fetchFieldAssessment(
  lat: number,
  lon: number,
  fertilizerType: string = "Urea",
  cropStage: string = "Vegetative / Tillering",
  saveMoney: boolean = true
): Promise<FieldAssessmentResponse> {
  const url = new URL(`${API_BASE_URL}/api/field-assessment`);
  url.searchParams.set("lat", lat.toString());
  url.searchParams.set("lon", lon.toString());
  url.searchParams.set("fertilizer_type", fertilizerType);
  url.searchParams.set("crop_stage", cropStage);
  url.searchParams.set("save_money", saveMoney ? "true" : "false");

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`Backend error: ${response.status} ${response.statusText}`);
  }

  return response.json();
}