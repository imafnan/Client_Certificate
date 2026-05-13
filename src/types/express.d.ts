import type { IUser } from "../models/User";

declare global {
  namespace Express {
    interface Request {
      /** Set by `requireAdmin` after successful admin auth. */
      adminUser?: IUser;
    }
  }
}

export {};
