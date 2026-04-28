import { Logo } from "./Logo";

export function SiteHeader({ right }: { right?: React.ReactNode }) {
  return (
    <header className="sticky top-0 z-40 border-b border-border/50 backdrop-blur-xl bg-background/70">
      <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
        <Logo />
        <div className="flex items-center gap-3">{right}</div>
      </div>
    </header>
  );
}