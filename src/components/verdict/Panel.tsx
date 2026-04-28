import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

interface Props {
  title: string;
  count?: number;
  defaultOpen?: boolean;
  children: ReactNode;
  missing?: boolean;
}

export function Panel({ title, count, defaultOpen = false, children, missing = false }: Props) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="border-b border-border">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full h-12 flex items-center gap-3 text-left hover:bg-foreground/[0.03] transition-colors px-1"
      >
        <h2 className="flex-1 text-[14px] font-medium text-foreground">{title}</h2>
        {typeof count === "number" && (
          <span className="text-[12px] text-muted-foreground tabular-nums">{count}</span>
        )}
        <ChevronDown
          className={`w-3.5 h-3.5 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <div className="pb-6 pt-1 px-1">
          {missing ? (
            <p className="text-[13px] text-muted-foreground py-2">No items.</p>
          ) : (
            children
          )}
        </div>
      )}
    </section>
  );
}

export function Cite({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center font-mono text-[11px] text-muted-foreground ml-2">
      {children}
    </span>
  );
}

export function CategoryTag({ children }: { children: ReactNode }) {
  return (
    <span className="text-[11px] text-muted-foreground">{children}</span>
  );
}
