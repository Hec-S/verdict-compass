import { useCallback, useRef, useState } from "react";
import { X } from "lucide-react";

interface Props {
  files: File[];
  onFiles: (f: File[]) => void;
  disabled?: boolean;
}

export function UploadZone({ files, onFiles, disabled }: Props) {
  const [drag, setDrag] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const accept = useCallback(
    (incoming: FileList | File[]) => {
      const arr = Array.from(incoming).filter(
        (f) => f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf"),
      );
      if (!arr.length) return;
      const merged = [...files];
      for (const f of arr) {
        if (!merged.find((m) => m.name === f.name && m.size === f.size)) merged.push(f);
      }
      onFiles(merged);
    },
    [files, onFiles],
  );

  return (
    <div className="space-y-3">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          if (!disabled) accept(e.dataTransfer.files);
        }}
        onClick={() => !disabled && inputRef.current?.click()}
        className={[
          "relative cursor-pointer border border-dashed px-6 py-10 text-center transition-colors",
          drag ? "border-foreground bg-foreground/[0.03]" : "border-border hover:border-foreground/60",
          disabled ? "opacity-60 cursor-not-allowed" : "",
        ].join(" ")}
      >
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,.pdf"
          multiple
          className="hidden"
          onChange={(e) => e.target.files && accept(e.target.files)}
        />
        <p className="text-[14px] text-foreground">Drop transcript PDFs here</p>
        <p className="text-[12px] text-muted-foreground mt-1">
          Or click to browse. Multiple volumes supported.
        </p>
      </div>

      {files.length > 0 && (
        <ul className="border-t border-border">
          {files.map((f, i) => (
            <li
              key={f.name + i}
              className="flex items-center gap-3 py-2.5 border-b border-border"
            >
              <span className="flex-1 text-[13px] text-foreground truncate">{f.name}</span>
              <span className="text-[12px] text-muted-foreground tabular-nums">
                {(f.size / 1024 / 1024).toFixed(2)} MB
              </span>
              <button
                type="button"
                onClick={() => onFiles(files.filter((_, j) => j !== i))}
                disabled={disabled}
                className="text-muted-foreground hover:text-foreground transition-colors disabled:opacity-30"
                aria-label="Remove"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
