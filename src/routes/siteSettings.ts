import { Router } from "express";
import type { NextFunction, Request, Response } from "express";
import mongoose from "mongoose";
import multer, { MulterError } from "multer";
import type { UploadApiResponse } from "cloudinary";
import { cloudinary, configureCloudinary, isCloudinaryConfigured } from "../config/cloudinary";
import { requireAdmin } from "../middleware/requireAdmin";
import { SITE_SETTINGS_KEY, SiteSettings } from "../models/SiteSettings";

const router = Router();

const HERO_FOLDER = "client_certificate/hero";
const GALLERY_FOLDER = "client_certificate/gallery";

type BannerLean = {
  _id?: mongoose.Types.ObjectId;
  publicId: string;
  url: string;
};

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = /^image\/(jpeg|jpg|png|gif|webp)$/i.test(file.mimetype);
    if (ok) cb(null, true);
    else
      cb(new Error("Only JPEG, PNG, GIF, or WebP images are allowed"));
  },
});

function uploadBuffer(buffer: Buffer, folder: string): Promise<UploadApiResponse> {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder, resource_type: "image" },
      (err, result) => {
        if (err) reject(err);
        else if (!result) reject(new Error("Cloudinary upload returned no result"));
        else resolve(result);
      }
    );
    stream.end(buffer);
  });
}

async function removeFromCloudinary(publicId: string | undefined): Promise<void> {
  if (!publicId) return;
  await cloudinary.uploader.destroy(publicId, { resource_type: "image" });
}

/** Parses multipart field `image` and forwards Multer errors as JSON. */
function multerSingleImage(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  upload.single("image")(req, res, (err: unknown) => {
    if (err instanceof MulterError) {
      if (err.code === "LIMIT_FILE_SIZE") {
        res.status(400).json({
          success: false,
          message: "Image too large (max 5 MB)",
        });
        return;
      }
      res.status(400).json({ success: false, message: err.message });
      return;
    }
    if (err instanceof Error) {
      res.status(400).json({ success: false, message: err.message });
      return;
    }
    next();
  });
}

/** One-time move from legacy single hero fields into `banners`. */
async function ensureLegacyMigrated(): Promise<void> {
  const doc = await SiteSettings.findOne({ key: SITE_SETTINGS_KEY });
  if (!doc) return;
  const hasLegacy =
    Boolean(doc.heroBackgroundUrl && doc.heroBackgroundPublicId) &&
    (!doc.banners || doc.banners.length === 0);
  if (!hasLegacy) return;
  await SiteSettings.updateOne(
    { key: SITE_SETTINGS_KEY },
    {
      $set: {
        banners: [
          {
            publicId: doc.heroBackgroundPublicId!,
            url: doc.heroBackgroundUrl!,
          },
        ],
      },
      $unset: { heroBackgroundPublicId: 1, heroBackgroundUrl: 1 },
    }
  );
}

/** Public: all hero/banner images for the landing page (no auth). */
router.get("/hero-background", async (_req, res) => {
  try {
    await ensureLegacyMigrated();
    const raw = await SiteSettings.findOne({ key: SITE_SETTINGS_KEY }).lean();
    const doc = raw as { banners?: BannerLean[] } | null;
    const list = doc?.banners ?? [];
    const banners = list.map((b) => ({
      id: b._id?.toString(),
      url: b.url,
      publicId: b.publicId,
    }));
    res.json({
      success: true,
      banners,
      count: banners.length,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      success: false,
      message: "Could not load banner settings",
    });
  }
});

/** Admin: add a banner image (multipart field name: `image`). */
router.post(
  "/hero-background",
  requireAdmin,
  multerSingleImage,
  async (req, res) => {
    if (!isCloudinaryConfigured()) {
      res.status(503).json({
        success: false,
        message:
          "Cloudinary is not configured. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET.",
      });
      return;
    }
    configureCloudinary();

    const file = req.file;
    if (!file?.buffer?.length) {
      res.status(400).json({
        success: false,
        message: "Missing image file (use multipart field name: image)",
      });
      return;
    }

    try {
      await ensureLegacyMigrated();
      const uploaded = await uploadBuffer(file.buffer, HERO_FOLDER);

      const doc = await SiteSettings.findOneAndUpdate(
        { key: SITE_SETTINGS_KEY },
        {
          $push: {
            banners: {
              publicId: uploaded.public_id,
              url: uploaded.secure_url,
            },
          },
          $setOnInsert: { key: SITE_SETTINGS_KEY },
        },
        { new: true, upsert: true, runValidators: true }
      );

      const added = doc!.banners[doc!.banners.length - 1];
      res.status(201).json({
        success: true,
        message: "Banner added",
        banner: {
          id: added._id?.toString(),
          url: added.url,
          publicId: added.publicId,
        },
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({
        success: false,
        message: "Could not upload banner",
      });
    }
  }
);

/** Admin: replace an existing banner image (multipart field name: `image`). */
router.patch(
  "/hero-background/:bannerId",
  requireAdmin,
  multerSingleImage,
  async (req, res) => {
    const { bannerId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(bannerId)) {
      res.status(400).json({ success: false, message: "Invalid banner id" });
      return;
    }

    if (!isCloudinaryConfigured()) {
      res.status(503).json({
        success: false,
        message:
          "Cloudinary is not configured. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET.",
      });
      return;
    }
    configureCloudinary();

    const file = req.file;
    if (!file?.buffer?.length) {
      res.status(400).json({
        success: false,
        message: "Missing image file (use multipart field name: image)",
      });
      return;
    }

    try {
      await ensureLegacyMigrated();
      const doc = await SiteSettings.findOne({ key: SITE_SETTINGS_KEY });
      if (!doc) {
        res.status(404).json({
          success: false,
          message: "No banners configured",
        });
        return;
      }

      const sub = doc.banners.id(bannerId);
      if (!sub) {
        res.status(404).json({ success: false, message: "Banner not found" });
        return;
      }

      const previousPublicId = sub.publicId;
      const uploaded = await uploadBuffer(file.buffer, HERO_FOLDER);

      sub.set({
        publicId: uploaded.public_id,
        url: uploaded.secure_url,
      });
      await doc.save();

      if (previousPublicId && previousPublicId !== uploaded.public_id) {
        try {
          await removeFromCloudinary(previousPublicId);
        } catch (destroyErr) {
          console.error("Could not delete previous image from Cloudinary:", destroyErr);
        }
      }

      res.json({
        success: true,
        message: "Banner updated",
        banner: {
          id: sub._id?.toString(),
          url: sub.url,
          publicId: sub.publicId,
          updatedAt: doc.updatedAt,
        },
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({
        success: false,
        message: "Could not update banner",
      });
    }
  }
);

/** Admin: remove one banner by id (Mongo subdocument id). */
router.delete("/hero-background/:bannerId", requireAdmin, async (req, res) => {
  const { bannerId } = req.params;
  if (!mongoose.Types.ObjectId.isValid(bannerId)) {
    res.status(400).json({ success: false, message: "Invalid banner id" });
    return;
  }

  if (!isCloudinaryConfigured()) {
    res.status(503).json({
      success: false,
      message:
        "Cloudinary is not configured. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET.",
    });
    return;
  }
  configureCloudinary();

  try {
    await ensureLegacyMigrated();
    const doc = await SiteSettings.findOne({ key: SITE_SETTINGS_KEY });
    if (!doc) {
      res.status(404).json({
        success: false,
        message: "No banners configured",
      });
      return;
    }

    const sub = doc.banners.id(bannerId);
    if (!sub) {
      res.status(404).json({ success: false, message: "Banner not found" });
      return;
    }

    const publicId = sub.publicId;
    sub.deleteOne();
    await doc.save();

    try {
      await removeFromCloudinary(publicId);
    } catch (destroyErr) {
      console.error("Could not delete image from Cloudinary:", destroyErr);
    }

    res.json({
      success: true,
      message: "Banner removed",
      bannerId,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      success: false,
      message: "Could not delete banner",
    });
  }
});

/** Admin: remove all banners from Cloudinary and clear the list. */
router.delete("/hero-background", requireAdmin, async (_req, res) => {
  if (!isCloudinaryConfigured()) {
    res.status(503).json({
      success: false,
      message:
        "Cloudinary is not configured. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET.",
    });
    return;
  }
  configureCloudinary();

  try {
    await ensureLegacyMigrated();
    const doc = await SiteSettings.findOne({ key: SITE_SETTINGS_KEY });
    const banners = doc?.banners ?? [];

    for (const b of banners) {
      try {
        await removeFromCloudinary(b.publicId);
      } catch (destroyErr) {
        console.error("Could not delete banner from Cloudinary:", destroyErr);
      }
    }

    await SiteSettings.findOneAndUpdate(
      { key: SITE_SETTINGS_KEY },
      { $set: { banners: [] }, $unset: { heroBackgroundPublicId: 1, heroBackgroundUrl: 1 } },
      { upsert: false }
    );

    res.json({
      success: true,
      message: "All banners removed",
      banners: [],
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      success: false,
      message: "Could not delete banners",
    });
  }
});

// --- Gallery section (same behavior as hero-background; Cloudinary folder: gallery) ---

/** Public: all gallery images (no auth). */
router.get("/gallery", async (_req, res) => {
  try {
    const raw = await SiteSettings.findOne({ key: SITE_SETTINGS_KEY }).lean();
    const doc = raw as { gallery?: BannerLean[] } | null;
    const list = doc?.gallery ?? [];
    const gallery = list.map((g) => ({
      id: g._id?.toString(),
      url: g.url,
      publicId: g.publicId,
    }));
    res.json({
      success: true,
      gallery,
      count: gallery.length,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      success: false,
      message: "Could not load gallery",
    });
  }
});

/** Admin: add a gallery image (multipart field name: `image`). */
router.post(
  "/gallery",
  requireAdmin,
  multerSingleImage,
  async (req, res) => {
    if (!isCloudinaryConfigured()) {
      res.status(503).json({
        success: false,
        message:
          "Cloudinary is not configured. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET.",
      });
      return;
    }
    configureCloudinary();

    const file = req.file;
    if (!file?.buffer?.length) {
      res.status(400).json({
        success: false,
        message: "Missing image file (use multipart field name: image)",
      });
      return;
    }

    try {
      const uploaded = await uploadBuffer(file.buffer, GALLERY_FOLDER);

      const doc = await SiteSettings.findOneAndUpdate(
        { key: SITE_SETTINGS_KEY },
        {
          $push: {
            gallery: {
              publicId: uploaded.public_id,
              url: uploaded.secure_url,
            },
          },
          $setOnInsert: { key: SITE_SETTINGS_KEY },
        },
        { new: true, upsert: true, runValidators: true }
      );

      const added = doc!.gallery[doc!.gallery.length - 1];
      res.status(201).json({
        success: true,
        message: "Gallery image added",
        galleryItem: {
          id: added._id?.toString(),
          url: added.url,
          publicId: added.publicId,
        },
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({
        success: false,
        message: "Could not upload gallery image",
      });
    }
  }
);

/** Admin: replace a gallery image (multipart field name: `image`). */
router.patch(
  "/gallery/:galleryId",
  requireAdmin,
  multerSingleImage,
  async (req, res) => {
    const { galleryId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(galleryId)) {
      res.status(400).json({ success: false, message: "Invalid gallery id" });
      return;
    }

    if (!isCloudinaryConfigured()) {
      res.status(503).json({
        success: false,
        message:
          "Cloudinary is not configured. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET.",
      });
      return;
    }
    configureCloudinary();

    const file = req.file;
    if (!file?.buffer?.length) {
      res.status(400).json({
        success: false,
        message: "Missing image file (use multipart field name: image)",
      });
      return;
    }

    try {
      const doc = await SiteSettings.findOne({ key: SITE_SETTINGS_KEY });
      if (!doc) {
        res.status(404).json({
          success: false,
          message: "No gallery configured",
        });
        return;
      }

      const sub = doc.gallery.id(galleryId);
      if (!sub) {
        res.status(404).json({ success: false, message: "Gallery image not found" });
        return;
      }

      const previousPublicId = sub.publicId;
      const uploaded = await uploadBuffer(file.buffer, GALLERY_FOLDER);

      sub.set({
        publicId: uploaded.public_id,
        url: uploaded.secure_url,
      });
      await doc.save();

      if (previousPublicId && previousPublicId !== uploaded.public_id) {
        try {
          await removeFromCloudinary(previousPublicId);
        } catch (destroyErr) {
          console.error("Could not delete previous gallery image from Cloudinary:", destroyErr);
        }
      }

      res.json({
        success: true,
        message: "Gallery image updated",
        galleryItem: {
          id: sub._id?.toString(),
          url: sub.url,
          publicId: sub.publicId,
          updatedAt: doc.updatedAt,
        },
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({
        success: false,
        message: "Could not update gallery image",
      });
    }
  }
);

/** Admin: remove one gallery image by id. */
router.delete("/gallery/:galleryId", requireAdmin, async (req, res) => {
  const { galleryId } = req.params;
  if (!mongoose.Types.ObjectId.isValid(galleryId)) {
    res.status(400).json({ success: false, message: "Invalid gallery id" });
    return;
  }

  if (!isCloudinaryConfigured()) {
    res.status(503).json({
      success: false,
      message:
        "Cloudinary is not configured. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET.",
    });
    return;
  }
  configureCloudinary();

  try {
    const doc = await SiteSettings.findOne({ key: SITE_SETTINGS_KEY });
    if (!doc) {
      res.status(404).json({
        success: false,
        message: "No gallery configured",
      });
      return;
    }

    const sub = doc.gallery.id(galleryId);
    if (!sub) {
      res.status(404).json({ success: false, message: "Gallery image not found" });
      return;
    }

    const publicId = sub.publicId;
    sub.deleteOne();
    await doc.save();

    try {
      await removeFromCloudinary(publicId);
    } catch (destroyErr) {
      console.error("Could not delete image from Cloudinary:", destroyErr);
    }

    res.json({
      success: true,
      message: "Gallery image removed",
      galleryId,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      success: false,
      message: "Could not delete gallery image",
    });
  }
});

/** Admin: remove all gallery images from Cloudinary and clear the list. */
router.delete("/gallery", requireAdmin, async (_req, res) => {
  if (!isCloudinaryConfigured()) {
    res.status(503).json({
      success: false,
      message:
        "Cloudinary is not configured. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET.",
    });
    return;
  }
  configureCloudinary();

  try {
    const doc = await SiteSettings.findOne({ key: SITE_SETTINGS_KEY });
    const gallery = doc?.gallery ?? [];

    for (const g of gallery) {
      try {
        await removeFromCloudinary(g.publicId);
      } catch (destroyErr) {
        console.error("Could not delete gallery image from Cloudinary:", destroyErr);
      }
    }

    await SiteSettings.findOneAndUpdate(
      { key: SITE_SETTINGS_KEY },
      { $set: { gallery: [] } },
      { upsert: false }
    );

    res.json({
      success: true,
      message: "All gallery images removed",
      gallery: [],
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      success: false,
      message: "Could not delete gallery images",
    });
  }
});

export const siteSettingsRouter = router;
