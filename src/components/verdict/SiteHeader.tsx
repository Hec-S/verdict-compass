import { Logo } from "./Logo";

export function SiteHeader({ right }: { right?: React.ReactNode }) {
  return (
    <header className="sticky top-0 z-40 bg-background border-b border-border">
      <div className="max-w-[880px] mx-auto px-8 h-12 flex items-center justify-between">
        <Logo />
        <div className="flex items-center gap-2">{right}</div>
      </div>
    </header>
  );
}
