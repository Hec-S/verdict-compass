import { Link } from "@tanstack/react-router";

export function Logo({ className = "" }: { className?: string }) {
  return (
    <Link
      to="/"
      className={`inline-flex items-center text-foreground hover:opacity-80 transition-opacity ${className}`}
    >
      <span className="text-[16px] font-medium tracking-[-0.01em]">VerdictIQ</span>
    </Link>
  );
}
