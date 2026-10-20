/** Shared helpers for the S4 capture-sprint harness. */
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import http from "node:http";
import path from "node:path";
import { closeBrowser, connectCdp, waitForCdp, waitForTarget } from "../scroll/cdp.mjs";

export function sleep(ms) {
  return new Promise(function (resolve) {
    setTimeout(resolve, ms);
  });
}
export function writeJson(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(value, null, 2) + "\n");
}
export function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}
export function ensureDir(dir) {
  mkdirSync(dir, { recursive: true });
}

export async function startServer(routes) {
  const server = http.createServer(function (request, response) {
    const pathname = (request.url || "/").split("?")[0];
    const html = routes[pathname];
    if (!html) {
      response.writeHead(404);
      response.end("not found");
      return;
    }
    response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    response.end(html);
  });
  await new Promise(function (resolve, reject) {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = server.address().port;
  return {
    origin: "http://127.0.0.1:" + port,
    close: function () {
      return new Promise(function (resolve) {
        server.close(function () { resolve(); });
      });
    },
  };
}

export function electronExePath(root) {
  const base = path.join(root, "artifacts", "desktop-electron", "node_modules", "electron");
  const exe = path.join(base, "dist", process.platform === "win32" ? "electron.exe" : process.platform === "darwin" ? "Electron.app/Contents/MacOS/Electron" : "electron");
  if (!readFileSync(path.join(base, "package.json"), "utf8").includes("version")) throw new Error("electron package unreadable");
  return exe;
}
export function electronVersion(root) {
  const base = path.join(root, "artifacts", "desktop-electron", "node_modules", "electron", "package.json");
  return JSON.parse(readFileSync(base, "utf8")).version;
}

export function spawnProcess(command, args, options) {
  const child = spawn(command, args, Object.assign({ stdio: ["ignore", "pipe", "pipe"], windowsHide: true }, options));
  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", function (chunk) { stdout += chunk.toString(); });
  child.stderr?.on("data", function (chunk) { stderr += chunk.toString(); });
  const exit = new Promise(function (resolve) {
    child.once("exit", function (code, signal) { resolve({ code: code, signal: signal }); });
  });
  return {
    child: child,
    exit: exit,
    stdout: function () { return stdout; },
    stderr: function () { return stderr; },
    info: function (marker) {
      const lines = stdout.split(/\r?\n/);
      for (let index = lines.length - 1; index >= 0; index--) {
        const at = lines[index].indexOf(marker);
        if (at >= 0) {
          try { return JSON.parse(lines[index].slice(at + marker.length)); } catch (error) { return null; }
        }
      }
      return null;
    },
  };
}

export function launchElectron(root, options) {
  const env = Object.assign({}, process.env, {
    DSH_CDP_PORT: String(options.port),
    DSH_SPRINT_MODE: options.mode,
    DSH_OVERLAY_ORIGIN: options.origin,
    DSH_TARGET_ORIGIN: options.origin,
    DSH_STEALTH: options.stealth ? "1" : "0",
    DSH_CLICK_THROUGH: options.clickThrough ? "1" : "0",
    DSH_USER_DATA_DIR: options.userDataDir,
  });
  if (options.userDataDir) mkdirSync(options.userDataDir, { recursive: true });
  delete env.ELECTRON_RUN_AS_NODE;
  const exe = electronExePath(root);
  const child = spawnProcess(exe, [path.join(root, "scripts", "capture-sprint", "main.cjs")], { cwd: root, env: env });
  return Object.assign(child, { port: options.port, mode: options.mode });
}

export async function closeProcess(instance, cdps) {
  if (cdps) for (const cdp of cdps) if (cdp) cdp.close();
  // Force-killing the harness-owned Electron/Chrome process tree is faster and
  // more reliable than awaiting Browser.close (a closing CDP socket never
  // resolves the response promise). No product process is involved.
  try {
    if (process.platform === "win32") spawnSync("taskkill", ["/PID", String(instance.child.pid), "/T", "/F"], { stdio: "ignore" });
    else instance.child.kill("SIGKILL");
  } catch (error) { /* best effort */ }
  await Promise.race([instance.exit, sleep(3000)]);
}

export async function waitForCdpVersion(port, timeoutMs) {
  const deadline = Date.now() + (timeoutMs || 15000);
  while (Date.now() < deadline) {
    try {
      const version = await fetch("http://127.0.0.1:" + port + "/json/version").then(function (response) { return response.json(); });
      if (version && version.webSocketDebuggerUrl) return version;
    } catch (error) { /* not up yet */ }
    await sleep(150);
  }
  throw new Error("CDP /json/version not available on port " + port);
}

export async function waitForPage(port, urlPart, readyExpression, timeoutMs) {
  const ready = await waitForCdp(port, timeoutMs || 15000);
  if (!ready) throw new Error("Electron/Chrome did not expose CDP on port " + port);
  const target = await waitForTarget(port, function (entry) { return String(entry.url).includes(urlPart); }, { timeoutMs: timeoutMs || 15000 });
  const cdp = await connectCdp(target.webSocketDebuggerUrl);
  await cdp.send("Runtime.enable");
  await cdp.send("Page.enable");
  const deadline = Date.now() + (timeoutMs || 15000);
  while (Date.now() < deadline) {
    try {
      const value = await evaluate(cdp, readyExpression);
      if (value) return { cdp: cdp, target: target };
    } catch (error) { /* page loading */ }
    await sleep(120);
  }
  throw new Error("page did not become ready: " + readyExpression + " (" + urlPart + ")");
}

export async function evaluate(cdp, expression) {
  const result = await cdp.send("Runtime.evaluate", { expression: expression, returnByValue: true, awaitPromise: true, userGesture: true });
  if (result.exceptionDetails) throw new Error("Runtime.evaluate failed: " + JSON.stringify(result.exceptionDetails));
  return result.result ? result.result.value : undefined;
}
export async function captureScreenshot(cdp, filePath) {
  const result = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, Buffer.from(result.data, "base64"));
  return { file: filePath, bytes: statSync(filePath).size };
}

/** Physical-coordinate click through the real OS input stack (Win32 SendInput). */
export function clickPhysical(point) {
  const script =
    "Add-Type -TypeDefinition 'using System; using System.Text; using System.Runtime.InteropServices; public class S4Click { [DllImport(\"user32.dll\")] public static extern bool SetCursorPos(int x, int y); [DllImport(\"user32.dll\")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, UIntPtr e); [DllImport(\"user32.dll\")] public static extern IntPtr GetForegroundWindow(); [DllImport(\"user32.dll\")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n); }'; " +
    "function Title { $sb = New-Object System.Text.StringBuilder 256; [S4Click]::GetWindowText([S4Click]::GetForegroundWindow(),$sb,256) | Out-Null; return $sb.ToString() }; " +
    "Write-Output (\"BEFORE=\" + (Title)); " +
    "[S4Click]::SetCursorPos(" + point.x + "," + point.y + ") | Out-Null; Start-Sleep -Milliseconds 150; " +
    "[S4Click]::mouse_event(0x0002,0,0,0,[UIntPtr]::Zero); Start-Sleep -Milliseconds 80; " +
    "[S4Click]::mouse_event(0x0004,0,0,0,[UIntPtr]::Zero); Start-Sleep -Milliseconds 350; " +
    "Write-Output (\"AFTER=\" + (Title))";
  const run = spawnSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script], { encoding: "utf8", timeout: 20000 });
  const output = String(run.stdout || "");
  function titleOf(marker) {
    const match = output.match(new RegExp(marker + "=(.*)"));
    return match ? match[1].trim() : null;
  }
  return { ok: run.status === 0, status: run.status, stderr: run.stderr, foregroundBefore: titleOf("BEFORE"), foregroundAfter: titleOf("AFTER") };
}

export function isMagenta(rgb) {
  return rgb && rgb[0] > 170 && rgb[2] > 170 && rgb[1] < 130;
}
export function isBlue(rgb) {
  return rgb && rgb[2] > 120 && rgb[1] < 150 && rgb[0] < 140;
}
export function isGreenish(rgb) {
  return rgb && rgb[1] > 60 && rgb[1] > rgb[0] + 20;
}
export function rgbClose(a, b, tolerance) {
  const limit = tolerance === undefined ? 40 : tolerance;
  return a && b && Math.abs(a[0] - b[0]) <= limit && Math.abs(a[1] - b[1]) <= limit && Math.abs(a[2] - b[2]) <= limit;
}
export { closeBrowser, connectCdp, waitForCdp, waitForTarget, rmSync, writeFileSync, readFileSync };
