import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const routeSource = (name: string) =>
  fs.readFileSync(path.resolve(import.meta.dirname, `../src/routes/${name}.ts`), "utf8");

describe("expensive AI route boundaries", () => {
  it("does not invoke resume models before the charge/refund wrapper", () => {
    const resumes = routeSource("resumes");
    expect(resumes).not.toMatch(/const result = await scoreResumeText[\s\S]{0,500}chargeOr402/);
    expect(resumes).not.toMatch(/const result = await chatCompleteJSON[\s\S]{0,500}chargeOr402/);
  });

  it("does not invoke the legacy project model before metering", () => {
    const ai = routeSource("ai");
    expect(ai).not.toMatch(/const ideas = await chatCompleteJSON[\s\S]{0,500}chargeOr402/);
  });

  it("meters project regeneration before invoking the model", () => {
    const projects = routeSource("projects");
    const route = projects.slice(
      projects.indexOf('router.put("/:id/projects"'),
      projects.indexOf('router.get("/:id/versions"'),
    );
    expect(route.indexOf("withCharge")).toBeGreaterThanOrEqual(0);
    expect(route.indexOf("withCharge")).toBeLessThan(route.indexOf("chatCompleteJSONWithBudgets"));
  });
});
