/**
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │  HireShade — Resume Editor V2.1  (Static Design Prototype)            │
 * │                                                                          │
 * │  DESIGN RATIONALE                                                        │
 * │  Font        DM Sans — compact, legible, distinct from Inter/Roboto      │
 * │  AI Accent   cyan-600  — calm intelligence, not purple-gradient cliché   │
 * │  Success     emerald   — present keywords, saved, free states            │
 * │  Warning     amber     — partial sections, credit costs                  │
 * │  Danger      rose      — missing keywords, empty sections                │
 * │  Credits     amber-700 on amber-50  — warm, dedicated channel            │
 * │  Locked      dashed border + "Factual" pill                              │
 * │                                                                          │
 * │  ARCHITECTURE                                                            │
 * │  TopBar + [SectionSidebar | CenterPanel | PreviewPanel] + BottomTabBar  │
 * │  CenterPanel → AiActionStrip (pill row + expandable card grid)          │
 * │             → PersonalInfoCard (active) + CollapsedSectionCard × 5      │
 * │  Modal portal → 8 AI action modals sharing ActionModalShell             │
 * └──────────────────────────────────────────────────────────────────────────┘
 */

 ;

import React, { useState } from "react";
import {
  AlertCircle, AlignLeft, BarChart2, Briefcase, Check, CheckCircle2,
  ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Clock, Code2,
  Coins, ExternalLink, Eye, FileDown, FolderOpen, GraduationCap,
  LayoutTemplate, Lock, Mail, Maximize2, Minus, PenLine, Plus,
  RotateCcw, Save, Search, SearchCode, Sparkles, Target, User, X,
  Zap, ZoomIn, ZoomOut,
} from "lucide-react";

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

type ModalId =
  | "enhance" | "rewrite" | "tailor" | "skills"
  | "keywords" | "ats" | "match" | "cover" | null;

type SectionStatus = "full" | "partial" | "empty";
type KwView = "list" | "map";
type KwTab  = "analyze" | "results";

interface AiAction {
  id: string; icon: React.ReactNode; label: string;
  desc: string; credit: number | "FREE"; primary: boolean;
}
interface NavSection {
  id: string; num: number; label: string; icon: React.ReactNode;
  status: SectionStatus; locked?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// DATA
// ─────────────────────────────────────────────────────────────────────────────

const AI_ACTIONS: AiAction[] = [
  { id:"enhance",  icon:<Sparkles size={14}/>,   label:"AI Enhance",    desc:"Rewrite the active section",      credit:1,      primary:true  },
  { id:"rewrite",  icon:<RotateCcw size={14}/>,  label:"Full Rewrite",  desc:"Full resume for target role",     credit:5,      primary:true  },
  { id:"tailor",   icon:<Target size={14}/>,     label:"Tailor to Job", desc:"JD-based deep tailoring",         credit:4,      primary:true  },
  { id:"skills",   icon:<Zap size={14}/>,        label:"Inject Skills", desc:"JD-aware skill suggestions",      credit:1,      primary:true  },
  { id:"keywords", icon:<SearchCode size={14}/>, label:"Bulk Keywords", desc:"Inject missing JD keywords",      credit:2,      primary:false },
  { id:"ats",      icon:<BarChart2 size={14}/>,  label:"ATS Score",     desc:"Score against ATS parsers",       credit:"FREE", primary:false },
  { id:"match",    icon:<Search size={14}/>,     label:"Keyword Match", desc:"Highlight JD keywords in resume", credit:"FREE", primary:false },
  { id:"cover",    icon:<Mail size={14}/>,       label:"Cover Letter",  desc:"Personalized to resume + JD",     credit:3,      primary:false },
];

const NAV_SECTIONS: NavSection[] = [
  { id:"personal",  num:1, label:"Personal Info",   icon:<User size={12}/>,          status:"full",    locked:true  },
  { id:"summary",   num:2, label:"Summary",         icon:<AlignLeft size={12}/>,     status:"full"                  },
  { id:"work",      num:3, label:"Work Experience", icon:<Briefcase size={12}/>,     status:"full"                  },
  { id:"skills",    num:4, label:"Skills",          icon:<Code2 size={12}/>,         status:"partial"               },
  { id:"projects",  num:5, label:"Projects",        icon:<FolderOpen size={12}/>,    status:"partial"               },
  { id:"education", num:6, label:"Education",       icon:<GraduationCap size={12}/>, status:"full",    locked:true  },
];

const KW_PRESENT = [
  { word:"Python",        sections:["Skills","Experience"] },
  { word:"SQL",           sections:["Skills","Summary"]    },
  { word:"AWS",           sections:["Skills","Experience"] },
  { word:"ETL",           sections:["Summary","Experience"] },
  { word:"Data Modeling", sections:["Experience"]          },
  { word:"Spark",         sections:["Skills"]              },
];
const KW_MISSING = [
  {word:"Apache Kafka"},{word:"Airflow"},{word:"dbt"},
  {word:"Snowflake"},{word:"Databricks"},{word:"MLflow"},
];
const MAP_SECTIONS = ["Summary","Experience","Skills","Projects"];
const MAP_WORDS    = ["Python","SQL","Spark","Kafka","AWS","Airflow"];
const MAP_DATA: Record<string,boolean[]> = {
  Python: [true,true,true,true],   SQL:    [true,true,true,false],
  Spark:  [false,false,true,true], Kafka:  [false,false,false,false],
  AWS:    [true,true,false,false], Airflow:[false,false,false,false],
};

const STATUS_DOT: Record<SectionStatus,string>    = { full:"bg-emerald-400", partial:"bg-amber-400",  empty:"bg-rose-300"   };
const STATUS_BORDER: Record<SectionStatus,string> = { full:"border-l-emerald-400", partial:"border-l-amber-400", empty:"border-l-rose-300" };

// ─────────────────────────────────────────────────────────────────────────────
// PRIMITIVES
// ─────────────────────────────────────────────────────────────────────────────

const CreditPill: React.FC<{credit:number|"FREE"; inverted?:boolean}> = ({credit,inverted}) =>
  credit==="FREE" ? (
    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full border ${inverted?"bg-white/15 text-white border-white/25":"bg-emerald-50 text-emerald-600 border-emerald-100"}`}>FREE</span>
  ) : (
    <span className="text-[9px] font-semibold text-cyan-700 bg-cyan-50 border border-cyan-100 px-1.5 py-0.5 rounded-full whitespace-nowrap">{credit}cr</span>
  );

const LockedField: React.FC<{label:string;value:string;helper?:string;className?:string}> = ({label,value,helper,className=""}) => (
  <div className={className}>
    <div className="flex items-center justify-between mb-1.5">
      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{label}</span>
      <span className="flex items-center gap-1 text-[9px] font-bold text-slate-300 bg-slate-50 border border-slate-100 px-1.5 py-0.5 rounded-full"><Lock size={8}/>Factual</span>
    </div>
    <div className="bg-slate-50/80 border border-dashed border-slate-200 rounded-xl px-3.5 py-2.5 text-[13px] text-slate-500 cursor-not-allowed select-none">{value}</div>
    {helper && <p className="mt-1 text-[10.5px] text-slate-400">{helper}</p>}
  </div>
);

const EditField: React.FC<{label:string;value?:string;placeholder?:string;className?:string}> = ({label,value,placeholder,className=""}) => (
  <div className={className}>
    <span className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">{label}</span>
    <input type="text" defaultValue={value} placeholder={placeholder} className="w-full bg-white border border-slate-200 rounded-xl px-3.5 py-2.5 text-[13px] text-slate-900 placeholder:text-slate-300 focus:outline-none focus:border-cyan-400 focus:ring-2 focus:ring-cyan-50 hover:border-slate-300 transition-all"/>
  </div>
);

const EditTextarea: React.FC<{label:string;value?:string;placeholder?:string;rows?:number;className?:string;badge?:React.ReactNode}> = ({label,value,placeholder,rows=4,className="",badge}) => (
  <div className={className}>
    <div className="flex items-center justify-between mb-1.5">
      <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">{label}</span>
      {badge}
    </div>
    <textarea defaultValue={value} placeholder={placeholder} rows={rows} className="w-full bg-white border border-slate-200 rounded-xl px-3.5 py-2.5 text-[13px] text-slate-900 placeholder:text-slate-300 focus:outline-none focus:border-cyan-400 focus:ring-2 focus:ring-cyan-50 hover:border-slate-300 transition-all resize-none"/>
  </div>
);

// ─────────────────────────────────────────────────────────────────────────────
// MODAL SHELL
// ─────────────────────────────────────────────────────────────────────────────

interface ModalShellProps {
  icon:React.ReactNode; title:string; credit:number|"FREE";
  iconBg?:string; onClose:()=>void; children:React.ReactNode;
  footer:React.ReactNode; wide?:boolean;
}

const ActionModalShell: React.FC<ModalShellProps> = ({icon,title,credit,iconBg="bg-cyan-50 text-cyan-700",onClose,children,footer,wide}) => (
  <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
    <div className="absolute inset-0 bg-slate-900/25 backdrop-blur-[2px]"/>
    <div
      className={`relative bg-white rounded-2xl shadow-[0_24px_64px_rgba(0,0,0,0.14)] flex flex-col overflow-hidden ${wide?"w-full max-w-2xl":"w-full max-w-md"}`}
      style={{maxHeight:"90vh"}} onClick={e=>e.stopPropagation()}
    >
      <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${iconBg}`}>{icon}</div>
          <div>
            <h3 className="text-[14.5px] font-bold text-slate-900 leading-none">{title}</h3>
            <div className="mt-1.5"><CreditPill credit={credit}/></div>
          </div>
        </div>
        <button onClick={onClose} className="w-8 h-8 flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-xl transition-colors"><X size={14}/></button>
      </div>
      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">{children}</div>
      <div className="px-6 py-4 border-t border-slate-100 flex items-center justify-end gap-2.5 flex-shrink-0">{footer}</div>
    </div>
  </div>
);

const CancelBtn: React.FC<{onClose:()=>void}> = ({onClose}) => (
  <button onClick={onClose} className="px-4 py-2 text-[12.5px] font-medium text-slate-600 border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors">Cancel</button>
);

// ─────────────────────────────────────────────────────────────────────────────
// MODALS
// ─────────────────────────────────────────────────────────────────────────────

const AiEnhanceModal: React.FC<{onClose:()=>void}> = ({onClose}) => (
  <ActionModalShell icon={<Sparkles size={16}/>} title="AI Enhance Section" credit={1} onClose={onClose}
    footer={<><CancelBtn onClose={onClose}/><button className="px-5 py-2 text-[12.5px] font-bold bg-cyan-600 text-white rounded-xl hover:bg-cyan-700 transition-colors flex items-center gap-2"><Sparkles size={12}/>Enhance Section</button></>}
  >
    <p className="text-[12.5px] text-slate-500 leading-relaxed">AI will rewrite <strong className="text-slate-800">Personal Info</strong> to be more impactful while keeping all factual data intact.</p>
    <EditTextarea label="Optional instructions" placeholder="e.g. Focus on data engineering leadership, use concise language…" rows={3}/>
    <div className="bg-slate-50 border border-slate-100 rounded-xl p-3.5 text-[11.5px] text-slate-500 leading-relaxed">
      <strong className="text-slate-700 block mb-1 text-[12px]">Current content</strong>
      Azure Data Engineer with 5+ years of experience building end-to-end data pipelines and cloud-native data warehouse solutions…
    </div>
  </ActionModalShell>
);

const FullRewriteModal: React.FC<{onClose:()=>void}> = ({onClose}) => (
  <ActionModalShell icon={<RotateCcw size={16}/>} title="Full Resume Rewrite" credit={5} iconBg="bg-violet-50 text-violet-700" onClose={onClose}
    footer={<><CancelBtn onClose={onClose}/><button className="px-5 py-2 text-[12.5px] font-bold bg-slate-900 text-white rounded-xl hover:bg-slate-800 transition-colors flex items-center gap-2"><RotateCcw size={12}/>Rewrite Resume</button></>}
  >
    <div className="flex items-start gap-2.5 bg-amber-50 border border-amber-100 rounded-xl p-3.5">
      <AlertCircle size={14} className="text-amber-500 mt-0.5 flex-shrink-0"/>
      <p className="text-[11.5px] text-amber-700 leading-relaxed">Replaces all editable sections. Employers, dates, and institutions are <strong>never changed</strong>. 5 credits charged.</p>
    </div>
    <EditField label="Target Role" value="Azure Data Engineer" placeholder="e.g. Senior Data Engineer"/>
    <EditField label="Company (optional)" placeholder="e.g. Microsoft, Databricks…"/>
    <EditTextarea label="Job Description" placeholder="Paste the full job description for best results…" rows={5}/>
  </ActionModalShell>
);

const TailorToJobModal: React.FC<{onClose:()=>void}> = ({onClose}) => (
  <ActionModalShell icon={<Target size={16}/>} title="Tailor to Job" credit={4} iconBg="bg-rose-50 text-rose-600" onClose={onClose}
    footer={<><CancelBtn onClose={onClose}/><button className="px-5 py-2 text-[12.5px] font-bold bg-rose-600 text-white rounded-xl hover:bg-rose-700 transition-colors flex items-center gap-2"><Target size={12}/>Tailor Resume</button></>}
  >
    <p className="text-[12.5px] text-slate-500 leading-relaxed">Rewrites summary, bullets, and skills to match the JD. Employers and dates are never touched.</p>
    <EditField label="Target Role" placeholder="e.g. Senior Data Engineer"/>
    <EditField label="Company" placeholder="e.g. Databricks, Snowflake…"/>
    <EditTextarea label="Job Description" placeholder="Paste the full JD — more detail = better tailoring…" rows={6}/>
    <div className="flex items-center gap-2 bg-cyan-50 border border-cyan-100 rounded-xl px-3.5 py-2.5">
      <Zap size={12} className="text-cyan-500 flex-shrink-0"/>
      <p className="text-[11.5px] text-cyan-700">Results are cached — re-tailoring the same JD is free.</p>
    </div>
  </ActionModalShell>
);

const InjectSkillsModal: React.FC<{onClose:()=>void}> = ({onClose}) => {
  const suggested = ["Apache Kafka","Apache Airflow","dbt","Snowflake","Databricks","MLflow","Terraform","Docker"];
  const [selected, setSelected] = useState<string[]>(["Apache Kafka","dbt","Snowflake"]);
  const toggle = (s:string) => setSelected(p => p.includes(s)?p.filter(x=>x!==s):[...p,s]);
  return (
    <ActionModalShell icon={<Zap size={16}/>} title="Inject Skills" credit={1} iconBg="bg-amber-50 text-amber-600" onClose={onClose}
      footer={<>
        <span className="mr-auto text-[11.5px] text-slate-400">{selected.length} skill{selected.length!==1?"s":""} selected</span>
        <CancelBtn onClose={onClose}/>
        <button className="px-5 py-2 text-[12.5px] font-bold bg-amber-500 text-white rounded-xl hover:bg-amber-600 transition-colors flex items-center gap-2"><Zap size={12}/>Inject {selected.length>0?selected.length:""} Skills</button>
      </>}
    >
      <EditTextarea label="Job Description (optional)" placeholder="Paste JD to get smarter skill suggestions…" rows={3}/>
      <div>
        <span className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2.5">Suggested Skills</span>
        <div className="flex flex-wrap gap-2">
          {suggested.map(s=>(
            <button key={s} onClick={()=>toggle(s)} className={`flex items-center gap-1.5 text-[12px] font-semibold px-3 py-1.5 rounded-full border transition-all ${selected.includes(s)?"bg-cyan-600 text-white border-cyan-600 shadow-sm":"bg-white text-slate-600 border-slate-200 hover:border-cyan-300 hover:text-cyan-700"}`}>
              {selected.includes(s)?<Check size={11}/>:<Plus size={11}/>}{s}
            </button>
          ))}
        </div>
      </div>
    </ActionModalShell>
  );
};

const BulkKeywordModal: React.FC<{onClose:()=>void}> = ({onClose}) => (
  <ActionModalShell icon={<SearchCode size={16}/>} title="Bulk Keyword Inject" credit={2} iconBg="bg-indigo-50 text-indigo-600" onClose={onClose}
    footer={<><CancelBtn onClose={onClose}/><button className="px-5 py-2 text-[12.5px] font-bold bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 transition-colors flex items-center gap-2"><SearchCode size={12}/>Inject Keywords</button></>}
  >
    <p className="text-[12.5px] text-slate-500 leading-relaxed">Scans the JD and naturally weaves missing keywords into your existing bullets and summary.</p>
    <EditTextarea label="Job Description" placeholder="Paste the full job description…" rows={6}/>
    <div className="bg-slate-50 border border-slate-100 rounded-xl p-3.5 space-y-2">
      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Detected keywords to inject</span>
      <div className="flex flex-wrap gap-1.5">
        {["Apache Kafka","Airflow","dbt","Snowflake","Databricks"].map(k=>(
          <span key={k} className="text-[11px] font-medium text-slate-600 bg-white border border-slate-200 px-2 py-0.5 rounded-full">{k}</span>
        ))}
        <span className="text-[11px] text-slate-300 italic">Paste JD above to auto-detect…</span>
      </div>
    </div>
  </ActionModalShell>
);

const AtsScoreModal: React.FC<{onClose:()=>void}> = ({onClose}) => {
  const cats = [
    {label:"Keyword Coverage",     score:58, color:"bg-amber-400"},
    {label:"Format & Structure",   score:90, color:"bg-emerald-400"},
    {label:"Section Completeness", score:85, color:"bg-emerald-400"},
    {label:"Readability",          score:72, color:"bg-amber-400"},
  ];
  const issues = [
    "Missing high-frequency JD keywords: Kafka, Airflow, dbt",
    "Summary lacks quantified achievements",
    "No LinkedIn URL in Personal Info",
  ];
  return (
    <ActionModalShell icon={<BarChart2 size={16}/>} title="ATS Score" credit="FREE" iconBg="bg-emerald-50 text-emerald-700" onClose={onClose}
      footer={<button onClick={onClose} className="px-4 py-2 text-[12.5px] font-medium text-slate-600 border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors">Close</button>}
    >
      <div className="flex items-center gap-5 py-1">
        <div className="relative w-[84px] h-[84px] flex-shrink-0">
          <svg className="w-full h-full -rotate-90" viewBox="0 0 84 84">
            <circle cx="42" cy="42" r="34" fill="none" stroke="#F1F5F9" strokeWidth="9"/>
            <circle cx="42" cy="42" r="34" fill="none" stroke="#F59E0B" strokeWidth="9" strokeDasharray={`${(76/100)*213.6} 213.6`} strokeLinecap="round"/>
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-[22px] font-extrabold text-slate-900 leading-none">76</span>
            <span className="text-[10px] font-bold text-slate-400">/100</span>
          </div>
        </div>
        <div>
          <p className="text-[13px] font-bold text-slate-800">Good — room to improve</p>
          <p className="mt-1 text-[11.5px] text-slate-500 leading-relaxed">Fixing keyword gaps could raise your score to <strong className="text-slate-700">88+</strong>, improving ATS pass-through rate.</p>
        </div>
      </div>
      <div className="space-y-3">
        {cats.map(c=>(
          <div key={c.label}>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[12px] font-medium text-slate-700">{c.label}</span>
              <span className="text-[12px] font-bold text-slate-900">{c.score}</span>
            </div>
            <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
              <div className={`h-full rounded-full ${c.color}`} style={{width:`${c.score}%`}}/>
            </div>
          </div>
        ))}
      </div>
      <div>
        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Top issues to fix</span>
        <ul className="mt-2.5 space-y-2">
          {issues.map(issue=>(
            <li key={issue} className="flex items-start gap-2.5 text-[12px] text-slate-700 bg-rose-50 border border-rose-100 rounded-xl px-3.5 py-2.5">
              <AlertCircle size={12} className="text-rose-400 mt-0.5 flex-shrink-0"/>{issue}
            </li>
          ))}
        </ul>
      </div>
    </ActionModalShell>
  );
};

const KeywordMatchModal: React.FC<{onClose:()=>void}> = ({onClose}) => {
  const [tab,  setTab]  = useState<KwTab>("results");
  const [view, setView] = useState<KwView>("list");
  return (
    <ActionModalShell icon={<Search size={16}/>} title="Keyword Match" credit="FREE" iconBg="bg-slate-100 text-slate-600" wide onClose={onClose}
      footer={<>
        <button onClick={onClose} className="px-4 py-2 text-[12.5px] font-medium text-slate-600 border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors">Close</button>
        <button className="px-5 py-2 text-[12.5px] font-bold bg-slate-900 text-white rounded-xl hover:bg-slate-800 transition-colors flex items-center gap-2"><SearchCode size={12}/>Fix Missing Keywords</button>
      </>}
    >
      <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl w-fit">
        {(["analyze","results"] as KwTab[]).map(t=>(
          <button key={t} onClick={()=>setTab(t)} className={`text-[12px] font-semibold px-4 py-1.5 rounded-lg capitalize transition-all ${tab===t?"bg-white text-slate-900 shadow-sm":"text-slate-500 hover:text-slate-700"}`}>
            {t==="analyze"?"Analyze JD":"Results"}
          </button>
        ))}
      </div>

      {tab==="analyze" ? (
        <>
          <EditTextarea label="Job Description" placeholder="Paste the job description to analyze keyword coverage…" rows={7}/>
          <button className="w-full py-2.5 text-[13px] font-bold bg-slate-900 text-white rounded-xl hover:bg-slate-800 transition-colors flex items-center justify-center gap-2"><Search size={13}/>Analyze Keywords</button>
        </>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-emerald-50 border border-emerald-100 rounded-xl px-4 py-3 text-center">
              <div className="text-[24px] font-extrabold text-emerald-700 leading-none">{KW_PRESENT.length}</div>
              <div className="text-[11px] font-semibold text-emerald-600 mt-1">Keywords Present</div>
            </div>
            <div className="bg-rose-50 border border-rose-100 rounded-xl px-4 py-3 text-center">
              <div className="text-[24px] font-extrabold text-rose-600 leading-none">{KW_MISSING.length}</div>
              <div className="text-[11px] font-semibold text-rose-500 mt-1">Keywords Missing</div>
            </div>
          </div>

          <div className="flex items-center justify-end">
            <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl">
              {(["list","map"] as KwView[]).map(v=>(
                <button key={v} onClick={()=>setView(v)} className={`text-[11px] font-semibold px-3 py-1.5 rounded-lg capitalize transition-all ${view===v?"bg-white text-slate-900 shadow-sm":"text-slate-500 hover:text-slate-700"}`}>
                  {v==="list"?"List":"Visual Map"}
                </button>
              ))}
            </div>
          </div>

          {view==="list" ? (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="flex items-center gap-1.5 mb-3"><CheckCircle2 size={12} className="text-emerald-500"/><span className="text-[10px] font-bold text-slate-600 uppercase tracking-wider">Present ({KW_PRESENT.length})</span></div>
                <div className="space-y-1.5">
                  {KW_PRESENT.map(k=>(
                    <div key={k.word} className="flex items-center justify-between gap-2 bg-emerald-50/70 border border-emerald-100 rounded-xl px-3 py-2">
                      <span className="text-[12px] font-semibold text-emerald-800">{k.word}</span>
                      <div className="flex gap-1 flex-wrap justify-end">{k.sections.map(s=><span key={s} className="text-[9px] font-bold text-emerald-600 bg-emerald-100 px-1.5 py-0.5 rounded-md">{s}</span>)}</div>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <div className="flex items-center gap-1.5 mb-3"><AlertCircle size={12} className="text-rose-400"/><span className="text-[10px] font-bold text-slate-600 uppercase tracking-wider">Missing ({KW_MISSING.length})</span></div>
                <div className="space-y-1.5">
                  {KW_MISSING.map(k=>(
                    <div key={k.word} className="flex items-center justify-between gap-2 bg-rose-50 border border-rose-100 rounded-xl px-3 py-2">
                      <span className="text-[12px] font-semibold text-rose-700">{k.word}</span>
                      <button className="text-[10px] font-bold text-rose-500 border border-rose-200 bg-white px-2 py-0.5 rounded-lg hover:bg-rose-50 transition-colors flex-shrink-0">+ Add</button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr>
                    <th className="text-left text-[9.5px] font-bold text-slate-400 uppercase tracking-wider pb-2 pr-3 w-[90px]">Section</th>
                    {MAP_WORDS.map(w=><th key={w} className="text-center pb-2 px-2"><span className="text-[9.5px] font-bold text-slate-500">{w}</span></th>)}
                  </tr>
                </thead>
                <tbody>
                  {MAP_SECTIONS.map((sec,si)=>(
                    <tr key={sec} className={si%2===0?"bg-slate-50/40":""}>
                      <td className="py-2 pr-3 text-[11.5px] font-semibold text-slate-600">{sec}</td>
                      {MAP_WORDS.map(w=>{
                        const present = MAP_DATA[w]?.[si]??false;
                        return (
                          <td key={w} className="py-2 px-2 text-center">
                            {present
                              ? <div className="w-5 h-5 rounded-full bg-emerald-100 flex items-center justify-center mx-auto"><Check size={10} className="text-emerald-600"/></div>
                              : <div className="w-5 h-5 rounded-full bg-slate-100 flex items-center justify-center mx-auto"><Minus size={10} className="text-slate-300"/></div>
                            }
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </ActionModalShell>
  );
};

const CoverLetterModal: React.FC<{onClose:()=>void}> = ({onClose}) => {
  const tones = ["Professional","Enthusiastic","Concise"];
  const [tone,setTone] = useState("Professional");
  return (
    <ActionModalShell icon={<Mail size={16}/>} title="Generate Cover Letter" credit={3} iconBg="bg-blue-50 text-blue-600" wide onClose={onClose}
      footer={<><CancelBtn onClose={onClose}/><button className="px-5 py-2 text-[12.5px] font-bold bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors flex items-center gap-2"><Mail size={12}/>Generate Letter</button></>}
    >
      <div className="grid grid-cols-2 gap-4">
        <EditField label="Target Role" placeholder="e.g. Senior Data Engineer"/>
        <EditField label="Company" placeholder="e.g. Databricks"/>
      </div>
      <EditField label="Hiring Manager (optional)" placeholder="e.g. Sarah Chen, Engineering Manager"/>
      <div>
        <span className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">Tone</span>
        <div className="flex gap-2">
          {tones.map(t=>(
            <button key={t} onClick={()=>setTone(t)} className={`text-[12px] font-semibold px-4 py-2 rounded-xl border transition-all ${tone===t?"bg-blue-600 text-white border-blue-600 shadow-sm":"bg-white text-slate-600 border-slate-200 hover:border-blue-300"}`}>{t}</button>
          ))}
        </div>
      </div>
      <EditTextarea label="Job Description" placeholder="Paste JD for a more personalized letter…" rows={4}/>
    </ActionModalShell>
  );
};

const MODALS: Record<string,React.FC<{onClose:()=>void}>> = {
  enhance:AiEnhanceModal, rewrite:FullRewriteModal, tailor:TailorToJobModal,
  skills:InjectSkillsModal, keywords:BulkKeywordModal, ats:AtsScoreModal,
  match:KeywordMatchModal, cover:CoverLetterModal,
};

// ─────────────────────────────────────────────────────────────────────────────
// AI ACTION STRIP
// ─────────────────────────────────────────────────────────────────────────────

const AiActionCard: React.FC<{action:AiAction;onClick:()=>void}> = ({action,onClick}) => (
  <button onClick={onClick} className={`group text-left flex items-start gap-3 p-3.5 rounded-xl border transition-all duration-150 ${action.primary?"bg-white border-slate-200 hover:border-cyan-200 hover:shadow-[0_0_0_4px_rgba(8,145,178,0.06)]":"bg-slate-50/60 border-slate-100 hover:bg-white hover:border-slate-200"}`}>
    <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5 transition-transform group-hover:scale-105 ${action.primary?"bg-cyan-50 text-cyan-700":"bg-slate-100 text-slate-500"}`}>{action.icon}</div>
    <div className="flex-1 min-w-0">
      <div className="flex items-center justify-between gap-1.5">
        <span className="text-[12px] font-semibold text-slate-800 truncate">{action.label}</span>
        <CreditPill credit={action.credit}/>
      </div>
      <p className="mt-0.5 text-[11px] text-slate-500 leading-tight">{action.desc}</p>
    </div>
  </button>
);

const AiActionStrip: React.FC<{open:boolean;onToggle:()=>void;onAction:(id:string)=>void}> = ({open,onToggle,onAction}) => (
  <div className="bg-white border-b border-slate-200 flex-shrink-0">
    <div className="flex items-center gap-2 px-5 py-2.5">
      <div className="flex items-center gap-1.5 flex-shrink-0">
        <Sparkles size={11} className="text-cyan-500"/>
        <span className="text-[9.5px] font-extrabold text-slate-400 uppercase tracking-[0.14em]">AI</span>
      </div>
      <div className="w-px h-3.5 bg-slate-200 flex-shrink-0"/>
      <div className="flex items-center gap-1.5 flex-1 overflow-x-auto no-scrollbar">
        {AI_ACTIONS.filter(a=>a.primary).map(a=>(
          <button key={a.id} onClick={()=>onAction(a.id)}
            className="flex items-center gap-1.5 text-[11.5px] font-semibold text-slate-600 bg-slate-50 border border-slate-200 hover:border-cyan-200 hover:bg-cyan-50 hover:text-cyan-700 px-3 py-1.5 rounded-full whitespace-nowrap transition-all flex-shrink-0"
          >
            <span className="text-slate-400">{a.icon}</span>{a.label}<CreditPill credit={a.credit}/>
          </button>
        ))}
      </div>
      <button onClick={onToggle} className="flex items-center gap-1 text-[11px] font-semibold text-slate-500 hover:text-slate-900 border border-slate-200 hover:border-slate-300 px-3 py-1.5 rounded-full transition-all flex-shrink-0">
        More {open?<ChevronUp size={11}/>:<ChevronDown size={11}/>}
      </button>
    </div>
    {open && (
      <div className="px-5 pb-4 space-y-2 border-t border-slate-100 pt-3">
        <div className="grid grid-cols-4 gap-2">{AI_ACTIONS.filter(a=>a.primary).map(a=><AiActionCard key={a.id} action={a} onClick={()=>onAction(a.id)}/>)}</div>
        <div className="flex items-center gap-3"><div className="h-px flex-1 bg-slate-100"/><span className="text-[9px] font-bold text-slate-300 uppercase tracking-widest">More tools</span><div className="h-px flex-1 bg-slate-100"/></div>
        <div className="grid grid-cols-4 gap-2">{AI_ACTIONS.filter(a=>!a.primary).map(a=><AiActionCard key={a.id} action={a} onClick={()=>onAction(a.id)}/>)}</div>
      </div>
    )}
  </div>
);

// ─────────────────────────────────────────────────────────────────────────────
// SECTION SIDEBAR
// ─────────────────────────────────────────────────────────────────────────────

const SectionNavItem: React.FC<{section:NavSection;active:boolean;onClick:()=>void}> = ({section,active,onClick}) => (
  <button onClick={onClick} className={`w-full group flex items-center gap-2.5 px-2 py-[8px] rounded-xl text-left transition-all border-l-2 ${active?"bg-cyan-50 border-l-cyan-500 pl-[6px]":"border-l-transparent hover:bg-slate-50 pl-2"}`}>
    <span className={`text-[9.5px] font-extrabold tabular-nums w-4 text-right flex-shrink-0 ${active?"text-cyan-500":"text-slate-300 group-hover:text-slate-400"}`}>{String(section.num).padStart(2,"0")}</span>
    <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${STATUS_DOT[section.status]}`}/>
    <span className={`flex-1 text-[12px] truncate ${active?"font-semibold text-cyan-700":"font-medium text-slate-600 group-hover:text-slate-900"}`}>{section.label}</span>
    {section.locked && <Lock size={9} className="text-slate-300 flex-shrink-0"/>}
  </button>
);

const SectionSidebar: React.FC<{active:string;onSelect:(id:string)=>void}> = ({active,onSelect}) => (
  <aside className="w-[196px] flex-shrink-0 bg-white border-r border-slate-200 flex flex-col overflow-hidden">
    <div className="px-4 pt-4 pb-2.5"><span className="text-[9.5px] font-extrabold text-slate-400 uppercase tracking-[0.14em]">Sections</span></div>
    <nav className="flex-1 overflow-y-auto px-2 pb-3 space-y-0.5">
      {NAV_SECTIONS.map(s=><SectionNavItem key={s.id} section={s} active={active===s.id} onClick={()=>onSelect(s.id)}/>)}
      <div className="pt-4 pb-1.5 px-2"><span className="text-[9.5px] font-extrabold text-slate-300 uppercase tracking-[0.14em]">Optional</span></div>
      {["Certifications","Publications"].map(name=>(
        <button key={name} className="w-full flex items-center gap-2 px-2 py-[7px] rounded-xl text-left text-[11.5px] font-medium text-slate-400 hover:text-slate-700 hover:bg-slate-50 transition-all border-l-2 border-l-transparent">
          <Plus size={10} className="flex-shrink-0 ml-4"/>{name}
        </button>
      ))}
    </nav>
  </aside>
);

// ─────────────────────────────────────────────────────────────────────────────
// SECTION CARDS
// ─────────────────────────────────────────────────────────────────────────────

const SectionCardShell: React.FC<{icon:React.ReactNode;title:string;helper:string;status:SectionStatus;onEnhance?:()=>void;children:React.ReactNode}> = ({icon,title,helper,status,onEnhance,children}) => (
  <div className={`bg-white rounded-2xl border border-slate-200 shadow-[0_1px_4px_rgba(0,0,0,0.05)] overflow-hidden border-l-[3px] ${STATUS_BORDER[status]}`}>
    <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-xl bg-slate-100 flex items-center justify-center flex-shrink-0">{icon}</div>
        <div>
          <h2 className="text-[13.5px] font-bold text-slate-900 leading-none">{title}</h2>
          <p className="text-[11px] text-slate-400 mt-0.5">{helper}</p>
        </div>
      </div>
      {onEnhance && (
        <button onClick={onEnhance} className="flex items-center gap-1.5 bg-cyan-600 hover:bg-cyan-700 text-white text-[11.5px] font-semibold px-3 py-1.5 rounded-xl transition-colors shadow-sm flex-shrink-0">
          <Sparkles size={11}/>AI Enhance<span className="bg-cyan-500/40 text-[8.5px] font-bold px-1.5 py-0.5 rounded-full">1cr</span>
        </button>
      )}
    </div>
    <div className="p-5 space-y-4">{children}</div>
  </div>
);

const PersonalInfoCard: React.FC<{showAiBanner?:boolean;onEnhance?:()=>void}> = ({showAiBanner,onEnhance}) => (
  <SectionCardShell icon={<User size={14} className="text-slate-600"/>} title="Personal Info" helper="Identity & contact details" status="full" onEnhance={onEnhance}>
    {showAiBanner && (
      <div className="flex items-center gap-2 bg-cyan-50 border border-cyan-100 rounded-xl px-3.5 py-2.5 text-[11.5px] font-medium text-cyan-700">
        <Sparkles size={11} className="text-cyan-500 flex-shrink-0"/>Section updated by AI
        <button className="ml-auto text-[10.5px] font-semibold text-cyan-500 hover:text-cyan-700 transition-colors">Undo</button>
      </div>
    )}
    <LockedField label="Full Name" value="TUSHAR VAGHELA" helper="Sourced from your verified profile"/>
    <EditField label="Professional Title" value="Azure Data Engineer"/>
    <div className="grid grid-cols-2 gap-4">
      <LockedField label="Email" value="tusharvaghela601@gmail.com"/>
      <EditField label="Phone" value="+91 95873 08671"/>
    </div>
    <EditField label="Location" value="Seattle, WA"/>
    <div>
      <span className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">Links &amp; Profiles</span>
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <select className="text-[12px] font-semibold text-slate-700 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 focus:outline-none focus:border-cyan-400 focus:ring-2 focus:ring-cyan-50 transition-all cursor-pointer flex-shrink-0">
            <option>GitHub</option><option>LinkedIn</option><option>Portfolio</option>
          </select>
          <input type="url" defaultValue="https://github.com/" className="flex-1 bg-white border border-slate-200 rounded-xl px-3.5 py-2.5 text-[13px] text-slate-800 focus:outline-none focus:border-cyan-400 focus:ring-2 focus:ring-cyan-50 hover:border-slate-300 transition-all min-w-0"/>
          <button className="p-2.5 text-slate-400 hover:text-slate-700 bg-white border border-slate-200 hover:border-slate-300 rounded-xl transition-colors flex-shrink-0"><ExternalLink size={12}/></button>
        </div>
        <button className="flex items-center gap-1.5 text-[11.5px] font-medium text-slate-400 hover:text-cyan-600 py-1 transition-colors"><Plus size={12}/>Add link</button>
      </div>
    </div>
  </SectionCardShell>
);

const CollapsedSectionCard: React.FC<{section:NavSection;onClick:()=>void}> = ({section,onClick}) => (
  <button onClick={onClick} className={`w-full bg-white rounded-2xl border border-slate-200 shadow-[0_1px_4px_rgba(0,0,0,0.04)] px-4 py-3.5 text-left hover:border-slate-300 transition-all group border-l-[3px] ${STATUS_BORDER[section.status]}`}>
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2.5">
        <span className="text-slate-400">{section.icon}</span>
        <span className="text-[13px] font-semibold text-slate-700">{section.label}</span>
        <div className={`w-1.5 h-1.5 rounded-full ${STATUS_DOT[section.status]}`}/>
        {section.locked && <Lock size={10} className="text-slate-300"/>}
      </div>
      <ChevronRight size={13} className="text-slate-300 group-hover:text-slate-500 transition-colors"/>
    </div>
  </button>
);

// ─────────────────────────────────────────────────────────────────────────────
// CENTER PANEL
// ─────────────────────────────────────────────────────────────────────────────

const CenterPanel: React.FC<{aiOpen:boolean;onToggleAi:()=>void;onAction:(id:string)=>void;showAiBanner?:boolean;activeSection:string;onSectionSelect:(id:string)=>void}> = ({aiOpen,onToggleAi,onAction,showAiBanner,activeSection,onSectionSelect}) => (
  <main className="flex-1 min-w-0 flex flex-col overflow-hidden bg-[#F6F7F9]">
    <AiActionStrip open={aiOpen} onToggle={onToggleAi} onAction={onAction}/>
    <div className="flex-1 overflow-y-auto p-5 space-y-3">
      {activeSection==="personal" && <PersonalInfoCard showAiBanner={showAiBanner} onEnhance={()=>onAction("enhance")}/>}
      {NAV_SECTIONS.filter(s=>s.id!==activeSection).map(s=><CollapsedSectionCard key={s.id} section={s} onClick={()=>onSectionSelect(s.id)}/>)}
    </div>
  </main>
);

// ─────────────────────────────────────────────────────────────────────────────
// PREVIEW PANEL
// ─────────────────────────────────────────────────────────────────────────────

const DocSkeleton: React.FC = () => {
  const secs = [
    {title:"TECHNICAL SKILLS",  lines:[1,0.88,0.73,0.61]},
    {title:"WORK EXPERIENCE",   lines:[1,0.82,1,0.55,0.9,0.72]},
    {title:"PROJECTS",          lines:[1,0.68,0.79,0.52]},
    {title:"EDUCATION",         lines:[0.72,0.45]},
  ];
  return (
    <div className="p-5 overflow-hidden h-full text-left">
      <div className="text-[8.5px] font-extrabold text-slate-800 tracking-wide">TUSHAR VAGHELA</div>
      <div className="text-[6.5px] text-cyan-600 font-bold mt-0.5">Azure Data Engineer</div>
      <div className="text-[5.5px] text-slate-400 mt-0.5">tusharvaghela601@gmail.com · Seattle, WA · github.com/tushar</div>
      <div className="mt-2.5 h-px bg-slate-100"/>
      {secs.map(s=>(
        <div key={s.title} className="mt-3">
          <div className="text-[5.5px] font-extrabold text-slate-600 tracking-[0.1em] uppercase mb-1.5">{s.title}</div>
          <div className="space-y-[3px]">{s.lines.map((w,i)=><div key={i} className="h-[3.5px] bg-slate-100 rounded-sm" style={{width:`${w*100}%`}}/>)}</div>
        </div>
      ))}
    </div>
  );
};

const PreviewPanel: React.FC = () => (
  <aside className="w-[300px] flex-shrink-0 bg-white border-l border-slate-200 flex flex-col overflow-hidden">
    <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between flex-shrink-0">
      <div className="flex items-center gap-1.5"><Eye size={11} className="text-slate-400"/><span className="text-[9.5px] font-extrabold text-slate-400 uppercase tracking-[0.14em]">Live Preview</span></div>
      <div className="flex items-center">
        <button className="w-7 h-7 flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"><ZoomOut size={11}/></button>
        <span className="text-[11px] font-bold text-slate-600 w-9 text-center tabular-nums">100%</span>
        <button className="w-7 h-7 flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"><ZoomIn size={11}/></button>
        <button className="w-7 h-7 flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors ml-1"><Maximize2 size={10}/></button>
      </div>
    </div>
    <div className="px-3.5 py-2.5 border-b border-slate-100 flex-shrink-0">
      <button className="w-full flex items-center justify-between text-[12px] font-medium text-slate-600 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 hover:border-slate-300 transition-colors">
        <span className="flex items-center gap-2"><LayoutTemplate size={11} className="text-slate-400"/>Minimal</span>
        <ChevronDown size={10} className="text-slate-400"/>
      </button>
    </div>
    <div className="flex-1 overflow-auto p-3 bg-[#ECEEF2]">
      <div className="bg-white w-full rounded-lg shadow-[0_4px_20px_rgba(0,0,0,0.12)] overflow-hidden" style={{aspectRatio:"210/297"}}>
        <DocSkeleton/>
      </div>
    </div>
  </aside>
);

// ─────────────────────────────────────────────────────────────────────────────
// TOP BAR
// ─────────────────────────────────────────────────────────────────────────────

const TopBar: React.FC = () => (
  <header className="h-[52px] bg-white border-b border-slate-200 flex items-center gap-2.5 px-5 flex-shrink-0">
    <button className="flex items-center gap-1.5 text-slate-500 hover:text-slate-900 hover:bg-slate-50 px-2.5 py-1.5 rounded-xl transition-all"><ChevronLeft size={14}/><span className="text-[12.5px] font-medium">Back</span></button>
    <div className="w-px h-4 bg-slate-200 flex-shrink-0"/>
    <div className="flex items-center gap-1.5 min-w-0 group">
      <span className="text-[13px] font-semibold text-slate-900 truncate max-w-[200px]">TUSHAR VAGHELA — Azure</span>
      <button className="flex-shrink-0 text-slate-300 hover:text-slate-600 p-0.5 opacity-0 group-hover:opacity-100 transition-all"><PenLine size={11}/></button>
    </div>
    <div className="flex items-center gap-1.5 flex-shrink-0">
      <div className="w-1.5 h-1.5 rounded-full bg-emerald-400"/><span className="text-[11px] font-medium text-slate-400">Saved</span>
    </div>
    <div className="flex-1"/>
    <button className="flex items-center gap-1.5 text-[11.5px] font-bold text-amber-700 bg-amber-50 border border-amber-200 hover:bg-amber-100 px-3 py-1.5 rounded-full transition-colors flex-shrink-0"><Coins size={12}/>515.5</button>
    <div className="w-px h-4 bg-slate-200 flex-shrink-0"/>
    <button className="flex items-center gap-1.5 text-[12px] font-medium text-slate-600 border border-slate-200 hover:border-slate-300 px-3 py-1.5 rounded-xl transition-colors flex-shrink-0"><LayoutTemplate size={12} className="text-slate-400"/>Minimal<ChevronDown size={10} className="text-slate-400"/></button>
    <button className="w-8 h-8 flex items-center justify-center text-slate-400 hover:text-slate-700 border border-slate-200 hover:border-slate-300 rounded-xl transition-colors flex-shrink-0"><Clock size={13}/></button>
    <div className="w-px h-4 bg-slate-200 flex-shrink-0"/>
    <button className="flex items-center gap-1.5 text-[12px] font-medium text-slate-600 border border-slate-200 hover:border-slate-300 px-3 py-1.5 rounded-xl transition-colors flex-shrink-0"><FileDown size={12}/>PDF</button>
    <button className="flex items-center gap-1.5 text-[12px] font-bold bg-slate-900 text-white hover:bg-slate-800 px-4 py-1.5 rounded-xl transition-colors flex-shrink-0"><Save size={11}/>Save</button>
  </header>
);

// ─────────────────────────────────────────────────────────────────────────────
// BOTTOM TAB BAR
// ─────────────────────────────────────────────────────────────────────────────

const TABS = [
  {id:"editor", label:"Editor",       icon:<PenLine size={11}/>                    },
  {id:"ats",    label:"ATS Score",    icon:<BarChart2 size={11}/>, chip:true        },
  {id:"tailor", label:"JD Tailor",    icon:<Target size={11}/>                     },
  {id:"cover",  label:"Cover Letter", icon:<Mail size={11}/>                       },
];

const BottomTabBar: React.FC<{active:string;onChange:(id:string)=>void}> = ({active,onChange}) => (
  <footer className="h-[44px] bg-white border-t border-slate-200 flex items-center px-5 gap-1 flex-shrink-0">
    {TABS.map(tab=>{
      const isActive = active===tab.id;
      return (
        <button key={tab.id} onClick={()=>onChange(tab.id)} className={`flex items-center gap-2 px-4 py-1.5 rounded-xl text-[12px] font-medium transition-all ${isActive?"bg-slate-900 text-white":"text-slate-500 hover:text-slate-900 hover:bg-slate-100"}`}>
          <span className={isActive?"text-white":"text-slate-400"}>{tab.icon}</span>
          {tab.label}
          {tab.chip && <CreditPill credit="FREE" inverted={isActive}/>}
        </button>
      );
    })}
  </footer>
);

// ─────────────────────────────────────────────────────────────────────────────
// ROOT
// ─────────────────────────────────────────────────────────────────────────────

export default function ResumeEditorV2() {
  const [activeSection, setActiveSection] = useState("personal");
  const [activeTab,     setActiveTab]     = useState("editor");
  const [aiOpen,        setAiOpen]        = useState(false);
  const [activeModal,   setActiveModal]   = useState<ModalId>(null);
  const showAiBanner = false; // set true to preview AI-updated banner state

  const openModal  = (id:string) => setActiveModal(id as ModalId);
  const closeModal = () => setActiveModal(null);
  const ModalComponent = activeModal ? MODALS[activeModal] : null;

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500;9..40,600;9..40,700;9..40,800&display=swap');
        .sse-v2, .sse-v2 * { font-family: 'DM Sans', sans-serif; box-sizing: border-box; }
        .no-scrollbar::-webkit-scrollbar { display: none; }
        .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
      `}</style>

      <div className="sse-v2 h-screen flex flex-col bg-[#F6F7F9] overflow-hidden">
        <TopBar/>
        <div className="flex-1 flex overflow-hidden">
          <SectionSidebar active={activeSection} onSelect={setActiveSection}/>
          <CenterPanel
            aiOpen={aiOpen} onToggleAi={()=>setAiOpen(v=>!v)}
            onAction={openModal} showAiBanner={showAiBanner}
            activeSection={activeSection} onSectionSelect={setActiveSection}
          />
          <PreviewPanel/>
        </div>
        <BottomTabBar active={activeTab} onChange={setActiveTab}/>
      </div>

      {ModalComponent && <ModalComponent onClose={closeModal}/>}
    </>
  );
}
