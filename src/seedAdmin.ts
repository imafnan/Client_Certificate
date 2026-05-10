import bcrypt from "bcrypt";
import { User } from "./models/User";

function adminCredentialsFromEnv(): { email: string; password: string } | null {
  const emailRaw =
    process.env.Adminemail?.trim() ?? process.env.ADMIN_EMAIL?.trim();
  const password =
    process.env.Adminpassword ?? process.env.ADMIN_PASSWORD ?? "";

  if (!emailRaw || !password) {
    console.warn(
      "Adminemail / Adminpassword (or ADMIN_EMAIL / ADMIN_PASSWORD) not set; skipping admin seed."
    );
    return null;
  }

  return { email: emailRaw.toLowerCase(), password };
}

/** Ensures the admin from env exists in MongoDB with a bcrypt password hash. */
export async function ensureAdminFromEnv(): Promise<void> {
  const creds = adminCredentialsFromEnv();
  if (!creds) return;

  const passwordHash = await bcrypt.hash(creds.password, 10);
  await User.findOneAndUpdate(
    { email: creds.email },
    { email: creds.email, passwordHash, role: "admin" },
    { upsert: true, new: true }
  );
  console.log(`Admin user synced for ${creds.email}`);
}
