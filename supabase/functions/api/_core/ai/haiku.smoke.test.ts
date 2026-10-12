import { isAiSmokeAllowed } from "./haiku.smoke.ts";

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

assert(isAiSmokeAllowed(true, "true"), "Enabled admin must be allowed");
assert(!isAiSmokeAllowed(false, "true"), "Normal ERP users must be denied");
assert(!isAiSmokeAllowed(true, undefined), "Unset flag must deny");
assert(!isAiSmokeAllowed(true, "false"), "Disabled flag must deny");
assert(!isAiSmokeAllowed(true, "TRUE"), "Non-exact flags must deny");
