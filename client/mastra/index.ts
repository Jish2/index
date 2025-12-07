import { Mastra } from "@mastra/core/mastra";
import { ConsoleLogger, LogLevel } from "@mastra/core/logger";
import { LibSQLStore } from "@mastra/libsql";
import { personFinderAgent } from "./agents/person-finder-agent";

export const mastra = new Mastra({
  agents: { personFinderAgent },
  storage: new LibSQLStore({
    // Stores observability data in-memory by default; configure a remote LibSQL URL for persistence.
    url: ":memory:",
  }),
  logger: new ConsoleLogger({
    name: "Mastra",
    level: LogLevel.INFO,
  }),
  telemetry: {
    // Telemetry is deprecated and will be removed in the Nov 4th release
    enabled: false,
  },
  observability: {
    // Enables DefaultExporter and CloudExporter for AI tracing
    default: { enabled: true },
  },
});
