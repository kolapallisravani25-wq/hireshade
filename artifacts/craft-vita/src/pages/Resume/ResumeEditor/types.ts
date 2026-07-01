/**
 * Shared types, constants, and pure helpers for the ResumeEditor feature.
 * All components in this directory import from here instead of re-declaring.
 */

import type { ResumeFields, SectionId } from "@/store/resumeBuilderSlice";
import type { ResumeData } from "@/lib/resumeTemplate";
import {
  FileText, Briefcase, Code2, FolderKanban,
  GraduationCap, Award, BookOpen, User,
} from "lucide-react";
import React from "react";

// ─── Section icon map ─────────────────────────────────────────────────────────

export const SECTION_ICONS: Record<string, React.ElementType> = {
  personalInfo:   User,
  summary:        FileText,
  experience:     Briefcase,
  skills:         Code2,
  projects:       FolderKanban,
  education:      GraduationCap,
  certifications: Award,
  publications:   BookOpen,
};

export function getSectionIcon(id: string): React.ElementType {
  return SECTION_ICONS[id] ?? FileText;
}

// ─── Template list ────────────────────────────────────────────────────────────

import type { TemplateId } from "@/store/resumeBuilderSlice";

export const TEMPLATES: { id: TemplateId; label: string }[] = [
  { id: "classic", label: "Classic" },
  { id: "modern",  label: "Modern"  },
  { id: "minimal", label: "Minimal" },
];

// ─── AI cost / section constants ──────────────────────────────────────────────

export const AI_ENHANCE_FALLBACK_COST = 1;

export const AI_ENHANCEABLE: SectionId[] = [
  "personalInfo", "summary", "experience", "skills", "projects", "education",
  "certifications", "publications",
];

export const SECTION_LABEL: Record<string, string> = {
  personalInfo:   "Personal Info",
  summary:        "Summary",
  experience:     "Work Experience",
  skills:         "Skills",
  projects:       "Projects",
  education:      "Education",
  certifications: "Certifications",
  publications:   "Publications",
};

export const SESSION_CONFIG_KEY = "resume_editor_config";

// ─── Available API template item ──────────────────────────────────────────────

export interface TemplateItem {
  id: string;
  name: string;
  category: string;
  code: string;
}

// ─── Pure section helpers ──────────────────────────────────────────────────────

export function sectionHasContent(id: string, fields: ResumeFields): boolean {
  switch (id) {
    case "personalInfo":    return !!(fields.name || fields.email);
    case "summary":         return !!fields.summary;
    case "experience":      return !!fields.experience;
    case "skills":          return !!(fields.skillsLanguages || fields.skillsFrameworks || fields.skillsDatabases || fields.skillsTools);
    case "projects":        return !!fields.projects;
    case "education":       return !!fields.education;
    case "certifications":  return !!fields.certifications;
    case "publications":    return !!fields.publications;
    default:                return false;
  }
}

export function sectionAIText(id: string, fields: ResumeFields): string {
  switch (id) {
    case "personalInfo":  return [fields.name, fields.role, fields.location].filter(Boolean).join(" · ");
    case "summary":       return fields.summary;
    case "experience":    return fields.experience;
    case "skills":        return [fields.skillsLanguages, fields.skillsFrameworks, fields.skillsDatabases, fields.skillsTools].filter(Boolean).join("\n");
    case "projects":      return fields.projects;
    case "education":     return fields.education;
    case "certifications": return fields.certifications;
    case "publications":  return fields.publications;
    default:              return "";
  }
}

export function mockAIEnhance(id: SectionId, text: string): string {
  switch (id) {
    case "summary":
      return text
        ? `Results-driven professional with proven expertise in ${text.split(" ").slice(0, 5).join(" ")}. Demonstrated ability to deliver high-impact solutions, optimise performance by 30 %, and collaborate across cross-functional teams in fast-paced environments.`
        : "Results-driven professional with a strong foundation in modern software development. Experienced in creating scalable systems and working seamlessly with cross-functional teams.";
    case "experience":
      return `• Led development of key features resulting in 40 % increase in user engagement\n• Architected scalable microservices handling 10 K+ requests/second\n• Mentored junior developers and conducted regular code reviews\n${text}`;
    case "skills":
      return `${text || "React, TypeScript, Node.js, Python"}\n\nSystem Design · CI/CD Pipelines · Cloud Architecture (AWS/GCP) · Performance Optimisation · Agile/Scrum`;
    case "projects":
      return `${text}\n\n• Implemented comprehensive test coverage achieving 95 % code coverage\n• Reduced page load time by 60 % through lazy loading and code splitting`;
    default:
      return text;
  }
}

// ─── Legacy resume text parser ────────────────────────────────────────────────

export function parseRawResume(text: string): ResumeData {
  const lines = text.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
  const data: ResumeData = {
    name: lines[0] || "Your Name", role: "Professional Role",
    email: "", phone: "", links: "", summary: "",
    languages: "", frameworks: "", database: "", tools: "",
    experiences: [], projects: [], education: [], certifications: "", publication: "",
    experienceRaw: "", projectsRaw: "", educationRaw: "",
  };
  const HEADERS = ["PROFILE", "PROJECTS", "TECHNICAL SKILLS", "EDUCATION", "PUBLICATION"];
  const firstIdx = lines.findIndex((l) => HEADERS.includes(l.toUpperCase()));
  if (firstIdx > 1) {
    const contactLines = lines.slice(1, firstIdx);
    data.phone = contactLines.find((l) => l.includes("+")) || "";
    data.links = contactLines.filter((l) => l.toLowerCase().includes("linkedin") || l.toLowerCase().includes("github") || l.includes("•")).join(" | ");
  }
  let cur = "";
  let curLines: string[] = [];
  const flush = (name: string, content: string[]) => {
    switch (name) {
      case "PROFILE":
        data.summary = content.join(" ");
        if (content[0]) data.role = content[0];
        break;
      case "TECHNICAL SKILLS":
        content.forEach((l) => {
          if (l.startsWith("Languages"))  data.languages  = l.split(":")[1]?.trim() || "";
          if (l.startsWith("Framework"))  data.frameworks = l.split(":")[1]?.trim() || "";
          if (l.startsWith("DataBase"))   data.database   = l.split(":")[1]?.trim() || "";
          if (l.startsWith("Other"))      data.tools      = l.split(":")[1]?.trim() || "";
        });
        break;
      case "PROJECTS": {
        let proj: { title: string; points: string[] } | null = null;
        content.forEach((l) => {
          if (!l.match(/^[📌•\-*]/) && l.length > 20) {
            if (proj) data.projects.push(proj);
            proj = { title: l, points: [] };
          } else if (proj) {
            proj.points.push(l.replace(/^[📌•\-*]\s*/, ""));
          }
        });
        if (proj) data.projects.push(proj);
        break;
      }
      case "EDUCATION":
        for (let i = 0; i < content.length; i += 4)
          if (content[i]) data.education.push({ degree: content[i] || "", institute: content[i + 1] || "", year: content[i + 3] || "" });
        break;
      case "PUBLICATION":
        data.publication = content.join(" ");
        break;
    }
  };
  lines.forEach((line) => {
    if (HEADERS.includes(line.toUpperCase())) {
      if (cur) flush(cur, curLines);
      cur = line.toUpperCase();
      curLines = [];
    } else if (cur) {
      curLines.push(line);
    }
  });
  if (cur) flush(cur, curLines);
  return data;
}

export function smartTitle(fields: Partial<ResumeFields>, fallback: string): string {
  const cap = (s: string, max = 60) =>
    s.length > max ? s.slice(0, max - 1).trimEnd() + "…" : s;
  const name = fields.name?.trim();
  const role = fields.role?.trim();
  if (name && role) return cap(`${name} – ${role}`);
  if (name) return cap(name);
  if (role) return cap(role);
  return fallback || "My Resume";
}

export function configToFields(config: Record<string, unknown>): { fields: Partial<ResumeFields>; title: string } {
  // ── Path A: resume was previously saved via the builder ─────────────────
  if (config.sourceType === "builder" && config.fields) {
    const rawTitle = (config.resumeTitle || config.title || "") as string;
    const isGeneric = !rawTitle || rawTitle === "My Resume";
    return {
      title:  isGeneric ? smartTitle(config.fields as Partial<ResumeFields>, rawTitle) : rawTitle,
      fields: config.fields as Partial<ResumeFields>,
    };
  }

  // ── Path B: resume was parsed from an uploaded file ──────────────────────
  let d: ResumeData;
  if (config.sourceType === "resume" && config.resumeContext) {
    try { d = JSON.parse(config.resumeContext as string); }
    catch { d = parseRawResume(config.resumeContext as string); }
  } else {
    const manualData = config.manualData as Record<string, string> | undefined;
    d = {
      name: "Your Name", role: "Professional Role",
      email: "email@example.com", phone: "", links: "",
      summary: manualData?.summary || "",
      languages: "", frameworks: "", database: "", tools: "",
      experiences: [], projects: [], education: [], certifications: "", publication: "",
      experienceRaw: "", projectsRaw: "", educationRaw: "",
    };
  }
  const parsedFields: Partial<ResumeFields> = {
    name: d.name, role: d.role, email: d.email,
    phone: d.phone, links: d.links, summary: d.summary,
    experience: d.role,
    skillsLanguages: d.languages, skillsFrameworks: d.frameworks,
    skillsDatabases: d.database, skillsTools: d.tools,
    projects: d.projects.map((p) => `${p.title}\n${p.points.map((pt) => `• ${pt}`).join("\n")}`).join("\n\n"),
    education: d.education.map((e) => `${e.degree}\n${e.institute}\n${e.year}`).join("\n\n"),
    publications: d.publication,
  };
  const rawTitle = (config.resumeTitle || "") as string;
  const isGeneric = !rawTitle || rawTitle === "My Resume";
  return {
    title: isGeneric ? smartTitle(parsedFields, rawTitle) : rawTitle,
    fields: parsedFields,
  };
}

// ─── Multi-entry section types and helpers ────────────────────────────────────

export interface ExperienceEntry {
  _id: string;
  company: string;
  title: string;
  dates: string;
  bullets: string;
}

export interface EducationEntry {
  _id: string;
  degree: string;
  institution: string;
  dates: string;
  extra: string;
}

export interface ProjectEntry {
  _id: string;
  title: string;
  bullets: string;
}

let _entrySeq = 0;
export function uid() { return `e_${++_entrySeq}_${Math.random().toString(36).slice(2, 7)}`; }

// ── Experience ──────────────────────────────────────────────────────────────

export function parseExperienceEntries(raw: string): ExperienceEntry[] {
  const blocks = raw.split(/\n\n+/).map((b) => b.trim()).filter(Boolean);
  if (!blocks.length) return [blankExperience()];
  return blocks.map((block) => {
    const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
    const headerLine = lines[0] ?? "";
    const parts = headerLine.split("|").map((p) => p.trim());
    const bullets = lines.slice(1).map((l) => l.replace(/^[•\-*]\s*/, "")).join("\n");
    return { _id: uid(), company: parts[0] ?? "", title: parts[1] ?? "", dates: parts[2] ?? "", bullets };
  });
}

export function serialiseExperienceEntries(entries: ExperienceEntry[]): string {
  return entries.map((e) => {
    const header = [e.company, e.title, e.dates].filter(Boolean).join(" | ");
    const pts    = e.bullets.split("\n").filter(Boolean).map((l) => `• ${l.replace(/^[•\-*]\s*/, "")}`).join("\n");
    return pts ? `${header}\n${pts}` : header;
  }).join("\n\n");
}

export function blankExperience(): ExperienceEntry {
  return { _id: uid(), company: "", title: "", dates: "", bullets: "" };
}

// ── Education ───────────────────────────────────────────────────────────────

export function parseEducationEntries(raw: string): EducationEntry[] {
  const blocks = raw.split(/\n\n+/).map((b) => b.trim()).filter(Boolean);
  if (!blocks.length) return [blankEducation()];
  return blocks.map((block) => {
    const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
    return { _id: uid(), degree: lines[0] ?? "", institution: lines[1] ?? "", dates: lines[2] ?? "", extra: lines.slice(3).join("\n") };
  });
}

export function serialiseEducationEntries(entries: EducationEntry[]): string {
  return entries.map((e) => [e.degree, e.institution, e.dates, e.extra].filter(Boolean).join("\n")).join("\n\n");
}

export function blankEducation(): EducationEntry {
  return { _id: uid(), degree: "", institution: "", dates: "", extra: "" };
}

// ── Projects ────────────────────────────────────────────────────────────────

export function parseProjectEntries(raw: string): ProjectEntry[] {
  const blocks = raw.split(/\n\n+/).map((b) => b.trim()).filter(Boolean);
  if (!blocks.length) return [blankProject()];
  return blocks.map((block) => {
    const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
    const rawTitle = lines[0] ?? "";
    const title = rawTitle.replace(/^[•\-*>—]\s*/, "");
    const bullets = lines.slice(1).map((l) => l.replace(/^[•\-*>—]\s*/, "")).filter(Boolean).join("\n");
    return { _id: uid(), title, bullets };
  });
}

export function serialiseProjectEntries(entries: ProjectEntry[]): string {
  return entries.map((e) => {
    const pts = e.bullets.split("\n").filter(Boolean).map((l) => `• ${l.replace(/^[•\-*]\s*/, "")}`).join("\n");
    return pts ? `${e.title}\n${pts}` : e.title;
  }).join("\n\n");
}

export function blankProject(): ProjectEntry {
  return { _id: uid(), title: "", bullets: "" };
}

// ─── Link types and helpers ────────────────────────────────────────────────────

export const PLATFORM_CONFIGS: { label: string; placeholder: string; baseUrl?: string }[] = [
  { label: "LinkedIn",      placeholder: "linkedin.com/in/username",  baseUrl: "https://linkedin.com/in/" },
  { label: "GitHub",        placeholder: "github.com/username",       baseUrl: "https://github.com/" },
  { label: "Portfolio",     placeholder: "mysite.dev" },
  { label: "LeetCode",      placeholder: "leetcode.com/u/username",   baseUrl: "https://leetcode.com/u/" },
  { label: "HackerRank",    placeholder: "hackerrank.com/profile/…",  baseUrl: "https://hackerrank.com/profile/" },
  { label: "Behance",       placeholder: "behance.net/username",      baseUrl: "https://behance.net/" },
  { label: "Dribbble",      placeholder: "dribbble.com/username",     baseUrl: "https://dribbble.com/" },
  { label: "Medium",        placeholder: "medium.com/@username" },
  { label: "Stack Overflow",placeholder: "stackoverflow.com/users/…" },
  { label: "Twitter/X",     placeholder: "x.com/username",           baseUrl: "https://x.com/" },
  { label: "Dev.to",        placeholder: "dev.to/username",           baseUrl: "https://dev.to/" },
  { label: "CodePen",       placeholder: "codepen.io/username",       baseUrl: "https://codepen.io/" },
  { label: "Custom",        placeholder: "https://…" },
];

export interface LinkEntry { id: string; label: string; url: string }

export function serializeLinks(entries: LinkEntry[]): string {
  return entries
    .filter((e) => e.url.trim())
    .map((e) => {
      const label = e.label.trim() || "Link";
      const url   = e.url.trim().startsWith("http") ? e.url.trim() : `https://${e.url.trim()}`;
      return `${label}: ${url}`;
    })
    .join(" | ");
}

export function deserializeLinks(raw: string): LinkEntry[] {
  if (!raw.trim()) return [];
  return raw
    .split("|")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((entry, i) => {
      const colonIdx = entry.indexOf(":");
      if (colonIdx > 0 && colonIdx < 25 && !entry.slice(0, colonIdx).includes("/")) {
        const label = entry.slice(0, colonIdx).trim();
        const url   = entry.slice(colonIdx + 1).trim();
        return { id: `link-${i}-${Date.now()}`, label, url };
      }
      return { id: `link-${i}-${Date.now()}`, label: "Portfolio", url: entry };
    });
}

// ─── Skill suggestion type (inject skills tool) ───────────────────────────────

export type SkillSuggestion = {
  skill: string;
  categoryKey: "skillsLanguages" | "skillsFrameworks" | "skillsDatabases" | "skillsTools";
  categoryLabel: string;
  reason: string;
};
