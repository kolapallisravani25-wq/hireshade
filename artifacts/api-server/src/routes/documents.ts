import { Router, type IRouter } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { requireAuth } from "../middlewares/requireAuth.js";
import { db } from "@workspace/db";
import { documentsTable } from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { hasExpectedFileSignature } from "../lib/uploadValidation.js";

const router: IRouter = Router();

const UPLOADS_DIR = path.join(process.cwd(), "uploads", "documents");
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// Matches the frontend's stated contract (UploadDocumentDialog: PDF only, 10MB).
// The client-side check is trivially bypassed (Postman/curl), so it must be
// enforced here too — this is the actual security boundary.
const ALLOWED_MIME_TYPES = new Set(["application/pdf"]);

/**
 * Build a safe on-disk filename from a client-supplied original name.
 * `path.basename` strips any directory components (defeats `../../` traversal
 * in the multer filename callback, which does NOT sanitize its input before
 * joining it to the destination dir), and the regex strips anything but a
 * conservative character set so the result can never resolve outside
 * UPLOADS_DIR regardless of what the client sends.
 */
function safeStoredFilename(originalname: string): string {
  const base = path.basename(originalname).replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 200);
  return `${uuidv4()}-${base || "document"}`;
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename: (_req, file, cb) => cb(null, safeStoredFilename(file.originalname)),
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME_TYPES.has(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Only PDF files are allowed"));
    }
  },
});

const uploadSingleDocument: import("express").RequestHandler = (req, res, next) => {
  upload.single("document")(req, res, (err: unknown) => {
    if (err) {
      const message =
        err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE"
          ? "File too large (max 10MB)"
          : err instanceof Error
            ? err.message
            : "Upload failed";
      res.status(400).json({ error: message });
      return;
    }
    next();
  });
};

function toFrontendDocument(d: typeof documentsTable.$inferSelect) {
  return {
    id: d.id,
    userId: d.userId,
    filename: d.filename,
    path: d.path,
    size: d.size,
    uploadedAt: d.createdAt,
    createdAt: d.createdAt,
  };
}

router.post("/upload", requireAuth, uploadSingleDocument, async (req, res) => {
  try {
    const userId = req.userId!;
    const file = req.file;

    if (!file) {
      res.status(400).json({ error: "No file uploaded" });
      return;
    }

    if (!hasExpectedFileSignature(fs.readFileSync(file.path), file.mimetype)) {
      fs.unlinkSync(file.path);
      res.status(400).json({ error: "File content does not match its declared type" });
      return;
    }

    const docId = uuidv4();
    const relativePath = path.relative(process.cwd(), file.path);
    await db.insert(documentsTable).values({
      id: docId,
      userId,
      filename: file.originalname,
      path: relativePath,
      size: file.size,
      mimeType: file.mimetype,
    });

    const [doc] = await db
      .select()
      .from(documentsTable)
      .where(eq(documentsTable.id, docId))
      .limit(1);

    res.status(201).json({ success: true, data: toFrontendDocument(doc!) });
  } catch (err) {
    console.error("[documents] upload error", err);
    res.status(500).json({ error: "Failed to upload document" });
  }
});

router.get("/list", requireAuth, async (req, res) => {
  try {
    const userId = req.userId!;

    const docs = await db
      .select()
      .from(documentsTable)
      .where(eq(documentsTable.userId, userId));

    res.json(docs.map(toFrontendDocument));
  } catch (err) {
    console.error("[documents] list error", err);
    res.status(500).json({ error: "Failed to fetch documents" });
  }
});

router.delete("/:id", requireAuth, async (req, res) => {
  try {
    const userId = req.userId!;
    const docId = String(req.params["id"] ?? "");

    const [doc] = await db
      .select()
      .from(documentsTable)
      .where(and(eq(documentsTable.id, docId), eq(documentsTable.userId, userId)))
      .limit(1);

    if (!doc) {
      res.status(404).json({ error: "Document not found" });
      return;
    }

    if (doc.path) {
      const absPath = doc.path.startsWith("/")
        ? doc.path
        : path.join(process.cwd(), doc.path);
      fs.unlink(absPath, () => {});
    }

    await db.delete(documentsTable).where(eq(documentsTable.id, docId));
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to delete document" });
  }
});

export default router;
