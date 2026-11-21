import assert from "node:assert/strict";
import {
  guessCategory, renameCategory, merchantKey, ruleKeyOf, isPersonLike, applyRules, upsertRule,
  applyRuleToTxList, countMatching, groupUncategorized, suggestCategory, ingestMessages,
  summarizeTx, summarizePeriod, monthRange, groupTxByMonth, txTimeKey, dueThisMonth,
  processBills, reconcileNewTx, migrateStore, buildBackup, parseBackup, detectRecurringCharges,
  DATA_VERSION, BACKUP_KEYS, parseSmsMessage,
} from "../src/lib.js";

let pass = 0, fail = 0;
function t(name, fn) { try { fn(); pass++; console.log("  ok   " + name); } catch (e) { fail++; console.log("  FAIL " + name + "\n       " + String(e.message).split("\n").slice(0, 4).join("\n       ")); } }
const TODAY = "2026-10-15";
const ts = (m, d, h = 10) => new Date(2026, m - 1, d, h, 0).getTime();
const msg = (body, sender = "VM-HDFCBK-S", when = ts(10, 12)) => ({ body, sender, ts: when });

console.log("\nCategories");
t("Savings catches SIPs, funds, brokers, deposits — but not 'MG Rd'", () => {
  for (const d of ["Zerodha Broking", "SIP - HDFC Mutual Fund", "Groww", "PPF deposit", "NPS contribution", "Fixed deposit"]) assert.equal(guessCategory(d), "Savings", d);
  assert.notEqual(guessCategory("MG Rd Stores"), "Savings");
});
t("insurance of every kind is Bills/Utilities", () => {
  for (const d of ["LIC premium", "Star Health Insurance", "Acko policy", "Max Life"]) assert.equal(guessCategory(d), "Bills/Utilities", d);
});
t("renamed categories", () => {
  assert.equal(guessCategory("Uber"), "Travel/Fuel"); assert.equal(guessCategory("Apollo Pharmacy"), "Health/Meds");
  assert.equal(guessCategory("BESCOM"), "Bills/Utilities"); assert.equal(guessCategory("School fees"), "Tuition/Education");
  assert.equal(guessCategory("HDFC Credit Card"), "Credit Card/EMI");
});
t("renameCategory maps all six old names and leaves new ones alone", () => {
  assert.deepEqual(["Insurance", "Utilities", "Transport", "Health", "Tuition / Education", "Credit Card / EMI"].map(renameCategory),
    ["Bills/Utilities", "Bills/Utilities", "Travel/Fuel", "Health/Meds", "Tuition/Education", "Credit Card/EMI"]);
  assert.equal(renameCategory("Savings"), "Savings"); assert.equal(renameCategory("Groceries"), "Groceries");
});
t("a Groww SIP debit parses as Savings", () => {
  const r = parseSmsMessage(msg("Rs.5,000.00 debited from A/c XX1234 on 03-10-26 to VPA groww@ybl (UPI Ref No 5)"), TODAY);
  assert.equal(r.tx.category, "Savings"); assert.equal(r.tx.amount, 5000);
});

console.log("\nMerchant keys & person detection");
t("UPI handle digits are stripped so a changing handle keeps one key", () => {
  assert.equal(merchantKey("swiggy@ybl"), "swiggy"); assert.equal(merchantKey("Swiggy"), "swiggy");
  assert.equal(merchantKey("shop123@ybl"), merchantKey("shop456@okaxis"));
  assert.equal(merchantKey("9876543210@ybl"), "p:9876543210"); assert.equal(merchantKey(""), "");
});
t("parsed transactions carry a key and a timestamp", () => {
  const r = parseSmsMessage(msg("Rs.500.00 debited from A/c XX1234 on 12-10-26 to VPA lovable99@ybl (UPI Ref No 1)"), TODAY);
  assert.equal(r.tx.mkey, "lovable"); assert.equal(r.tx.ts, ts(10, 12));
});
t("isPersonLike", () => {
  assert.equal(isPersonLike("Ramesh Kumar"), true); assert.equal(isPersonLike("Swiggy"), false);
  assert.equal(isPersonLike("Sharma Medical Store"), false); assert.equal(isPersonLike("Ramesh Kumar 2"), false);
  assert.equal(isPersonLike("x", "p:9876543210"), true);
});

console.log("\nLearned rules");
const tx0 = { id: "1", desc: "Lovable", amount: 500, category: "Others", mkey: "lovable", date: "2026-10-01" };
t("a rule overrides the guess for the same merchant and direction", () => {
  const rules = upsertRule([], { key: "lovable", dir: "out", category: "Entertainment", label: "Lovable" });
  assert.equal(applyRules(tx0, rules).category, "Entertainment");
});
t("rules are direction-specific, skip excluded items, and money-out is never Income", () => {
  const rules = upsertRule([], { key: "lovable", dir: "out", category: "Entertainment", label: "Lovable" });
  assert.equal(applyRules({ ...tx0, amount: -500, category: "Income" }, rules).category, "Income");
  assert.equal(applyRules({ ...tx0, excluded: true }, rules).category, "Others");
  const bad = upsertRule([], { key: "lovable", dir: "out", category: "Income", label: "x" });
  assert.equal(applyRules(tx0, bad).category, "Others");
});
t("money-in rules work too (a friend repaying dinner)", () => {
  const rules = upsertRule([], { key: "rahul", dir: "in", category: "Dining Out", label: "Rahul" });
  const credit = { id: "2", desc: "Rahul", amount: -1200, category: "Income", mkey: "rahul", date: "2026-10-02" };
  assert.equal(applyRules(credit, rules).category, "Dining Out");
});
t("upsertRule replaces the same merchant+direction instead of duplicating", () => {
  let rules = upsertRule([], { key: "k", dir: "out", category: "Shopping" });
  rules = upsertRule(rules, { key: "k", dir: "out", category: "Groceries" });
  assert.equal(rules.length, 1); assert.equal(rules[0].category, "Groceries");
});
t("fixing past transactions only touches matching ones, and counts them", () => {
  const rule = { id: "out:lovable", key: "lovable", dir: "out", category: "Entertainment" };
  const list = [tx0, { ...tx0, id: "2" }, { ...tx0, id: "3", desc: "Swiggy", mkey: "swiggy" }, { ...tx0, id: "4", excluded: true }];
  assert.equal(countMatching(list, rule), 2);
  const r = applyRuleToTxList(list, rule);
  assert.equal(r.changed, 2); assert.equal(r.list[2].category, "Others"); assert.equal(r.list[3].category, "Others");
});
t("ingestion applies rules, including across UPI handle digit changes", () => {
  const rules = upsertRule([], { key: "lovable", dir: "out", category: "Entertainment", label: "Lovable" });
  const r = ingestMessages([msg("Rs.500.00 debited from A/c XX1234 on 12-10-26 to VPA lovable99@ybl (UPI Ref No 1)")], { today: TODAY, rules });
  assert.equal(r.txs[0].category, "Entertainment");
  const none = ingestMessages([msg("Rs.500.00 debited from A/c XX1234 on 12-10-26 to VPA lovable99@ybl (UPI Ref No 1)")], { today: TODAY });
  assert.equal(none.txs[0].category, "Others");
});

console.log("\n'Needs a category' inbox & suggestions");
t("groups uncategorised SMS spending by merchant, biggest first; ignores manual/excluded/categorised", () => {
  const mk = (id, desc, amt, extra = {}) => ({ id, desc, amount: amt, category: "Others", mkey: merchantKey(desc), smsKey: "k" + id, date: "2026-10-0" + id, ...extra });
  const g = groupUncategorized([
    mk("1", "Ramesh Kumar", 300), mk("2", "Ramesh Kumar", 500), mk("3", "Lovable", 900),
    mk("4", "Manual", 100, { smsKey: undefined }), mk("5", "Excl", 100, { excluded: true }), mk("6", "Done", 100, { category: "Shopping" }),
  ]);
  assert.equal(g.length, 2); assert.equal(g[0].name, "Lovable"); assert.equal(g[1].count, 2); assert.equal(g[1].total, 800);
  assert.equal(g[1].personLike, true); assert.equal(g[0].personLike, false);
});
t("suggestions come from shared distinctive words, never for people, never the same merchant", () => {
  const rules = [{ id: "out:sharma medical", key: "sharma medical", dir: "out", category: "Health/Meds", label: "Sharma Medical" }];
  const s = suggestCategory("apollo medical", rules);
  assert.equal(s.category, "Health/Meds"); assert.equal(s.because, "Sharma Medical");
  assert.equal(suggestCategory("swiggy", rules), null); assert.equal(suggestCategory("p:98765", rules), null);
  assert.equal(suggestCategory("sharma medical", rules), null);
  assert.equal(suggestCategory("city cabs", [{ id: "x", key: "city medical", dir: "out", category: "Health/Meds", label: "City Medical" }]), null); // "city" is too generic
});

console.log("\nTotals: Saved and Spent never overlap");
t("Earned = Spent + Saved + Left over", () => {
  const list = [
    { amount: -50000, category: "Income" }, { amount: 5000, category: "Savings" }, { amount: 2000, category: "Dining Out" },
    { amount: -300, category: "Shopping" }, { amount: 1000, category: "Dining Out", excluded: true }, { amount: -1000, category: "Savings" },
  ];
  const s = summarizeTx(list);
  assert.equal(s.income, 50000); assert.equal(s.spent, 1700); assert.equal(s.saved, 4000); assert.equal(s.refunds, 300);
  assert.equal(s.leftOver, 44300); assert.equal(s.income, s.spent + s.saved + s.leftOver); assert.equal(s.retained, 48300);
});
t("period summary keeps Savings out of spend and categories", () => {
  const list = [
    { desc: "Salary", amount: -50000, category: "Income", date: "2026-10-01" }, { desc: "Groww", amount: 5000, category: "Savings", date: "2026-10-03" },
    { desc: "Swiggy", amount: 2000, category: "Dining Out", date: "2026-10-04" },
  ];
  const s = summarizePeriod(list, [], monthRange("2026-10", TODAY));
  assert.equal(s.spend, 2000); assert.equal(s.saved, 5000); assert.equal(s.leftOver, 43000);
  assert.deepEqual(s.categories.map((c) => c.category), ["Dining Out"]);
  assert.equal(Math.round(s.savingsRate), 96);   // (50000-2000)/50000: money put into savings is still money kept
});

console.log("\nMonth grouping");
t("newest month first, newest day first, same-day order by time received, with per-month totals", () => {
  const list = [
    { id: "a", date: "2026-10-05", ts: 1000, amount: 100, category: "Others" }, { id: "b", date: "2026-10-05", ts: 2000, amount: 200, category: "Others" },
    { id: "c", date: "2026-10-09", amount: -5000, category: "Income" }, { id: "d", date: "2026-09-30", amount: 50, category: "Others" },
  ];
  const g = groupTxByMonth(list);
  assert.deepEqual(g.map((x) => x.key), ["2026-10", "2026-09"]);
  assert.deepEqual(g[0].items.map((x) => x.id), ["c", "b", "a"]);
  assert.equal(g[0].label, "October 2026"); assert.equal(g[0].spent, 300); assert.equal(g[0].income, 5000); assert.equal(g[1].count, 1);
});
t("txTimeKey reads the SMS timestamp or the manual id", () => {
  assert.equal(txTimeKey({ smsKey: "1700000000000|X|abc" }), 1700000000000);
  assert.equal(txTimeKey({ id: "tx1791564969907" }), 1791564969907); assert.equal(txTimeKey({ id: "a" }), 0);
});

console.log("\nStill to pay this month");
t("unpaid recurring + Upcoming due this month; paid and next-month items excluded; overdue flagged", () => {
  const rec = [
    { id: "rent", desc: "Rent", amount: 18000, everyMonthDay: 5, lastPaid: null },
    { id: "nf", desc: "Netflix", amount: 649, everyMonthDay: 20, lastPaid: "2026-09-20" },
    { id: "gym", desc: "Gym", amount: 999, everyMonthDay: 10, lastPaid: "2026-10-10" },
  ];
  const planned = [{ id: "p1", desc: "Insurance", amount: 5000, dueDate: "2026-10-28" }, { id: "p2", desc: "Later", amount: 1, dueDate: "2026-11-02" }];
  const d = dueThisMonth(rec, planned, TODAY);
  assert.deepEqual(d.items.map((i) => i.id), ["rent", "nf", "p1"]);
  assert.equal(d.items[0].overdue, true); assert.equal(d.items[1].overdue, false); assert.equal(d.total, 18000 + 649 + 5000);
});

console.log("\nSMS bills -> recurring bills");
const SEP = "Dear Customer, your HDFC Bank Credit Card XX1234 statement is generated. Total Amt Due Rs 12,345.67, Min Amt Due Rs 617.00, Due Date 25-Sep-2026.";
const OCT = "Dear Customer, your HDFC Bank Credit Card XX1234 statement is generated. Total Amt Due Rs 9,800.00, Min Amt Due Rs 490.00, Due Date 25-Oct-2026.";
const JUL = "Dear Customer, your HDFC Bank Credit Card XX1234 statement is generated. Total Amt Due Rs 7,000.00, Min Amt Due Rs 350.00, Due Date 25-Jul-2026.";
const bills = (...texts) => { const r = ingestMessages(texts.map((b, i) => msg(b, "VM-HDFCBK-S", ts(10, 1 + i))), { today: TODAY }); return r; };
t("two consecutive monthly statements -> one recurring bill, nothing piles up in Upcoming", () => {
  const r = bills(SEP, OCT);
  assert.equal(r.staleBills.length, 1); assert.equal(r.bills.length, 1);
  const out = processBills(r.bills, r.staleBills, { today: TODAY });
  assert.equal(out.recurringAdd.length, 1); assert.equal(out.plannedAdd.length, 0);
  const rb = out.recurringAdd[0];
  assert.equal(rb.amount, 9800); assert.equal(rb.everyMonthDay, 25); assert.equal(rb.isNew, true); assert.equal(rb.fromSms, true);
  assert.equal(rb.category, "Credit Card/EMI"); assert.equal(out.promoted.length, 1);
});
t("a single statement stays a one-off Upcoming item", () => {
  const r = bills(OCT); const out = processBills(r.bills, r.staleBills, { today: TODAY });
  assert.equal(out.recurringAdd.length, 0); assert.equal(out.plannedAdd.length, 1); assert.equal(out.plannedAdd[0].dueDate, "2026-10-25");
});
t("quarterly bills (gap ~3 months) are NOT promoted", () => {
  const r = bills(JUL, OCT); const out = processBills(r.bills, r.staleBills, { today: TODAY });
  assert.equal(out.recurringAdd.length, 0); assert.equal(out.plannedAdd.length, 1);
});
t("an EMI auto-debit notice becomes recurring from the very first message", () => {
  const r = ingestMessages([msg("Your EMI of Rs 5,000 will be debited from A/c XX1234 on 05-11-26. Maintain sufficient balance.")], { today: TODAY });
  const out = processBills(r.bills, r.staleBills, { today: TODAY });
  assert.equal(out.recurringAdd.length, 1); assert.equal(out.recurringAdd[0].everyMonthDay, 5); assert.equal(out.plannedAdd.length, 0);
});
t("an existing recurring bill is refreshed by a new statement (amount + due day), not duplicated", () => {
  const r = bills(OCT);
  const existing = [{ id: "r1", desc: "HDFC credit card bill", amount: 1, everyMonthDay: 20, billerKey: r.bills[0].billerKey }];
  const out = processBills(r.bills, r.staleBills, { recurring: existing, today: TODAY });
  assert.equal(out.recurringAdd.length, 0); assert.equal(out.plannedAdd.length, 0);
  assert.deepEqual(out.recurringUpdate, [{ id: "r1", updates: { amount: 9800, everyMonthDay: 25 } }]);
});
t("a recurring bill the user deleted stays deleted — new statements show only as Upcoming", () => {
  const r = bills(SEP, OCT);
  const out = processBills(r.bills, r.staleBills, { ignored: new Set(["rec:" + r.bills[0].billerKey]), today: TODAY });
  assert.equal(out.recurringAdd.length, 0); assert.equal(out.plannedAdd.length, 1);
});
t("promotion clears that biller's earlier one-off Upcoming items", () => {
  const r = bills(SEP, OCT);
  const out = processBills(r.bills, r.staleBills, { planned: [{ id: "p_old", billerKey: r.bills[0].billerKey }], today: TODAY });
  assert.deepEqual(out.plannedRemoveIds, ["p_old"]);
});
t("history remembers occurrences so a pattern can complete across syncs", () => {
  const first = bills(SEP);
  const o1 = processBills(first.bills, first.staleBills, { today: TODAY });
  assert.equal(o1.recurringAdd.length, 0);
  const second = bills(OCT);
  const o2 = processBills(second.bills, second.staleBills, { history: o1.history, today: TODAY });
  assert.equal(o2.recurringAdd.length, 1);
});

console.log("\nMatching bank debits to what you already recorded (counted once)");
const rec1 = { id: "r1", desc: "HDFC credit card bill", amount: 9800, category: "Credit Card/EMI", everyMonthDay: 25, lastPaid: null };
const cardDebit = { id: "s1", desc: "HDFC Credit Card", amount: 9800, category: "Credit Card/EMI", date: "2026-10-24", smsKey: "k1", excluded: true,
  body: "Rs.9,800.00 debited from A/c XX1234 on 24-10-26 towards HDFC Credit Card XX9999 payment" };
t("a matching debit marks the recurring bill paid for that cycle and links to it", () => {
  const r = reconcileNewTx([cardDebit], { recurring: [rec1] });
  assert.equal(r.txs[0].recurringId, "r1"); assert.deepEqual(r.recurringUpdates, [{ id: "r1", updates: { lastPaid: "2026-10-25", paidTxId: "s1" } }]);
});
t("a manual 'Mark paid' entry is replaced by the SMS record, not added alongside it", () => {
  const manual = { id: "m1", payRef: true, recurringId: "r1", desc: "HDFC credit card bill", amount: 9800, date: "2026-10-20", category: "Credit Card/EMI" };
  const r = reconcileNewTx([cardDebit], { txList: [manual], recurring: [{ ...rec1, lastPaid: "2026-10-25", paidTxId: "m1" }] });
  assert.deepEqual(r.removeTxIds, ["m1"]); assert.equal(r.recurringUpdates[0].updates.paidTxId, "s1");
});
t("a cycle already paid by an SMS entry is not claimed twice", () => {
  const prev = { id: "s0", smsKey: "k0", amount: 9800, date: "2026-10-22" };
  const r = reconcileNewTx([{ ...cardDebit, id: "s2" }], { txList: [prev], recurring: [{ ...rec1, lastPaid: "2026-10-25", paidTxId: "s0" }] });
  assert.equal(r.txs[0].recurringId, undefined); assert.equal(r.recurringUpdates.length, 0);
});
t("paying early (11-20 days before due) still matches, and a late payment picks the cycle it is closest to", () => {
  const early = reconcileNewTx([{ ...cardDebit, id: "e1", date: "2026-10-08" }], { recurring: [rec1] });          // 17 days early
  assert.equal(early.txs[0].recurringId, "r1");
  // paid on 5 Oct: 10 days after the 25 Sep due date but 20 days before 25 Oct -> belongs to September's cycle
  const late = reconcileNewTx([{ ...cardDebit, id: "l1", date: "2026-10-05" }], { recurring: [rec1] });
  assert.equal(late.recurringUpdates[0].updates.lastPaid, "2026-09-25");
});
t("different amounts do not match", () => {
  const r = reconcileNewTx([{ ...cardDebit, amount: 5000 }], { recurring: [rec1] });
  assert.equal(r.txs[0].recurringId, undefined);
});
t("a manual 'Spent' entry from Upcoming is replaced when the bank debit arrives", () => {
  const manual = { id: "m2", payRef: true, desc: "Car service", amount: 3500, category: "Travel/Fuel", date: "2026-10-10" };
  const debit = { id: "s5", desc: "Hero Motors", amount: 3500, category: "Travel/Fuel", date: "2026-10-12", smsKey: "k5", body: "Rs 3,500 debited ... Hero Motors" };
  const r = reconcileNewTx([debit], { txList: [manual] });
  assert.deepEqual(r.removeTxIds, ["m2"]);
});
t("an Upcoming item paid straight from the bank is resolved automatically", () => {
  const planned = [{ id: "p1", desc: "BESCOM electricity bill", amount: 1450, dueDate: "2026-10-20", category: "Bills/Utilities", billKey: "bk1" }];
  const debit = { id: "s6", desc: "Bescom", amount: 1450, category: "Bills/Utilities", date: "2026-10-18", smsKey: "k6", body: "Rs 1,450 debited ... BESCOM" };
  const r = reconcileNewTx([debit], { planned });
  assert.deepEqual(r.plannedRemove, [{ id: "p1", billKey: "bk1" }]);
});
t("no false positives: same amount but a different merchant and category is left alone", () => {
  const planned = [{ id: "p1", desc: "BESCOM electricity bill", amount: 1450, dueDate: "2026-10-20", category: "Bills/Utilities" }];
  const r = reconcileNewTx([{ id: "s7", desc: "Swiggy", amount: 1450, category: "Dining Out", date: "2026-10-18", smsKey: "k7", body: "Rs 1,450 debited ... Swiggy" }], { planned });
  assert.equal(r.plannedRemove.length, 0);
});
t("credits and refunds pass straight through", () => {
  const credit = { id: "c1", amount: -500, date: "2026-10-18", category: "Income" };
  assert.deepEqual(reconcileNewTx([credit], { recurring: [rec1] }).txs, [credit]);
});

console.log("\nMigration");
t("renames flow through transactions, group expenses, budgets, Upcoming, rules and alert history", () => {
  const out = migrateStore({
    trucent_tx: [{ id: "1", category: "Transport", amount: 100 }, { id: "2", category: "Tuition / Education", amount: 5 }],
    trucent_expenses: [{ id: "e", category: "Health", amount: 50, recurring: false, date: "2026-10-01" }],
    trucent_planned: [{ id: "p", category: "Insurance" }],
    trucent_rules: [{ id: "r", category: "Utilities" }],
    trucent_notif_state: { init: true, keys: ["b:Transport:2026-10:80", "g:1:50"] },
  }, 1);
  assert.equal(out.trucent_tx[0].category, "Travel/Fuel"); assert.equal(out.trucent_tx[1].category, "Tuition/Education");
  assert.equal(out.trucent_expenses[0].category, "Health/Meds"); assert.equal(out.trucent_planned[0].category, "Bills/Utilities");
  assert.equal(out.trucent_rules[0].category, "Bills/Utilities");
  assert.deepEqual(out.trucent_notif_state.keys, ["b:Travel/Fuel:2026-10:80", "g:1:50"]);
});
t("two budgets that merge into one keep the higher limit", () => {
  const out = migrateStore({ trucent_budgets: [{ category: "Insurance", limit: 1000 }, { category: "Utilities", limit: 3000 }, { category: "Groceries", limit: 500 }] }, 1);
  assert.equal(out.trucent_budgets.length, 2); assert.equal(out.trucent_budgets.find((b) => b.category === "Bills/Utilities").limit, 3000);
});
t("old Split-tab recurring bills and 'repeats' flags become real recurring items", () => {
  const out = migrateStore({
    trucent_expenses: [
      { id: "e1", desc: "Rent", amount: 18000, category: "Utilities", recurring: true, everyMonthDay: 5, lastPaid: "2026-10-05", date: "2026-10-05" },
      { id: "e2", desc: "Dinner", amount: 600, category: "Dining Out", recurring: false, date: "2026-10-06", paidBy: "you", splitAmong: ["you"] },
    ],
    trucent_tx: [{ id: "tx1", desc: "Gym", amount: 999, category: "Others", date: "2026-10-08", recurring: true, manual: true }],
  }, 1);
  assert.deepEqual(out.trucent_expenses.map((e) => e.id), ["e2"]);
  const rent = out.trucent_recurring.find((r) => r.id === "r_e1"); assert.equal(rent.category, "Bills/Utilities"); assert.equal(rent.everyMonthDay, 5);
  const gym = out.trucent_recurring.find((r) => r.id === "r_tx1"); assert.equal(gym.paidTxId, "tx1"); assert.equal(gym.everyMonthDay, 8);
  assert.equal(out.trucent_tx[0].recurring, undefined); assert.equal(out.trucent_tx[0].recurringId, "r_tx1");
});
t("a debit wrongly tagged Income (impossible now) is moved to Others", () => {
  assert.equal(migrateStore({ trucent_tx: [{ id: "1", category: "Income", amount: 500 }] }, 1).trucent_tx[0].category, "Others");
});
t("fresh installs invent nothing; current-version data is untouched; migrating twice changes nothing more", () => {
  assert.deepEqual(migrateStore({}, 1), {});
  const cur = { trucent_tx: [{ id: "1", category: "Transport", amount: 1 }] };
  assert.deepEqual(migrateStore(cur, DATA_VERSION), cur);
  const old = { trucent_tx: [{ id: "1", category: "Transport", amount: 1, recurring: true, desc: "x", date: "2026-10-01" }] };
  const once = migrateStore(old, 1);
  assert.deepEqual(migrateStore(once, 1), once);
});

console.log("\nBackup / restore");
const sample = () => ({
  trucent_tx: [{ id: "1", desc: "A", amount: 10, category: "Others", date: "2026-10-01" }], trucent_expenses: [], trucent_budgets: [{ category: "Groceries", limit: 5 }],
  trucent_goals: [{ id: "g", name: "Trip", target: 10, saved: 1 }], trucent_planned: [], trucent_recurring: [{ id: "r1", desc: "Rent", amount: 1, everyMonthDay: 5 }],
  trucent_rules: [{ id: "out:a", key: "a", dir: "out", category: "Shopping" }], trucent_bill_history: { k: [] },
  trucent_members: [{ id: "you", name: "You" }, { id: "m1", name: "Dad" }], trucent_current_member: "m1",
  trucent_activity: ["2026-10-01"], trucent_sms_ignored: ["k1"], trucent_recurring_dismissed: [], trucent_nudge_phones: { m1: "98" }, trucent_notif_state: { init: true, keys: [] },
  trucent_sms_status: "granted", trucent_last_sms_sync: 123,       // device-specific: must NOT be backed up
});
t("round trip keeps everything, including learned rules and the deleted-SMS list; device-only keys are left out", () => {
  const b = buildBackup(sample(), new Date("2026-10-15T10:00:00Z"));
  assert.equal(b.app, "trucent"); assert.equal(b.version, DATA_VERSION); assert.ok(!("trucent_sms_status" in b.data)); assert.ok(!("trucent_last_sms_sync" in b.data));
  const r = parseBackup(JSON.stringify(b));
  assert.equal(r.ok, true); assert.deepEqual(r.store.trucent_rules, sample().trucent_rules); assert.deepEqual(r.store.trucent_sms_ignored, ["k1"]);
  assert.deepEqual(r.summary, { transactions: 1, groupExpenses: 0, members: 2, recurring: 1, goals: 1, rules: 1 });
});
t("rejects junk, the wrong app, and backups from a newer app version", () => {
  assert.equal(parseBackup("not json").ok, false); assert.equal(parseBackup(JSON.stringify({ app: "other", data: {} })).ok, false);
  const newer = parseBackup(JSON.stringify({ app: "trucent", version: DATA_VERSION + 1, data: {} }));
  assert.equal(newer.ok, false); assert.match(newer.error, /newer version/);
});
t("an old (pre-rename) backup is migrated on restore", () => {
  const r = parseBackup(JSON.stringify({ app: "trucent", version: 1, data: { trucent_tx: [{ id: "1", category: "Transport", amount: 5, date: "2026-10-01" }] } }));
  assert.equal(r.ok, true); assert.equal(r.store.trucent_tx[0].category, "Travel/Fuel");
});
t("wrong-typed fields are dropped, invalid members ignored, and a missing current member repaired", () => {
  const r = parseBackup(JSON.stringify({ app: "trucent", version: DATA_VERSION, data: { trucent_tx: "oops", trucent_members: [{ id: "a", name: "A" }], trucent_current_member: "zzz" } }));
  assert.equal(r.ok, true); assert.ok(!("trucent_tx" in r.store)); assert.equal(r.store.trucent_current_member, "a");
  const bad = parseBackup(JSON.stringify({ app: "trucent", version: DATA_VERSION, data: { trucent_members: [{ nope: 1 }] } }));
  assert.ok(!("trucent_members" in bad.store));
});
t("every backed-up key is accounted for", () => assert.equal(new Set(BACKUP_KEYS).size, BACKUP_KEYS.length));

console.log("\nSubscription detector");
t("merchants already tracked as recurring (by link or name) aren't suggested again", () => {
  const mk = (id, date, extra = {}) => ({ id, desc: "Netflix", amount: 649, category: "Entertainment", date, ...extra });
  const list = [mk("1", "2026-08-15"), mk("2", "2026-09-14"), mk("3", "2026-10-13")];
  assert.equal(detectRecurringCharges(list, TODAY).length, 1);
  assert.equal(detectRecurringCharges(list.map((x) => ({ ...x, recurringId: "r1" })), TODAY).length, 0);
  assert.equal(detectRecurringCharges(list, TODAY, new Set(["netflix"])).length, 0);
});

console.log("\nEnd to end: a realistic inbox");
t("SMS -> categories -> bills -> recurring -> payment matched -> totals add up", () => {
  const inbox = [
    msg("Rs.85,000.00 credited to A/c XX1234 on 01-10-26 by NEFT-INFOTECH PVT LTD-SALARY OCT. Avl Bal Rs 90,000", "VM-HDFCBK-S", ts(10, 1)),
    msg("Rs.5,000.00 debited from A/c XX1234 on 03-10-26 to VPA groww@ybl (UPI Ref No 5)", "VM-HDFCBK-S", ts(10, 3)),
    msg("Rs.500.00 debited from A/c XX1234 on 04-10-26 to VPA swiggy@ybl (UPI Ref No 6)", "VM-HDFCBK-S", ts(10, 4)),
    msg("Rs.9,800.00 debited from A/c XX1234 on 14-10-26 towards HDFC Credit Card XX9999 payment (UPI Ref 1)", "VM-HDFCBK-S", ts(10, 14)),
    msg(SEP, "VM-HDFCBK-S", ts(9, 20)), msg(OCT, "VM-HDFCBK-S", ts(10, 10)),
  ];
  const ing = ingestMessages(inbox, { today: TODAY });
  assert.equal(ing.txs.length, 4); assert.equal(ing.bills.length, 1); assert.equal(ing.staleBills.length, 1);
  const pb = processBills(ing.bills, ing.staleBills, { today: TODAY });
  assert.equal(pb.recurringAdd.length, 1);
  const rc = reconcileNewTx(ing.txs, { recurring: pb.recurringAdd });
  const card = rc.txs.find((x) => x.excluded);
  assert.equal(card.recurringId, pb.recurringAdd[0].id); assert.equal(rc.recurringUpdates[0].updates.lastPaid, "2026-10-25");
  const s = summarizeTx(rc.txs);
  assert.equal(s.income, 85000); assert.equal(s.saved, 5000); assert.equal(s.spent, 500);      // card payment excluded, SIP is Saved not Spent
  assert.equal(s.income, s.spent + s.saved + s.leftOver);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
