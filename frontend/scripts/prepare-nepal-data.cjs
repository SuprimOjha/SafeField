const fs = require("node:fs");
const path = require("node:path");
const nepalGeojson = require("nepal-geojson");

const outputDirectory = path.resolve("public/data");
fs.mkdirSync(outputDirectory, { recursive: true });

const districts = nepalGeojson.districts();
fs.writeFileSync(
  path.join(outputDirectory, "nepal-districts.geojson"),
  JSON.stringify(districts)
);

console.log(`Prepared ${districts.features.length} Nepal district boundaries.`);
