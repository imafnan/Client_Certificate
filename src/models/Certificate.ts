import mongoose from "mongoose";

export type CertificateStatus = "draft" | "published";

export interface ICertificate extends mongoose.Document {
  sequenceId: number;
  ref_no: string;
  full_name: string;
  date_of_birth?: Date;
  passport_no?: string;
  nid_card_no?: string;
  father_name?: string;
  mother_name?: string;
  village?: string;
  post_office?: string;
  upazila?: string;
  district?: string;
  skill_title: string;
  experience_years: number;
  issue_date?: Date;
  status: CertificateStatus;
}

const certificateSchema = new mongoose.Schema<ICertificate>(
  {
    sequenceId: { type: Number, required: true, unique: true, index: true },
    ref_no: { type: String, required: true, unique: true, maxlength: 20 },
    full_name: { type: String, required: true, maxlength: 255 },
    date_of_birth: { type: Date },
    passport_no: { type: String, maxlength: 100 },
    nid_card_no: { type: String, maxlength: 100 },
    father_name: { type: String, maxlength: 255 },
    mother_name: { type: String, maxlength: 255 },
    village: { type: String, maxlength: 255 },
    post_office: { type: String, maxlength: 255 },
    upazila: { type: String, maxlength: 255 },
    district: { type: String, maxlength: 255 },
    skill_title: { type: String, maxlength: 255, default: "Agriculture" },
    experience_years: { type: Number, default: 5, min: 0 },
    issue_date: { type: Date },
    status: {
      type: String,
      enum: ["draft", "published"],
      default: "draft",
    },
  },
  { timestamps: true }
);

export const Certificate =
  mongoose.models.Certificate ??
  mongoose.model<ICertificate>("Certificate", certificateSchema);
