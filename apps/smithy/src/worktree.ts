import { mkdir } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

function runGit(args: string[], cwd: string) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn("git", args, { cwd, shell: false, stdio: "ignore" });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve() : reject(new Error(`git worktree exited with code ${code}`)));
  });
}

export async function prepareWorktree(repo: string, branch: string | null, taskId: string) {
  if (!branch) return repo;
  const root = path.join(repo, ".smithy-worktrees");
  const target = path.join(root, taskId);
  await mkdir(root, { recursive: true });
  try { await runGit(["worktree", "add", target, branch], repo); } catch (error) {
    if ((error instanceof Error ? error.message : "").includes("already exists")) return target;
    throw error;
  }
  return target;
}
