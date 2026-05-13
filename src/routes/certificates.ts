import { Router } from "express";
import mongoose from "mongoose";
import { Certificate } from "../models/Certificate";
import { Counter } from "../models/Counter";
import { requireAdmin } from "../middleware/requireAdmin";
import { parseOptionalDate } from "../utils/dates";

const router = Router();

/** Certificate reference: SPD + 6-digit sequence (e.g. SPD000001). */
const REF_PREFIX = "SPD";

async function nextSequence(): Promise<number> {
  const doc = await Counter.findOneAndUpdate(
    { _id: "certificate" },
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  );
  if (!doc || typeof doc.seq !== "number") {
    throw new Error("Counter sequence unavailable");
  }
  return doc.seq;
}

function refNoFromSequence(seq: number): string {
  const suffix = String(seq).padStart(6, "0");
  return `${REF_PREFIX}${suffix}`;
}

router.get("/", requireAdmin, async (_req, res) => {
  try {
    const certificates = await Certificate.find()
      .sort({ createdAt: -1 })
      .lean();
    res.json({
      success: true,
      count: certificates.length,
      certificates,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      success: false,
      message: "Could not list certificates",
    });
  }
});

router.post("/", requireAdmin, async (req, res) => {
  try {
    const body = req.body ?? {};
    const full_name =
      typeof body.full_name === "string" ? body.full_name.trim() : "";

    if (!full_name) {
      res.status(400).json({
        success: false,
        message: "full_name is required",
      });
      return;
    }

    const seq = await nextSequence();
    const ref_no = refNoFromSequence(seq);

    const doc = await Certificate.create({
      sequenceId: seq,
      ref_no,
      full_name,
      date_of_birth: parseOptionalDate(body.date_of_birth),
      passport_no:
        typeof body.passport_no === "string"
          ? body.passport_no.trim()
          : undefined,
      nid_card_no:
        typeof body.nid_card_no === "string"
          ? body.nid_card_no.trim()
          : undefined,
      father_name:
        typeof body.father_name === "string"
          ? body.father_name.trim()
          : undefined,
      mother_name:
        typeof body.mother_name === "string"
          ? body.mother_name.trim()
          : undefined,
      village:
        typeof body.village === "string" ? body.village.trim() : undefined,
      post_office:
        typeof body.post_office === "string"
          ? body.post_office.trim()
          : undefined,
      upazila:
        typeof body.upazila === "string" ? body.upazila.trim() : undefined,
      district:
        typeof body.district === "string" ? body.district.trim() : undefined,
      skill_title:
        typeof body.skill_title === "string" && body.skill_title.trim()
          ? body.skill_title.trim()
          : "Agriculture",
      experience_years:
        typeof body.experience_years === "number" &&
        Number.isFinite(body.experience_years)
          ? Math.trunc(body.experience_years)
          : 5,
      issue_date: parseOptionalDate(body.issue_date),
      start_date: parseOptionalDate(body.start_date),
      end_date: parseOptionalDate(body.end_date),
      status:
        body.status === "published" || body.status === "draft"
          ? body.status
          : "draft",
    });

    res.status(201).json({
      success: true,
      message: "Certificate created",
      certificate: doc.toJSON(),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      success: false,
      message: "Could not create certificate",
    });
  }
});

const PATCHABLE = [
  "full_name",
  "date_of_birth",
  "passport_no",
  "nid_card_no",
  "father_name",
  "mother_name",
  "village",
  "post_office",
  "upazila",
  "district",
  "skill_title",
  "experience_years",
  "issue_date",
  "start_date",
  "end_date",
  "status",
] as const;

router.patch("/:id", requireAdmin, async (req, res) => {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    res.status(400).json({ success: false, message: "Invalid certificate id" });
    return;
  }

  const updates: Record<string, unknown> = {};
  const body = req.body ?? {};

  for (const key of PATCHABLE) {
    if (!(key in body)) continue;
    const value = body[key];
    if (
      key === "date_of_birth" ||
      key === "issue_date" ||
      key === "start_date" ||
      key === "end_date"
    ) {
      const d = parseOptionalDate(value);
      if (value !== undefined && value !== null && value !== "" && !d) {
        res.status(400).json({
          success: false,
          message: `Invalid date for ${key}`,
        });
        return;
      }
      updates[key] = d;
      continue;
    }
    if (key === "experience_years") {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        res.status(400).json({
          success: false,
          message: "experience_years must be a number",
        });
        return;
      }
      updates[key] = Math.trunc(value);
      continue;
    }
    if (key === "status") {
      if (value !== "draft" && value !== "published") {
        res.status(400).json({
          success: false,
          message: "status must be draft or published",
        });
        return;
      }
      updates[key] = value;
      continue;
    }
    if (typeof value === "string") {
      updates[key] = value.trim();
      continue;
    }
    if (value === null || value === "") {
      updates[key] = undefined;
      continue;
    }
    res.status(400).json({
      success: false,
      message: `Invalid value for ${key}`,
    });
    return;
  }

  if (Object.keys(updates).length === 0) {
    res.status(400).json({
      success: false,
      message: "No valid fields to update",
    });
    return;
  }

  if (
    "full_name" in updates &&
    typeof updates.full_name === "string" &&
    !updates.full_name
  ) {
    res.status(400).json({
      success: false,
      message: "full_name cannot be empty",
    });
    return;
  }

  try {
    const doc = await Certificate.findByIdAndUpdate(id, updates, {
      new: true,
      runValidators: true,
    });

    if (!doc) {
      res.status(404).json({
        success: false,
        message: "Certificate not found",
      });
      return;
    }

    res.json({
      success: true,
      message: "Certificate updated",
      certificate: doc.toJSON(),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      success: false,
      message: "Could not update certificate",
    });
  }
});

router.delete("/:id", requireAdmin, async (req, res) => {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    res.status(400).json({ success: false, message: "Invalid certificate id" });
    return;
  }

  try {
    const doc = await Certificate.findByIdAndDelete(id);
    if (!doc) {
      res.status(404).json({
        success: false,
        message: "Certificate not found",
      });
      return;
    }
    res.json({
      success: true,
      message: "Certificate deleted",
      certificate: doc.toJSON(),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      success: false,
      message: "Could not delete certificate",
    });
  }
});

router.get("/ref/:refNo", async (req, res) => {
  const refNo = decodeURIComponent(req.params.refNo ?? "").trim();
  if (!refNo) {
    res.status(400).json({
      success: false,
      message: "ref_no is required",
    });
    return;
  }

  try {
    const doc = await Certificate.findOne({ ref_no: refNo });
    if (!doc) {
      res.status(404).json({
        success: false,
        message: "Certificate not found",
      });
      return;
    }
    res.json({
      success: true,
      certificate: doc.toJSON(),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      success: false,
      message: "Search failed",
    });
  }
});

export const certificatesRouter = router;
