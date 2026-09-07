import { lstat, mkdir, realpath } from "node:fs/promises";
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

async function existingWorktree(root: string, target: string) {
  const rootStat = await lstat(root);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) throw new Error("Smithy worktree root must be a real directory");
  const stat = await lstat(target);
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error("Existing Smithy worktree path must be a real directory");
  const resolvedRoot = await realpath(root);
  const resolvedTarget = await realpath(target);
  if (!resolvedTarget.startsWith(`${resolvedRoot}${path.sep}`)) throw new Error("Existing Smithy worktree escapes its workspace root");
  return target;
}

export async function prepareWorktree(repo: string, branch: string | null, taskId: string) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(taskId) || taskId === "." || taskId === "..") throw new Error("Task id is not safe for a Smithy worktree path");
  const root = path.join(repo, ".smithy-worktrees");
  const target = path.resolve(root, taskId);
  if (!target.startsWith(`${path.resolve(root)}${path.sep}`)) throw new Error("Task worktree path escapes the Smithy workspace root");
  await mkdir(root, { recursive: true });
  try {
    return await existingWorktree(root, target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  try { await runGit(branch ? ["worktree", "add", target, branch] : ["worktree", "add", "--detach", target, "HEAD"], repo); } catch (error) {
    try { return await existingWorktree(root, target); } catch { /* report original error */ }
    throw error;
  }
  return existingWorktree(root, target);
}
