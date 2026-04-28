import { useCallback, useRef, useState } from "react";
import { Upload, FileText, X } from "lucide-react";

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
      const arr = Array.from(incoming).filter((f) =>
        f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf"),
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
    <div className="space-y-4">
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
          "relative cursor-pointer rounded-xl border-2 border-dashed p-12 text-center transition",
          drag ? "border-gold bg-gold/5 shadow-gold" : "border-border hover:border-gold/60 hover:bg-secondary/40",
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
        <div className="mx-auto w-14 h-14 rounded-full bg-gold/10 border border-gold/30 flex items-center justify-center mb-4">
          <Upload className="w-6 h-6 text-gold" />
        </div>
        <p className="font-serif text-2xl mb-1">Drop transcript PDFs here</p>
        <p className="text-sm text-muted-foreground">
          Or click to browse. Multiple volumes supported (Vol. 1, Vol. 2…).
        </p>
      </div>

      {files.length > 0 && (
        <ul className="space-y-2">
          {files.map((f, i) => (
            <li
              key={f.name + i}
              className="flex items-center gap-3 px-4 py-3 rounded-lg bg-secondary/60 border border-border"
            >
              <FileText className="w-4 h-4 text-gold flex-shrink-0" />
              <span className="flex-1 text-sm truncate">{f.name}</span>
              <span className="text-xs text-muted-foreground">
                {(f.size / 1024 / 1024).toFixed(2)} MB
              </span>
              <button
                type="button"
                onClick={() => onFiles(files.filter((_, j) => j !== i))}
                disabled={disabled}
                className="text-muted-foreground hover:text-destructive transition disabled:opacity-30"
                aria-label="Remove"
              >
                <X className="w-4 h-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}