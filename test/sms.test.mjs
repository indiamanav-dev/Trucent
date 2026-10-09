import assert from "node:assert/strict";
import { parseSmsMessage, ingestMessages, findDueDate, senderName, localISO, todayISO, recurringNextDue, computeNextBill, addDaysISO, guessCategory } from "../src/lib.js";

let pass = 0, fail = 0;
function t(name, fn) { try { fn(); pass++; console.log("  ok   " + name); } catch (e) { fail++; console.log("  FAIL " + name + "\n       " + e.message.split("\n").join("\n       ")); } }

// Fixed "today" so date logic is deterministic: 12 Sep 2026
const TODAY = "2026-09-12";
const TS = new Date(2026, 8, 12, 10, 30).getTime();   // local time
const msg = (body, sender = "VM-HDFCBK-S", ts = TS) => ({ body, sender, ts });
const p = (body, sender) => parseSmsMessage(msg(body, sender), TODAY);

console.log("\nDebits");
t("UPI debit to VPA", () => {
  const r = p("Rs.500.00 debited from A/c XX1234 on 12-09-26 to VPA swiggy@ybl (UPI Ref No 123456789012). Not you? Call 1800xxxx");
  assert.equal(r.kind, "txn"); assert.equal(r.tx.amount, 500); assert.equal(r.tx.type, "debit");
  assert.equal(r.tx.desc, "Swiggy"); assert.equal(r.tx.category, "Dining Out"); assert.equal(r.tx.date, "2026-09-12");
});
t("a/c debited for amount, credited to other a/c", () => {
  const r = p("Your a/c no. XXXXXX1234 is debited for Rs. 1,299.00 on 15-Sep-26 and a/c XXXXXX9876 is credited (UPI Ref no 1234).");
  assert.equal(r.kind, "txn"); assert.equal(r.tx.type, "debit"); assert.equal(r.tx.amount, 1299);
});
t("card purchase 'spent ... at AMAZON', ignores Avl Lmt", () => {
  const r = p("Spent Rs.2340 on HDFC Bank Card XX1234 at AMAZON on 2026-09-14. Avl Lmt Rs 45000");
  assert.equal(r.tx.amount, 2340); assert.equal(r.tx.desc, "Amazon"); assert.equal(r.tx.category, "Shopping");
});
t("Sent Rs to person via UPI, skips balance", () => {
  const r = p("Sent Rs.250.00 to Ramesh Kumar via UPI. Ref 123. Balance Rs 4,500", "AX-PHONEPE");
  assert.equal(r.tx.amount, 250); assert.equal(r.tx.desc, "Ramesh Kumar");
});
t("Info: field merchant, Avl Bal ignored", () => {
  const r = p("INR 1,250.00 debited A/c *1234 on 14-Sep-26 Info: UPI/DR/123456/BigBasket. Avl Bal INR 12,000.55");
  assert.equal(r.tx.amount, 1250); assert.equal(r.tx.desc, "BigBasket"); assert.equal(r.tx.category, "Groceries");
});
t("ATM withdrawal", () => {
  const r = p("Rs 5,000 withdrawn from A/c XX1234 at ATM on 12-09-26. Avl bal Rs 9,000");
  assert.equal(r.tx.amount, 5000); assert.equal(r.tx.desc, "ATM cash withdrawal");
});
t("Indian digit grouping 1,00,000.50", () => {
  const r = p("Rs 1,00,000.50 debited from A/c XX1234 on 12-09-26 to VPA landlord@okaxis");
  assert.equal(r.tx.amount, 100000.5);
});
t("credit card bill payment from bank is excluded from spending (avoid double count)", () => {
  const r = p("Rs.12,000.00 debited from A/c XX1234 on 12-09-26 towards HDFC Credit Card XX9999 payment (UPI Ref 1)");
  assert.equal(r.kind, "txn"); assert.equal(r.tx.excluded, true); assert.equal(r.tx.category, "Credit Card / EMI");
});

console.log("\nCredits / income / refunds");
t("salary credit is income (negative amount)", () => {
  const r = p("Rs.85,000.00 credited to A/c XX1234 on 01-09-26 by NEFT-INFOTECH PVT LTD-SALARY SEP. Avl Bal Rs 90,000");
  assert.equal(r.tx.category, "Income"); assert.equal(r.tx.amount, -85000); assert.equal(r.tx.desc, "Salary"); assert.equal(r.tx.type, "credit");
});
t("multiple credits each parsed (old code only counted the first)", () => {
  const a = p("Rs 1,200 credited to your A/c XX1234 on 10-Sep-26 from VPA rahul@okhdfc (UPI Ref 1234)");
  const b = p("Rs 3,000 credited to your A/c XX1234 on 11-Sep-26 from VPA priya@okicici (UPI Ref 5678)");
  assert.equal(a.tx.category, "Income"); assert.equal(b.tx.category, "Income"); assert.equal(a.tx.desc, "Rahul");
});
t("refund is NOT income; category from merchant", () => {
  const r = p("Refund of Rs 649.00 for your order from AMAZON has been credited to your A/c XX1234");
  assert.equal(r.tx.type, "refund"); assert.equal(r.tx.amount, -649); assert.notEqual(r.tx.category, "Income");
  assert.equal(r.tx.category, "Shopping"); assert.equal(r.tx.desc, "Amazon");
});
t("UPI reversal counts as refund", () => {
  const r = p("Rs.349 reversed to your A/c XX1234 - Txn reversal for UPI ref 1234");
  assert.equal(r.tx.type, "refund"); assert.equal(r.tx.amount, -349);
});
t("cashback credited is a refund-type credit", () => {
  const r = p("Cashback of Rs 25 credited to your A/c XX1234 via UPI");
  assert.equal(r.tx.type, "refund"); assert.equal(r.tx.desc, "Cashback");
});
t("refund credited back to a card", () => {
  const r = p("Refund of Rs 1,500 has been credited to your card XX1234 for order at MYNTRA");
  assert.equal(r.tx.type, "refund"); assert.equal(r.tx.amount, -1500);
});

console.log("\nMessages that must be ignored");
t("OTP", () => assert.equal(p("123456 is your OTP for txn of Rs 500 at AMAZON. Do not share with anyone."), null));
t("promo with no amount/movement", () => assert.equal(p("Get flat 20% cashback on your next order! Use code SAVE20 via UPI"), null));
t("promo mentioning Rs via UPI but no debit/credit", () => assert.equal(p("Pay via UPI and get cashback up to Rs 100. Offer valid till 30 Sep"), null));
t("payment received on credit card is not income", () => assert.equal(p("Payment of Rs.5,000 received towards your HDFC Credit Card XX1234 on 12-Sep-26. Thank you"), null));
t("order paid msg without bank marker", () => assert.equal(p("Your order of Rs 999 has been paid and will be shipped tomorrow", "AMAZON"), null));
t("empty body", () => assert.equal(parseSmsMessage({ body: "", sender: "X", ts: TS }, TODAY), null));

console.log("\nBills & upcoming dues");
t("credit card statement: total due, not min due", () => {
  const r = p("Dear Customer, your HDFC Bank Credit Card XX1234 statement is generated. Total Amt Due Rs 12,345.67, Min Amt Due Rs 617.00, Due Date 25-Sep-2026. Pay via NetBanking/app");
  assert.equal(r.kind, "bill"); assert.equal(r.bill.amount, 12345.67); assert.equal(r.bill.dueDate, "2026-09-25");
  assert.equal(r.bill.category, "Credit Card / EMI"); assert.match(r.bill.desc, /HDFC credit card bill/i);
});
t("min due listed before total due still picks total", () => {
  const r = p("Your ICICI Credit Card statement: Min Amt Due Rs 500. Total Amt Due Rs 9,800. Due Date 28/09/2026");
  assert.equal(r.bill.amount, 9800); assert.equal(r.bill.dueDate, "2026-09-28");
});
t("electricity bill dd/mm/yyyy", () => {
  const r = p("Your BESCOM electricity bill of Rs 1,450 for consumer no 123 is due on 20/09/2026. Pay online to avoid disconnection", "AD-BESCOM");
  assert.equal(r.kind, "bill"); assert.equal(r.bill.amount, 1450); assert.equal(r.bill.dueDate, "2026-09-20"); assert.equal(r.bill.category, "Utilities");
});
t("insurance premium 2-digit year + Mon", () => {
  const r = p("Reminder: Your LIC premium of Rs.5,432 is due on 28-Sep-26", "VK-LICIND");
  assert.equal(r.bill.amount, 5432); assert.equal(r.bill.dueDate, "2026-09-28"); assert.equal(r.bill.category, "Insurance");
});
t("year-less date 'pay by 5th Oct' resolves to next occurrence", () => {
  const r = p("Your Airtel postpaid bill of Rs 499 is generated, pay by 5th Oct", "AD-AIRTEL");
  assert.equal(r.bill.dueDate, "2026-10-05"); assert.equal(r.bill.amount, 499);
});
t("future auto-debit notice becomes an upcoming bill, not a transaction", () => {
  const r = p("Your EMI of Rs 5,000 will be debited from A/c XX1234 on 05-10-26. Maintain sufficient balance.");
  assert.equal(r.kind, "bill"); assert.equal(r.bill.amount, 5000); assert.equal(r.bill.dueDate, "2026-10-05"); assert.equal(r.bill.category, "Credit Card / EMI");
});
t("bill payment confirmation is NOT a bill", () => {
  assert.equal(p("Payment of Rs 1,450 towards your electricity bill received. Thank you", "AD-BESCOM"), null);
});
t("an actual EMI debit that already happened stays a transaction", () => {
  const r = p("Rs 5,000 debited from A/c XX1234 on 05-09-26 towards loan EMI (NACH). Avl Bal Rs 9,000");
  assert.equal(r.kind, "txn"); assert.equal(r.tx.amount, 5000);
});
t("stale bill (due > 7 days ago) ignored", () => {
  assert.equal(p("Your BESCOM electricity bill of Rs 1,450 is due on 01/08/2026", "AD-BESCOM"), null);
});

console.log("\nFinding due dates");
t("various formats", () => {
  assert.equal(findDueDate("bill due on 15 Oct 2026", TODAY), "2026-10-15");
  assert.equal(findDueDate("Due date: Oct 15, 2026", TODAY), "2026-10-15");
  assert.equal(findDueDate("please pay before 30-09-26", TODAY), "2026-09-30");
  assert.equal(findDueDate("sent on 12-09-26 nothing due", TODAY), null);
});

console.log("\nIngest / dedupe / ignore list");
t("dedupes, respects ignore list, splits txns and bills", () => {
  const msgs = [
    msg("Rs.500.00 debited from A/c XX1234 on 12-09-26 to VPA swiggy@ybl (UPI Ref No 1)"),
    msg("Rs.500.00 debited from A/c XX1234 on 12-09-26 to VPA swiggy@ybl (UPI Ref No 1)"), // exact duplicate
    msg("Your BESCOM electricity bill of Rs 1,450 is due on 20/09/2026", "AD-BESCOM"),
    msg("Reminder: BESCOM electricity bill of Rs 1,450 is due on 20/09/2026", "AD-BESCOM", TS + 86400000), // same bill, later reminder
    msg("123456 is your OTP"),
  ];
  const r = ingestMessages(msgs, { today: TODAY });
  assert.equal(r.txs.length, 1); assert.equal(r.bills.length, 1); assert.equal(r.skipped, 3);
  const again = ingestMessages(msgs, { today: TODAY, txKeys: new Set(r.txs.map(x => x.smsKey)), billKeys: new Set(r.bills.map(x => x.billKey)) });
  assert.equal(again.txs.length, 0); assert.equal(again.bills.length, 0);
  const ign = ingestMessages(msgs, { today: TODAY, ignored: new Set([r.txs[0].smsKey]) });
  assert.equal(ign.txs.length, 0);
});

console.log("\nDates / helpers");
t("localISO is local, not UTC", () => {
  const d = new Date(2026, 8, 12, 0, 30);           // 00:30 local
  assert.equal(localISO(d), "2026-09-12");
});
t("senderName", () => {
  assert.equal(senderName("VM-HDFCBK-S"), "HDFCBK"); assert.equal(senderName("AD-BESCOM"), "BESCOM"); assert.equal(senderName("+919876543210"), "+919876543210");
});
t("recurringNextDue: unpaid soon → this month; paid → next month; month-length clamp", () => {
  assert.equal(recurringNextDue({ everyMonthDay: 20, lastPaid: "2026-08-20" }, "2026-09-12"), "2026-09-20");
  assert.equal(recurringNextDue({ everyMonthDay: 20, lastPaid: "2026-09-10" }, "2026-09-12"), "2026-10-20");
  assert.equal(recurringNextDue({ everyMonthDay: 10, lastPaid: "2026-08-10" }, "2026-09-12"), "2026-09-10"); // 2 days overdue still shown
  assert.equal(recurringNextDue({ everyMonthDay: 31, lastPaid: "2026-01-31" }, "2026-02-10"), "2026-02-28");
});
t("computeNextBill picks earliest across recurring + SMS bills", () => {
  const nb = computeNextBill([{ id: "r1", desc: "Rent", amount: 18000, everyMonthDay: 20, lastPaid: "2026-08-20" }],
    [{ id: "p1", desc: "HDFC credit card bill", amount: 9800, dueDate: "2026-09-15", fromSms: true }], TODAY);
  assert.equal(nb.name, "HDFC credit card bill"); assert.equal(nb.days, 3);
});
t("guessCategory: 'credited' no longer forces Income for descriptions", () => {
  assert.equal(guessCategory("credited to merchant"), "Others"); assert.equal(guessCategory("Salary"), "Income");
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
