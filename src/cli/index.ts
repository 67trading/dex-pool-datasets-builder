#!/usr/bin/env node
import "dotenv/config";
import { Command } from "commander";
import { registerBuildCommand } from "./commands/build.command.js";
import { registerDiscoverCommand } from "./commands/discover.command.js";
import { registerDiscoverCacheCommand } from "./commands/discover-cache.command.js";
import { registerInspectCommand } from "./commands/inspect.command.js";
import { registerDoctorCommand } from "./commands/doctor.command.js";
import { registerInitCommand } from "./commands/init.command.js";
import { registerRunCommand } from "./commands/run.command.js";
import { registerPlanCommand } from "./commands/plan.command.js";
import { registerValidateCommand } from "./commands/validate.command.js";
import { registerJupiterDiscoverCommand } from "./commands/jupiter-discover.command.js";
import { registerJupiterExecutionsCommand } from "./commands/jupiter-executions.command.js";
import { registerJupiterQuotesCommand } from "./commands/jupiter-quotes.command.js";

const program = new Command();

program
  .name("dex-pool")
  .description("DEX pool dataset builder")
  .version("0.1.0");

registerBuildCommand(program);
registerRunCommand(program);
registerDiscoverCommand(program);
registerDiscoverCacheCommand(program);
registerInspectCommand(program);
registerDoctorCommand(program);
registerInitCommand(program);
registerPlanCommand(program);
registerValidateCommand(program);
registerJupiterDiscoverCommand(program);
registerJupiterExecutionsCommand(program);
registerJupiterQuotesCommand(program);

program.parseAsync(process.argv).catch((error: unknown) => {
  process.stderr.write(`${String(error instanceof Error ? error.message : error)}\n`);
  process.exit(1);
});
