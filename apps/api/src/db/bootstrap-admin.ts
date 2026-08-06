import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { db } from "./database.js";

const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
const password = process.env.ADMIN_PASSWORD;
const name = process.env.ADMIN_NAME?.trim() || "Administrator";

if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
  throw new Error("ADMIN_EMAIL must be a valid email address");
}

if (!password || password.length < 12) {
  throw new Error("ADMIN_PASSWORD must contain at least 12 characters");
}

try {
  const existing = await db.prepare("SELECT id, kind FROM users WHERE email = ?").get(email) as { id: string; kind: string } | undefined;
  if (existing?.kind === "AGENT") throw new Error("ADMIN_EMAIL already belongs to an agent identity");

  const passwordHash = await bcrypt.hash(password, 12);
  const now = new Date().toISOString();
  if (existing) {
    await db.prepare("UPDATE users SET name = ?, password_hash = ?, role = 'ADMIN' WHERE id = ?")
      .run(name, passwordHash, existing.id);
  } else {
    await db.prepare(`INSERT INTO users (id, email, name, password_hash, kind, role, avatar_url, created_at)
      VALUES (?, ?, ?, ?, 'HUMAN', 'ADMIN', NULL, ?)`)
      .run(randomUUID(), email, name, passwordHash, now);
  }

  console.log(`Administrator ${existing ? "updated" : "created"}: ${email}`);
} finally {
  await db.close();
}
