import { config } from "dotenv";
import { applyTestDbName } from "./test-db-name";

config({ path: ".env.test", override: true, quiet: true });
applyTestDbName();
