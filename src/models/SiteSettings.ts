import mongoose from "mongoose";

export interface IBanner {
  _id?: mongoose.Types.ObjectId;
  publicId: string;
  url: string;
}

/** Single logical row `key: "site"` — hero/banner and gallery images in Cloudinary. */
export interface ISiteSettings extends mongoose.Document {
  key: string;
  banners: IBanner[];
  gallery: IBanner[];
  /** @deprecated Migrated into `banners`; removed after first read */
  heroBackgroundPublicId?: string;
  heroBackgroundUrl?: string;
}

const bannerSchema = new mongoose.Schema<IBanner>(
  {
    publicId: { type: String, required: true },
    url: { type: String, required: true },
  },
  { _id: true }
);

const siteSettingsSchema = new mongoose.Schema<ISiteSettings>(
  {
    key: { type: String, required: true, unique: true, index: true },
    banners: { type: [bannerSchema], default: [] },
    gallery: { type: [bannerSchema], default: [] },
    heroBackgroundPublicId: { type: String },
    heroBackgroundUrl: { type: String },
  },
  { timestamps: true }
);

export const SiteSettings =
  mongoose.models.SiteSettings ??
  mongoose.model<ISiteSettings>("SiteSettings", siteSettingsSchema);

export const SITE_SETTINGS_KEY = "site" as const;
