import { Router, Response } from "express";
import multer from "multer";
import { requireAuth, requireWriteAccess, type AuthRequest } from "../middleware/auth.js";
import { uploadFile, deleteFile, getSignedDownloadUrl } from "../s3/client.js";
import { generateId } from "../utils/helpers.js";

const router = Router();

// Multer in-memory storage (max 15 MB)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }, // 15 MB
});

// ── POST /api/upload ──
router.post(
  "/",
  requireAuth,
  requireWriteAccess("upload"),
  upload.array("files", 10),
  async (req: AuthRequest, res: Response) => {
    try {
      const files = req.files as Express.Multer.File[] | undefined;
      if (!files || files.length === 0) {
        res.status(400).json({ error: "No files provided" });
        return;
      }

      const { scope } = req.body;
      const scopeStr = scope || "documents";

      const results = await Promise.all(
        files.map(async (file) => {
          const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]+/g, "_");
          const key = `${req.user!.id}/${scopeStr}/${Date.now()}-${generateId().slice(0, 6)}-${safeName}`;

          await uploadFile(key, file.buffer, file.mimetype || "application/octet-stream");

          return {
            path: key,
            name: file.originalname,
            type: file.mimetype || "application/octet-stream",
            size: file.size,
            uploaded_at: new Date().toISOString(),
          };
        }),
      );

      res.status(201).json(results);
    } catch (err) {
      console.error("Upload error:", err);
      res.status(500).json({ error: "Upload failed" });
    }
  },
);

// ── DELETE /api/upload ──
router.delete("/", requireAuth, requireWriteAccess("upload"), async (req: AuthRequest, res: Response) => {
  try {
    const { paths } = req.body;
    if (!paths || !Array.isArray(paths)) {
      res.status(400).json({ error: "paths array required" });
      return;
    }

    await Promise.all(paths.map((p: string) => deleteFile(p)));
    res.json({ success: true });
  } catch (err) {
    console.error("Delete files error:", err);
    res.status(500).json({ error: "Delete failed" });
  }
});

// ── GET /api/upload/signed-url/* ──
router.get("/signed-url/**", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    // Reconstruct the key from the path (may contain slashes)
    const key = req.path.replace("/api/upload/signed-url/", "");
    const url = await getSignedDownloadUrl(key, 60);
    res.json({ signedUrl: url });
  } catch (err) {
    console.error("Generate signed URL error:", err);
    res.status(500).json({ error: "Failed to generate URL" });
  }
});

export default router;
