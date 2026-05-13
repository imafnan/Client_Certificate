import "dotenv/config";
import dns from "node:dns";
import bcrypt from "bcrypt";
import express from "express";
import mongoose from "mongoose";
import { User } from "./models/User";
import { certificatesRouter } from "./routes/certificates";
import { adminRouter } from "./routes/admin";
import { configureCloudinary } from "./config/cloudinary";
import { siteSettingsRouter } from "./routes/siteSettings";

const app = express();
app.use(express.json());

const PORT = Number(process.env.PORT) || 3000;

/**
 * On Windows, Node's DNS SRV lookup for mongodb+srv:// sometimes fails with
 * querySrv ECONNREFUSED even when `nslookup` works. Using explicit resolvers
 * avoids that for many setups (corporate/VPN issues may require unsetting this).
 */
function applyMongoSrvDnsWorkaround(uri: string): void {
  if (!uri.startsWith("mongodb+srv://")) return;
  if (process.env.MONGODB_SKIP_DNS_OVERRIDE === "1") return;

  const raw = process.env.MONGODB_DNS_SERVERS;
  const custom =
    raw?.split(",")
      .map((s) => s.trim())
      .filter(Boolean) ?? [];
  dns.setServers(custom.length > 0 ? custom : ["1.1.1.1", "8.8.8.8"]);
}

async function start(): Promise<void> {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error("Missing MONGODB_URI in environment (.env)");
    process.exit(1);
  }

  try {
    applyMongoSrvDnsWorkaround(uri);
    await mongoose.connect(uri);
    console.log("Database is connected successfully");

    const adminCount = await User.countDocuments({ role: "admin" });
    if (adminCount === 0) {
      console.warn(
        "No admin user in the database. Create one with POST /admin/bootstrap (JSON body: email, password)."
      );
    }

    const userFromUri = /^mongodb(\+srv)?:\/\/([^:]+):/i.exec(uri);
    if (userFromUri?.[2]) {
      console.log(`MongoDB username: ${userFromUri[2]}`);
    }

    configureCloudinary();

    app.use("/admin", adminRouter);
    app.use("/certificates", certificatesRouter);
    app.use("/site-settings", siteSettingsRouter);

    app.get("/", (_req, res) => {
      res.json({ ok: true, message: "API is running" });
    });

    app.post("/login", async (req, res) => {
      const email = req.body?.email;
      const password = req.body?.password;

      if (typeof email !== "string" || typeof password !== "string") {
        res.status(400).json({
          success: false,
          message: "Login failed",
          detail: "Email and password must be strings",
        });
        return;
      }

      const normalizedEmail = email.trim().toLowerCase();
      const user = await User.findOne({ email: normalizedEmail });

      if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
        res.status(401).json({ success: false, message: "Login failed" });
        return;
      }

      res.json({
        success: true,
        message: "Login success",
        user: { email: user.email, role: user.role },
      });
    });

    app.listen(PORT, () => {
      console.log(`Server listening on http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error("Failed to connect to MongoDB:", err);
    process.exit(1);
  }
}

void start();
