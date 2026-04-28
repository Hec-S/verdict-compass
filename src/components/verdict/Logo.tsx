import { Link } from "@tanstack/react-router";
import { Scale } from "lucide-react";

export function Logo({ className = "" }: { className?: string }) {
  return (
    <Link to="/" className={`inline-flex items-center gap-2.5 group ${className}`}>
      <div className="relative">
        <div className="absolute inset-0 rounded-md bg-gradient-gold blur-md opacity-40 group-hover:opacity-60 transition" />
        <div className="relative w-9 h-9 rounded-md bg-gradient-gold flex items-center justify-center text-navy-deep">
          <Scale className="w-5 h-5" strokeWidth={2.2} />
        </div>
      </div>
      <div className="flex flex-col leading-none">
        <span className="font-serif text-xl tracking-tight">
          Verdict<span className="text-gold">IQ</span>
        </span>
        <span className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground mt-0.5">
          Trial Intelligence
        </span>
      </div>
    </Link>
  );
}