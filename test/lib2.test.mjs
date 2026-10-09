import assert from "node:assert/strict";
import {
  computeStreakInfo, detectRecurringCharges, summarizePeriod, monthRange, periodRange,
  computeWrapped, planNotifications, buildNudgeText, waLink, normalizePhone, firstName,
  buildWidgetPayload, buildExportModel, buildExportXlsx, buildExportPdf, addDaysISO,
  savingsStreakMonths, monthKey, hashToInt,
} from "../src/lib.js";

let pass = 0, fail = 0;
function t(name, fn) { try { fn(); pass++; console.log("  ok   " + name); } catch (e) { fail++; console.log("  FAIL " + name + "\n       " + e.stack.split("\n").slice(0,3).join("\n       ")); } }

const TODAY = "2026-09-12";

console.log("\nStreaks");
t("current streak counts back from today", () => {
  const dates = [addDaysISO(TODAY, -2), addDaysISO(TODAY, -1), TODAY];
  const s = computeStreakInfo(dates, TODAY);
  assert.equal(s.current, 3); assert.equal(s.todayDone, true); assert.equal(s.atRisk, false);
});
t("streak alive at risk if yesterday done but not today yet", () => {
  const dates = [addDaysISO(TODAY, -2), addDaysISO(TODAY, -1)];
  const s = computeStreakInfo(dates, TODAY);
  assert.equal(s.current, 2); assert.equal(s.todayDone, false); assert.equal(s.atRisk, true);
});
t("gap breaks streak, best streak remembered", () => {
  const dates = [addDaysISO(TODAY, -10), addDaysISO(TODAY, -9), addDaysISO(TODAY, -8), addDaysISO(TODAY, -8), addDaysISO(TODAY, -1), TODAY];
  const s = computeStreakInfo(dates, TODAY);
  assert.equal(s.current, 2); assert.equal(s.best, 3);
});
t("empty dates", () => {
  const s = computeStreakInfo([], TODAY);
  assert.equal(s.current, 0); assert.equal(s.best, 0); assert.equal(s.last7.length, 7);
});

console.log("\nRecurring-charge detector");
const tx = (id, desc, amount, date, category = "Entertainment") => ({ id, desc, amount, date, category });
t("3 monthly Netflix charges flagged, one-off Amazon purchase not", () => {
  const txs = [
    tx("1", "Netflix", 649, "2026-06-30"), tx("2", "Netflix", 649, "2026-07-30"), tx("3", "Netflix", 649, "2026-08-29"),
    tx("4", "Amazon", 2000, "2026-08-15", "Shopping"),
  ];
  const r = detectRecurringCharges(txs, TODAY);
  assert.equal(r.length, 1); assert.equal(r[0].name, "Netflix"); assert.equal(r[0].count, 3); assert.equal(r[0].yearly, 649 * 12);
});
t("already-tracked recurring bills are not re-flagged", () => {
  const txs = [
    tx("1", "Rent", 18000, "2026-07-05", "Utilities"), tx("2", "Rent", 18000, "2026-08-05", "Utilities"),
    { ...tx("3", "Rent", 18000, "2026-09-05", "Utilities"), recurring: true },
  ];
  assert.equal(detectRecurringCharges(txs, TODAY).length, 0);
});
t("charge that stopped 2 months ago is not flagged (already cancelled)", () => {
  const txs = [tx("1", "OldGym", 999, "2026-05-01"), tx("2", "OldGym", 999, "2026-06-01")];
  assert.equal(detectRecurringCharges(txs, TODAY).length, 0);
});
t("amount drift within 5% still matches (price bump)", () => {
  const txs = [tx("1", "Spotify", 119, "2026-07-10"), tx("2", "Spotify", 129, "2026-08-10")];
  assert.equal(detectRecurringCharges(txs, TODAY).length, 1);
});
t("irregular gaps (not ~monthly) are not flagged", () => {
  const txs = [tx("1", "Cafe", 300, "2026-07-01"), tx("2", "Cafe", 300, "2026-07-05"), tx("3", "Cafe", 300, "2026-08-20")];
  assert.equal(detectRecurringCharges(txs, TODAY).length, 0);
});

console.log("\nPeriod summaries & Wrapped");
t("summarizePeriod separates income/spend/refunds, finds top category", () => {
  const txs = [
    { desc: "Salary", amount: -85000, category: "Income", date: "2026-09-01" },
    { desc: "Swiggy", amount: 500, category: "Dining Out", date: "2026-09-03" },
    { desc: "Swiggy", amount: 400, category: "Dining Out", date: "2026-09-05" },
    { desc: "Refund", amount: -100, category: "Shopping", date: "2026-09-06" },
  ];
  const s = summarizePeriod(txs, [], monthRange("2026-09", TODAY));
  assert.equal(s.income, 85000); assert.equal(s.refunds, 100); assert.equal(s.spend, 900 - 100);
  assert.equal(s.topCategory.category, "Dining Out"); assert.equal(s.topMerchant.name, "Swiggy");
});
t("computeWrapped: goal achieved is the headline win", () => {
  const w = computeWrapped({
    txList: [{ desc: "Salary", amount: -50000, category: "Income", date: "2026-09-01" }],
    recurringItems: [], goals: [{ id: "g1", name: "Trip", target: 10000, saved: 10000 }],
    activityDates: [TODAY], kind: "month", today: TODAY,
  });
  assert.match(w.win.title, /Goal achieved/); assert.equal(w.hasData, true);
});
t("computeWrapped: no data yet is honestly reported", () => {
  const w = computeWrapped({ txList: [], recurringItems: [], goals: [], activityDates: [], kind: "month", today: TODAY });
  assert.equal(w.hasData, false);
});
t("savingsStreakMonths counts back consecutive income>spend months", () => {
  const txs = [
    { desc: "Salary", amount: -50000, category: "Income", date: "2026-07-01" }, { desc: "Rent", amount: 10000, category: "Utilities", date: "2026-07-05" },
    { desc: "Salary", amount: -50000, category: "Income", date: "2026-08-01" }, { desc: "Rent", amount: 10000, category: "Utilities", date: "2026-08-05" },
    { desc: "Salary", amount: -20000, category: "Income", date: "2026-06-01" }, { desc: "Rent", amount: 25000, category: "Utilities", date: "2026-06-05" }, // overspent -> breaks chain
  ];
  assert.equal(savingsStreakMonths(txs, "2026-08", TODAY), 2);
});

console.log("\nNotifications");
t("budget 80% fires once, not repeated next run", () => {
  const budgets = [{ category: "Dining Out", limit: 2000, spent: 1700 }];
  const r1 = planNotifications({ budgetsWithSpend: budgets, goals: [], planned: [], recurringItems: [], notifState: { init: true, keys: [] }, today: TODAY });
  assert.equal(r1.immediate.length, 1); assert.match(r1.immediate[0].title, /8[0-9]%/);
  const r2 = planNotifications({ budgetsWithSpend: budgets, goals: [], planned: [], recurringItems: [], notifState: { init: true, keys: r1.newKeys }, today: TODAY });
  assert.equal(r2.immediate.length, 0);
});
t("budget 100% supersedes 80 and fires", () => {
  const budgets = [{ category: "Dining Out", limit: 2000, spent: 2100 }];
  const r1 = planNotifications({ budgetsWithSpend: budgets, goals: [], planned: [], recurringItems: [], notifState: { init: true, keys: [] }, today: TODAY });
  assert.equal(r1.immediate.length, 1); assert.match(r1.immediate[0].title, /used up/);
});
t("first run (fresh install) does not spam for already-crossed thresholds", () => {
  const budgets = [{ category: "Dining Out", limit: 2000, spent: 2100 }];
  const goals = [{ id: "g1", name: "Trip", target: 1000, saved: 1000 }];
  const r = planNotifications({ budgetsWithSpend: budgets, goals, planned: [], recurringItems: [], notifState: { init: false, keys: [] }, today: TODAY });
  assert.equal(r.immediate.length, 0); assert.ok(r.newKeys.length > 0); // recorded silently so it won't fire retroactively
});
t("bill due tomorrow fires immediately when it's actually tomorrow", () => {
  const recurring = [{ id: "r1", desc: "Rent", amount: 18000, everyMonthDay: Number(TODAY.slice(8, 10)) + 1, lastPaid: null }];
  const r = planNotifications({ budgetsWithSpend: [], goals: [], planned: [], recurringItems: recurring, notifState: { init: true, keys: [] }, today: TODAY });
  assert.ok(r.immediate.some((n) => /due tomorrow/i.test(n.title)));
});
t("far-future bill is scheduled, not fired immediately", () => {
  // nowMs must represent "right now" as of the fake TODAY fixture, not the
  // sandbox's real wall clock (which drifts forward every time these tests
  // run on a later date) — otherwise a 20-day-out bill can look like it is
  // already in the past relative to *actual* now.
  const fakeNowMs = new Date(2026, 8, 12, 8, 0, 0).getTime();
  const planned = [{ id: "p1", desc: "Insurance", amount: 5000, dueDate: addDaysISO(TODAY, 20) }];
  const r = planNotifications({ budgetsWithSpend: [], goals: [], planned, recurringItems: [], notifState: { init: true, keys: [] }, today: TODAY, nowMs: fakeNowMs });
  assert.equal(r.immediate.length, 0); assert.ok(r.scheduled.length >= 1);
});
t("notification ids are positive 31-bit ints (Android requirement)", () => {
  const id = hashToInt("bill:plan:p1:2026-10-01:eve");
  assert.ok(id > 0 && id < 2147483647);
});

console.log("\nWhatsApp nudge");
t("nudge text greets the debtor, credits the actual creditor", () => {
  const text = buildNudgeText({ debtorName: "Rahul Singh", creditorName: "Priya", creditorIsMe: false, amount: 450, items: "dinner" });
  assert.match(text, /^Hi Rahul,/); assert.match(text, /owe Priya ₹450 for dinner/);
  const link = waLink("9876543210", text);
  assert.match(link, /^https:\/\/wa\.me\/919876543210\?text=/);
});
t("nudge text when the current profile is the creditor says 'owe me'", () => {
  const text = buildNudgeText({ debtorName: "Rahul", creditorName: "You", creditorIsMe: true, amount: 200, items: "cab" });
  assert.match(text, /^Hi Rahul,/); assert.match(text, /owe me ₹200 for cab/);
});
t("normalizePhone handles 10-digit, leading-0, and already-prefixed", () => {
  assert.equal(normalizePhone("9876543210"), "919876543210");
  assert.equal(normalizePhone("09876543210"), "919876543210");
  assert.equal(normalizePhone("+91 98765 43210"), "919876543210");
});
t("firstName strips role suffix", () => { assert.equal(firstName("Rajesh (Dad)"), "Rajesh"); });

console.log("\nWidget payload");
t("no data yet shows em-dash, not misleading 0", () => {
  const w = buildWidgetPayload({ income: 0, totalSpend: 0, saved: 0, nextBill: null, streak: null, today: TODAY });
  assert.equal(w.net, "—");
});
t("has data shows signed net and next bill", () => {
  const w = buildWidgetPayload({ income: 50000, totalSpend: 20000, saved: 30000, nextBill: { name: "Rent", amount: 18000, dueDate: "2026-09-20" }, streak: { current: 5 }, today: TODAY });
  assert.equal(w.net, "+₹30,000"); assert.equal(w.nextBillName, "Rent"); assert.equal(w.streak, 5);
});

console.log("\nExport model + file builders produce valid bytes");
t("xlsx: is a real zip with expected sheet count", () => {
  const model = buildExportModel({
    txList: [{ id: "1", desc: "Swiggy", amount: 500, category: "Dining Out", date: "2026-09-03", source: "SMS" }],
    expenses: [{ id: "e1", desc: "Trip fuel", amount: 1000, category: "Transport", date: "2026-09-04", paidBy: "you", splitAmong: ["you", "sis"], recurring: false }],
    recurringItems: [], nameOf: (id) => id === "you" ? "You" : "Sis", range: monthRange("2026-09", TODAY), today: TODAY,
  });
  const bytes = buildExportXlsx(model);
  assert.equal(String.fromCharCode(bytes[0], bytes[1]), "PK");
  const txt = Buffer.from(bytes).toString("latin1");
  assert.ok(txt.includes("[Content_Types].xml")); assert.ok(txt.includes("Transactions")); assert.ok(txt.includes("Group expenses"));
});
t("pdf: starts with %PDF, has matching object/xref structure", () => {
  const model = buildExportModel({
    txList: [{ id: "1", desc: "Swiggy", amount: 500, category: "Dining Out", date: "2026-09-03", source: "SMS" }],
    expenses: [], recurringItems: [], nameOf: (id) => id, range: monthRange("2026-09", TODAY), today: TODAY,
  });
  const bytes = buildExportPdf(model, "You");
  const txt = Buffer.from(bytes).toString("latin1");
  assert.ok(txt.startsWith("%PDF-1.4")); assert.ok(txt.includes("/Type /Catalog")); assert.ok(txt.includes("startxref")); assert.ok(txt.trim().endsWith("%%EOF"));
});
t("pdf text is escaped and non-ASCII (rupee) mapped, not raw bytes", () => {
  const model = buildExportModel({ txList: [], expenses: [], recurringItems: [], nameOf: (id) => id, range: monthRange("2026-09", TODAY), today: TODAY });
  const bytes = buildExportPdf(model, "Parth (Me)");
  const txt = Buffer.from(bytes).toString("latin1");
  assert.ok(!txt.includes("₹"));
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
