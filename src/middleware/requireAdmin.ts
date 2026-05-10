import type { NextFunction, Request, Response } from "express";
import bcrypt from "bcrypt";
import { User } from "../models/User";

/**
 * Expects headers x-admin-email and x-admin-password (admin user must exist with role admin).
 */
export async function requireAdmin(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const emailRaw = req.headers["x-admin-email"];
  const passwordRaw = req.headers["x-admin-password"];

  const email =
    typeof emailRaw === "string" ? emailRaw.trim().toLowerCase() : "";
  const password = typeof passwordRaw === "string" ? passwordRaw : "";

  if (!email || !password) {
    res.status(401).json({
      success: false,
      message: "Admin credentials required",
      detail: "Send x-admin-email and x-admin-password headers",
    });
    return;
  }

  const user = await User.findOne({ email });
  if (
    !user ||
    user.role !== "admin" ||
    !(await bcrypt.compare(password, user.passwordHash))
  ) {
    res.status(403).json({ success: false, message: "Forbidden" });
    return;
  }

  next();
}
