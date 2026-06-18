import { Router, Response } from "express";
import multer from "multer";
import { Readable } from "stream";
import { requireAuth, requireWriteAccess, verifyToken, type AuthRequest } from "../middleware/auth.js";
import { uploadFile, deleteFile, getFileStream } from "../s3/client.js";
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
// Streams the file from S3 directly so AWS credentials never reach the client
router.get("/signed-url/**", async (req: AuthRequest, res: Response) => {
  try {
    // Support auth via query param ?token= (for opening in a new tab) or via Bearer header
    let user: { id: string; email: string; roles: any[] } | null = null;

    const queryToken = req.query.token as string | undefined;
    if (queryToken) {
      try {
        const decoded = verifyToken(queryToken);
        user = { id: decoded.sub, email: decoded.email, roles: decoded.roles };
      } catch { /* fall through to header check */ }
    }

    if (!user) {
      const authHeader = req.headers.authorization;
      if (authHeader && authHeader.startsWith("Bearer ")) {
        try {
          const decoded = verifyToken(authHeader.replace("Bearer ", ""));
          user = { id: decoded.sub, email: decoded.email, roles: decoded.roles };
        } catch { /* ignore */ }
      }
    }

    if (!user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    req.user = user;

    // Extract the S3 key from the path (relative to mount point /api/upload)
    const rawKey = req.path.replace("/signed-url/", "");
    const key = decodeURIComponent(rawKey);

    const s3Response = await getFileStream(key);

    if (!s3Response.Body) {
      res.status(404).json({ error: "File not found" });
      return;
    }

    // Set content headers so the browser renders inline (PDFs, images, etc.)
    const contentType = s3Response.ContentType || "application/octet-stream";
    res.setHeader("Content-Type", contentType);
    res.setHeader("Content-Disposition", "inline");
    if (s3Response.ContentLength) {
      res.setHeader("Content-Length", s3Response.ContentLength.toString());
    }

    // Pipe the S3 stream directly to the client — no AWS credentials exposed
    const bodyStream = s3Response.Body as Readable;
    bodyStream.pipe(res);
  } catch (err) {
    console.error("Stream file error:", err);
    if (!res.headersSent) {
      res.status(500).json({ error: "Failed to download file" });
    }
  }
});

export default router;
