// ============================================================================
// TruCent — pure logic (no React, no DOM, no network).
// Everything here is deterministic and unit-tested (see /test/lib.test.mjs),
// which matters because the phone build can't be run inside the dev sandbox.
// ============================================================================

// ----------------------------------------------------------------------------
// Dates — ALL local-time. (The old code used toISOString(), which is UTC and
// returns *yesterday's* date in India between 00:00 and 05:30.)
// ----------------------------------------------------------------------------
export const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function pad2(n) { return String(n).padStart(2, "0"); }
export function localISO(d = new Date()) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
export function todayISO() { return localISO(new Date()); }
export function isoParts(iso) {
  const [y, m, d] = String(iso).split("-").map(Number);
  return { y, m, d };
}
export function daysBetweenISO(a, b) {
  const A = isoParts(a), B = isoParts(b);
  return Math.round((Date.UTC(B.y, B.m - 1, B.d) - Date.UTC(A.y, A.m - 1, A.d)) / 86400000);
}
export function addDaysISO(iso, n) {
  const { y, m, d } = isoParts(iso);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}
export function daysUntilDate(dateStr, today = todayISO()) { return daysBetweenISO(today, dateStr); }
export function monthKey(iso) { return String(iso || "").slice(0, 7); }
export function prevMonthKey(key) {
  const [y, m] = key.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${pad2(m - 1)}`;
}
export function monthLabel(key) {
  const [y, m] = key.split("-").map(Number);
  return `${MONTH_NAMES[m - 1]} ${y}`;
}
export function lastDayOfMonth(y, m) { return new Date(y, m, 0).getDate(); }
export function getTodayDay() { return new Date().getDate(); }
export function fmtDateShort(iso) {
  const { m, d } = isoParts(iso);
  return `${d} ${MONTH_NAMES[m - 1].slice(0, 3)}`;
}
export function ordinal(n) {
  if (!n) return "";
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return s[(v - 20) % 10] || s[v] || s[0];
}

export const inr = (n) => "₹" + Math.round(Math.abs(n)).toLocaleString("en-IN");

// ----------------------------------------------------------------------------
// Recurring due dates & "next bill"
// ----------------------------------------------------------------------------
// Next due date for a monthly recurring bill. A bill that's unpaid and up to a
// week overdue is still "next" (so it isn't silently skipped); once paid for
// this month, the next due date rolls to next month.
export function recurringNextDue(item, today = todayISO()) {
  const { y, m } = isoParts(today);
  const thisKey = `${y}-${pad2(m)}`;
  const day = Math.min(item.everyMonthDay, lastDayOfMonth(y, m));
  const thisDue = `${thisKey}-${pad2(day)}`;
  const paidThisMonth = item.lastPaid && item.lastPaid.slice(0, 7) === thisKey;
  if (!paidThisMonth && daysBetweenISO(today, thisDue) >= -7) return thisDue;
  const nm = m === 12 ? { y: y + 1, m: 1 } : { y, m: m + 1 };
  const nday = Math.min(item.everyMonthDay, lastDayOfMonth(nm.y, nm.m));
  return `${nm.y}-${pad2(nm.m)}-${pad2(nday)}`;
}

export function computeNextBill(recurringItems, planned, today = todayISO()) {
  const cands = [];
  (recurringItems || []).forEach((e) => {
    if (e.everyMonthDay) {
      cands.push({ key: "rec:" + e.id, name: e.desc, amount: e.amount, dueDate: recurringNextDue(e, today), source: "recurring" });
    }
  });
  (planned || []).forEach((p) => {
    cands.push({ key: "plan:" + p.id, name: p.desc, amount: p.amount, dueDate: p.dueDate, source: p.fromSms ? "sms" : "planned" });
  });
  const live = cands.filter((c) => c.dueDate && daysBetweenISO(today, c.dueDate) >= -7);
  live.sort((a, b) => a.dueDate.localeCompare(b.dueDate) || b.amount - a.amount);
  if (!live.length) return null;
  return { ...live[0], days: daysBetweenISO(today, live[0].dueDate) };
}

// ----------------------------------------------------------------------------
// Categories
// ----------------------------------------------------------------------------
export function guessCategory(desc = "") {
  const d = String(desc).toLowerCase();
  if (/salary|payroll/.test(d)) return "Income";
  // Savings = money you put away, not money you spent (counted separately from Spent).
  if (/\bsip\b|mutual fund|zerodha|groww|kuvera|paytm money|\bnps\b|\bppf\b|\bfd\b|fixed deposit|recurring deposit|rd installment|rd a\/c|digital gold|sovereign gold|gold bond|gold etf|smallcase|et money|upstox|angel one|5paisa|iccl|indian clearing|nse clearing/.test(d)) return "Savings";
  if (/credit card|cc bill|\bemi\b|loan|cred\.club|\bcred\b/.test(d)) return "Credit Card/EMI";
  // Insurance of every kind lives under Bills/Utilities.
  if (/insurance|\blic\b|premium|policy|acko|star health|max life/.test(d)) return "Bills/Utilities";
  if (/swiggy|zomato|eatsure|restaurant|cafe|coffee|dominos|domino's|pizza|burger|kfc|mcdonald|starbucks|biryani|bakery|dhaba|dine|food/.test(d)) return "Dining Out";
  if (/netflix|spotify|prime video|hotstar|jiocinema|sonyliv|zee5|youtube|movie|cinema|pvr|inox|bookmyshow|gaming|steam/.test(d)) return "Entertainment";
  if (/uber|\bola\b|rapido|petrol|diesel|fuel|hpcl|bpcl|iocl|indian oil|shell|metro|irctc|redbus|fastag|toll|cab\b|parking|makemytrip|indigo|air india/.test(d)) return "Travel/Fuel";
  if (/amazon|flipkart|myntra|ajio|meesho|nykaa|mall|decathlon|croma|lifestyle|zara|shopper|reliance digital/.test(d)) return "Shopping";
  if (/bigbasket|dmart|d-mart|grocery|kirana|supermarket|blinkit|zepto|instamart|more retail|reliance fresh|milk|vegetable|fruits|sabzi/.test(d)) return "Groceries";
  if (/pharmacy|apollo|medplus|pharmeasy|1mg|hospital|clinic|doctor|diagnostic|lab\b|dental|health/.test(d)) return "Health/Meds";
  if (/electricity|bescom|msedcl|tneb|tata power|adani|water bill|gas bill|piped gas|broadband|wifi|fiber|dth|tata play|recharge|postpaid|prepaid|airtel|\bjio\b|vodafone|\bvi\b|bsnl/.test(d)) return "Bills/Utilities";
  if (/school|tuition|fees|college|academy|coaching|byju|unacademy/.test(d)) return "Tuition/Education";
  if (/maid|cook|domestic help|servant/.test(d)) return "Domestic Help";
  if (/society|maintenance|rwa/.test(d)) return "Society Maintenance";
  return "Others";
}

// Old name -> new name. Used to migrate saved data and old backups.
export const CATEGORY_RENAMES = {
  "Insurance": "Bills/Utilities",
  "Utilities": "Bills/Utilities",
  "Transport": "Travel/Fuel",
  "Health": "Health/Meds",
  "Tuition / Education": "Tuition/Education",
  "Credit Card / EMI": "Credit Card/EMI",
};
export function renameCategory(c) { return CATEGORY_RENAMES[c] || c; }

// ----------------------------------------------------------------------------
// Persistence-adjacent helpers
// ----------------------------------------------------------------------------
export function hashString(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
export function hashToInt(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) % 2147483000 + 1; // positive 31-bit int (notification ids)
}

// ----------------------------------------------------------------------------
// SMS parsing
//   The native plugin now only *filters* the inbox down to financial-looking
//   messages and hands them over as { sender, body, ts }. All interpretation
//   (debit/credit/refund/bill) happens here, in testable JS.
// ----------------------------------------------------------------------------
const OTP_RE = /\botp\b|one[\s-]?time password|verification code|\bcvv\b|do not share|is your (?:code|pin|password)/i;
const PROMO_RE = /(?:^|\W)(?:offer|discount|win|congratulations|lottery|apply now|pre-?approved|limited period|exclusive|use code|coupon)(?:\W|$)/i;
const BANK_MARKER = /a\/c|acct|account|\bcard\b|\bupi\b|\bvpa\b|\bbank\b|\bimps\b|\bneft\b|\brtgs\b|wallet|paytm|phonepe|gpay|google pay|\bbhim\b|\batm\b/i;
const REFUND_RE = /refund|revers(?:ed|al)|chargeback|cashback.{0,40}credited|credited.{0,40}cashback/i;
const DEBIT_RE = /\b(?:debited|spent|withdrawn|withdrawal|purchase|paid|sent|transferred)\b/;
const CREDIT_RE = /\b(?:credited|received|deposited|refund\w*|reversed|reversal)\b/;
const FUTURE_DEBIT_RE = /(?:will be|to be)\s+(?:debited|deducted|charged|auto-?debited)|auto-?\s?debit|autopay|mandate/i;
const BILL_HINT = /\b(?:bill|statement|premium|emi|outstanding|amount due|amt due|due date|payment due|min(?:imum)? (?:amount )?due|pay (?:by|before)|last date|total due)\b/i;
const PAID_CONF = /(?:payment|amount|bill)[^.]{0,60}(?:received|successful|successfully|paid)|thank(?:s| you) for (?:your )?payment|has been (?:received|paid)|successfully paid/i;

export function senderName(sender = "") {
  const s = String(sender).trim();
  if (/^\+?\d[\d\s-]{6,}$/.test(s)) return s;
  const parts = s.split("-").filter(Boolean);
  if (parts.length >= 3) return parts[1];
  if (parts.length === 2 && parts[0].length <= 2) return parts[1];
  return parts.length ? parts.join("-") : s;
}

function titleCase(str) {
  return str.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase());
}
export function prettyMerchant(raw = "") {
  let s = String(raw).trim();
  if (!s) return "";
  if (s.includes("@")) s = s.split("@")[0].replace(/[._-]+/g, " ").trim();
  s = s.replace(/\s+/g, " ").replace(/[\s.,;:-]+$/, "");
  if (/^(?:xx|x{2,}|\*+)\d*/i.test(s) || /a\/c|acct/i.test(s)) return "";
  if (s === s.toUpperCase() || s === s.toLowerCase()) s = titleCase(s);
  return s.length > 34 ? s.slice(0, 34).trim() : s;
}

const STOP = String.raw`(?=\s+(?:on|ref|upi|txn|via|dated|has|have|is|was|will|for|towards|using|a\/c|acct|account|credited|debited|avl|bal|not|if|call|to)\b|\s+-\s|\s*[.,;(]|\s*$)`;
function capture(re, text) {
  const m = re.exec(text);
  return m && m[1] ? m[1].trim() : "";
}
function extractMerchant(body, dir, isRefund, sender) {
  const t = body.replace(/\s+/g, " ");
  const tries = [];
  if (isRefund) {
    tries.push(new RegExp(String.raw`\b(?:from|by|at)\s+([A-Za-z][A-Za-z0-9 .&'@_-]{1,32}?)` + STOP, "i"));
  } else if (dir === "credit") {
    tries.push(/(?:neft|imps|rtgs)[\s\-/]*(?:cr[\s\-/]*)?([A-Za-z][A-Za-z0-9 .&']{2,32}?)(?=\s*[-/]|\.|,|\s+on\b|\s+ref\b|\s*$)/i);
    tries.push(new RegExp(String.raw`\bfrom\s+(?:vpa\s+)?([A-Za-z][A-Za-z0-9 .&'@_-]{1,32}?)` + STOP, "i"));
  } else {
    tries.push(/\binfo[:\-\s]+(?:upi[/-]\w+[/-]\w+[/-])?([A-Za-z][A-Za-z0-9 .&'@_-]{1,32}?)(?=\.|,|;|\s{2,}|\s+(?:avl|bal|ref|on)\b|\s*$)/i);
    tries.push(new RegExp(String.raw`\bat\s+([A-Za-z][A-Za-z0-9 .&'@_-]{1,32}?)` + STOP, "i"));
    tries.push(new RegExp(String.raw`\bto\s+(?:vpa\s+)?([A-Za-z][A-Za-z0-9 .&'@_-]{1,32}?)` + STOP, "i"));
    tries.push(new RegExp(String.raw`\btowards\s+([A-Za-z][A-Za-z0-9 .&'@_-]{1,32}?)` + STOP, "i"));
  }
  for (const re of tries) {
    const raw = capture(re, t);
    const got = prettyMerchant(raw);
    if (got && got.length >= 2) return { pretty: got, raw };
  }
  const sn = senderName(sender);
  return { pretty: sn, raw: sn };
}

function pickAmount(body, skipKeywords = /(?:bal|balance|limit|lmt|available|avl|outstanding|min|minimum)\W*$/i) {
  const re = /(?:\brs\.?|\binr|₹)\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/gi;
  let m;
  while ((m = re.exec(body))) {
    const before = body.slice(Math.max(0, m.index - 24), m.index);
    if (skipKeywords.test(before)) continue;
    const v = parseFloat(m[1].replace(/,/g, ""));
    if (v > 0) return v;
  }
  return null;
}

// ---- date parsing for bill due dates ---------------------------------------
const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
function fullYear(y) { return y < 100 ? 2000 + y : y; }
function validISO(y, m, d) {
  if (m < 1 || m > 12 || d < 1 || d > lastDayOfMonth(y, m)) return null;
  return `${y}-${pad2(m)}-${pad2(d)}`;
}
function resolveYearless(m, d, today) {
  const { y } = isoParts(today);
  let iso = validISO(y, m, d);
  if (iso && daysBetweenISO(today, iso) < -30) iso = validISO(y + 1, m, d);
  return iso;
}
const MON_RE = "jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec";
export function findDueDate(body, today = todayISO()) {
  const found = [];
  let m;
  const numeric = /\b(\d{1,2})(?:st|nd|rd|th)?[\s\-/.](\d{1,2})[\s\-/.](\d{2,4})\b/g;
  while ((m = numeric.exec(body))) {
    const iso = validISO(fullYear(+m[3]), +m[2], +m[1]);
    if (iso) found.push({ index: m.index, iso });
  }
  const dayMon = new RegExp(String.raw`\b(\d{1,2})(?:st|nd|rd|th)?[\s\-/.]?(${MON_RE})[a-z]*\.?(?:[\s\-/.,]*(\d{4}|\d{2}))?\b`, "gi");
  while ((m = dayMon.exec(body))) {
    const mon = MON[m[2].toLowerCase()];
    const iso = m[3] ? validISO(fullYear(+m[3]), mon, +m[1]) : resolveYearless(mon, +m[1], today);
    if (iso) found.push({ index: m.index, iso });
  }
  const monDay = new RegExp(String.raw`\b(${MON_RE})[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s*(\d{4}))?\b`, "gi");
  while ((m = monDay.exec(body))) {
    const mon = MON[m[1].toLowerCase()];
    const iso = m[3] ? validISO(+m[3], mon, +m[2]) : resolveYearless(mon, +m[2], today);
    if (iso) found.push({ index: m.index, iso });
  }
  found.sort((a, b) => a.index - b.index);
  // Trigger phrases directly before the date. The "will be debited ... on <date>"
  // form allows a few words in between ("...debited from A/c XX1234 on <date>").
  const ctx = /(?:due(?:\s*date)?|pay(?:ment)?\s*(?:by|before|on)|last\s*date|before|\bby|auto-?\s?debit(?:\s+on)?|(?:will be|to be)\s+(?:debited|deducted|charged)[^.]{0,40}?)\W*(?:is|on|:|-|=)?\W*(?:the\s+)?$/i;
  for (const f of found) {
    const before = body.slice(Math.max(0, f.index - 64), f.index);
    if (ctx.test(before)) return f.iso;
  }
  return null;
}

function firstAmountAfter(re, body) {
  const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
  let m;
  while ((m = g.exec(body))) {
    const before = body.slice(Math.max(0, m.index - 10), m.index);
    if (/min(?:imum)?\s*$/i.test(before)) continue;
    const v = parseFloat(m[1].replace(/,/g, ""));
    if (v > 0) return v;
  }
  return null;
}
const AMT = String.raw`[^0-9₹]{0,25}(?:rs\.?|inr|₹)?\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)`;
const BILL_AMOUNT_RES = [
  new RegExp(String.raw`total\s*(?:amount|amt)?\s*(?:due|payable)` + AMT, "i"),
  new RegExp(String.raw`(?:bill\s*(?:amount|of)|premium(?:\s*amount)?(?:\s*of)?|emi(?:\s*amount)?(?:\s*of)?|payable|outstanding(?:\s*amount)?|due\s*amount)` + AMT, "i"),
  new RegExp(String.raw`(?:amount|amt)\s*due` + AMT, "i"),
];

function billTypeOf(lower) {
  if (/credit\s*card|\bcc\b|card ending|card no/.test(lower)) return { label: "credit card bill", category: "Credit Card/EMI" };
  if (/\bemi\b|loan/.test(lower)) return { label: "loan EMI", category: "Credit Card/EMI" };
  if (/insurance|premium|policy|\blic\b/.test(lower)) return { label: "insurance premium", category: "Bills/Utilities" };
  if (/electricity|bescom|msedcl|discom|tneb|power|energy/.test(lower)) return { label: "electricity bill", category: "Bills/Utilities" };
  if (/water/.test(lower)) return { label: "water bill", category: "Bills/Utilities" };
  if (/\bgas\b|piped/.test(lower)) return { label: "gas bill", category: "Bills/Utilities" };
  if (/broadband|fiber|fibre|wifi/.test(lower)) return { label: "broadband bill", category: "Bills/Utilities" };
  if (/postpaid|mobile|recharge/.test(lower)) return { label: "mobile bill", category: "Bills/Utilities" };
  return { label: "bill", category: "Bills/Utilities" };
}
const KNOWN_BILLERS = /\b(hdfc|icici|sbi|axis|kotak|yes bank|idfc|indusind|rbl|amex|american express|bescom|airtel|jio|vodafone|bsnl|tata power|adani|lic|max life|bajaj|star health|acko|digit|tata play)\b/i;

function parseBill(body, sender, ts, today, futureDebit = false) {
  const lower = body.toLowerCase();
  const dueDate = findDueDate(body, today);
  if (!dueDate) return null;
  let amount = null;
  for (const re of BILL_AMOUNT_RES) { amount = firstAmountAfter(re, body); if (amount) break; }
  if (!amount) amount = pickAmount(body);
  if (!amount) return null;
  const age = daysBetweenISO(today, dueDate);
  if (age < -200 || age > 120) return null;
  // A bill whose due date has already passed is kept (flagged stale) rather than
  // dropped: it can't become an Upcoming item, but it is evidence of a monthly
  // pattern ("last month's statement + this month's statement").
  const stale = age < -7;
  const type = billTypeOf(lower);
  const known = KNOWN_BILLERS.exec(body);
  const biller = known ? (known[1].length <= 4 ? known[1].toUpperCase() : titleCase(known[1])) : senderName(sender);
  const desc = `${biller} ${type.label}`;
  const key = `${biller.toLowerCase()}|${type.label}|${Math.round(amount)}|${dueDate}`;
  return {
    kind: "bill",
    bill: {
      desc, category: type.category, amount, dueDate, billKey: key,
      billerKey: `${biller.toLowerCase()}|${type.label}`, billLabel: type.label,
      autoDebit: !!futureDebit, stale,
      smsKey: `${ts}|${sender}|${hashString(body)}`, sender, body, ts,
    },
  };
}

// Returns null (ignore) | { kind: "txn", tx } | { kind: "bill", bill }
export function parseSmsMessage(m, today = todayISO()) {
  const body = String(m.body || "").trim();
  const sender = String(m.sender || "");
  const ts = Number(m.ts) || Date.now();
  if (!body) return null;
  const lower = body.toLowerCase();
  if (OTP_RE.test(body)) return null;

  const debitIdx = lower.search(DEBIT_RE);
  const creditIdx = lower.search(CREDIT_RE);
  const hasMoveWord = /debited|credited|spent|withdrawn|refund|reversed/.test(lower);
  if (PROMO_RE.test(body) && !hasMoveWord) return null;

  // 1) Bills / upcoming auto-debits
  const futureDebit = FUTURE_DEBIT_RE.test(body);
  if ((BILL_HINT.test(body) || futureDebit) && !PAID_CONF.test(body)) {
    const bill = parseBill(body, sender, ts, today, futureDebit);
    if (bill) return bill;
    if (futureDebit) return null; // a *future* debit is not a transaction that happened
  }

  // 2) Transactions
  if (!BANK_MARKER.test(body)) return null;
  const isRefund = REFUND_RE.test(body) && creditIdx >= 0;
  let dir = null;
  if (isRefund) dir = "credit";
  else if (debitIdx >= 0 && (creditIdx < 0 || debitIdx < creditIdx)) dir = "debit";
  else if (creditIdx >= 0) dir = "credit";
  if (!dir) return null;

  // Payment received *on a credit card* is not income.
  if (dir === "credit" && !isRefund && /\bcard\b/.test(lower) && !/a\/c|account|\bupi\b|\bvpa\b/.test(lower)) return null;

  const amount = pickAmount(body);
  if (!amount) return null;

  const date = localISO(new Date(ts));
  const smsKey = `${ts}|${sender}|${hashString(body)}`;
  const mer = extractMerchant(body, dir, isRefund, sender);
  let desc = mer.pretty;
  const extractedDesc = desc;
  let category, signed, type;

  if (isRefund) {
    type = "refund"; signed = -amount;
    if (/cashback/i.test(body)) desc = desc && desc !== senderName(sender) ? desc : "Cashback";
    else if (!desc || desc === senderName(sender)) desc = "Refund";
    const g = guessCategory(desc);
    category = g === "Income" ? "Others" : g;
  } else if (dir === "credit") {
    type = "credit"; signed = -amount; category = "Income";
    if (/salary/i.test(body)) desc = "Salary";
  } else {
    type = "debit"; signed = amount;
    if (/\batm\b|cash withdrawal|withdrawn|withdrawal/i.test(body)) desc = "ATM cash withdrawal";
    category = guessCategory(desc);
    if (category === "Others") category = guessCategory(body.replace(/debited|credited/gi, ""));
  }
  // Key used to remember user corrections: stable across display-name changes
  // (for UPI handles the digits are stripped, so "shop123@ybl" == "shop456@ybl").
  const mkey = desc === extractedDesc ? merchantKey(mer.raw) : merchantKey(desc);

  const tx = {
    id: `sms_${ts}_${hashString(body)}`,
    desc, amount: signed, category, date, type,
    source: `SMS · ${senderName(sender)}`, sender, body, smsKey, ts, mkey,
  };
  // Paying a credit-card bill from the bank account is a transfer — the card
  // purchases themselves are already counted, so don't double-count by default.
  if (type === "debit" && /credit\s*card|cc\s*bill|card\s*(?:bill|payment)|\bcred\b/i.test(body + " " + desc)) {
    tx.category = "Credit Card/EMI";
    tx.excluded = true;
    tx.excludedReason = "Credit-card bill payment — card purchases are already counted";
  }
  return { kind: "txn", tx };
}

// Turn a batch of raw messages into new transactions + bills, skipping anything
// already imported (or deliberately deleted by the user).
export function ingestMessages(messages, { txKeys = new Set(), billKeys = new Set(), ignored = new Set(), today = todayISO(), rules = [] } = {}) {
  const txs = [];
  const bills = [];
  const staleBills = [];
  let skipped = 0;
  const seenBill = new Set(billKeys);
  const seenTx = new Set(txKeys);
  for (const m of messages || []) {
    const parsed = parseSmsMessage(m, today);
    if (!parsed) { skipped++; continue; }
    if (parsed.kind === "txn") {
      const k = parsed.tx.smsKey;
      if (ignored.has(k) || seenTx.has(k)) { skipped++; continue; }
      seenTx.add(k);
      txs.push(applyRules(parsed.tx, rules));
    } else {
      const b = parsed.bill;
      if (ignored.has(b.smsKey) || ignored.has(b.billKey) || seenBill.has(b.billKey)) { skipped++; continue; }
      seenBill.add(b.billKey);
      (b.stale ? staleBills : bills).push(b);
    }
  }
  return { txs, bills, staleBills, skipped };
}

// ----------------------------------------------------------------------------
// Streaks — consecutive days with a logging action
// ----------------------------------------------------------------------------
export function computeStreakInfo(dates, today = todayISO()) {
  const set = new Set(dates || []);
  const todayDone = set.has(today);
  let current = 0;
  let cursor = todayDone ? today : addDaysISO(today, -1);
  while (set.has(cursor)) { current++; cursor = addDaysISO(cursor, -1); }
  const sorted = [...set].sort();
  let best = 0, run = 0, prev = null;
  for (const d of sorted) {
    run = prev && daysBetweenISO(prev, d) === 1 ? run + 1 : 1;
    if (run > best) best = run;
    prev = d;
  }
  const last7 = [];
  for (let i = 6; i >= 0; i--) { const d = addDaysISO(today, -i); last7.push({ date: d, done: set.has(d) }); }
  return { current, best, todayDone, atRisk: current > 0 && !todayDone, last7 };
}

// ----------------------------------------------------------------------------
// Repeating-charge (forgotten subscription) detector
// ----------------------------------------------------------------------------
export function normMerchant(desc = "") {
  return String(desc).toLowerCase().replace(/[^a-z]+/g, " ")
    .replace(/\b(?:upi|pos|ref|txn|payment|to|at|via|ltd|pvt|limited|india|online)\b/g, " ")
    .replace(/\s+/g, " ").trim().slice(0, 24);
}
function similarAmount(a, b) { return Math.abs(a - b) <= Math.max(a, b) * 0.05 || Math.abs(a - b) <= 10; }

export function detectRecurringCharges(txList, today = todayISO(), trackedKeys = new Set()) {
  const groups = new Map();
  for (const t of txList || []) {
    if (!(t.amount > 0) || t.category === "Income" || t.excluded) continue;
    const k = normMerchant(t.desc);
    if (!k || k.length < 3 || /\batm\b|cash withdrawal/.test(k)) continue;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(t);
  }
  const out = [];
  for (const [key, arr] of groups) {
    if (arr.some((t) => t.recurring || t.recurringId) || trackedKeys.has(key)) continue;   // already tracked as recurring
    const sorted = [...arr].sort((a, b) => a.date.localeCompare(b.date));
    // collapse same-day duplicates
    const days = [];
    for (const t of sorted) if (!days.length || days[days.length - 1].date !== t.date) days.push(t);
    if (days.length < 2) continue;
    const last = days[days.length - 1];
    if (daysBetweenISO(last.date, today) > 45) continue;         // stopped already
    const chain = [last];
    for (let i = days.length - 2; i >= 0; i--) {
      const gap = daysBetweenISO(days[i].date, chain[0].date);
      if (gap >= 25 && gap <= 40 && similarAmount(days[i].amount, last.amount)) chain.unshift(days[i]); else break;
    }
    if (chain.length < 2) continue;
    out.push({
      key, name: last.desc, amount: last.amount, category: last.category, count: chain.length,
      lastDate: last.date, yearly: last.amount * 12, lastId: last.id, ids: chain.map((t) => t.id),
    });
  }
  return out.sort((a, b) => b.amount - a.amount);
}

// ----------------------------------------------------------------------------
// Period statistics (used by Money Wrapped and by exports)
// ----------------------------------------------------------------------------
export function monthRange(key, today = todayISO()) {
  const [y, m] = key.split("-").map(Number);
  const start = `${key}-01`;
  const full = `${key}-${pad2(lastDayOfMonth(y, m))}`;
  const end = today >= start && today < full ? today : full;
  return { start, end, key, label: monthLabel(key) };
}
export function periodRange(kind, today = todayISO()) {
  const key = monthKey(today);
  if (kind === "month") return monthRange(key, today);
  if (kind === "lastMonth") return monthRange(prevMonthKey(key), today);
  if (kind === "year") { const { y } = isoParts(today); return { start: `${y}-01-01`, end: today, key: String(y), label: `${y} so far` }; }
  if (kind === "last90") return { start: addDaysISO(today, -89), end: today, key: "last90", label: "Last 90 days" };
  return { start: "0000-01-01", end: "9999-12-31", key: "all", label: "All time" };
}

export function summarizePeriod(txList, recurringItems, range) {
  // recurringItems is accepted for backwards compatibility but unused: recurring
  // bills now count as spending only when actually paid, i.e. as transactions.
  const inRange = (txList || []).filter((t) => t.date >= range.start && t.date <= range.end && !t.excluded);
  let income = 0, refunds = 0, spend = 0, saved = 0, count = 0;
  const cat = new Map();
  const merch = new Map();
  let biggest = null;
  for (const t of inRange) {
    if (t.category === "Income") { income += Math.abs(t.amount); continue; }
    if (t.category === "Savings") { saved += t.amount; continue; }
    spend += t.amount;
    cat.set(t.category, (cat.get(t.category) || 0) + t.amount);
    if (t.amount < 0) refunds += Math.abs(t.amount);
    else {
      count++;
      const k = normMerchant(t.desc) || t.desc;
      const cur = merch.get(k) || { name: t.desc, total: 0, n: 0 };
      cur.total += t.amount; cur.n += 1; merch.set(k, cur);
      if (!biggest || t.amount > biggest.amount) biggest = t;
    }
  }
  spend = Math.max(0, spend);
  const categories = [...cat.entries()].map(([category, amount]) => ({ category, amount })).filter((c) => c.amount > 0).sort((a, b) => b.amount - a.amount);
  const topMerchant = [...merch.values()].sort((a, b) => b.total - a.total)[0] || null;
  const net = income - spend;                    // not spent (includes what went to savings)
  return {
    range, income, spend, saved, refunds, net, leftOver: net - saved, count, categories, topMerchant, biggest,
    topCategory: categories[0] ? { ...categories[0], pct: spend ? (categories[0].amount / spend) * 100 : 0 } : null,
    savingsRate: income > 0 ? Math.max(0, (net / income) * 100) : null,
  };
}

// Consecutive months (ending at `endKey`, walking backwards) in which income
// exceeded spending. Needs income data, so it is 0 until credits are logged.
export function savingsStreakMonths(txList, endKey, today = todayISO(), maxLookback = 12) {
  let key = endKey, n = 0;
  for (let i = 0; i < maxLookback; i++) {
    const s = summarizePeriod(txList, [], monthRange(key, today));
    if (s.income > 0 && s.income > s.spend) { n++; key = prevMonthKey(key); } else break;
  }
  return n;
}

export function computeWrapped({ txList, recurringItems, goals, activityDates, kind = "month", today = todayISO() }) {
  const range = periodRange(kind, today);
  const cur = summarizePeriod(txList, recurringItems, range);
  const streak = computeStreakInfo(activityDates, today);
  const endKey = kind === "year" ? monthKey(today) : range.key;
  const savingsStreak = savingsStreakMonths(txList, kind === "month" || kind === "year" ? monthKey(today) : endKey, today);

  let prev = null;
  if (kind === "lastMonth") prev = summarizePeriod(txList, [], monthRange(prevMonthKey(range.key), today));

  // "Biggest win": the most flattering true thing we can say about the period.
  let win = null;
  const done = (goals || []).find((g) => g.target > 0 && g.saved >= g.target);
  if (done) win = { title: "Goal achieved", detail: `${done.name} is fully funded (${inr(done.target)}).` };
  if (!win && prev) {
    const drops = cur.categories.length || prev.categories.length
      ? prev.categories.map((p) => {
          const c = cur.categories.find((x) => x.category === p.category);
          return { category: p.category, drop: p.amount - (c ? c.amount : 0), before: p.amount, after: c ? c.amount : 0 };
        }).filter((d) => d.drop >= 500 && d.after <= d.before * 0.8).sort((a, b) => b.drop - a.drop)
      : [];
    if (drops[0]) win = { title: `${drops[0].category} down ${inr(drops[0].drop)}`, detail: `${inr(drops[0].after)} vs ${inr(drops[0].before)} the month before.` };
  }
  if (!win && cur.income > 0 && cur.net > 0) {
    win = { title: `Saved ${inr(cur.net)}`, detail: `You kept ${cur.savingsRate.toFixed(0)}% of what you earned.` };
  }
  if (!win && cur.refunds > 0) win = { title: `Recovered ${inr(cur.refunds)}`, detail: "Refunds and reversals that came back to you." };
  if (!win && cur.count > 0) win = { title: `Logged ${cur.count} transactions`, detail: "Every entry makes the picture clearer." };

  return { range, kind, cur, prev, win, streak, savingsStreak, hasData: cur.count > 0 || cur.income > 0 || cur.spend > 0 };
}

// ----------------------------------------------------------------------------
// Notification planner — pure. The app feeds it current state and it returns
// what to fire now vs. schedule. `notifState.keys` de-duplicates across runs.
// ----------------------------------------------------------------------------
export function planNotifications({ budgetsWithSpend, goals, planned, recurringItems, notifState, today = todayISO(), nowMs = Date.now() }) {
  const keys = new Set((notifState && notifState.keys) || []);
  const firstRun = !(notifState && notifState.init);
  const immediate = [];
  const newKeys = [];
  const mk = monthKey(today);
  const fire = (key, title, body, silentOnFirstRun) => {
    if (keys.has(key)) return;
    if (!(firstRun && silentOnFirstRun)) immediate.push({ key, title, body });
    newKeys.push(key);
  };

  // Budgets: 80% and 100%
  (budgetsWithSpend || []).forEach((b) => {
    if (!b.limit) return;
    const pct = (b.spent / b.limit) * 100;
    const k80 = `b:${b.category}:${mk}:80`, k100 = `b:${b.category}:${mk}:100`;
    if (pct >= 100) {
      fire(k100, `${b.category} budget used up`, `You've spent ${inr(b.spent)} of your ${inr(b.limit)} budget this month.`, true);
      if (!keys.has(k80)) newKeys.push(k80);
    } else if (pct >= 80) {
      fire(k80, `${b.category} budget at ${Math.floor(pct)}%`, `${inr(b.limit - b.spent)} left of ${inr(b.limit)} for this month.`, true);
    }
  });

  // Goals: 50% and 100%
  (goals || []).forEach((g) => {
    if (!g.target) return;
    const pct = (g.saved / g.target) * 100;
    const k50 = `g:${g.id}:50`, k100 = `g:${g.id}:100`;
    if (pct >= 100) {
      fire(k100, `Goal reached: ${g.name}`, `You've fully funded ${g.name} — ${inr(g.target)}. Well done.`, true);
      if (!keys.has(k50)) newKeys.push(k50);
    } else if (pct >= 50) {
      fire(k50, `Halfway there: ${g.name}`, `${inr(g.saved)} of ${inr(g.target)} saved.`, true);
    }
  });

  // Bills: reminder at 9:00 the day before AND the morning of the due date
  const bills = [];
  (recurringItems || []).forEach((e) => {
    if (e.everyMonthDay) bills.push({ key: "rec:" + e.id, name: e.desc, amount: e.amount, dueDate: recurringNextDue(e, today) });
  });
  (planned || []).forEach((p) => bills.push({ key: "plan:" + p.id, name: p.desc, amount: p.amount, dueDate: p.dueDate }));

  const scheduled = [];
  const at9 = (iso) => { const { y, m, d } = isoParts(iso); return new Date(y, m - 1, d, 9, 0, 0).getTime(); };
  bills.forEach((b) => {
    if (!b.dueDate) return;
    const days = daysBetweenISO(today, b.dueDate);
    if (days < 0 || days > 45) return;
    const dayBeforeAt = at9(addDaysISO(b.dueDate, -1));
    const dueAt = at9(b.dueDate);
    if (dayBeforeAt > nowMs + 60000) {
      scheduled.push({ id: hashToInt(`bill:${b.key}:${b.dueDate}:eve`), title: "Bill due tomorrow", body: `${b.name} · ${inr(b.amount)}`, at: dayBeforeAt });
    } else if (days === 1) {
      fire(`bill:${b.key}:${b.dueDate}:eve`, "Bill due tomorrow", `${b.name} · ${inr(b.amount)}`, false);
    }
    if (dueAt > nowMs + 60000) {
      scheduled.push({ id: hashToInt(`bill:${b.key}:${b.dueDate}:day`), title: "Bill due today", body: `${b.name} · ${inr(b.amount)}`, at: dueAt });
    }
  });
  scheduled.sort((a, b) => a.at - b.at);
  return { immediate, scheduled: scheduled.slice(0, 40), newKeys };
}

// ----------------------------------------------------------------------------
// WhatsApp nudge
// ----------------------------------------------------------------------------
export function firstName(name = "") { return String(name).replace(/\(.*?\)/g, "").trim().split(/\s+/)[0] || String(name); }
export function normalizePhone(p = "") {
  const d = String(p).replace(/\D/g, "");
  if (d.length === 10) return "91" + d;                       // assume India for bare 10-digit numbers
  if (d.length === 11 && d.startsWith("0")) return "91" + d.slice(1);
  return d;
}
export function waLink(phone, text) {
  const n = normalizePhone(phone);
  return `https://wa.me/${n}?text=${encodeURIComponent(text)}`;
}
// debtorName: who the WhatsApp message is addressed to (they're the one who owes).
// creditorName/creditorIsMe: who the money is owed to — "me" if it's the current profile.
export function buildNudgeText({ debtorName, creditorName, creditorIsMe, amount, items }) {
  const who = creditorIsMe ? "me" : firstName(creditorName);
  return `Hi ${firstName(debtorName)}, quick reminder — you owe ${who} ${inr(amount)} for ${items || "our shared expenses"}. Please settle up when you can. Thanks! (sent from TruCent)`;
}

// ----------------------------------------------------------------------------
// Home-screen widget payload
// ----------------------------------------------------------------------------
export function buildWidgetPayload({ income, totalSpend, saved, nextBill, streak, today = todayISO() }) {
  const { m } = isoParts(today);
  const hasData = income > 0 || totalSpend > 0;
  return {
    label: `LEFT OVER · ${MONTH_NAMES[m - 1].toUpperCase()}`,   // `saved` argument = Earned - Spent - Saved
    net: hasData ? `${saved >= 0 ? "+" : "-"}${inr(saved)}` : "—",
    netPositive: saved >= 0,
    earned: inr(income), spent: inr(totalSpend),
    nextBillName: nextBill ? nextBill.name : "",
    nextBillAmount: nextBill ? inr(nextBill.amount) : "",
    nextBillDue: nextBill ? nextBill.dueDate : "",
    streak: streak ? streak.current : 0,
    updatedAt: Date.now(),
  };
}

// ----------------------------------------------------------------------------
// Export: Excel (.xlsx) and PDF, both hand-built so they need no dependencies
// ----------------------------------------------------------------------------
export function buildExportModel({ txList, expenses, recurringItems, nameOf, range, today = todayISO() }) {
  const s = summarizePeriod(txList, recurringItems, range);
  const txs = (txList || []).filter((t) => t.date >= range.start && t.date <= range.end).sort((a, b) => a.date.localeCompare(b.date));
  const typeOf = (t) => t.category === "Income" ? "Income" : t.category === "Savings" && t.amount > 0 ? "Savings" : t.amount < 0 ? "Refund" : "Expense";
  const txRows = txs.map((t) => [
    t.date, t.desc, t.category, typeOf(t),
    t.amount > 0 ? t.amount : null, t.amount < 0 ? Math.abs(t.amount) : null,
    t.source || "", t.excluded ? "No" : "Yes",
  ]);
  const grp = (expenses || []).filter((e) => !e.recurring && e.date >= range.start && e.date <= range.end).sort((a, b) => a.date.localeCompare(b.date));
  const groupRows = grp.map((e) => [
    e.date, e.desc, e.category, nameOf(e.paidBy), (e.splitAmong || []).map(nameOf).join(", "), e.amount,
    e.splitAmong && e.splitAmong.length ? Math.round((e.amount / e.splitAmong.length) * 100) / 100 : e.amount,
  ]);
  const catRows = s.categories.map((c) => [c.category, Math.round(c.amount * 100) / 100, s.spend ? Math.round((c.amount / s.spend) * 1000) / 10 : 0]);
  const summaryRows = [
    ["Period", range.label],
    ["Earned", s.income], ["Spent (excl. refunds & savings)", s.spend],
    ["Saved / invested", s.saved], ["Refunds received", s.refunds], ["Left over", s.leftOver],
    ["Savings rate", s.savingsRate == null ? "n/a" : `${s.savingsRate.toFixed(0)}%`],
    ["Transactions", String(s.count)], ["Generated on", today],
  ];
  return { range, summary: s, summaryRows, txRows, groupRows, catRows };
}

// --- ZIP (store only) + CRC32 ----------------------------------------------
let CRC_TABLE = null;
function crc32(bytes) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; CRC_TABLE[n] = c >>> 0; }
  }
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function zipStore(files) {
  const enc = new TextEncoder();
  const chunks = [], central = [];
  let offset = 0;
  const u16 = (n) => [n & 255, (n >>> 8) & 255];
  const u32 = (n) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];
  for (const f of files) {
    const name = enc.encode(f.name);
    const data = typeof f.data === "string" ? enc.encode(f.data) : f.data;
    const crc = crc32(data);
    const local = new Uint8Array([
      ...u32(0x04034b50), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21),
      ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(name.length), ...u16(0),
    ]);
    chunks.push(local, name, data);
    central.push({ name, crc, size: data.length, offset });
    offset += local.length + name.length + data.length;
  }
  const cdStart = offset;
  for (const c of central) {
    const hdr = new Uint8Array([
      ...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21),
      ...u32(c.crc), ...u32(c.size), ...u32(c.size), ...u16(c.name.length), ...u16(0), ...u16(0),
      ...u16(0), ...u16(0), ...u32(0), ...u32(c.offset),
    ]);
    chunks.push(hdr, c.name);
    offset += hdr.length + c.name.length;
  }
  const eocd = new Uint8Array([
    ...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(central.length), ...u16(central.length),
    ...u32(offset - cdStart), ...u32(cdStart), ...u16(0),
  ]);
  chunks.push(eocd);
  const total = chunks.reduce((s, c) => s + c.length, 0);
  const out = new Uint8Array(total);
  let p = 0;
  for (const c of chunks) { out.set(c, p); p += c.length; }
  return out;
}

const xmlEsc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
  .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
function colLetter(i) { let s = ""; i++; while (i > 0) { const r = (i - 1) % 26; s = String.fromCharCode(65 + r) + s; i = Math.floor((i - 1) / 26); } return s; }

// sheets: [{ name, rows: [[cell,...]], widths?: [n,...], header?: true }]
export function buildXlsx(sheets) {
  const files = [];
  const safeName = (n, i) => (String(n).replace(/[\[\]:*?/\\]/g, " ").slice(0, 31) || `Sheet${i + 1}`);
  files.push({ name: "[Content_Types].xml", data:
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
    sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("") +
    `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>` });
  files.push({ name: "_rels/.rels", data:
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` });
  files.push({ name: "xl/workbook.xml", data:
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>` +
    sheets.map((s, i) => `<sheet name="${xmlEsc(safeName(s.name, i))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("") + `</sheets></workbook>` });
  files.push({ name: "xl/_rels/workbook.xml.rels", data:
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("") +
    `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` });
  files.push({ name: "xl/styles.xml", data:
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.00"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF8B5CF6"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>` });

  sheets.forEach((sh, si) => {
    const header = sh.header !== false;
    let xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">`;
    if (header) xml += `<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>`;
    if (sh.widths && sh.widths.length) xml += `<cols>` + sh.widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("") + `</cols>`;
    xml += `<sheetData>`;
    sh.rows.forEach((row, ri) => {
      xml += `<row r="${ri + 1}">`;
      row.forEach((cell, ci) => {
        if (cell === null || cell === undefined || cell === "") return;
        const ref = colLetter(ci) + (ri + 1);
        if (typeof cell === "number" && isFinite(cell)) xml += `<c r="${ref}" s="2"><v>${cell}</v></c>`;
        else xml += `<c r="${ref}" t="inlineStr"${header && ri === 0 ? ' s="1"' : ""}><is><t xml:space="preserve">${xmlEsc(cell)}</t></is></c>`;
      });
      xml += `</row>`;
    });
    xml += `</sheetData></worksheet>`;
    files.push({ name: `xl/worksheets/sheet${si + 1}.xml`, data: xml });
  });
  return zipStore(files);
}

export function buildExportXlsx(model) {
  return buildXlsx([
    { name: "Summary", header: false, widths: [44, 22], rows: model.summaryRows },
    { name: "Transactions", widths: [12, 34, 20, 10, 14, 14, 22, 10],
      rows: [["Date", "Description", "Category", "Type", "Debit (₹)", "Credit (₹)", "Source", "Counted"], ...model.txRows] },
    { name: "Group expenses", widths: [12, 30, 20, 18, 30, 14, 14],
      rows: [["Date", "Description", "Category", "Paid by", "Split among", "Amount (₹)", "Per person (₹)"], ...model.groupRows] },
    { name: "By category", widths: [26, 16, 12], rows: [["Category", "Spent (₹)", "% of spend"], ...model.catRows] },
  ]);
}

// --- PDF (text only, Latin-1) -----------------------------------------------
function pdfSafe(s) {
  return String(s ?? "")
    .replace(/₹/g, "Rs.").replace(/[−–—]/g, "-").replace(/[·•]/g, "-").replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/…/g, "...")
    .replace(/[^\x20-\x7e]/g, "?")
    .replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}
const padTo = (s, w, right) => { s = String(s); if (s.length > w) s = s.slice(0, Math.max(0, w - 1)) + "."; return right ? s.padStart(w) : s.padEnd(w); };

// blocks: {t:"h",text} | {t:"p",text} | {t:"gap"} | {t:"table", cols:[{label,w,right?}], rows:[[...]]}
export function buildPdf({ title, subtitle, blocks }) {
  const SIZE = 8.5, CHAR = SIZE * 0.6, LEFT = 40, TOP = 800, LINE = 11.5, BOTTOM = 46;
  const maxChars = Math.floor((595 - 2 * LEFT) / CHAR);
  const pages = [[]];
  let y = TOP;
  const put = (text, font, size, extra = 0) => {
    if (y - LINE - extra < BOTTOM) { pages.push([]); y = TOP; }
    y -= LINE + extra;
    pages[pages.length - 1].push({ x: LEFT, y, text, font, size });
  };
  put(title, "F2", 17, 6);
  if (subtitle) put(subtitle, "F1", 10, 2);
  put("", "F3", SIZE);
  for (const b of blocks) {
    if (b.t === "gap") { put("", "F3", SIZE); continue; }
    if (b.t === "h") { put("", "F3", SIZE); put(b.text, "F2", 11.5, 2); continue; }
    if (b.t === "p") { put(b.text.slice(0, maxChars), "F3", SIZE); continue; }
    if (b.t === "table") {
      const widthSum = b.cols.reduce((s, c) => s + c.w, 0) + (b.cols.length - 1) * 2;
      const scale = widthSum > maxChars ? maxChars / widthSum : 1;
      const cols = b.cols.map((c) => ({ ...c, w: Math.max(4, Math.floor(c.w * scale)) }));
      const line = (cells) => cols.map((c, i) => padTo(cells[i] ?? "", c.w, c.right)).join("  ");
      put(line(cols.map((c) => c.label)), "F3", SIZE);
      put("-".repeat(Math.min(maxChars, cols.reduce((s, c) => s + c.w, 0) + (cols.length - 1) * 2)), "F3", SIZE);
      b.rows.forEach((r) => put(line(r), "F3", SIZE));
      continue;
    }
  }
  // Assemble objects. 1 Catalog, 2 Pages, 3-5 fonts, then (content, page) pairs.
  const objs = [];
  objs[1] = `<< /Type /Catalog /Pages 2 0 R >>`;
  objs[3] = `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>`;
  objs[4] = `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>`;
  objs[5] = `<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>`;
  const kids = [];
  pages.forEach((items, i) => {
    const body = items.map((it) => `BT /${it.font} ${it.size} Tf 1 0 0 1 ${it.x} ${it.y} Tm (${pdfSafe(it.text)}) Tj ET`).join("\n")
      + `\nBT /F3 7 Tf 1 0 0 1 ${LEFT} 24 Tm (${pdfSafe(`TruCent - page ${i + 1} of ${pages.length}`)}) Tj ET`;
    const cId = 6 + i * 2, pId = 7 + i * 2;
    objs[cId] = `<< /Length ${body.length} >>\nstream\n${body}\nendstream`;
    objs[pId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R >> >> /Contents ${cId} 0 R >>`;
    kids.push(`${pId} 0 R`);
  });
  objs[2] = `<< /Type /Pages /Kids [${kids.join(" ")}] /Count ${kids.length} >>`;
  let out = "%PDF-1.4\n";
  const offsets = [];
  for (let i = 1; i < objs.length; i++) { offsets[i] = out.length; out += `${i} 0 obj\n${objs[i]}\nendobj\n`; }
  const xref = out.length;
  out += `xref\n0 ${objs.length}\n0000000000 65535 f \n`;
  for (let i = 1; i < objs.length; i++) out += String(offsets[i]).padStart(10, "0") + " 00000 n \n";
  out += `trailer\n<< /Size ${objs.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  const bytes = new Uint8Array(out.length);
  for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 255;
  return bytes;
}

export function buildExportPdf(model, ownerLabel = "") {
  const s = model.summary;
  const blocks = [
    { t: "h", text: "Summary" },
    ...model.summaryRows.map(([k, v]) => ({ t: "p", text: `${padTo(k, 44)} ${typeof v === "number" ? inr(v).replace("₹", "Rs. ") : v}` })),
    { t: "h", text: "By category" },
    { t: "table", cols: [{ label: "Category", w: 26 }, { label: "Spent", w: 16, right: true }, { label: "%", w: 8, right: true }],
      rows: model.catRows.map(([c, a, p]) => [c, "Rs. " + Math.round(a).toLocaleString("en-IN"), p + "%"]) },
    { t: "h", text: `Transactions (${model.txRows.length})` },
    { t: "table",
      cols: [{ label: "Date", w: 10 }, { label: "Description", w: 30 }, { label: "Category", w: 18 }, { label: "Type", w: 8 }, { label: "Amount", w: 13, right: true }],
      rows: model.txRows.map((r) => [r[0], r[1], r[2], r[3], (r[4] != null ? "-" : "+") + Math.round(r[4] != null ? r[4] : r[5]).toLocaleString("en-IN")]) },
  ];
  if (model.groupRows.length) {
    blocks.push({ t: "h", text: `Group expenses (${model.groupRows.length})` });
    blocks.push({ t: "table",
      cols: [{ label: "Date", w: 10 }, { label: "Description", w: 26 }, { label: "Paid by", w: 14 }, { label: "Amount", w: 12, right: true }, { label: "Per person", w: 12, right: true }],
      rows: model.groupRows.map((r) => [r[0], r[1], r[3], Math.round(r[5]).toLocaleString("en-IN"), Math.round(r[6]).toLocaleString("en-IN")]) });
  }
  return buildPdf({ title: "TruCent statement", subtitle: `${s.range.label}${ownerLabel ? "  -  " + ownerLabel : ""}`, blocks });
}

export function bytesToBase64(bytes) {
  let s = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) s += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  return btoa(s);
}

// ----------------------------------------------------------------------------
// Group ledger export (Split tab) — a statement of shared one-off expenses
// plus the settle-up position, meant to be shared with the group: "here's
// what we spent, here's who owes what." Recurring bills are deliberately
// excluded, matching the app's own split — they're fixed costs, not shared
// debts (see the note in the Split tab itself).
// ----------------------------------------------------------------------------
export function buildGroupLedgerModel({ expenses, settlements, members, nameOf, today = todayISO() }) {
  const oneOff = (expenses || []).filter((e) => !e.recurring).sort((a, b) => a.date.localeCompare(b.date));

  const perMember = new Map();
  (members || []).forEach((m) => perMember.set(m.id, { id: m.id, name: nameOf(m.id), paid: 0, share: 0 }));
  const ensure = (id) => {
    if (!perMember.has(id)) perMember.set(id, { id, name: nameOf(id), paid: 0, share: 0 });
    return perMember.get(id);
  };
  oneOff.forEach((e) => {
    ensure(e.paidBy).paid += e.amount;
    const n = e.splitAmong && e.splitAmong.length ? e.splitAmong.length : 0;
    const per = n ? e.amount / n : 0;
    (e.splitAmong || []).forEach((id) => { ensure(id).share += per; });
  });
  const summary = [...perMember.values()]
    .map((m) => ({ ...m, net: m.paid - m.share }))
    .filter((m) => m.paid > 0.004 || m.share > 0.004)
    .sort((a, b) => b.net - a.net);

  const totalSpend = oneOff.reduce((s, e) => s + e.amount, 0);

  const ledgerRows = oneOff.map((e) => [
    e.date, e.desc, e.category, nameOf(e.paidBy),
    (e.splitAmong || []).map(nameOf).join(", "), e.amount,
    e.splitAmong && e.splitAmong.length ? Math.round((e.amount / e.splitAmong.length) * 100) / 100 : e.amount,
  ]);
  const settleRows = (settlements || []).map((s) => [nameOf(s.from), nameOf(s.to), Math.round(s.amount * 100) / 100]);
  const summaryRows = summary.map((m) => [m.name, Math.round(m.paid * 100) / 100, Math.round(m.share * 100) / 100, Math.round(m.net * 100) / 100]);

  return { oneOff, totalSpend, settlements: settlements || [], summary, ledgerRows, settleRows, summaryRows, today, count: oneOff.length };
}

export function buildGroupLedgerXlsx(model) {
  return buildXlsx([
    { name: "Settle up", widths: [20, 20, 16],
      rows: [["Owes", "Owed to", "Amount (₹)"], ...model.settleRows] },
    { name: "Per-member summary", widths: [20, 16, 16, 16],
      rows: [["Member", "Paid (₹)", "Share (₹)", "Net (₹)"], ...model.summaryRows] },
    { name: "Ledger", widths: [12, 30, 20, 16, 30, 14, 14],
      rows: [["Date", "Description", "Category", "Paid by", "Split among", "Amount (₹)", "Per person (₹)"], ...model.ledgerRows] },
  ]);
}

export function buildGroupLedgerPdf(model, ownerLabel = "") {
  const blocks = [{ t: "h", text: "Settle up" }];
  if (model.settleRows.length === 0) {
    blocks.push({ t: "p", text: "Everyone's square -- no one owes anyone right now." });
  } else {
    blocks.push({
      t: "table", cols: [{ label: "Owes", w: 18 }, { label: "Owed to", w: 18 }, { label: "Amount", w: 14, right: true }],
      rows: model.settleRows.map((r) => [r[0], r[1], "Rs. " + Math.round(r[2]).toLocaleString("en-IN")]),
    });
  }

  blocks.push({ t: "h", text: "Per-member summary" });
  blocks.push({
    t: "table",
    cols: [{ label: "Member", w: 18 }, { label: "Paid", w: 14, right: true }, { label: "Share", w: 14, right: true }, { label: "Net", w: 14, right: true }],
    rows: model.summary.map((m) => [
      m.name,
      "Rs. " + Math.round(m.paid).toLocaleString("en-IN"),
      "Rs. " + Math.round(m.share).toLocaleString("en-IN"),
      (m.net >= 0 ? "+" : "-") + "Rs. " + Math.round(Math.abs(m.net)).toLocaleString("en-IN"),
    ]),
  });

  blocks.push({ t: "h", text: `Ledger (${model.ledgerRows.length} expenses, Rs. ${Math.round(model.totalSpend).toLocaleString("en-IN")} total)` });
  blocks.push({
    t: "table",
    cols: [{ label: "Date", w: 10 }, { label: "Description", w: 30 }, { label: "Paid by", w: 12 }, { label: "Split among", w: 22 }, { label: "Amount", w: 12, right: true }],
    rows: model.ledgerRows.map((r) => [r[0], r[1], r[3], r[4], "Rs. " + Math.round(r[5]).toLocaleString("en-IN")]),
  });

  return buildPdf({ title: "TruCent group ledger", subtitle: ownerLabel || undefined, blocks });
}


// ----------------------------------------------------------------------------
// Learning from corrections. A rule says: "for this merchant key, in this
// direction (money out / money in), use this category". Rules override the
// built-in keyword guesses, and are only ever created by an explicit user
// action — never silently.
// ----------------------------------------------------------------------------
export function merchantKey(raw = "") {
  const s = String(raw).trim().toLowerCase();
  if (!s) return "";
  if (s.includes("@")) {
    const local = s.split("@")[0];
    const letters = normMerchant(local);
    if (letters.length >= 3) return letters;       // "shop123@ybl" -> "shop"
    const digits = local.replace(/\D/g, "");
    return digits ? "p:" + digits : local.slice(0, 24);   // phone-number handle
  }
  return normMerchant(s);
}
export function ruleKeyOf(tx) { return tx.mkey || merchantKey(tx.desc); }
export function txDir(tx) { return tx.amount < 0 ? "in" : "out"; }

const BUSINESS_WORDS = /\b(store|stores|mart|supermarket|traders|trading|enterprises?|services?|pvt|ltd|limited|restaurant|cafe|hotel|bakery|medical|pharmacy|clinic|hospital|salon|mobiles?|electronics|garments|fashion|foods?|kitchen|dhaba|bar|pub|sweets?|dairy|agency|solutions|technologies|systems|motors|travels|tours|fuels?|petrol|stationers?|books?|studio|gym|fitness|academy|school|college|institute|bank|finance|insurance|payments?|pay|wallet|recharge|bill|shop|center|centre|club)\b/i;
// Heuristic: does this look like a payment to/from a *person*? Used only to decide
// whether to ask "always, or just this once?" — a wrong guess costs one extra tap.
export function isPersonLike(desc = "", mkey = "") {
  if (String(mkey).startsWith("p:")) return true;
  const s = String(desc).trim();
  if (!s || /\d/.test(s) || BUSINESS_WORDS.test(s)) return false;
  if (guessCategory(s) !== "Others") return false;
  const words = s.split(/\s+/);
  return words.length >= 2 && words.length <= 3 && words.every((w) => /^[A-Za-z][A-Za-z.'-]*$/.test(w));
}

export function applyRules(tx, rules) {
  if (!rules || !rules.length || tx.excluded) return tx;
  const key = ruleKeyOf(tx);
  if (!key) return tx;
  const dir = txDir(tx);
  const r = rules.find((x) => x.key === key && x.dir === dir);
  if (!r) return tx;
  if (dir === "out" && r.category === "Income") return tx;      // money out can never be income
  return { ...tx, category: r.category, ruleId: r.id };
}
export function upsertRule(rules, { key, dir, category, label }) {
  const id = `${dir}:${key}`;
  const rest = (rules || []).filter((r) => r.id !== id);
  return [{ id, key, dir, category, label: label || key, createdAt: Date.now() }, ...rest];
}
function matchesRule(t, rule) {
  return !t.excluded && txDir(t) === rule.dir && ruleKeyOf(t) === rule.key && !(rule.dir === "out" && rule.category === "Income");
}
export function countMatching(txList, rule) {
  return (txList || []).filter((t) => matchesRule(t, rule) && t.category !== rule.category).length;
}
export function applyRuleToTxList(txList, rule) {
  let changed = 0;
  const list = (txList || []).map((t) => {
    if (!matchesRule(t, rule) || t.category === rule.category) return t;
    changed++;
    return { ...t, category: rule.category, ruleId: rule.id };
  });
  return { list, changed };
}

// "Needs a category": SMS spending that ended up in Others, grouped by merchant.
export function groupUncategorized(txList) {
  const groups = new Map();
  for (const t of txList || []) {
    if (!t.smsKey || t.excluded || !(t.amount > 0) || t.category !== "Others") continue;
    const key = ruleKeyOf(t);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, { key, name: t.desc, count: 0, total: 0, ids: [], mkey: t.mkey, last: "" });
    const g = groups.get(key);
    g.count++; g.total += t.amount; g.ids.push(t.id);
    if (t.date >= g.last) { g.last = t.date; g.name = t.desc; }
  }
  return [...groups.values()].map((g) => ({ ...g, personLike: isPersonLike(g.name, g.mkey) })).sort((a, b) => b.total - a.total);
}

const GENERIC_TOKENS = new Set(["store", "stores", "mart", "traders", "trading", "enterprises", "enterprise", "services", "service", "limited", "shop", "center", "centre", "india", "super", "shree", "sree", "city", "general", "national", "bharat", "royal", "great", "new"]);
function keyTokens(key) { return String(key).replace(/^p:/, "").split(/\s+/).filter((w) => w.length >= 4 && !GENERIC_TOKENS.has(w)); }
// Suggestion only (never applied silently): a merchant sharing a distinctive word
// with one you already categorised, e.g. "Apollo Medical" after "City Medical" -> Health/Meds.
export function suggestCategory(key, rules) {
  if (!key || String(key).startsWith("p:")) return null;
  const mine = new Set(keyTokens(key));
  if (!mine.size) return null;
  const votes = new Map();
  for (const r of rules || []) {
    if (r.dir !== "out" || r.key === key || r.category === "Income") continue;
    const shared = keyTokens(r.key).filter((w) => mine.has(w));
    if (!shared.length) continue;
    const v = votes.get(r.category) || { score: 0, because: r.label };
    v.score += shared.length;
    votes.set(r.category, v);
  }
  const best = [...votes.entries()].sort((a, b) => b[1].score - a[1].score)[0];
  return best ? { category: best[0], because: best[1].because } : null;
}

// ----------------------------------------------------------------------------
// Totals — one definition of Earned / Spent / Saved / Left over, used by the
// header, the month rows in the transaction list, and the dashboard.
//   Spent    = money out, net of refunds, excluding Savings and excluded items
//   Saved    = money put into Savings (SIPs, deposits...), net of withdrawals
//   LeftOver = Earned - Spent - Saved        (Earned = Spent + Saved + LeftOver)
// ----------------------------------------------------------------------------
export function summarizeTx(list) {
  let income = 0, saved = 0, spent = 0, refunds = 0;
  for (const t of list || []) {
    if (t.excluded) continue;
    if (t.category === "Income") { income += Math.abs(t.amount); continue; }
    if (t.category === "Savings") { saved += t.amount; continue; }
    spent += t.amount;
    if (t.amount < 0) refunds += -t.amount;
  }
  spent = Math.max(0, spent);
  return { income, spent, saved, refunds, retained: income - spent, leftOver: income - spent - saved };
}

// Newest first. Within one day, newest by time received where we know it.
export function txTimeKey(t) {
  if (t.ts) return Number(t.ts) || 0;
  const m = /^(\d{10,})\|/.exec(t.smsKey || "") || /(\d{12,})/.exec(String(t.id || ""));
  return m ? Number(m[1]) : 0;
}
export function sortTxDesc(list) {
  return [...(list || [])].sort((a, b) => String(b.date).localeCompare(String(a.date)) || txTimeKey(b) - txTimeKey(a));
}
export function groupTxByMonth(list) {
  const groups = new Map();
  for (const t of sortTxDesc(list)) {
    const k = monthKey(t.date);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(t);
  }
  return [...groups.entries()].map(([key, items]) => ({ key, label: monthLabel(key), items, count: items.length, ...summarizeTx(items) }));
}

// ----------------------------------------------------------------------------
// Recurring bills: what's still unpaid this month
// ----------------------------------------------------------------------------
export function isPaidForMonth(item, mk) { return !!item.lastPaid && monthKey(item.lastPaid) === mk; }

export function dueThisMonth(recurringItems, planned, today = todayISO()) {
  const mk = monthKey(today);
  const { y, m } = isoParts(today);
  const items = [];
  for (const e of recurringItems || []) {
    if (isPaidForMonth(e, mk)) continue;
    const due = `${mk}-${pad2(Math.min(e.everyMonthDay, lastDayOfMonth(y, m)))}`;
    items.push({ id: e.id, name: e.desc, amount: e.amount, dueDate: due, kind: "recurring", overdue: due < today });
  }
  for (const p of planned || []) {
    if (monthKey(p.dueDate) !== mk) continue;
    items.push({ id: p.id, name: p.desc, amount: p.amount, dueDate: p.dueDate, kind: "upcoming", overdue: p.dueDate < today });
  }
  items.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  return { items, total: items.reduce((sum, i) => sum + i.amount, 0) };
}

// ----------------------------------------------------------------------------
// SMS bills -> recurring bills. A biller becomes a recurring bill (automatically)
// when it shows up in two consecutive months, or when the message is an
// auto-debit/EMI notice (those repeat by nature). One item per biller: later
// statements refresh its amount and due day instead of piling up in Upcoming.
// Quarterly / yearly bills (gap > ~40 days) stay as one-off Upcoming items.
// ----------------------------------------------------------------------------
function dayOf(iso) { return isoParts(iso).d; }
function hasMonthlyPattern(records) {
  const ds = [...new Set(records.map((r) => r.dueDate))].sort();
  for (let i = 1; i < ds.length; i++) {
    const gap = daysBetweenISO(ds[i - 1], ds[i]);
    if (gap >= 24 && gap <= 40) return true;
  }
  return false;
}
function plannedFromBill(b) {
  return {
    id: "p_" + hashString(b.billKey), desc: b.desc, category: b.category, amount: b.amount, dueDate: b.dueDate,
    fromSms: true, billKey: b.billKey, billerKey: b.billerKey, billLabel: b.billLabel, smsKey: b.smsKey, body: b.body, sender: b.sender,
  };
}
export function processBills(freshBills, staleBills, { recurring = [], planned = [], history = {}, ignored = new Set(), today = todayISO() } = {}) {
  const hist = {};
  for (const [k, v] of Object.entries(history || {})) hist[k] = v.map((x) => ({ ...x }));
  const recurringAdd = [];
  const recurringUpdate = new Map();
  const plannedRemoveIds = new Set();
  let plannedOut = [];
  const promoted = [];

  const all = [...(staleBills || []).map((b) => ({ b, fresh: false })), ...(freshBills || []).map((b) => ({ b, fresh: true }))]
    .sort((x, y) => x.b.dueDate.localeCompare(y.b.dueDate));
  const findRecurring = (billerKey) => recurringAdd.find((r) => r.billerKey === billerKey) || (recurring || []).find((r) => r.billerKey === billerKey);

  for (const { b, fresh } of all) {
    if (!hist[b.billerKey]) hist[b.billerKey] = [];
    const h = hist[b.billerKey];
    if (!h.some((x) => x.billKey === b.billKey)) h.push({ billKey: b.billKey, dueDate: b.dueDate, amount: b.amount });

    const existing = findRecurring(b.billerKey);
    if (existing) {
      if (fresh) {
        const upd = { amount: b.amount, everyMonthDay: dayOf(b.dueDate) };
        const justAdded = recurringAdd.find((r) => r.id === existing.id);
        if (justAdded) Object.assign(justAdded, upd);
        else recurringUpdate.set(existing.id, { ...(recurringUpdate.get(existing.id) || {}), ...upd });
      }
      continue;
    }
    if (ignored.has("rec:" + b.billerKey)) {            // user deleted this recurring bill before
      if (fresh) plannedOut.push(plannedFromBill(b));
      continue;
    }
    if (b.autoDebit || hasMonthlyPattern(h)) {
      recurringAdd.push({
        id: "r_" + hashString(b.billerKey), desc: b.desc, amount: b.amount, category: b.category,
        everyMonthDay: dayOf(b.dueDate), lastPaid: null, source: "sms", fromSms: true,
        billerKey: b.billerKey, billLabel: b.billLabel, isNew: true, createdAt: today,
      });
      promoted.push(b.desc);
      plannedOut = plannedOut.filter((p) => p.billerKey !== b.billerKey);
      (planned || []).filter((p) => p.billerKey === b.billerKey).forEach((p) => plannedRemoveIds.add(p.id));
      continue;
    }
    if (fresh) plannedOut.push(plannedFromBill(b));
  }

  // keep history small
  for (const k of Object.keys(hist)) {
    hist[k].sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    hist[k] = hist[k].slice(-8);
    if (daysBetweenISO(hist[k][hist[k].length - 1].dueDate, today) > 400) delete hist[k];
  }
  return {
    recurringAdd,
    recurringUpdate: [...recurringUpdate.entries()].map(([id, updates]) => ({ id, updates })),
    plannedAdd: plannedOut,
    plannedRemoveIds: [...plannedRemoveIds],
    history: hist,
    promoted,
  };
}

// ----------------------------------------------------------------------------
// Matching a newly-arrived bank debit to something the user already recorded,
// so a payment is counted once. The SMS entry is always the one that is kept.
//   1. a recurring bill for that cycle (marks it paid; replaces a manual "Mark paid" entry)
//   2. a manual "Spent" entry made from Upcoming
//   3. an Upcoming item not yet marked spent (it is simply resolved)
// ----------------------------------------------------------------------------
const GENERIC_WORDS = new Set(["bill", "bills", "card", "credit", "payment", "payments", "premium", "loan", "emi", "recurring", "upi", "pay", "bank", "account", "towards", "monthly", "due"]);
function distinctiveTokens(text) { return normMerchant(text).split(" ").filter((w) => w.length >= 3 && !GENERIC_WORDS.has(w)); }
function nameHit(label, tx) {
  const toks = distinctiveTokens(label);
  if (!toks.length) return false;
  const hay = normMerchant(tx.desc) + " " + String(tx.body || "").toLowerCase().replace(/[^a-z]+/g, " ");
  return toks.some((w) => hay.includes(w));
}
const amtClose = (a, b) => Math.abs(a - b) <= Math.max(5, 0.02 * Math.max(a, b));
const sameRealCategory = (a, b) => !!a && a === b && a !== "Others";

function cycleDueFor(item, txDate) {
  const { y, m } = isoParts(txDate);
  let best = null;
  for (const off of [-1, 0, 1]) {
    let yy = y, mm = m + off;
    if (mm < 1) { mm = 12; yy--; }
    if (mm > 12) { mm = 1; yy++; }
    const due = `${yy}-${pad2(mm)}-${pad2(Math.min(item.everyMonthDay, lastDayOfMonth(yy, mm)))}`;
    const diff = daysBetweenISO(due, txDate);
    if (diff >= -20 && diff <= 15 && (!best || Math.abs(diff) < Math.abs(best.diff))) best = { due, diff };   // people often pay soon after the statement arrives
  }
  return best;
}

export function reconcileNewTx(newTxs, { txList = [], recurring = [], planned = [] } = {}) {
  const removeTxIds = new Set();
  const plannedRemove = [];
  const rec = new Map((recurring || []).map((r) => [r.id, { ...r }]));
  const touched = new Set();
  const claimed = new Set();
  const manualPay = (txList || []).filter((t) => t.payRef && !t.recurringId);
  const usedPlanned = new Set();
  const out = [];

  for (const tx of [...(newTxs || [])].sort((a, b) => a.date.localeCompare(b.date))) {
    if (!(tx.amount > 0)) { out.push(tx); continue; }

    // 1) recurring bill
    let best = null;
    for (const r of rec.values()) {
      if (!amtClose(r.amount, tx.amount)) continue;
      if (!(nameHit(r.desc, tx) || sameRealCategory(r.category, tx.category))) continue;
      const c = cycleDueFor(r, tx.date);
      if (!c) continue;
      const cm = monthKey(c.due);
      if (claimed.has(r.id + ":" + cm)) continue;
      let replace = null;
      if (r.lastPaid && monthKey(r.lastPaid) === cm && r.paidTxId) {
        const prev = (txList || []).find((x) => x.id === r.paidTxId);
        if (prev && prev.payRef && !prev.smsKey) replace = prev.id;   // earlier manual "Mark paid" -> swap for the SMS record
        else continue;                                                 // already paid, via an SMS entry
      }
      const diff = Math.abs(r.amount - tx.amount);
      if (!best || diff < best.diff) best = { r, c, cm, replace, diff };
    }
    if (best) {
      claimed.add(best.r.id + ":" + best.cm);
      if (best.replace) removeTxIds.add(best.replace);
      const cur = rec.get(best.r.id);
      if (!cur.lastPaid || best.c.due >= cur.lastPaid) { cur.lastPaid = best.c.due; cur.paidTxId = tx.id; }
      touched.add(cur.id);
      out.push({ ...tx, recurringId: best.r.id });
      continue;
    }

    // 2) manual "Spent" entry from Upcoming
    const mp = manualPay.find((mt) => !removeTxIds.has(mt.id) && amtClose(mt.amount, tx.amount)
      && daysBetweenISO(mt.date, tx.date) >= -3 && daysBetweenISO(mt.date, tx.date) <= 10
      && (nameHit(mt.desc, tx) || sameRealCategory(mt.category, tx.category)));
    if (mp) { removeTxIds.add(mp.id); out.push(tx); continue; }

    // 3) Upcoming item the user hasn't marked spent
    const up = (planned || []).find((p) => !usedPlanned.has(p.id) && amtClose(p.amount, tx.amount)
      && daysBetweenISO(p.dueDate, tx.date) >= -15 && daysBetweenISO(p.dueDate, tx.date) <= 10
      && (nameHit(p.desc, tx) || sameRealCategory(p.category, tx.category)));
    if (up) { usedPlanned.add(up.id); plannedRemove.push({ id: up.id, billKey: up.billKey }); }
    out.push(tx);
  }
  return {
    txs: out,
    recurringUpdates: [...touched].map((id) => ({ id, updates: { lastPaid: rec.get(id).lastPaid, paidTxId: rec.get(id).paidTxId } })),
    removeTxIds: [...removeTxIds],
    plannedRemove,
  };
}

// ----------------------------------------------------------------------------
// Saved-data migration + backup format
// ----------------------------------------------------------------------------
export const DATA_VERSION = 2;
export const BACKUP_KEYS = [
  "trucent_expenses", "trucent_tx", "trucent_budgets", "trucent_goals", "trucent_planned",
  "trucent_recurring", "trucent_rules", "trucent_bill_history", "trucent_members", "trucent_current_member",
  "trucent_activity", "trucent_sms_ignored", "trucent_recurring_dismissed", "trucent_nudge_phones", "trucent_notif_state",
];
const OBJECT_KEYS = new Set(["trucent_bill_history", "trucent_nudge_phones", "trucent_notif_state"]);
const STRING_KEYS = new Set(["trucent_current_member"]);

// store: { [localStorage key]: parsed value }. Pure — returns a migrated copy.
export function migrateStore(store, fromVersion = 1) {
  const out = { ...store };
  if (fromVersion >= 2) return out;
  const has = (k) => Array.isArray(store[k]);
  const rn = renameCategory;

  let tx = has("trucent_tx") ? store.trucent_tx.map((t) => {
    let c = rn(t.category);
    if (c === "Income" && t.amount > 0) c = "Others";               // money out can't be income
    return c === t.category ? t : { ...t, category: c };
  }) : null;

  let expenses = has("trucent_expenses") ? store.trucent_expenses : null;
  let recurring = has("trucent_recurring") ? [...store.trucent_recurring] : [];
  const known = (desc, amt) => recurring.some((r) => r.desc === desc && Math.round(r.amount) === Math.round(amt));
  let touchedRecurring = false;

  if (expenses) {                                                   // old Split-tab recurring bills
    for (const e of expenses.filter((x) => x.recurring)) {
      if (known(e.desc, e.amount)) continue;
      recurring.push({
        id: "r_" + e.id, desc: e.desc, amount: e.amount, category: rn(e.category),
        everyMonthDay: e.everyMonthDay || dayOf(e.date), lastPaid: e.lastPaid || null, source: "manual",
      });
      touchedRecurring = true;
    }
    expenses = expenses.filter((x) => !x.recurring).map((e) => (rn(e.category) === e.category ? e : { ...e, category: rn(e.category) }));
  }
  if (tx) {                                                         // old "repeats regularly" flags on offline entries
    tx = tx.map((t) => {
      if (!t.recurring) return t;
      const { recurring: _flag, ...rest } = t;
      if (t.category !== "Income" && !known(t.desc, t.amount)) {
        const id = "r_" + t.id;
        recurring.push({ id, desc: t.desc, amount: t.amount, category: t.category, everyMonthDay: dayOf(t.date), lastPaid: t.date, paidTxId: t.id, source: "offline" });
        touchedRecurring = true;
        return { ...rest, recurringId: id };
      }
      return rest;
    });
  }

  if (has("trucent_budgets")) {                                     // renames can merge two budgets into one: keep the higher limit
    const merged = new Map();
    for (const b of store.trucent_budgets) {
      const c = rn(b.category);
      const prev = merged.get(c);
      merged.set(c, { ...b, category: c, limit: prev ? Math.max(prev.limit, b.limit) : b.limit });
    }
    out.trucent_budgets = [...merged.values()];
  }
  if (has("trucent_planned")) out.trucent_planned = store.trucent_planned.map((p) => ({ ...p, category: rn(p.category) }));
  if (has("trucent_rules")) out.trucent_rules = store.trucent_rules.map((r) => ({ ...r, category: rn(r.category) }));
  if (store.trucent_notif_state && Array.isArray(store.trucent_notif_state.keys)) {
    out.trucent_notif_state = {
      ...store.trucent_notif_state,
      keys: store.trucent_notif_state.keys.map((k) => {
        const m = /^b:(.*):(\d{4}-\d{2}):(80|100)$/.exec(k);
        return m ? `b:${rn(m[1])}:${m[2]}:${m[3]}` : k;
      }),
    };
  }
  if (tx) out.trucent_tx = tx;
  if (expenses) out.trucent_expenses = expenses;
  if (recurring.length || touchedRecurring || has("trucent_recurring")) out.trucent_recurring = recurring.map((r) => ({ ...r, category: rn(r.category) }));
  return out;
}

export function buildBackup(store, now = new Date()) {
  const data = {};
  for (const k of BACKUP_KEYS) if (store[k] !== undefined && store[k] !== null) data[k] = store[k];
  return { app: "trucent", version: DATA_VERSION, createdAt: now.toISOString(), data };
}

export function parseBackup(text) {
  let obj;
  try { obj = JSON.parse(text); } catch { return { ok: false, error: "That file couldn't be read as a TruCent backup." }; }
  if (!obj || obj.app !== "trucent" || typeof obj.data !== "object" || obj.data === null) {
    return { ok: false, error: "This doesn't look like a TruCent backup file." };
  }
  const ver = Number(obj.version) || 1;
  if (ver > DATA_VERSION) return { ok: false, error: "This backup was made by a newer version of TruCent. Update the app first, then restore." };

  const clean = {};
  for (const k of BACKUP_KEYS) {
    const v = obj.data[k];
    if (v === undefined || v === null) continue;
    const ok = STRING_KEYS.has(k) ? typeof v === "string"
      : OBJECT_KEYS.has(k) ? typeof v === "object" && !Array.isArray(v)
      : Array.isArray(v);
    if (ok) clean[k] = v;
  }
  const store = migrateStore(clean, ver);
  if (store.trucent_members && !(store.trucent_members.length && store.trucent_members.every((m) => m && m.id && m.name))) {
    delete store.trucent_members;
  }
  if (store.trucent_members && store.trucent_current_member && !store.trucent_members.some((m) => m.id === store.trucent_current_member)) {
    store.trucent_current_member = store.trucent_members[0].id;
  }
  const n = (k) => (Array.isArray(store[k]) ? store[k].length : 0);
  return {
    ok: true, store, createdAt: obj.createdAt || null,
    summary: { transactions: n("trucent_tx"), groupExpenses: n("trucent_expenses"), members: n("trucent_members"), recurring: n("trucent_recurring"), goals: n("trucent_goals"), rules: n("trucent_rules") },
  };
}
