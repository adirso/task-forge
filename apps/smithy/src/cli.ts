import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import path from "node:path";
import { defaultEnvFile, readProviders, writeProviders, type SmithyProviderValues } from "./env-file.js";

const labels = ["claude", "codex", "cursor", "other"] as const;

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function masked(value: string | undefined): string {
  return value ? `${value.slice(0, 3)}***` : "(not set)";
}

async function promptRequired(rl: ReturnType<typeof createInterface>, label: string, current?: string): Promise<string> {
  const answer = (await rl.question(`${label}${current ? ` [${current}]` : ""}: `)).trim();
  if (answer) return answer;
  if (current) return current;
  throw new Error(`${label} is required`);
}

async function configure(file: string): Promise<void> {
  const providers = await readProviders(file);
  const rl = createInterface({ input, output });
  try {
    console.log(`Smithy provider configuration: ${path.resolve(file)}`);
    while (true) {
      console.log("\nProviders:");
      const names = Object.keys(providers);
      if (!names.length) console.log("  (none)");
      for (const name of names) { const provider = providers[name]; if (provider) console.log(`  ${name} (apiToken ${masked(provider.apiToken)}, webhookSecret ${masked(provider.webhookSecret)})`); }
      const action = (await rl.question("\nChoose [a]dd/[e]dit, [r]emove, [q]uit: ")).trim().toLowerCase();
      if (action === "q" || action === "quit") break;
      if (action === "r" || action === "remove") {
        const name = (await rl.question("Provider label to remove: ")).trim();
        if (providers[name]) { delete providers[name]; await writeProviders(file, providers); console.log("Provider removed."); }
        else console.log("Provider not found.");
        continue;
      }
      if (action !== "a" && action !== "add" && action !== "e" && action !== "edit") continue;
      const selected = (await rl.question("Provider [claude/codex/cursor/other]: ")).trim().toLowerCase();
      const name = selected === "other" ? await promptRequired(rl, "Custom provider label") : selected;
      if (!/^[a-z][a-z0-9_-]{0,63}$/i.test(name)) throw new Error("Provider label must start with a letter and contain only letters, numbers, '_' or '-'.");
      const current = providers[name];
      const cmd = await promptRequired(rl, "Command template (use {prompt})", current?.cmd);
      const repoAnswer = (await rl.question(`Fallback repository path${current?.repo ? ` [${current.repo}]` : " (optional)"}: `)).trim();
      const secret = await promptRequired(rl, "Webhook secret (blank keeps existing)", current?.webhookSecret);
      const token = await promptRequired(rl, "TaskForge API token (blank keeps existing)", current?.apiToken);
      const next: SmithyProviderValues = { cmd, webhookSecret: secret, apiToken: token };
      if (repoAnswer || current?.repo) next.repo = repoAnswer || current?.repo;
      providers[name] = next;
      await writeProviders(file, providers);
      console.log(`Saved ${name} to ${path.resolve(file)}. Secrets were not printed.`);
    }
  } finally { rl.close(); }
}

const requestedFile = option(process.argv.slice(2), "--env-file");
// npm workspace scripts run from apps/smithy; INIT_CWD preserves the directory
// from which the operator invoked npm, so repository-root paths still work.
const file = requestedFile && !path.isAbsolute(requestedFile) && process.env.INIT_CWD
  ? path.resolve(process.env.INIT_CWD, requestedFile)
  : requestedFile ?? defaultEnvFile();
configure(file).catch((error) => { console.error(error instanceof Error ? error.message : "Unable to configure Smithy"); process.exitCode = 1; });
