const mode = process.argv.find((arg) => arg.startsWith("--mode="))?.slice("--mode=".length) ?? process.env.FAKE_PROVIDER_MODE ?? "success";
const args = process.argv.slice(2).join(" ");

if (mode === "timeout") {
  setTimeout(() => {}, 60_000);
} else if (mode === "missing-auth") {
  process.stderr.write("authentication required token=tf_fake_secret\n");
  process.exitCode = 1;
} else {
  process.stdout.write(`token=tf_fake_secret provider-output ${args}\n`);
  process.stderr.write("progress: ready\n");
}
