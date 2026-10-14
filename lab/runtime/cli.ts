import { LabRuntime } from "./lab-runtime.js";

const runtime = new LabRuntime();
const [command, argument] = process.argv.slice(2);

switch (command ?? "run") {
  case "start":
    console.log(JSON.stringify(runtime.start().health));
    break;
  case "reset":
    runtime.reset();
    console.log(JSON.stringify(runtime.health()));
    break;
  case "fault":
    console.log(JSON.stringify(runtime.activateFault(argument ?? "connection-pool-exhaustion")));
    break;
  case "scenarios":
    console.log(JSON.stringify(runtime.scenarios(), null, 2));
    break;
  case "run": {
    const count = argument ? Number(argument) : undefined;
    const result = Number.isFinite(count)
      ? runtime.runWorkload({ count: count as number })
      : runtime.runWorkload();
    console.log(JSON.stringify(result.run, null, 2));
    break;
  }
  default:
    throw new Error(`Usage: start | reset | fault <fault-id> | scenarios | run [count]`);
}
