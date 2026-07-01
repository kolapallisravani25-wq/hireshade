import React, { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sparkles,
  Layers,
  Activity,
  CheckCircle2,
  Download,
  Layout,
  Target,
  Clock,
  Users,
  Globe,
  Zap,
  Network,
  Puzzle,
  Database,
  Code2,
  Server,
  GitBranch,
  MonitorCheck,
  AlertCircle,
  TrendingUp,
  Shield,
  Brain,
  ChevronRight,
  Flame,
  MessageSquare
} from "lucide-react";
import { cn } from "@/lib/utils";

// Highly flexible extraction utility
const safeGet = (obj: any, path: string[], defaultValue: any = undefined) => {
  if (!obj) return defaultValue;
  let current = obj;
  for (const key of path) {
    if (current === null || current === undefined) return defaultValue;
    current = current[key];
  }
  return current !== undefined ? current : defaultValue;
};

export function ProjectDetailsView({ projects }: { projects: any[] }) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [activeTab, setActiveTab] = useState("strategy");

  // Robustly extract the projects array
  const safeProjects = Array.isArray(projects) ? projects : [];
  
  if (safeProjects.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-40 text-center bg-card rounded-[48px] border border-dashed border-border/60">
        <Sparkles className="h-24 w-24 text-primary/20 mb-8 animate-pulse" />
        <h3 className="text-4xl font-black text-slate-900 tracking-tighter">No Projects Found</h3>
        <p className="text-slate-500 mt-2 max-w-sm font-medium">We couldn't detect any valid project data. The AI might still be generating or the data format is unrecognized.</p>
        <div className="mt-8 p-6 bg-slate-100 rounded-xl text-left overflow-auto max-w-2xl max-h-64">
           <p className="text-xs font-mono text-slate-500">Raw Input: {JSON.stringify(projects, null, 2)}</p>
        </div>
      </div>
    );
  }

  // Attempt to unwrap if the data is deeply nested (e.g., project.projects or similar)
  let activeProject = safeProjects[activeIndex] || {};
  if (activeProject.projects && Array.isArray(activeProject.projects) && activeProject.projects.length > 0) {
     activeProject = activeProject.projects[0];
  }

  // Defensively extract fields
  const title = safeGet(activeProject, ["projectHeader", "title"]) || activeProject.title || `System Model 0${activeIndex + 1}`;
  const tagline = safeGet(activeProject, ["projectHeader", "tagline"]) || activeProject.tagline || activeProject.description || "High-performance technical implementation.";
  const domain = safeGet(activeProject, ["projectHeader", "domain"]) || activeProject.domain || "Software Engineering";
  const duration = safeGet(activeProject, ["projectHeader", "duration"]) || activeProject.duration || "N/A";
  const teamSize = safeGet(activeProject, ["projectHeader", "teamSize"]) || activeProject.teamSize || "Solo";

  const summary = safeGet(activeProject, ["introduction", "summary"]) || activeProject.summary;
  const context = safeGet(activeProject, ["introduction", "context"]) || activeProject.context;
  const elevatorPitch = safeGet(activeProject, ["howToExplain", "elevatorPitch"]) || "N/A";
  const detailedExplanation = safeGet(activeProject, ["howToExplain", "detailedExplanation"]) || "N/A";
  const problemStatement = safeGet(activeProject, ["businessPurpose", "problemStatement"]) || "N/A";
  const successCriteria = safeGet(activeProject, ["businessPurpose", "successCriteria"]) || "N/A";

  const architectureOverview = safeGet(activeProject, ["architecture", "overview"]) || "A robust, scalable system architecture.";
  const architectureComponents = safeGet(activeProject, ["architecture", "components"], []);
  
  const dbSchema = safeGet(activeProject, ["databaseSchema"], []);
  const codeSnippets = safeGet(activeProject, ["codeSnippets"], []);
  const infrastructure = safeGet(activeProject, ["clusterAndNodes", "infrastructure"]) || "Cloud-native infrastructure.";
  const infraDetails = safeGet(activeProject, ["clusterAndNodes", "details"], []);
  const ciCdPipeline = safeGet(activeProject, ["ciCdPipeline"], []);
  const achievements = safeGet(activeProject, ["keyAchievements"], []);
  const resolutions = safeGet(activeProject, ["challengesAndResolutions"], []);
  const learnings = safeGet(activeProject, ["technicalLearnings"], []);

  const resumePoints = activeProject.resumeReadyPoints || activeProject.points || [];

  const tabs = [
    { id: "strategy", label: "Strategic Context", icon: Target },
    { id: "architecture", label: "Architecture", icon: Layers },
    { id: "ops", label: "DevOps & Cloud", icon: Activity },
    { id: "results", label: "Outcomes", icon: CheckCircle2 },
  ];

  return (
    <div className="space-y-12 min-h-screen pb-20 animate-in fade-in duration-1000">
      
      {/* ── Header ── */}
      <div className="flex flex-col md:flex-row items-center justify-between gap-8 p-8 bg-slate-950 rounded-[40px] shadow-2xl overflow-hidden relative">
        <div className="absolute top-0 left-0 w-full h-full bg-gradient-to-br from-indigo-500/10 to-purple-500/10 z-0"></div>
        <div className="relative z-10 flex items-center gap-6">
          <div className="h-20 w-20 rounded-[28px] bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white shadow-xl shadow-indigo-500/30 border border-white/10">
            <Layout className="h-10 w-10 text-white" />
          </div>
          <div>
            <h1 className="text-4xl font-black tracking-tighter text-white leading-none mb-3 uppercase">AI Project Studio</h1>
            <div className="flex items-center gap-3">
              <Badge className="bg-emerald-500/20 text-emerald-400 border-none font-black text-[10px] px-3">ACTIVE MODEL</Badge>
              <span className="text-[10px] font-bold text-slate-400 tracking-widest uppercase">System Ready</span>
            </div>
          </div>
        </div>

        <Button
          className="relative z-10 h-14 px-8 rounded-2xl bg-white/10 hover:bg-white/20 text-white font-black text-xs tracking-[0.15em] gap-3 backdrop-blur-md border border-white/10 transition-all"
        >
          <Download className="h-4 w-4" />
          EXPORT PDF
        </Button>
      </div>

      {/* ── Project Selection ── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {safeProjects.map((p, i) => {
          const pTitle = safeGet(p, ["projectHeader", "title"]) || p.title || `System ${i + 1}`;
          const pTagline = safeGet(p, ["projectHeader", "tagline"]) || p.tagline || p.description || "Engineering Project";
          const pDomain = safeGet(p, ["projectHeader", "domain"]) || p.domain || "Software";

          return (
            <button
              key={i}
              onClick={() => setActiveIndex(i)}
              className={cn(
                "p-8 rounded-[32px] transition-all border-2 text-left group relative overflow-hidden",
                i === activeIndex
                  ? "bg-slate-900 text-white border-slate-900 shadow-xl shadow-indigo-500/10"
                  : "bg-white text-slate-400 hover:bg-slate-50 border-slate-100 hover:border-slate-300 hover:shadow-md"
              )}
            >
              <span className={cn(
                "text-[10px] font-black uppercase tracking-[0.3em] mb-4 block",
                i === activeIndex ? "text-indigo-400" : "text-slate-300"
              )}>
                {pDomain}
              </span>
              <h3 className="text-xl font-black tracking-tighter leading-tight relative z-10 mb-2 truncate">
                {pTitle}
              </h3>
              <p className={cn("text-xs font-bold line-clamp-2 opacity-60", i === activeIndex ? "text-slate-300" : "text-slate-400")}>
                {pTagline}
              </p>
            </button>
          );
        })}
      </div>

      {/* ── Main Container ── */}
      <div className="max-w-7xl mx-auto w-full bg-white border border-slate-200/60 rounded-[48px] shadow-2xl shadow-slate-200/50 overflow-hidden">
        
        {/* Hero Section */}
        <div className="p-10 md:p-16 bg-slate-50 border-b border-slate-100 flex flex-col md:flex-row gap-12">
           <div className="flex-1 space-y-8">
              <Badge className="bg-indigo-100 text-indigo-700 border-none font-black text-[10px] tracking-widest px-4 py-1.5 uppercase">
                {domain}
              </Badge>
              <div className="space-y-4">
                <h1 className="text-5xl md:text-7xl font-black tracking-tighter text-slate-900 leading-[0.85]">
                  {title}
                </h1>
                <p className="text-xl font-bold text-slate-500 max-w-2xl leading-relaxed">
                  {tagline}
                </p>
              </div>
              <div className="flex flex-wrap gap-4 pt-2">
                {[
                  { icon: Clock, label: "Duration", value: duration },
                  { icon: Users, label: "Team", value: teamSize },
                ].map((stat, i) => (
                  <div key={i} className="flex items-center gap-3 px-5 py-2.5 bg-white border border-slate-200 rounded-2xl shadow-sm">
                    <stat.icon className="h-4 w-4 text-indigo-500" />
                    <div>
                      <p className="text-[8px] font-black uppercase text-slate-400 tracking-widest">{stat.label}</p>
                      <p className="text-xs font-black text-slate-900">{stat.value}</p>
                    </div>
                  </div>
                ))}
              </div>
           </div>
           
           {Array.isArray(resumePoints) && resumePoints.length > 0 && (
             <div className="w-full md:w-[400px] space-y-4">
                <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-indigo-500 flex items-center gap-2">
                  <Zap className="h-3 w-3" /> Resume Highlights
                </h4>
                <div className="space-y-3">
                  {resumePoints.slice(0, 4).map((point: string, i: number) => (
                    <div key={i} className="p-4 rounded-2xl bg-white border border-slate-200 text-xs font-bold text-slate-700 shadow-sm leading-relaxed">
                       {point}
                    </div>
                  ))}
                </div>
             </div>
           )}
        </div>

        {/* Navigation Tabs */}
        <div className="px-10 md:px-16 py-4 border-b border-slate-100 bg-white sticky top-0 z-30 flex gap-2 overflow-x-auto no-scrollbar">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "whitespace-nowrap px-6 py-3 rounded-2xl text-[11px] font-black uppercase tracking-widest transition-all flex items-center gap-3 border",
                activeTab === tab.id 
                  ? "bg-slate-900 text-white border-slate-900 shadow-xl shadow-slate-900/10" 
                  : "bg-white text-slate-400 border-transparent hover:bg-slate-50 hover:text-slate-900 hover:border-slate-200"
              )}
            >
              <tab.icon className="h-4 w-4" />
              {tab.label}
            </button>
          ))}
        </div>

        {/* Content Body */}
        <div className="p-10 md:p-16 bg-white min-h-[500px]">
          
          {/* STRATEGY TAB */}
          {activeTab === "strategy" && (
            <div className="space-y-16 animate-in slide-in-from-bottom-8 duration-700">
              {summary && (
                <div className="p-8 md:p-12 rounded-[40px] bg-gradient-to-br from-indigo-500/5 to-purple-500/5 border border-indigo-500/10">
                   <h2 className="text-sm font-black uppercase tracking-[0.2em] text-indigo-600 mb-6">Executive Summary</h2>
                   <p className="text-2xl font-bold text-slate-800 leading-snug">{summary}</p>
                </div>
              )}
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                 <div className="p-8 rounded-[32px] border border-slate-100 bg-slate-50 space-y-6">
                    <div className="flex items-center gap-3">
                       <div className="h-10 w-10 rounded-xl bg-white flex items-center justify-center text-slate-900 shadow-sm">
                          <MessageSquare className="h-5 w-5" />
                       </div>
                       <h3 className="text-lg font-black text-slate-900">Elevator Pitch</h3>
                    </div>
                    <p className="text-sm font-bold text-slate-600 leading-relaxed italic border-l-4 border-indigo-200 pl-4">"{elevatorPitch}"</p>
                    <div className="space-y-2 mt-4">
                       <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Detailed Explanation</h4>
                       <p className="text-xs font-medium text-slate-500 leading-relaxed">{detailedExplanation}</p>
                    </div>
                 </div>

                 <div className="p-8 rounded-[32px] border border-slate-100 bg-slate-900 text-white space-y-6">
                    <div className="flex items-center gap-3">
                       <div className="h-10 w-10 rounded-xl bg-white/10 flex items-center justify-center text-indigo-400">
                          <Flame className="h-5 w-5" />
                       </div>
                       <h3 className="text-lg font-black text-white">Business Purpose</h3>
                    </div>
                    <div className="space-y-4">
                       <div>
                         <h4 className="text-[10px] font-black text-indigo-400 uppercase tracking-widest mb-1">Problem</h4>
                         <p className="text-sm font-bold text-slate-300 leading-relaxed">{problemStatement}</p>
                       </div>
                       <div>
                         <h4 className="text-[10px] font-black text-indigo-400 uppercase tracking-widest mb-1">Success Criteria</h4>
                         <p className="text-sm font-bold text-slate-300 leading-relaxed">{successCriteria}</p>
                       </div>
                    </div>
                 </div>
              </div>
            </div>
          )}

          {/* ARCHITECTURE TAB */}
          {activeTab === "architecture" && (
            <div className="space-y-16 animate-in slide-in-from-bottom-8 duration-700">
              <div className="space-y-6">
                 <h2 className="text-sm font-black uppercase tracking-[0.2em] text-slate-400 flex items-center gap-3">
                   <Network className="h-4 w-4 text-indigo-500" /> Architecture Overview
                 </h2>
                 <p className="text-lg font-bold text-slate-700 leading-relaxed max-w-4xl">{architectureOverview}</p>
              </div>

              {Array.isArray(architectureComponents) && architectureComponents.length > 0 && (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                   {architectureComponents.map((comp: any, i: number) => (
                     <div key={i} className="p-8 rounded-[32px] border border-slate-100 bg-white hover:shadow-xl transition-shadow group">
                        <div className="h-12 w-12 rounded-2xl bg-slate-50 flex items-center justify-center text-slate-400 mb-6 group-hover:bg-indigo-50 group-hover:text-indigo-600 transition-colors">
                           <Puzzle className="h-6 w-6" />
                        </div>
                        <h3 className="text-xl font-black text-slate-900 mb-3">{comp.name || "Component"}</h3>
                        <p className="text-xs font-bold text-slate-500 leading-relaxed mb-6">{comp.description}</p>
                        <div className="flex flex-wrap gap-2">
                           {Array.isArray(comp.tech) && comp.tech.map((t: string, idx: number) => (
                             <Badge key={idx} variant="secondary" className="bg-slate-100 hover:bg-slate-200 text-slate-600 text-[9px]">{t}</Badge>
                           ))}
                        </div>
                     </div>
                   ))}
                </div>
              )}

              {Array.isArray(dbSchema) && dbSchema.length > 0 && (
                <div className="space-y-6">
                  <h2 className="text-sm font-black uppercase tracking-[0.2em] text-slate-400 flex items-center gap-3">
                    <Database className="h-4 w-4 text-indigo-500" /> Database Schema
                  </h2>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                     {dbSchema.map((db: any, i: number) => (
                       <div key={i} className="p-6 rounded-[24px] border border-slate-100 bg-slate-50 flex flex-col gap-4">
                          <div className="flex justify-between items-center">
                             <h4 className="text-lg font-black text-slate-900">{db.table}</h4>
                             <Badge className="bg-slate-200 text-slate-600 hover:bg-slate-200 text-[9px]">TABLE</Badge>
                          </div>
                          <p className="text-xs font-bold text-slate-500">{db.description}</p>
                          <div className="flex flex-wrap gap-2">
                             {Array.isArray(db.fields) && db.fields.map((f: string, idx: number) => (
                               <Badge key={idx} variant="outline" className="border-slate-200 text-slate-600 text-[9px] bg-white">{f}</Badge>
                             ))}
                          </div>
                       </div>
                     ))}
                  </div>
                </div>
              )}

              {Array.isArray(codeSnippets) && codeSnippets.length > 0 && (
                <div className="space-y-6">
                   <h2 className="text-sm font-black uppercase tracking-[0.2em] text-slate-400 flex items-center gap-3">
                    <Code2 className="h-4 w-4 text-indigo-500" /> Reference Implementation
                  </h2>
                  {codeSnippets.map((snippet: any, i: number) => (
                     <div key={i} className="rounded-[32px] bg-[#0D1117] overflow-hidden border border-slate-800">
                        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between">
                           <span className="text-sm font-black text-slate-300">{snippet.title}</span>
                           <span className="text-[10px] font-bold text-slate-500 uppercase">{snippet.purpose}</span>
                        </div>
                        <div className="p-6 overflow-x-auto">
                           <pre className="text-[13px] font-mono text-indigo-300 leading-relaxed">
                             <code>{snippet.code}</code>
                           </pre>
                        </div>
                     </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* DEVOPS TAB */}
          {activeTab === "ops" && (
            <div className="space-y-16 animate-in slide-in-from-bottom-8 duration-700">
               <div className="p-10 rounded-[40px] bg-slate-900 text-white flex flex-col md:flex-row gap-12 items-center">
                  <div className="h-24 w-24 rounded-[32px] bg-white/10 flex items-center justify-center text-indigo-400 shrink-0">
                     <Server className="h-10 w-10" />
                  </div>
                  <div>
                     <h4 className="text-[10px] font-black text-indigo-400 uppercase tracking-widest mb-3">Infrastructure Overview</h4>
                     <p className="text-2xl font-black text-white leading-snug">{infrastructure}</p>
                  </div>
               </div>

               {Array.isArray(infraDetails) && infraDetails.length > 0 && (
                 <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {infraDetails.map((detail: any, i: number) => (
                      <div key={i} className="p-6 rounded-[24px] border border-slate-100 bg-white flex items-center gap-6">
                         <div className="h-12 w-12 rounded-full bg-slate-50 flex items-center justify-center text-slate-400">
                            <Activity className="h-5 w-5" />
                         </div>
                         <div>
                            <h5 className="text-sm font-black text-slate-900 mb-1">{detail.component}</h5>
                            <p className="text-xs font-bold text-slate-500">{detail.configuration}</p>
                         </div>
                      </div>
                    ))}
                 </div>
               )}

               {Array.isArray(ciCdPipeline) && ciCdPipeline.length > 0 && (
                 <div className="space-y-8">
                    <h2 className="text-sm font-black uppercase tracking-[0.2em] text-slate-400 flex items-center gap-3">
                      <GitBranch className="h-4 w-4 text-indigo-500" /> CI/CD Pipeline
                    </h2>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                       {ciCdPipeline.map((pipe: any, i: number) => (
                         <div key={i} className="p-8 rounded-[32px] border border-slate-100 bg-slate-50 relative group">
                            <div className="h-8 w-8 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center font-black text-xs mb-6">
                               {i + 1}
                            </div>
                            <h4 className="text-lg font-black text-slate-900 mb-3">{pipe.stage}</h4>
                            <p className="text-xs font-bold text-slate-500 mb-6">{pipe.description}</p>
                            <div className="flex flex-wrap gap-2">
                               {Array.isArray(pipe.tools) && pipe.tools.map((t: string, idx: number) => (
                                 <Badge key={idx} variant="outline" className="text-[9px] bg-white">{t}</Badge>
                               ))}
                            </div>
                         </div>
                       ))}
                    </div>
                 </div>
               )}
            </div>
          )}

          {/* RESULTS TAB */}
          {activeTab === "results" && (
            <div className="space-y-16 animate-in slide-in-from-bottom-8 duration-700">
               {Array.isArray(achievements) && achievements.length > 0 && (
                 <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {achievements.map((ach: any, i: number) => (
                      <div key={i} className="p-8 rounded-[32px] border border-emerald-100 bg-gradient-to-br from-emerald-50 to-white">
                         <div className="h-10 w-10 rounded-xl bg-emerald-100 text-emerald-600 flex items-center justify-center mb-6">
                            <TrendingUp className="h-5 w-5" />
                         </div>
                         <h4 className="text-3xl font-black text-emerald-600 mb-2">{ach.value}</h4>
                         <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-4">{ach.metric}</p>
                         <p className="text-xs font-bold text-slate-600">{ach.description}</p>
                      </div>
                    ))}
                 </div>
               )}

               {Array.isArray(resolutions) && resolutions.length > 0 && (
                 <div className="space-y-6">
                    <h2 className="text-sm font-black uppercase tracking-[0.2em] text-slate-400 flex items-center gap-3">
                      <Shield className="h-4 w-4 text-indigo-500" /> Resilience & Challenges
                    </h2>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                       {resolutions.map((res: any, i: number) => (
                         <div key={i} className="p-8 rounded-[32px] border border-slate-100 bg-white">
                            <div className="flex items-center gap-2 text-rose-500 mb-3">
                               <AlertCircle className="h-4 w-4" />
                               <span className="text-[10px] font-black uppercase tracking-widest">Challenge</span>
                            </div>
                            <p className="text-sm font-bold text-slate-900 mb-6 italic">"{res.challenge}"</p>
                            
                            <div className="flex items-center gap-2 text-emerald-500 mb-2">
                               <CheckCircle2 className="h-4 w-4" />
                               <span className="text-[10px] font-black uppercase tracking-widest">Resolution</span>
                            </div>
                            <p className="text-xs font-bold text-slate-600 leading-relaxed">{res.solution}</p>
                         </div>
                       ))}
                    </div>
                 </div>
               )}

               {Array.isArray(learnings) && learnings.length > 0 && (
                 <div className="p-10 rounded-[40px] bg-slate-900 text-white">
                    <h2 className="text-sm font-black uppercase tracking-[0.2em] text-indigo-400 mb-8 flex items-center gap-3">
                      <Brain className="h-4 w-4" /> Technical Learnings
                    </h2>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                       {learnings.map((learn: string, i: number) => (
                         <div key={i} className="flex gap-4 items-start">
                            <div className="h-6 w-6 rounded-full bg-indigo-500/20 text-indigo-400 flex items-center justify-center shrink-0 font-black text-[10px]">
                               {i + 1}
                            </div>
                            <p className="text-sm font-medium text-slate-300 pt-0.5 leading-relaxed">{learn}</p>
                         </div>
                       ))}
                    </div>
                 </div>
               )}
            </div>
          )}

        </div>

        {/* Footer */}
        <div className="p-8 border-t border-slate-100 bg-slate-50 flex items-center justify-center">
           <p className="text-[10px] font-black text-slate-400 tracking-[0.4em] uppercase text-center">
             GENERATED BY HIRESHADE AI SYSTEM • {new Date().getFullYear()}
           </p>
        </div>
      </div>
    </div>
  );
}
