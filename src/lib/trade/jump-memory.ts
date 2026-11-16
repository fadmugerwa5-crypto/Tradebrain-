import type { JumpMemoryRecord } from './jump-runtime.ts';
const KEY = 'jump-scalper-opportunity-memory-v1';
export function readJumpMemory(): JumpMemoryRecord[] {
  if (typeof localStorage === 'undefined') return [];
  try { const raw = localStorage.getItem(KEY); const parsed = raw ? JSON.parse(raw) : []; return Array.isArray(parsed) ? parsed.slice(-2000) : []; }
  catch { return []; }
}
export function writeJumpMemory(records: JumpMemoryRecord[]) {
  if (typeof localStorage === 'undefined') return;
  try { localStorage.setItem(KEY, JSON.stringify(records.slice(-2000))); } catch { /* storage quota/private mode */ }
}
export function recordJumpMemory(record: JumpMemoryRecord) {
  const rows = readJumpMemory();
  const i = rows.findIndex(r => r.id === record.id);
  if (i >= 0) rows[i] = record; else rows.push(record);
  writeJumpMemory(rows);
  return rows;
}
