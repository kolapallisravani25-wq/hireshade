import express, { type Express } from "express";
import cors from "cors";
import path from "path";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { verifyUploadsSignature } from "./lib/resumeStorage";
import { buildCorsOptions } from "./lib/corsPolicy.js";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
// Production fails closed until the browser and desktop origins are explicit.
// Development remains permissive for local Vite/Tauri ports.
app.use(cors(buildCorsOptions(process.env["CORS_ORIGINS"], process.env["NODE_ENV"])));
// The Razorpay webhook signature is an HMAC over the RAW request bytes —
// express.json() would consume and re-serialize the body, breaking byte-exact
// verification. Mounting express.raw() for this one path first makes the
// downstream json parser skip it (body already parsed).
app.use("/api/credits/webhook/razorpay", express.raw({ type: () => true }));
// 1mb (default 100kb): /ai-answer and /save-message carry full live-session
// transcripts — a long interview comfortably exceeds 100kb, which turned
// into opaque 413s exactly at the point users need answers most (deep into a
// long session).
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));

// /uploads serves user PII (resumes, documents) off local disk. It MUST NOT
// be publicly readable: every request needs a valid, unexpired HMAC signature
// issued by getResumeSignedUrl (the authed /api/resume/:id/signed-url route).
// Direct/expired/stale links get 403 and the client re-requests a fresh URL.
app.use(
  "/uploads",
  (req, res, next) => {
    const relUploadPath = decodeURIComponent(req.path.replace(/^\/+/, ""));
    if (
      verifyUploadsSignature(relUploadPath, req.query["exp"], req.query["sig"])
    ) {
      next();
      return;
    }
    res.status(403).json({ error: "Invalid or expired link" });
  },
  express.static(path.join(process.cwd(), "uploads")),
);

app.use("/api", router);

export default app;
