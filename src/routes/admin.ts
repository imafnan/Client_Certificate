import { Router } from "express";
import bcrypt from "bcrypt";
import { User } from "../models/User";
import { requireAdmin } from "../middleware/requireAdmin";

const router = Router();

const MIN_PASSWORD_LENGTH = 8;

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

/** Check whether first-time bootstrap is still allowed (no admin in DB yet). */
router.get("/bootstrap", async (_req, res) => {
  try {
    const adminCount = await User.countDocuments({ role: "admin" });
    res.json({
      success: true,
      canBootstrap: adminCount === 0,
      adminUsersInDatabase: adminCount,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      success: false,
      message: "Could not read admin status",
    });
  }
});

/** First-time setup: create the only admin user when no admin exists yet (no env credentials). */
router.post("/bootstrap", async (req, res) => {
  try {
    const adminCount = await User.countDocuments({ role: "admin" });
    if (adminCount > 0) {
      res.status(403).json({
        success: false,
        code: "ADMIN_ALREADY_EXISTS",
        message:
          "An admin account already exists in the database. Bootstrap is only for the first admin. Use POST /login with your saved credentials, or delete the admin user in MongoDB only if you intentionally want to run bootstrap again.",
        adminUsersInDatabase: adminCount,
      });
      return;
    }

    const body = req.body ?? {};
    const emailRaw = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body.password === "string" ? body.password : "";

    if (!emailRaw || !isValidEmail(emailRaw)) {
      res.status(400).json({
        success: false,
        message: "Valid email is required",
      });
      return;
    }

    if (password.length < MIN_PASSWORD_LENGTH) {
      res.status(400).json({
        success: false,
        message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
      });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await User.create({
      email: emailRaw,
      passwordHash,
      role: "admin",
    });

    res.status(201).json({
      success: true,
      message: "Admin account created. Store these credentials securely.",
      user: { email: user.email, role: user.role },
    });
  } catch (err: unknown) {
    if (
      err &&
      typeof err === "object" &&
      "code" in err &&
      (err as { code?: number }).code === 11000
    ) {
      res.status(409).json({
        success: false,
        message: "That email is already registered",
      });
      return;
    }
    console.error(err);
    res.status(500).json({
      success: false,
      message: "Could not create admin account",
    });
  }
});

/** Current admin profile (auth via headers). */
router.get("/account", requireAdmin, async (req, res) => {
  const user = req.adminUser!;
  res.json({
    success: true,
    user: { email: user.email, role: user.role },
  });
});

/** Change admin email (requires current password). After success, use the new email in `x-admin-email`. */
router.patch("/account/email", requireAdmin, async (req, res) => {
  const admin = req.adminUser!;
  const body = req.body ?? {};
  const currentPassword =
    typeof body.currentPassword === "string" ? body.currentPassword : "";
  const newEmailRaw =
    typeof body.newEmail === "string" ? body.newEmail.trim().toLowerCase() : "";

  if (!newEmailRaw || !isValidEmail(newEmailRaw)) {
    res.status(400).json({
      success: false,
      message: "Valid newEmail is required",
    });
    return;
  }

  if (!currentPassword) {
    res.status(400).json({
      success: false,
      message: "currentPassword is required",
    });
    return;
  }

  if (!(await bcrypt.compare(currentPassword, admin.passwordHash))) {
    res.status(401).json({
      success: false,
      message: "Current password is incorrect",
    });
    return;
  }

  if (newEmailRaw === admin.email) {
    res.json({
      success: true,
      message: "Email unchanged",
      user: { email: admin.email, role: admin.role },
    });
    return;
  }

  try {
    const existing = await User.findOne({ email: newEmailRaw });
    if (existing && String(existing._id) !== String(admin._id)) {
      res.status(409).json({
        success: false,
        message: "That email is already in use",
      });
      return;
    }

    admin.email = newEmailRaw;
    await admin.save();

    res.json({
      success: true,
      message:
        "Email updated. Use the new address in the x-admin-email header for admin API calls.",
      user: { email: admin.email, role: admin.role },
    });
  } catch (err: unknown) {
    if (
      err &&
      typeof err === "object" &&
      "code" in err &&
      (err as { code?: number }).code === 11000
    ) {
      res.status(409).json({
        success: false,
        message: "That email is already in use",
      });
      return;
    }
    console.error(err);
    res.status(500).json({
      success: false,
      message: "Could not update email",
    });
  }
});

/** Change admin password (requires current password). */
router.patch("/account/password", requireAdmin, async (req, res) => {
  const admin = req.adminUser!;
  const body = req.body ?? {};
  const currentPassword =
    typeof body.currentPassword === "string" ? body.currentPassword : "";
  const newPassword =
    typeof body.newPassword === "string" ? body.newPassword : "";

  if (!currentPassword) {
    res.status(400).json({
      success: false,
      message: "currentPassword is required",
    });
    return;
  }

  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    res.status(400).json({
      success: false,
      message: `newPassword must be at least ${MIN_PASSWORD_LENGTH} characters`,
    });
    return;
  }

  if (!(await bcrypt.compare(currentPassword, admin.passwordHash))) {
    res.status(401).json({
      success: false,
      message: "Current password is incorrect",
    });
    return;
  }

  try {
    admin.passwordHash = await bcrypt.hash(newPassword, 10);
    await admin.save();

    res.json({
      success: true,
      message:
        "Password updated. Use the new password in the x-admin-password header for admin API calls.",
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      success: false,
      message: "Could not update password",
    });
  }
});

export const adminRouter = router;
