import { copyFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

const sourceDirectory = resolve("node_modules/maplibre-gl/dist");
const destinationDirectory = resolve("public/maplibre");

mkdirSync(destinationDirectory, { recursive: true });

for (const file of ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"]) {
  copyFileSync(
    resolve(sourceDirectory, file),
    resolve(destinationDirectory, file)
  );
  console.log(`Copied MapLibre worker asset: ${file}`);
}
