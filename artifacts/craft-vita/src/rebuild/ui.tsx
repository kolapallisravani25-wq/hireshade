export function joinClasses(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

export function RebuildCard({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={joinClasses("rounded-[1.7rem] border border-slate-200 bg-white p-5 shadow-sm", className)}>{children}</div>;
}

export function RebuildHeader({ title, subtitle, action }: { title: string; subtitle: string; action?: React.ReactNode }) {
  return (
    <div className="mb-7 flex flex-col justify-between gap-4 rounded-[2rem] border border-white bg-white/80 p-6 shadow-xl shadow-slate-200/70 backdrop-blur md:flex-row md:items-center">
      <div>
        <p className="mb-2 text-xs font-black uppercase tracking-[0.25em] text-blue-600">HireShade</p>
        <h1 className="text-3xl font-black tracking-tight text-slate-950">{title}</h1>
        <p className="mt-2 max-w-2xl text-sm font-medium leading-6 text-slate-500">{subtitle}</p>
      </div>
      {action}
    </div>
  );
}

export function RebuildEmpty({ text }: { text: string }) {
  return <div className="rounded-3xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-sm font-semibold text-slate-500">{text}</div>;
}

export function formatDisplayDate(value?: string | null) {
  if (!value) return "—";
  try {
    return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
  } catch {
    return "—";
  }
}
