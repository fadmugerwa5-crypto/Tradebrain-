import test from "node:test";
import assert from "node:assert/strict";
import { clearArchivedOpportunities, listOpportunities, saveHiveWait, updateOpportunityPrices } from "./watchtower.ts";

class MemoryStorage {
  data = new Map<string, string>();
  getItem(k: string) { return this.data.get(k) ?? null; }
  setItem(k: string, v: string) { this.data.set(k, v); }
}
(globalThis as unknown as { localStorage: MemoryStorage }).localStorage = new MemoryStorage();

test("Watchtower saves a promising Hive WAIT independently of execution", () => {
  saveHiveWait({ symbol: "BTCUSDT", label: "Bitcoin", direction: "BUY", price: 60000, reason: "Need confirmation", timeframe: "5m", venue: "binance" }, 1000);
  const rows = listOpportunities();
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.status, "MONITORING");
  assert.equal(rows[0]!.direction, "BUY");
  assert.match(rows[0]!.reason, /confirmation/);
});

test("Watchtower marks an opportunity approaching its trigger", () => {
  const row = listOpportunities()[0]!;
  updateOpportunityPrices({ BTCUSDT: { last: row.trigger * 1.001 } }, 2000);
  assert.equal(listOpportunities()[0]!.status, "APPROACHING_TRIGGER");
});

test("archived opportunities can be cleared without touching active ones", () => {
  const row = listOpportunities()[0]!;
  updateOpportunityPrices({ BTCUSDT: { last: row.stop || 50000 } }, row.expiresAt + 1);
  assert.equal(listOpportunities()[0]!.status, "EXPIRED");
  clearArchivedOpportunities();
  assert.equal(listOpportunities().length, 0);
});
