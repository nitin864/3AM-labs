import { writeBenchmarkArtifact } from "./index.js";

const outIndex = process.argv.indexOf("--out");
const output = outIndex >= 0 ? process.argv[outIndex + 1] : "../../artifacts/benchmark/result.json";
if (output === undefined || output.startsWith("-")) throw new Error("usage: benchmark --out <artifact.json>");
const artifact = await writeBenchmarkArtifact(output);
console.log(JSON.stringify({ output, scenarios: artifact.scenarios.length, aggregate: artifact.aggregate }, null, 2));
