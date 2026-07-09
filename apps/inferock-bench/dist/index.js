#!/usr/bin/env node
import { runCli } from "./cli.js";
runCli(process.argv.slice(2)).catch((error) => {
    if (error instanceof Error && error.constructor.name === "CliUsageError") {
        process.exitCode = 1;
        return;
    }
    const message = error instanceof Error ? error.message : "inferock-bench failed";
    console.error(message);
    process.exitCode = 1;
});
//# sourceMappingURL=index.js.map