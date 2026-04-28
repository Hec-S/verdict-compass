import type { StoredCase } from "./analysis-types";

const KEY = "verdictiq:cases:v1";

function read(): Record<string, StoredCase> {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(KEY) || "{}");
  } catch {
    return {};
  }
}

function write(map: Record<string, StoredCase>) {
  localStorage.setItem(KEY, JSON.stringify(map));
}

export function saveCase(c: StoredCase) {
  const map = read();
  map[c.id] = c;
  write(map);
}

export function getCase(id: string): StoredCase | null {
  return read()[id] ?? null;
}

export function listCases(): StoredCase[] {
  return Object.values(read()).sort((a, b) => b.createdAt - a.createdAt);
}

export function deleteCase(id: string) {
  const map = read();
  delete map[id];
  write(map);
}