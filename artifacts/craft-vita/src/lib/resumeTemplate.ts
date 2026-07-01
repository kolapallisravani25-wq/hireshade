/**
 * Shared resume template utilities — used by both the resume editor preview
 * panel and the Build Resume card-grid preview dialog.
 *
 * Extracted from src/pages/Resume/ResumeEditor/page.tsx to avoid duplication.
 */

import type { ResumeFields, SectionDef } from "@/store/resumeBuilderSlice";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ResumeData {
  name: string;
  role: string;
  email: string;
  phone: string;
  links: string;
  summary: string;
  languages: string;
  frameworks: string;
  database: string;
  tools: string;
  experiences: Array<{ company: string; title: string; dates: string; points: string[] }>;
  projects: Array<{ title: string; points: string[] }>;
  education: Array<{ degree: string; institute: string; year: string }>;
  certifications: string;
  publication: string;
  // Raw versions for text-based [data-field] injection
  experienceRaw: string;
  projectsRaw: string;
  educationRaw: string;
}

export interface PopulateTemplateOptions {
  sections?: SectionDef[];
  customSections?: Record<string, string>;
  [sectionId: string]: boolean | SectionDef[] | Record<string, string> | undefined;
}

// ─── Text parsers ─────────────────────────────────────────────────────────────

export function parseProjectsText(text: string): Array<{ title: string; points: string[] }> {
  if (!text.trim()) return [];
  return text.split(/\n\n+/).map((block) => {
    const lines = block.split("\n").filter((l) => l.trim());
    return { title: lines[0] ?? "Project", points: lines.slice(1).map((l) => l.replace(/^[•\-*]\s*/, "")) };
  });
}

export function parseEducationText(text: string): Array<{ degree: string; institute: string; year: string }> {
  if (!text.trim()) return [];
  return text.split(/\n\n+/).map((block) => {
    const lines = block.split("\n").filter((l) => l.trim());
    return { degree: lines[0] ?? "", institute: lines[1] ?? "", year: lines[2] ?? "" };
  });
}

export function parseExperienceForTemplate(
  raw: string,
): Array<{ company: string; title: string; dates: string; points: string[] }> {
  const blocks = raw.split(/\n\n+/).map((b) => b.trim()).filter(Boolean);
  return blocks.map((block) => {
    const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
    const header = lines[0] ?? "";
    const parts  = header.split("|").map((p) => p.trim());
    const points = lines.slice(1).map((l) => l.replace(/^[•\-*]\s*/, "")).filter(Boolean);
    return { company: parts[0] ?? "", title: parts[1] ?? "", dates: parts[2] ?? "", points };
  });
}

// ─── fieldsToResumeData ───────────────────────────────────────────────────────

export function fieldsToResumeData(fields: ResumeFields): ResumeData {
  return {
    name: fields.name || "Your Name",
    role: fields.role || "Professional Role",
    email: fields.email || "email@example.com",
    phone: fields.phone || "",
    links: fields.links || "",
    summary: fields.summary || "",
    languages: fields.skillsLanguages || "",
    frameworks: fields.skillsFrameworks || "",
    database: fields.skillsDatabases || "",
    tools: fields.skillsTools || "",
    experiences: parseExperienceForTemplate(fields.experience),
    projects: parseProjectsText(fields.projects),
    education: parseEducationText(fields.education),
    certifications: fields.certifications || "",
    publication: fields.publications || "",
    experienceRaw: fields.experience || "",
    projectsRaw: fields.projects || "",
    educationRaw: fields.education || "",
  };
}

function hasTemplateSectionContent(sectionId: string, data: ResumeData, customSections?: Record<string, string>): boolean {
  switch (sectionId) {
    case "summary":
      return !!data.summary.trim();
    case "experience":
      return !!data.experienceRaw.trim() || data.experiences.length > 0;
    case "skills":
      return !!(data.languages.trim() || data.frameworks.trim() || data.database.trim() || data.tools.trim());
    case "projects":
      return !!data.projectsRaw.trim() || data.projects.length > 0;
    case "education":
      return !!data.educationRaw.trim() || data.education.length > 0;
    case "certifications":
      return !!data.certifications.trim();
    case "publications":
      return !!data.publication.trim();
    case "personalInfo":
      return true;
    default:
      return !!customSections?.[sectionId]?.trim();
  }
}

const TEMPLATE_SECTION_IDS = [
  "personalInfo",
  "summary",
  "experience",
  "skills",
  "projects",
  "education",
  "certifications",
  "publications",
];

const REQUIRED_TEMPLATE_SECTIONS = new Set(["personalInfo", "summary", "experience", "skills", "education"]);

function normalizeTemplateSections(sections?: SectionDef[]): Array<Pick<SectionDef, "id" | "enabled">> {
  if (!sections?.length) {
    return TEMPLATE_SECTION_IDS.map((id) => ({
      id,
      enabled: id === "projects" ? false : !["certifications", "publications"].includes(id),
    }));
  }

  const seen = new Set<string>();
  const normalized = sections.map((section) => {
    seen.add(section.id);
    return { id: section.id, enabled: section.enabled };
  });

  TEMPLATE_SECTION_IDS.forEach((id) => {
    if (seen.has(id)) return;
    normalized.push({ id, enabled: REQUIRED_TEMPLATE_SECTIONS.has(id) });
  });

  return normalized;
}

const SECTION_HEADING_TEXT: Record<string, string[]> = {
  personalInfo: ["personal info", "personal information", "contact"],
  summary: ["summary", "profile", "professional summary", "career profile"],
  experience: ["experience", "work experience", "professional experience", "employment", "employment history"],
  skills: ["skills", "technical skills", "core skills", "key skills"],
  projects: ["projects", "project", "selected projects"],
  education: ["education", "academic background", "academics"],
  certifications: ["certifications", "certification", "certificates"],
  publications: ["publications", "publication"],
};

function normalizeSectionText(value: string): string {
  const normalized = value
    .replace(/\s+/g, " ")
    .replace(/[:|]+$/g, "")
    .trim()
    .toLowerCase();
  const compact = normalized.replace(/\s+/g, "");
  return compact.length > 1 && /^[a-z]+$/.test(compact) ? compact : normalized;
}

function headingSectionId(el: Element): string | null {
  const text = normalizeSectionText(el.textContent ?? "");
  if (!text || text.length > 60) return null;
  for (const [sectionId, labels] of Object.entries(SECTION_HEADING_TEXT)) {
    if (labels.map(normalizeSectionText).includes(text)) return sectionId;
  }
  return null;
}

function findSectionHeading(doc: Document, sectionId: string): HTMLElement | null {
  const labels = (SECTION_HEADING_TEXT[sectionId] ?? [sectionId]).map(normalizeSectionText);
  const candidates = doc.querySelectorAll("h1,h2,h3,h4,h5,h6,.section-title,.resume-section-title,.title,div,p");
  for (const candidate of candidates) {
    const text = normalizeSectionText(candidate.textContent ?? "");
    if (labels.includes(text) && candidate instanceof HTMLElement) return candidate;
  }
  return null;
}

function findSectionHost(doc: Document, sectionId: string): HTMLElement | null {
  const selectors: Record<string, string[]> = {
    personalInfo: ['[data-field="name"]', '[data-field="role"]', '[data-field="email"]'],
    summary: ['[data-field="summary"]'],
    experience: ['[data-field="experience"]', '[data-list="experience"]'],
    skills: ['[data-field="languages"]', '[data-field="frameworks"]', '[data-field="database"]', '[data-field="tools"]'],
    projects: ['[data-list="projects"]', '[data-field="projects"]'],
    education: ['[data-list="education"]', '[data-field="education"]'],
    certifications: ['[data-field="certifications"]'],
    publications: ['[data-field="publications"]', '[data-field="publication"]'],
  };

  const heading = findSectionHeading(doc, sectionId);
  if (heading) {
    const host = heading.closest("section") ?? heading.closest("article") ?? heading.closest(".resume-section");
    return host instanceof HTMLElement ? host : heading;
  }

  for (const selector of selectors[sectionId] ?? [`[data-field="${sectionId}"]`]) {
    const marker = doc.querySelector(selector);
    const host = marker?.closest("section") ?? marker?.closest("article") ?? marker?.closest(".resume-section");
    if (host instanceof HTMLElement) return host;
    if (marker instanceof HTMLElement) return marker;
  }
  return null;
}

function extractMovableChunk(host: HTMLElement): Node[] {
  const chunk: Node[] = [];
  const prev = host.previousElementSibling;
  if (prev instanceof HTMLElement) {
    const tag = prev.tagName.toLowerCase();
    const looksLikeDivider = tag === "hr" || prev.classList.contains("divider");
    if (looksLikeDivider) chunk.push(prev);
  }
  chunk.push(host);
  const tag = host.tagName.toLowerCase();
  const hostIsLooseHeading = /^h[1-6]$/.test(tag) || headingSectionId(host) !== null;
  if (hostIsLooseHeading && !["section", "article"].includes(tag) && !host.classList.contains("resume-section")) {
    let next = host.nextSibling;
    while (next) {
      const current = next;
      next = next.nextSibling;
      if (current instanceof HTMLElement) {
        const currentTag = current.tagName.toLowerCase();
        const startsNextSection = currentTag === "hr" || headingSectionId(current) !== null;
        if (startsNextSection) break;
      }
      chunk.push(current);
    }
  }
  return chunk;
}

function removeTemplateSection(doc: Document, sectionId: string) {
  const host = findSectionHost(doc, sectionId);
  if (!host) return;
  extractMovableChunk(host).forEach((node) => node.parentNode?.removeChild(node));
}

function shouldRenderSection(
  sectionId: string,
  sections: Array<Pick<SectionDef, "id" | "enabled">>,
  data: ResumeData,
  customSections?: Record<string, string>,
): boolean {
  if (sectionId === "personalInfo") return true;
  const section = sections.find((s) => s.id === sectionId);
  const enabled = section ? section.enabled : REQUIRED_TEMPLATE_SECTIONS.has(sectionId);
  if (!enabled) return false;
  return hasTemplateSectionContent(sectionId, data, customSections);
}

function pruneByVisualHeadings(
  doc: Document,
  sections: Array<Pick<SectionDef, "id" | "enabled">>,
  data: ResumeData,
  customSections?: Record<string, string>,
) {
  const headingCandidates = doc.querySelectorAll("h1,h2,h3,h4,h5,h6,.section-title,.resume-section-title");
  const handled = new Set<string>();
  headingCandidates.forEach((el) => {
    const sectionId = headingSectionId(el);
    if (!sectionId || sectionId === "personalInfo") return;
    if (handled.has(sectionId)) return;
    handled.add(sectionId);
    if (!shouldRenderSection(sectionId, sections, data, customSections)) {
      removeTemplateSection(doc, sectionId);
    }
  });
}

function reorderTemplateSections(doc: Document, sections: Array<Pick<SectionDef, "id" | "enabled">>, data: ResumeData, customSections?: Record<string, string>) {
  if (!sections?.length) return;

  const orderedHosts = sections
    .filter((section) => shouldRenderSection(section.id, sections, data, customSections))
    .map((section) => findSectionHost(doc, section.id))
    .filter((host): host is HTMLElement => !!host);

  const seen = new Set<HTMLElement>();
  const uniqueHosts = orderedHosts.filter((host) => {
    if (seen.has(host)) return false;
    seen.add(host);
    return true;
  });

  const parentGroups = new Map<ParentNode, HTMLElement[]>();
  uniqueHosts.forEach((host) => {
    if (!host.parentNode) return;
    const current = parentGroups.get(host.parentNode) ?? [];
    current.push(host);
    parentGroups.set(host.parentNode, current);
  });

  parentGroups.forEach((hosts, parent) => {
    if (hosts.length < 2) return;
    const chunks = hosts.map((host) => extractMovableChunk(host));
    const lastChunk = chunks[chunks.length - 1];
    const anchor = lastChunk[lastChunk.length - 1].nextSibling;
    chunks.flat().forEach((node) => node.parentNode?.removeChild(node));
    chunks.flat().forEach((node) => parent.insertBefore(node, anchor));
  });
}

// ─── Link parsing helpers ─────────────────────────────────────────────────────

function inferPlatformLabel(url: string): string {
  const lower = url.toLowerCase();
  if (lower.includes("linkedin.com"))      return "LinkedIn";
  if (lower.includes("github.com"))        return "GitHub";
  if (lower.includes("leetcode.com"))      return "LeetCode";
  if (lower.includes("hackerrank.com"))    return "HackerRank";
  if (lower.includes("behance.net"))       return "Behance";
  if (lower.includes("dribbble.com"))      return "Dribbble";
  if (lower.includes("medium.com"))        return "Medium";
  if (lower.includes("codepen.io"))        return "CodePen";
  if (lower.includes("stackoverflow.com")) return "Stack Overflow";
  if (lower.includes("twitter.com") || lower.includes("x.com")) return "Twitter/X";
  if (lower.includes("dev.to"))            return "Dev.to";
  return "Portfolio";
}

function parseLinksString(raw: string): { label: string; url: string }[] {
  if (!raw.trim()) return [];
  return raw
    .split("|")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((entry) => {
      const colonIdx = entry.indexOf(":");
      if (colonIdx > 0 && colonIdx < 25) {
        const label = entry.slice(0, colonIdx).trim();
        const rest  = entry.slice(colonIdx + 1).trim();
        if (!label.includes("/") && rest) {
          const url = rest.startsWith("http") ? rest : `https://${rest}`;
          return { label, url };
        }
      }
      const url = entry.startsWith("http") ? entry : `https://${entry}`;
      return { label: inferPlatformLabel(url), url };
    });
}

const SECTION_TITLES: Record<string, string> = {
  personalInfo: "Personal Info",
  summary: "Summary",
  experience: "Work Experience",
  skills: "Technical Skills",
  projects: "Projects",
  education: "Education",
  certifications: "Certifications",
  publications: "Publications",
};

function cleanSectionPrefixedHeading(value: string, sectionId: string): string {
  const lines = value.split("\n");
  if (lines.length < 2) return value.trim();
  const first = normalizeSectionText(lines[0] ?? "");
  const labels = (SECTION_HEADING_TEXT[sectionId] ?? []).map(normalizeSectionText);
  if (labels.includes(first)) return lines.slice(1).join("\n").trim();
  return value.trim();
}

function buildFallbackSection(doc: Document, sectionId: string, data: ResumeData): HTMLElement | null {
  const section = doc.createElement("section");
  section.className = "resume-section generated-resume-section";

  const heading = doc.createElement("h2");
  heading.textContent = SECTION_TITLES[sectionId] ?? sectionId;
  section.appendChild(heading);

  const content = doc.createElement("div");
  content.style.whiteSpace = "pre-wrap";
  content.style.lineHeight = "1.5";
  content.style.fontSize = "12px";

  switch (sectionId) {
    case "certifications":
      content.textContent = cleanSectionPrefixedHeading(data.certifications, "certifications");
      break;
    case "publications":
      content.textContent = cleanSectionPrefixedHeading(data.publication, "publications");
      break;
    case "projects":
      content.textContent = cleanSectionPrefixedHeading(data.projectsRaw, "projects");
      break;
    case "experience":
      content.textContent = cleanSectionPrefixedHeading(data.experienceRaw, "experience");
      break;
    case "education":
      content.textContent = cleanSectionPrefixedHeading(data.educationRaw, "education");
      break;
    default:
      return null;
  }

  if (!content.textContent?.trim()) return null;
  section.appendChild(content);
  return section;
}

function appendMissingEnabledSections(
  doc: Document,
  sections: Array<Pick<SectionDef, "id" | "enabled">>,
  data: ResumeData,
  customSections?: Record<string, string>,
) {
  const body = doc.body;
  if (!body) return;
  sections.forEach((section) => {
    if (!shouldRenderSection(section.id, sections, data, customSections)) return;
    if (findSectionHost(doc, section.id)) return;
    const fallback = buildFallbackSection(doc, section.id, data);
    if (!fallback) return;
    body.appendChild(doc.createElement("hr"));
    body.appendChild(fallback);
  });
}

// ─── populateTemplate ─────────────────────────────────────────────────────────

/**
 * Stamp a resume HTML template string with field values from `data`.
 * Returns the fully populated outerHTML string.
 */
export function populateTemplate(
  html: string,
  data: ResumeData,
  options: PopulateTemplateOptions = {},
): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const optMap: Record<string, string> = {
    name:        "personalInfo",
    role:        "personalInfo",
    email:       "personalInfo",
    phone:       "personalInfo",
    links:       "personalInfo",
    summary:     "summary",
    languages:   "skills",
    frameworks:  "skills",
    database:    "skills",
    tools:       "skills",
    certifications: "certifications",
    publication: "publications",
  };

  const MULTI_BLOCK_MAPPING: Record<string, keyof ResumeData> = {
    experience: "experienceRaw",
    projects: "projectsRaw",
    education: "educationRaw",
    certifications: "certifications",
    publications: "publication",
  };

  doc.querySelectorAll("[data-field]").forEach((el) => {
    const f = el.getAttribute("data-field");
    if (!f) return;
    // Multi-block fields are handled by the smart block-pass below
    if (f in MULTI_BLOCK_MAPPING) return;
    const v = data[f as keyof ResumeData];
    if (typeof v === "string") {
      if (f === "links") {
        const parsed = parseLinksString(v);
        if (parsed.length === 0) {
          el.textContent = "";
        } else {
          const isBlock = el.classList.contains("links-block") || el.closest(".sidebar") !== null;
          el.innerHTML = parsed.map(({ label, url }, i) => {
            const a = `<a href="${url}" style="color:inherit;text-decoration:none;">${label}</a>`;
            if (isBlock) return `<span style="display:block;margin-bottom:2px;">${a}</span>`;
            return (i > 0 ? " · " : "") + a;
          }).join("");
        }
        if (!v.trim()) (el as HTMLElement).style.display = "none";
        if (optMap[f] && options[optMap[f]] === false) (el as HTMLElement).style.display = "none";
        return;
      }
      el.textContent = v;
      if (!v.trim()) (el as HTMLElement).style.display = "none";
      if (optMap[f] && options[optMap[f]] === false) (el as HTMLElement).style.display = "none";
    }
  });

  doc.querySelectorAll("[data-list]").forEach((container) => {
    const listName = container.getAttribute("data-list");
    const listData = data[listName as keyof ResumeData];
    const listOptMap: Record<string, string> = { projects: "projects", education: "education" };
    if (listOptMap[listName ?? ""] && options[listOptMap[listName ?? ""]] === false) {
      (container as HTMLElement).style.display = "none";
      return;
    }
    if (!Array.isArray(listData) || !container.firstElementChild) return;
    const tpl = container.firstElementChild.cloneNode(true) as HTMLElement;
    container.innerHTML = "";
    (listData as Record<string, unknown>[]).forEach((item) => {
      const clone = tpl.cloneNode(true) as HTMLElement;
      Object.entries(item).forEach(([key, val]) => {
        clone.querySelectorAll(`[data-field="${key}"]`).forEach((el) => {
          el.textContent = val as string;
        });
        if (key === "points" && Array.isArray(val)) {
          const pts = clone.querySelector('[data-list="points"]');
          if (pts?.firstElementChild) {
            const ptTpl = pts.firstElementChild.cloneNode(true) as HTMLElement;
            pts.innerHTML = "";
            (val as string[]).forEach((pt) => {
              const c = ptTpl.cloneNode(true) as HTMLElement;
              (c.querySelector('[data-field="point"]') || c).textContent = pt;
              pts.appendChild(c);
            });
          }
        }
      });
      container.appendChild(clone);
    });
  });

  // ── Render multi-block text fields (Smart System)
  // Maps data-field names to ResumeData raw strings and wraps them neutrally
  // for page-break protection while preserving original template CSS 100%.

  Object.entries(MULTI_BLOCK_MAPPING).forEach(([field, dataKey]) => {
    doc.querySelectorAll(`[data-field="${field}"]`).forEach((el) => {
      const rawValue = data[dataKey];
      const v = typeof rawValue === "string" ? cleanSectionPrefixedHeading(rawValue, field) : rawValue;
      if (typeof v !== "string" || !v.trim()) return;

      // Split on blank lines to get individual entry blocks
      const blocks = v.split(/\n\n+/).map((b) => b.trim()).filter(Boolean);
      if (blocks.length <= 1) {
        // Single block — render as plain text with pre-wrap for 100% accuracy
        (el as HTMLElement).style.whiteSpace = "pre-wrap";
        el.textContent = blocks[0] || "";
        return;
      }

      // Multiple blocks — wrap each in a neutral block for break-inside targeting.
      el.innerHTML = blocks
        .map((block) => {
          return `<div class="resume-entry-block" style="break-inside:avoid;page-break-inside:avoid;white-space:pre-wrap;margin-bottom:0.75em;">${block}</div>`;
        })
        .join("");
    });
  });

  const sections = options.sections;
  const customSections = options.customSections;
  const knownSections = normalizeTemplateSections(sections);

  knownSections.forEach((section) => {
    if (!shouldRenderSection(section.id, knownSections, data, customSections)) {
      removeTemplateSection(doc, section.id);
    }
  });
  appendMissingEnabledSections(doc, knownSections, data, customSections);
  pruneByVisualHeadings(doc, knownSections, data, customSections);
  reorderTemplateSections(doc, knownSections, data, customSections);

  // Strip all <script> tags so sandboxed iframes (which lack allow-scripts)
  // don't emit "Blocked script execution in 'about:srcdoc'" console errors.
  // Resume templates render purely via CSS — no JS is needed.
  doc.querySelectorAll("script").forEach((s) => s.remove());

  return doc.documentElement.outerHTML;
}
