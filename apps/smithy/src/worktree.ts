import { access, mkdir } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

function runGit(args: string[], cwd: string) {
  return new Promise<void>((resolve, reject) => {
    let stderr = "";
    const child = spawn("git", args, { cwd, shell: false });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve() : reject(new Error(`git worktree exited with code ${code}: ${stderr.trim()}`)));
  });
}

export async function prepareWorktree(repo: string, branch: string | null, taskId: string) {
  const root = path.join(repo, ".smithy-worktrees");
  const target = path.join(root, taskId);
  await mkdir(root, { recursive: true });
  try { await access(target); return target; } catch { /* create below */ }
  try { await runGit(branch ? ["worktree", "add", target, branch] : ["worktree", "add", "--detach", target, "HEAD"], repo); } catch (error) {
    try { await access(target); return target; } catch { /* report original error */ }
    throw error;
  }
  return target;
}
