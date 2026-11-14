const fs = require("node:fs");
const path = require("node:path");

const SOURCE =
  "https://raw.githubusercontent.com/Acesmndr/nepal-geojson/master/generated-geojson/nepal-with-districts-acesmndr.geojson";

async function main() {
  const response = await fetch(SOURCE);
  if (!response.ok) {
    throw new Error(`Unable to download Nepal district boundaries: HTTP ${response.status}`);
  }

  const data = await response.json();
  if (data.type !== "FeatureCollection" || !Array.isArray(data.features) || data.features.length < 70) {
    throw new Error("The downloaded Nepal district boundary data is invalid or incomplete.");
  }

  const outputDirectory = path.resolve("public/data");
  fs.mkdirSync(outputDirectory, { recursive: true });
  fs.writeFileSync(
    path.join(outputDirectory, "nepal-districts.geojson"),
    JSON.stringify(data)
  );

  console.log(`Prepared ${data.features.length} Nepal district boundaries.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
