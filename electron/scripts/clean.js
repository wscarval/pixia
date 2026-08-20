const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const targets = ["node_modules", "native/build", "dist"];

for (const target of targets) {
  const fullPath = path.join(root, target);
  fs.rmSync(fullPath, { recursive: true, force: true });
  console.log(`Removido: ${target}`);
}
