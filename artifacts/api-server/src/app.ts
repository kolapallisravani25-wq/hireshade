import express, { type Express } from "express";
import cors from "cors";
import path from "path";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { verifyUploadsSignature } from "./lib/resumeStorage";

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
app.use(cors());
// The Razorpay webhook signature is an HMAC over the RAW request bytes —
// express.json() would consume and re-serialize the body, breaking byte-exact
// verification. Mounting express.raw() for this one path first makes the
// downstream json parser skip it (body already parsed).
app.use("/api/credits/webhook/razorpay", express.raw({ type: () => true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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
