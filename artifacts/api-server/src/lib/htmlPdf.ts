import type { Browser } from "puppeteer-core";
import { logger } from "./logger.js";

/**
 * HTML → PDF rendering for resume/project export (Resume Studio spec §4D:
 * "Backend renders the current version's content into the selected template
 * as a PDF ... Cost: Free").
 *
 * The client sends fully-populated, self-contained template HTML; this module
 * renders it in headless Chrome via puppeteer-core. Chrome is NOT bundled —
 * the executable path comes from PDF_CHROME_PATH (or common install
 * locations), so environments without Chrome degrade to a clear
 * PDF_NOT_CONFIGURED error instead of a crash. Error codes here are a
 * CONTRACT with the client (TopBar.tsx maps PDF_TIMEOUT / BROWSER_CRASH /
 * TEMPLATE_RENDER_ERROR to friendly messages) — do not rename them.
 *
 * SECURITY: the HTML is user-controlled and rendered server-side, which is an
 * SSRF vector (e.g. <img src="http://169.254.169.254/...">). Request
 * interception aborts EVERY outbound request except data: URIs, so the render
 * can never reach the network, localhost services, or cloud metadata.
 */

export class PdfError extends Error {
  code: "PDF_NOT_CONFIGURED" | "PDF_TIMEOUT" | "BROWSER_CRASH" | "TEMPLATE_RENDER_ERROR";
  constructor(code: PdfError["code"], message: string) {
    super(message);
    this.code = code;
  }
}

const CHROME_CANDIDATES = [
  process.env["PDF_CHROME_PATH"],
  "/usr/bin/google-chrome-stable",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium-browser",
  "/usr/bin/chromium",
  "/opt/google/chrome/chrome",
].filter(Boolean) as string[];

const RENDER_TIMEOUT_MS = Number(process.env["PDF_RENDER_TIMEOUT_MS"] ?? 20_000);
const MAX_HTML_BYTES = 2_500_000; // 2.5MB of HTML is far beyond any real resume

let browserPromise: Promise<Browser> | null = null;

async function resolveChromePath(): Promise<string> {
  const fs = await import("node:fs/promises");
  for (const candidate of CHROME_CANDIDATES) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // try next
    }
  }
  throw new PdfError(
    "PDF_NOT_CONFIGURED",
    "PDF export requires configuration (no Chrome executable found — set PDF_CHROME_PATH)",
  );
}

async function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = (async () => {
      const executablePath = await resolveChromePath();
      const { launch } = await import("puppeteer-core");
      const os = await import("node:os");
      const path = await import("node:path");
      const fs = await import("node:fs/promises");

      // Chrome insists on writable HOME/XDG dirs and a crashpad database even
      // in headless mode; service accounts (User=hireshade, HOME under /opt)
      // typically can't provide them, which kills the process at startup
      // ("mkdir .local/share/applications: Permission denied",
      // "chrome_crashpad_handler: --database is required"). Give it a private
      // writable profile under tmp and disable crash reporting outright.
      const profileDir = path.join(os.tmpdir(), "hireshade-chrome-profile");
      await fs.mkdir(profileDir, { recursive: true });

      const browser = await launch({
        executablePath,
        headless: true,
        userDataDir: profileDir,
        env: {
          ...process.env,
          HOME: profileDir,
          XDG_CONFIG_HOME: path.join(profileDir, ".config"),
          XDG_CACHE_HOME: path.join(profileDir, ".cache"),
        },
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-gpu",
          "--disable-dev-shm-usage",
          "--disable-extensions",
          "--no-first-run",
          "--disable-crashpad",
          "--disable-crash-reporter",
          "--disable-breakpad",
        ],
      });
      browser.on("disconnected", () => {
        // Next render relaunches instead of reusing a dead handle.
        browserPromise = null;
      });
      return browser;
    })();
    browserPromise.catch(() => {
      browserPromise = null;
    });
  }
  return browserPromise;
}

export async function renderHtmlToPdf(html: string): Promise<Buffer> {
  if (!html || typeof html !== "string") {
    throw new PdfError("TEMPLATE_RENDER_ERROR", "No HTML provided to render");
  }
  if (Buffer.byteLength(html, "utf8") > MAX_HTML_BYTES) {
    throw new PdfError("TEMPLATE_RENDER_ERROR", "Resume HTML too large to render");
  }

  let browser: Browser;
  try {
    browser = await getBrowser();
  } catch (err) {
    if (err instanceof PdfError) throw err;
    logger.error({ err }, "[pdf] browser launch failed");
    throw new PdfError("BROWSER_CRASH", "PDF renderer failed to start");
  }

  const page = await browser.newPage().catch((err) => {
    logger.error({ err }, "[pdf] newPage failed");
    throw new PdfError("BROWSER_CRASH", "PDF renderer crashed");
  });

  try {
    // SSRF hard-block: abort every request that isn't an inline data: URI.
    await page.setRequestInterception(true);
    page.on("request", (req) => {
      if (req.url().startsWith("data:")) void req.continue();
      else void req.abort();
    });
    await page.setJavaScriptEnabled(false);

    await page.setContent(html, {
      waitUntil: "load",
      timeout: RENDER_TIMEOUT_MS,
    });

    const pdf = await page.pdf({
      format: "a4",
      printBackground: true,
      margin: { top: "0mm", bottom: "0mm", left: "0mm", right: "0mm" },
      timeout: RENDER_TIMEOUT_MS,
    });
    return Buffer.from(pdf);
  } catch (err) {
    if (err instanceof PdfError) throw err;
    const msg = String(err);
    if (/timeout/i.test(msg)) {
      throw new PdfError("PDF_TIMEOUT", "PDF render timed out");
    }
    if (/(disconnected|crashed|Target closed|Protocol error)/i.test(msg)) {
      throw new PdfError("BROWSER_CRASH", "PDF renderer crashed");
    }
    logger.error({ err }, "[pdf] render failed");
    throw new PdfError("TEMPLATE_RENDER_ERROR", "Resume template failed to render");
  } finally {
    await page.close().catch(() => {});
  }
}
