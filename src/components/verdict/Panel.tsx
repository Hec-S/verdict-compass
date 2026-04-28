import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

interface Props {
  icon: ReactNode;
  title: string;
  subtitle?: string;
  count?: number;
  defaultOpen?: boolean;
  children: ReactNode;
  accent?: "gold" | "success" | "destructive" | "warning";
}

const accentMap = {
  gold: "text-gold",
  success: "text-success",
  destructive: "text-destructive",
  warning: "text-warning",
};

export function Panel({ icon, title, subtitle, count, defaultOpen = true, children, accent = "gold" }: Props) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="rounded-xl border border-border bg-card/60 backdrop-blur-sm overflow-hidden shadow-elegant">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-4 px-6 py-5 hover:bg-secondary/40 transition text-left"
      >
        <div className={`w-10 h-10 rounded-lg bg-secondary flex items-center justify-center ${accentMap[accent]}`}>
          {icon}
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="font-serif text-2xl flex items-center gap-3">
            {title}
            {typeof count === "number" && (
              <span className="text-xs font-sans px-2 py-0.5 rounded-full bg-secondary text-muted-foreground">
                {count}
              </span>
            )}
          </h2>
          {subtitle && <p className="text-sm text-muted-foreground mt-0.5">{subtitle}</p>}
        </div>
        <ChevronDown className={`w-5 h-5 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && <div className="px-6 pb-6 pt-1 border-t border-border/50">{children}</div>}
    </section>
  );
}

export function Cite({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-mono bg-secondary text-muted-foreground border border-border">
      {children}
    </span>
  );
}

export function CategoryTag({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] uppercase tracking-wider font-semibold bg-gold/10 text-gold border border-gold/30">
      {children}
    </span>
  );
}