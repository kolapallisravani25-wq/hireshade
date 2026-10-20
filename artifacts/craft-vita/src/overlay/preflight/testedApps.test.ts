import { describe, expect, it } from 'vitest';
import {
  TESTED_APPS,
  TESTED_APPS_LIST_VERSION,
  TESTED_APPS_META,
  TESTED_APPS_SCHEMA_VERSION,
  TESTED_APPS_TESTED_ON,
} from './testedApps.data';
import { highRiskApps } from './appDetection';

describe('curated tested-app data list', () => {
  it('is versioned and stamped', () => {
    expect(TESTED_APPS_SCHEMA_VERSION).toBe(1);
    expect(TESTED_APPS_META.schemaVersion).toBe(TESTED_APPS_SCHEMA_VERSION);
    expect(TESTED_APPS_META.listVersion).toBe(TESTED_APPS_LIST_VERSION);
    expect(TESTED_APPS_LIST_VERSION).toMatch(/^\d{4}\.\d{2}\.\d{2}\.\d+$/);
    expect(TESTED_APPS_LIST_VERSION.startsWith(TESTED_APPS_TESTED_ON.replace(/-/g, '.'))).toBe(true);
    expect(TESTED_APPS_META.testedOn).toBe(TESTED_APPS_TESTED_ON);
    expect(TESTED_APPS_TESTED_ON).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const tested = new Date(TESTED_APPS_TESTED_ON + 'T00:00:00Z');
    expect(Number.isNaN(tested.getTime())).toBe(false);
    expect(tested.getTime()).toBeLessThanOrEqual(Date.now() + 24 * 60 * 60 * 1000);
    expect(TESTED_APPS_META.source).toContain('CAPTURE_MATRIX');
  });

  it('has at least 10 apps with unique ids', () => {
    expect(TESTED_APPS.length).toBeGreaterThanOrEqual(10);
    const ids = TESTED_APPS.map((app) => app.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('covers the meeting apps the product markets', () => {
    const ids = TESTED_APPS.map((app) => app.id);
    for (const required of [
      'zoom',
      'microsoft-teams',
      'google-meet',
      'webex',
      'discord',
      'obs',
    ]) {
      expect(ids).toContain(required);
    }
  });

  it('has valid patterns, processes, risk and evidence fields', () => {
    const risks = ['low', 'medium', 'high', 'unknown'];
    const statuses = ['OBSERVED', 'INFERRED', 'UNTESTED'];
    for (const app of TESTED_APPS) {
      expect(app.label.trim().length, app.id).toBeGreaterThan(0);
      expect(app.platforms.length, app.id).toBeGreaterThan(0);
      expect(app.processNames.length, app.id).toBeGreaterThan(0);
      expect(app.windowTitlePatterns.length, app.id).toBeGreaterThan(0);
      expect(risks, app.id).toContain(app.captureRisk);
      expect(statuses, app.id).toContain(app.evidenceStatus);
      expect(app.riskReason.trim().length, app.id).toBeGreaterThan(10);
      expect(app.lastTestedOn === null || /^\d{4}-\d{2}-\d{2}$/.test(app.lastTestedOn), app.id).toBe(true);
      for (const pattern of app.windowTitlePatterns) {
        expect(() => new RegExp(pattern, 'i'), app.id + ':' + pattern).not.toThrow();
      }
      for (const process of app.processNames) {
        expect(process, app.id).toMatch(/^[a-z0-9 ._-]+$/i);
      }
    }
  });

  it('classifies the DXGI-family apps as high risk and labels evidence honestly', () => {
    expect(highRiskApps().map((app) => app.id)).toEqual(
      expect.arrayContaining(['zoom', 'microsoft-teams', 'discord', 'obs']),
    );
    const obs = TESTED_APPS.find((app) => app.id === 'obs');
    expect(obs?.evidenceStatus).toBe('OBSERVED');
    expect(obs?.lastTestedOn).toBe(TESTED_APPS_TESTED_ON);
    expect(obs?.riskReason.toLowerCase()).toContain('dxgi');
    // Untested apps must say so, not borrow observed evidence.
    for (const app of TESTED_APPS) {
      if (app.evidenceStatus === 'UNTESTED') expect(app.lastTestedOn).toBeNull();
    }
  });
});
