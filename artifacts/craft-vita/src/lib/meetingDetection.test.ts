import { describe, expect, it } from "vitest";
import {
  BROWSERS,
  MEETING_APPS,
  MEETING_PLATFORM_SLUGS,
  MEETING_WEB_VARIANTS,
  buildMeetingPrompt,
  detectBrowser,
  detectMeeting,
  getMeetingAppSlug,
  getMeetingPlatform,
  isAllowedMeetingApp,
  isBrowserMeetingApp,
} from "./meetingDetection";
import {
  MEETING_DETECTION_FIXTURES,
  REQUIRED_MEETING_SLUGS,
} from "@/features/meetingDetection/fixtures";

describe("meeting detector platform table (T-13)", () => {
  it("is data-driven with 8 apps, 3 web variants and 7 browsers", () => {
    expect(MEETING_APPS).toHaveLength(8);
    expect(MEETING_WEB_VARIANTS).toHaveLength(3);
    expect(BROWSERS).toHaveLength(7);
    expect(MEETING_PLATFORM_SLUGS).toEqual([...new Set(MEETING_PLATFORM_SLUGS)]);
    expect(MEETING_PLATFORM_SLUGS).toHaveLength(18);
  });

  it("contains every required target slug", () => {
    for (const slug of REQUIRED_MEETING_SLUGS) {
      expect(getMeetingPlatform(slug), slug).toBeDefined();
      expect(MEETING_PLATFORM_SLUGS).toContain(slug);
    }
  });

  it("classifies app vs web variants", () => {
    expect(isAllowedMeetingApp("zoom")).toBe(true);
    expect(isBrowserMeetingApp("zoom")).toBe(false);
    expect(isBrowserMeetingApp("google_meet")).toBe(true);
    expect(isAllowedMeetingApp("google_meet")).toBe(false);
    expect(isAllowedMeetingApp("chrome")).toBe(false);
  });

  it("gives every platform at least one detectable signal definition", () => {
    for (const platform of [...MEETING_APPS, ...MEETING_WEB_VARIANTS, ...BROWSERS]) {
      const hasSignals =
        (platform.appIds?.length ?? 0) > 0 ||
        (platform.processNames?.length ?? 0) > 0 ||
        (platform.namePatterns?.length ?? 0) > 0 ||
        (platform.titlePatterns?.length ?? 0) > 0 ||
        (platform.urlPatterns?.length ?? 0) > 0;
      expect(hasSignals, platform.slug).toBe(true);
    }
  });
});

describe("detectMeeting fixtures (3-signal model)", () => {
  it.each(MEETING_DETECTION_FIXTURES.map((fixture) => [fixture.name, fixture] as const))(
    "%s",
    (_name, fixture) => {
      const detection = detectMeeting(fixture.signal);
      if (fixture.expected === null) {
        expect(detection).toBeNull();
        return;
      }
      expect(detection, JSON.stringify(fixture.signal)).not.toBeNull();
      expect(detection!.slug).toBe(fixture.expected);
      if (fixture.expectedSignals) {
        expect([...detection!.matchedSignals].sort()).toEqual(
          [...fixture.expectedSignals].sort(),
        );
      }
      if (fixture.minConfidence !== undefined) {
        expect(detection!.confidence).toBeGreaterThanOrEqual(fixture.minConfidence);
      }
      expect(detection!.confidence).toBeGreaterThan(0);
      expect(detection!.confidence).toBeLessThanOrEqual(0.99);
    },
  );

  it("covers every required platform with a fixture or a browser entry", () => {
    const detected = new Set(
      MEETING_DETECTION_FIXTURES.filter((f) => f.expected !== null).map((f) => f.expected),
    );
    const browserSlugs = new Set(BROWSERS.map((browser) => browser.slug));
    for (const slug of REQUIRED_MEETING_SLUGS) {
      // Browsers are detected as *browser* signals (they are not meetings), so
      // they are covered by the browser table rather than a meeting fixture.
      expect(detected.has(slug) || browserSlugs.has(slug), slug).toBe(true);
    }
  });
});

describe("confidence ordering", () => {
  it("bundle id beats process name beats title-only", () => {
    const bundle = detectMeeting({ macBundleId: "us.zoom.xos" })!;
    const process = detectMeeting({ windowsProcessName: "Zoom.exe" })!;
    const title = detectMeeting({ windowTitle: "Zoom Meeting" })!;
    expect(bundle.confidence).toBeGreaterThan(process.confidence);
    expect(process.confidence).toBeGreaterThan(title.confidence);
  });

  it("boosts confidence when several signals agree", () => {
    const one = detectMeeting({ windowsProcessName: "Zoom.exe" })!;
    const two = detectMeeting({
      windowsProcessName: "Zoom.exe",
      windowTitle: "Zoom Meeting",
    })!;
    expect(two.confidence).toBeGreaterThan(one.confidence);
    expect(two.matchedSignals).toEqual(["processName", "windowTitle"]);
  });
});

describe("browser/app disambiguation", () => {
  it("identifies the browser from a process, bundle or title", () => {
    expect(detectBrowser({ windowsProcessName: "chrome.exe" })?.slug).toBe("chrome");
    expect(detectBrowser({ macBundleId: "com.apple.Safari" })?.slug).toBe("safari");
    expect(detectBrowser({ windowTitle: "Docs - Brave" })?.slug).toBe("brave");
    expect(detectBrowser({ macBundleId: "company.thebrowser.Browser" })?.slug).toBe("arc");
    expect(detectBrowser({ windowsProcessName: "msedge.exe" })?.slug).toBe("edge");
    expect(detectBrowser({ windowsProcessName: "firefox.exe" })?.slug).toBe("firefox");
    expect(detectBrowser({ windowsProcessName: "opera.exe" })?.slug).toBe("opera");
    expect(detectBrowser({ windowTitle: "Untitled" })).toBeUndefined();
  });

  it("reports a Zoom tab as zoom_web, not the desktop app", () => {
    const detection = detectMeeting({
      windowsProcessName: "chrome.exe",
      windowTitle: "Zoom Meeting - Google Chrome",
    })!;
    expect(detection.slug).toBe("zoom_web");
    expect(detection.isBrowserMeeting).toBe(true);
    expect(detection.browserSlug).toBe("chrome");
    expect(detection.kind).toBe("web");
  });

  it("still reports the desktop Zoom app when its process is the foreground", () => {
    const detection = detectMeeting({
      windowsProcessName: "Zoom.exe",
      windowTitle: "Zoom Meeting",
    })!;
    expect(detection.slug).toBe("zoom");
    expect(detection.kind).toBe("app");
    expect(detection.browserSlug).toBeUndefined();
  });

  it("does not treat a browser with a non-meeting title as a meeting", () => {
    expect(detectBrowser({ windowsProcessName: "arc.exe" })?.slug).toBe("arc");
    expect(
      detectMeeting({ windowsProcessName: "arc.exe", windowTitle: "Hacker News - Arc" }),
    ).toBeNull();
  });
});

describe("convenience helpers", () => {
  it("getMeetingAppSlug returns just the slug", () => {
    expect(getMeetingAppSlug({ windowsProcessName: "slack.exe" })).toBe("slack");
    expect(getMeetingAppSlug({ windowTitle: "Notepad" })).toBeNull();
  });

  it("builds prompt copy for the detected platform", () => {
    const detection = detectMeeting({ macBundleId: "us.zoom.xos" })!;
    expect(buildMeetingPrompt(detection)).toBe(
      "Zoom meeting detected — start HireShade for this call?",
    );
  });

  it("matches case-insensitively", () => {
    expect(detectMeeting({ macBundleId: "US.ZOOM.XOS" })?.slug).toBe("zoom");
    expect(detectMeeting({ windowsProcessName: "ZOOM.EXE" })?.slug).toBe("zoom");
  });
});
