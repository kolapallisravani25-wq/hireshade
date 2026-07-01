 ;

import * as React from "react";
import { Loader2, Check, Coins, Layout } from "lucide-react";
import { cn } from "@/lib/utils";
import { getAuthHeaders } from "@/lib/globalAuth";

export interface Template {
  id: string;
  category: string;
  name?: string;
  thumbnail: string;
  code: string;
}

interface TemplateSelectionStepProps {
  selectedTemplateId: string | null;
  onSelect: (template: Template) => void;
}

// ─── Default fallback templates (shown when API returns empty) ────────────────

const CLASSIC_HTML = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8"/>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Segoe UI',Arial,sans-serif;font-size:13px;color:#1a1a1a;background:#fff;padding:32px 40px}
  h1{font-size:22px;font-weight:700;letter-spacing:-0.3px}
  .role{font-size:13px;color:#555;margin-top:2px}
  .contact{font-size:11px;color:#777;margin-top:6px}
  .contact a{color:#555;text-decoration:none}
  .contact a:hover{text-decoration:underline}
  hr{border:none;border-top:2px solid #1a1a1a;margin:16px 0 10px}
  h2{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1.2px;color:#1a1a1a;margin-bottom:8px}
  section{margin-bottom:18px}
  .summary{font-size:12px;line-height:1.6;color:#333}
  .skill-group{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:6px}
  .skill-chip{background:#f0f0f0;border-radius:4px;padding:2px 8px;font-size:11px}
  .proj-item,.edu-item{margin-bottom:10px}
  .exp-title{font-weight:600;font-size:12.5px}
  .exp-meta{font-size:11px;color:#666}
  ul{padding-left:16px;margin-top:4px}
  li{font-size:12px;line-height:1.5;color:#333;margin-bottom:2px}
  /* ── Pagination ── */
  section{break-inside:avoid;page-break-inside:avoid}
  h2{break-after:avoid;page-break-after:avoid;orphans:2;widows:2}
  hr{break-after:avoid;page-break-after:avoid}
  .proj-item,.edu-item{break-inside:avoid;page-break-inside:avoid;orphans:2;widows:2}
  ul,ol{break-inside:avoid;page-break-inside:avoid;orphans:2;widows:2}
  li{break-inside:avoid;page-break-inside:avoid}
</style>
</head>
<body>
  <h1 data-field="name">Your Name</h1>
  <div class="role" data-field="role">Professional Role</div>
  <div class="contact">
    <span data-field="email">email@example.com</span>
    <span> · </span><span data-field="phone">+1 (555) 000-0000</span>
    <span> · </span><span class="links-inline" data-field="links">linkedin.com/in/yourprofile</span>
  </div>
  <hr/>
  <section>
    <h2>Summary</h2>
    <p class="summary" data-field="summary">A brief professional summary highlighting your key skills and experience.</p>
  </section>
  <section>
    <h2>Skills</h2>
    <div class="skill-group">
      <span class="skill-chip" data-field="languages">Languages</span>
      <span class="skill-chip" data-field="frameworks">Frameworks</span>
      <span class="skill-chip" data-field="database">Databases</span>
      <span class="skill-chip" data-field="tools">Tools</span>
    </div>
  </section>
  <section>
    <h2>Projects</h2>
    <div data-list="projects">
      <div class="proj-item">
        <div class="exp-title" data-field="title">Project Title</div>
        <ul data-list="points"><li data-field="point">Project description point</li></ul>
      </div>
    </div>
  </section>
  <section>
    <h2>Education</h2>
    <div data-list="education">
      <div class="edu-item">
        <div class="exp-title" data-field="degree">Degree</div>
        <div class="exp-meta"><span data-field="institute">Institute</span> · <span data-field="year">Year</span></div>
      </div>
    </div>
  </section>
</body>
</html>`;

const MODERN_HTML = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8"/>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Segoe UI',Arial,sans-serif;font-size:13px;color:#111;background:#fff;display:flex;min-height:100vh}
  .sidebar{width:200px;background:#1a1a2e;color:#e2e8f0;padding:28px 20px;flex-shrink:0}
  .sidebar h1{font-size:16px;font-weight:700;color:#fff;line-height:1.3}
  .sidebar .role{font-size:11px;color:#94a3b8;margin-top:4px}
  .sidebar h2{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;color:#64748b;margin:20px 0 8px}
  .sidebar p,.sidebar span{font-size:11px;color:#cbd5e1;line-height:1.5;display:block;margin-bottom:2px}
  .sidebar a{color:#cbd5e1;text-decoration:none}
  .sidebar .skill-chip{background:#1e293b;border-radius:3px;padding:2px 8px;font-size:10.5px;color:#e2e8f0;margin-bottom:4px}
  .main{flex:1;padding:28px 24px}
  section{margin-bottom:18px}
  .section-title{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;color:#1a1a2e;border-bottom:2px solid #1a1a2e;padding-bottom:4px;margin-bottom:10px}
  .proj-item,.edu-item{margin-bottom:10px}
  .item-title{font-weight:600;font-size:12.5px}
  .item-meta{font-size:11px;color:#666}
  ul{padding-left:16px;margin-top:4px}
  li{font-size:12px;line-height:1.5;color:#333;margin-bottom:2px}
  .summary{font-size:12px;line-height:1.6;color:#444}
  /* ── Pagination ── */
  section{break-inside:avoid;page-break-inside:avoid}
  .section-title{break-after:avoid;page-break-after:avoid;orphans:2;widows:2}
  .proj-item,.edu-item{break-inside:avoid;page-break-inside:avoid;orphans:2;widows:2}
  ul,ol{break-inside:avoid;page-break-inside:avoid;orphans:2;widows:2}
  li{break-inside:avoid;page-break-inside:avoid}
  .sidebar{break-inside:avoid;page-break-inside:avoid}
  .sidebar h2{break-after:avoid;page-break-after:avoid}
</style>
</head>
<body>
  <div class="sidebar">
    <h1 data-field="name">Your Name</h1>
    <div class="role" data-field="role">Role</div>
    <h2>Contact</h2>
    <span data-field="email">email@example.com</span>
    <span data-field="phone">+1 000-0000</span>
    <span class="links-block" data-field="links">linkedin</span>
    <h2>Skills</h2>
    <span class="skill-chip" data-field="languages">Languages</span>
    <span class="skill-chip" data-field="frameworks">Frameworks</span>
    <span class="skill-chip" data-field="database">Databases</span>
    <span class="skill-chip" data-field="tools">Tools</span>
  </div>
  <div class="main">
    <section>
      <div class="section-title">Summary</div>
      <p class="summary" data-field="summary">Professional summary goes here.</p>
    </section>
    <section>
      <div class="section-title">Projects</div>
      <div data-list="projects">
        <div class="proj-item">
          <div class="item-title" data-field="title">Project Title</div>
          <ul data-list="points"><li data-field="point">Detail</li></ul>
        </div>
      </div>
    </section>
    <section>
      <div class="section-title">Education</div>
      <div data-list="education">
        <div class="edu-item">
          <div class="item-title" data-field="degree">Degree</div>
          <div class="item-meta"><span data-field="institute">Institute</span> · <span data-field="year">Year</span></div>
        </div>
      </div>
    </section>
  </div>
</body>
</html>`;

const MINIMAL_HTML = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8"/>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:Georgia,'Times New Roman',serif;font-size:13px;color:#1a1a1a;background:#fff;padding:36px 44px}
  h1{font-size:24px;font-weight:400;letter-spacing:2px;text-transform:uppercase;text-align:center}
  .role{font-size:11px;color:#888;text-align:center;letter-spacing:1.5px;text-transform:uppercase;margin-top:4px}
  .contact{text-align:center;font-size:11px;color:#888;margin-top:6px}
  .contact a{color:#666;text-decoration:none}
  .divider{border:none;border-top:1px solid #ccc;margin:18px 0 12px}
  h2{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:2px;color:#888;margin-bottom:8px}
  section{margin-bottom:20px}
  .summary{font-size:12.5px;line-height:1.7;color:#333;font-style:italic}
  .skills-row{display:flex;flex-wrap:wrap;gap:4px}
  .skill{font-size:11.5px;color:#555}
  .skill::after{content:" ·";color:#ccc}
  .skill:last-child::after{content:""}
  .proj-item,.edu-item{margin-bottom:10px}
  .item-title{font-weight:700;font-size:12.5px}
  .item-meta{font-size:11px;color:#888}
  ul{padding-left:18px;margin-top:4px}
  li{font-size:12px;line-height:1.6;color:#444;margin-bottom:2px}
  /* ── Pagination ── */
  section{break-inside:avoid;page-break-inside:avoid}
  h2{break-after:avoid;page-break-after:avoid;orphans:2;widows:2}
  hr.divider{break-after:avoid;page-break-after:avoid}
  .proj-item,.edu-item{break-inside:avoid;page-break-inside:avoid;orphans:2;widows:2}
  ul,ol{break-inside:avoid;page-break-inside:avoid;orphans:2;widows:2}
  li{break-inside:avoid;page-break-inside:avoid}
</style>
</head>
<body>
  <h1 data-field="name">YOUR NAME</h1>
  <div class="role" data-field="role">PROFESSIONAL ROLE</div>
  <div class="contact">
    <span data-field="email">email@example.com</span> &nbsp;·&nbsp;
    <span data-field="phone">Phone</span> &nbsp;·&nbsp;
    <span class="links-inline" data-field="links">Links</span>
  </div>
  <hr class="divider"/>
  <section>
    <h2>Profile</h2>
    <p class="summary" data-field="summary">Your professional summary.</p>
  </section>
  <hr class="divider"/>
  <section>
    <h2>Technical Skills</h2>
    <div class="skills-row">
      <span class="skill" data-field="languages">Languages</span>
      <span class="skill" data-field="frameworks">Frameworks</span>
      <span class="skill" data-field="database">Databases</span>
      <span class="skill" data-field="tools">Tools</span>
    </div>
  </section>
  <hr class="divider"/>
  <section>
    <h2>Projects</h2>
    <div data-list="projects">
      <div class="proj-item">
        <div class="item-title" data-field="title">Project Title</div>
        <ul data-list="points"><li data-field="point">Detail</li></ul>
      </div>
    </div>
  </section>
  <hr class="divider"/>
  <section>
    <h2>Education</h2>
    <div data-list="education">
      <div class="edu-item">
        <div class="item-title" data-field="degree">Degree</div>
        <div class="item-meta"><span data-field="institute">Institute</span> · <span data-field="year">Year</span></div>
      </div>
    </div>
  </section>
</body>
</html>`;

const DEFAULT_TEMPLATES: Template[] = [
  { id: "classic", category: "Classic", name: "Classic", thumbnail: "", code: CLASSIC_HTML },
  { id: "modern",  category: "Modern",  name: "Modern",  thumbnail: "", code: MODERN_HTML  },
  { id: "minimal", category: "Minimal", name: "Minimal", thumbnail: "", code: MINIMAL_HTML },
];

// ─── Card ─────────────────────────────────────────────────────────────────────

// Scale an A4 iframe (794 × 1123 px) to fill any container width.
// Uses a ResizeObserver so the scale stays exact regardless of dialog width.
function useA4Scale(ref: React.RefObject<HTMLDivElement | null>) {
  const [scale, setScale] = React.useState(0.33);
  React.useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([entry]) => {
      const w = entry.contentRect.width;
      if (w > 0) setScale(w / 794);
    });
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, [ref]);
  return scale;
}

// Isolated card to avoid re-renders of all cards when hover state changes
const TemplateCard = React.memo(function TemplateCard({
  tpl,
  isSelected,
  onSelect,
}: {
  tpl: Template;
  isSelected: boolean;
  onSelect: (t: Template) => void;
}) {
  const [hovered, setHovered] = React.useState(false);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const scale = useA4Scale(containerRef);
  // Container height matches the scaled iframe height (A4 = 794×1123)
  const containerHeight = Math.round(1123 * scale);

  return (
    <button
      onClick={() => onSelect(tpl)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className={cn(
        "flex flex-col rounded-xl border-2 transition-all duration-200 text-left overflow-hidden w-full",
        isSelected
          ? "border-primary shadow-lg ring-2 ring-primary/20"
          : "border-border hover:border-primary/50 hover:shadow-md",
      )}
    >
      {/* Live preview — always visible, scales to fit container */}
      <div
        ref={containerRef}
        className="relative w-full overflow-hidden bg-white"
        style={{ height: containerHeight }}
      >
        {tpl.code ? (
          <iframe
            srcDoc={tpl.code}
            title={`Preview ${tpl.name ?? tpl.category}`}
            sandbox=""
            className="absolute top-0 left-0 border-none pointer-events-none"
            style={{
              width: 794,
              height: 1123,
              transform: `scale(${scale})`,
              transformOrigin: "top left",
            }}
          />
        ) : tpl.thumbnail ? (
          <img
            src={tpl.thumbnail}
            alt={tpl.name ?? tpl.category}
            className="absolute inset-0 w-full h-full object-cover object-top"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Layout className="h-10 w-10 text-muted-foreground/30" />
          </div>
        )}

        {/* Selected badge */}
        {isSelected && (
          <div className="absolute top-2 right-2 h-6 w-6 rounded-full bg-primary flex items-center justify-center shadow-md z-10">
            <Check className="h-3.5 w-3.5 text-primary-foreground" />
          </div>
        )}

        {/* Hover overlay */}
        {hovered && (
          <div className="absolute inset-0 bg-primary/10 flex items-end justify-center pb-3 z-10 transition-opacity duration-150">
            <span
              className={cn(
                "text-[11px] font-bold px-4 py-1.5 rounded-full shadow",
                isSelected
                  ? "bg-primary text-primary-foreground"
                  : "bg-white text-foreground",
              )}
            >
              {isSelected ? "✓ Selected" : "Select"}
            </span>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-3 py-2 border-t border-border bg-card flex items-center justify-between">
        <p className="font-semibold text-sm truncate">{tpl.name ?? tpl.category}</p>
        <span className="text-[10px] text-muted-foreground uppercase tracking-wide shrink-0 ml-2">
          {tpl.category}
        </span>
      </div>
    </button>
  );
});

export function TemplateSelectionStep({
  selectedTemplateId,
  onSelect,
}: TemplateSelectionStepProps) {
  const [templates, setTemplates] = React.useState<Template[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const fetchTemplates = React.useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await fetch(
        `${import.meta.env.VITE_BACKEND_URL}/api/resume/all-templates`,
        { headers: await getAuthHeaders() },
      );
      if (!response.ok) throw new Error("Failed to fetch templates");
      const data: Template[] = await response.json();
      // Fall back to built-in defaults when API returns empty
      setTemplates(data.length > 0 ? data : DEFAULT_TEMPLATES);
    } catch {
      // Network / server error — use defaults silently
      setTemplates(DEFAULT_TEMPLATES);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    fetchTemplates();
  }, [fetchTemplates]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-16 space-y-4">
        <Loader2 className="h-8 w-8 text-primary animate-spin" />
        <p className="text-sm text-muted-foreground">Loading templates…</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3 max-h-[360px] overflow-y-auto pr-1 pb-1 no-scrollbar">
        {templates.map((tpl) => (
          <TemplateCard
            key={tpl.id}
            tpl={tpl}
            isSelected={selectedTemplateId === tpl.id}
            onSelect={onSelect}
          />
        ))}
      </div>

      {/* Credit note */}
      <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-amber-50 border border-amber-200/60">
        <Coins className="h-3.5 w-3.5 text-amber-600 shrink-0" />
        <p className="text-[11px] text-amber-700 leading-relaxed">
          <span className="font-bold">1 credit</span> is used to apply this template.{" "}
          <span className="text-amber-600">Switching templates inside the editor is free.</span>
        </p>
      </div>
    </div>
  );
}
