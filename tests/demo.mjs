import { runVerification } from './harness.mjs';

const result = runVerification({ print: true });
if (!result.ok) process.exitCode = 1;
