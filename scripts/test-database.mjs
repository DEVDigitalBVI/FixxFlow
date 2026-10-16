import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";

const command = process.platform === "win32" ? "supabase.cmd" : "supabase";
const dockerCommand = process.platform === "win32" ? "docker.exe" : "docker";
const environment = { ...process.env, SUPABASE_TELEMETRY_DISABLED: "1" };
const config = readFileSync("supabase/config.toml", "utf8");
const projectId = config.match(/^project_id\s*=\s*"([^"]+)"/m)?.[1];

if (!projectId) throw new Error("supabase/config.toml must define project_id");

function run(arguments_) {
  const result = spawnSync(command, arguments_, { env: environment, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function runSqlFile(path) {
  const result = spawnSync(
    dockerCommand,
    [
      "exec",
      "--interactive",
      `supabase_db_${projectId}`,
      "psql",
      "--username",
      "postgres",
      "--dbname",
      "postgres",
      "--set",
      "ON_ERROR_STOP=1",
    ],
    {
      env: environment,
      input: readFileSync(path),
      stdio: ["pipe", "inherit", "inherit"],
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run(["db", "lint", "--local", "--level", "error", "--fail-on", "error"]);
run(["test", "db", "--local", "supabase/tests/database"]);
runSqlFile("supabase/tests/fixtures/regression-base.sql");

const regressions = readdirSync("supabase/tests")
  .filter(file => file.endsWith(".sql"))
  .sort();

for (const file of regressions) {
  console.log(`Running transactional database regression: ${file}`);
  runSqlFile(`supabase/tests/${file}`);
}
