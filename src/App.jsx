import React, { useState, useMemo, useEffect } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, RadialBarChart, RadialBar,
} from "recharts";
import {
  Wallet, Plus, Check, Repeat, ArrowRight, Smartphone,
  ShoppingBag, Utensils, Car, Zap, GraduationCap, Building2, Users, Sparkles,
  ChevronDown, X, TrendingUp, TrendingDown, Bell, PiggyBank,
  ArrowUpRight, ArrowDownRight, LayoutGrid, Target, CalendarClock, Trash2,
  AlertTriangle, ArrowUpCircle, Banknote, Receipt, Scale, Edit2, Bot, Loader2,
  Flame, RefreshCw, MessageCircle, Share2, CreditCard,
  HeartPulse, FileSpreadsheet, FileText, RotateCcw, Gift,
  Tag, Upload, Download, Undo2, ChevronRight,
} from "lucide-react";
import {
  todayISO, getTodayDay, inr, ingestMessages, computeNextBill, normMerchant,
  computeStreakInfo, detectRecurringCharges, computeWrapped, periodRange,
  planNotifications, buildNudgeText, waLink, buildWidgetPayload,
  buildExportModel, buildExportXlsx, buildExportPdf, bytesToBase64, ordinal,
  daysUntilDate, hashToInt, monthKey, monthLabel, fmtDateShort, lastDayOfMonth,
  buildGroupLedgerModel, buildGroupLedgerXlsx, buildGroupLedgerPdf,
  summarizeTx, groupTxByMonth, dueThisMonth, processBills, reconcileNewTx,
  upsertRule, applyRuleToTxList, countMatching, groupUncategorized, suggestCategory,
  isPersonLike, ruleKeyOf, txDir, isPaidForMonth,
  migrateStore, buildBackup, parseBackup, DATA_VERSION, BACKUP_KEYS,
} from "./lib.js";

// ---------------------------------------------------------------------------
// Design tokens
// ---------------------------------------------------------------------------
const T = {
  bg: "#0A0A0F",
  surface: "#15151D",
  surfaceHi: "#1C1C26",
  border: "rgba(255,255,255,0.08)",
  borderHi: "rgba(255,255,255,0.16)",
  text: "#F5F5F7",
  textSoft: "#9797A6",
  textMute: "#5C5C6B",
  purple: "#8B5CF6",
  pink: "#EC4899",
  gold: "#FBBF24",
  green: "#34D399",
  red: "#FB7185",
  blue: "#60A5FA",
  gradPrimary: "linear-gradient(135deg, #8B5CF6 0%, #EC4899 100%)",
  gradGold: "linear-gradient(135deg, #FDE68A 0%, #FBBF24 55%, #F59E0B 100%)",
  gradDark: "linear-gradient(180deg, #1C1C26 0%, #131319 100%)",
  gradHero: "linear-gradient(135deg, #1B1730 0%, #2A1740 45%, #3A1830 100%)",
};

const CATEGORY_META = {
  "Groceries": { icon: ShoppingBag, color: T.green },
  "Society Maintenance": { icon: Building2, color: T.purple },
  "Domestic Help": { icon: Users, color: T.gold },
  "Tuition/Education": { icon: GraduationCap, color: "#A78BFA" },
  "Bills/Utilities": { icon: Zap, color: T.red },
  "Dining Out": { icon: Utensils, color: "#FB923C" },
  "Travel/Fuel": { icon: Car, color: T.blue },
  "Shopping": { icon: ShoppingBag, color: T.pink },
  "Entertainment": { icon: Sparkles, color: "#38BDF8" },
  "Credit Card/EMI": { icon: CreditCard, color: "#F472B6" },
  "Savings": { icon: PiggyBank, color: "#22D3EE" },
  "Health/Meds": { icon: HeartPulse, color: "#F87171" },
  "Income": { icon: TrendingUp, color: T.green },
  "Others": { icon: Wallet, color: T.textSoft },
};
const CATEGORY_LIST = Object.keys(CATEGORY_META);
// Money out can be filed under anything except Income. (A money-in entry can be
// filed under anything at all — see categoriesFor() — e.g. a friend repaying a
// dinner is "Dining Out", which nets that category down.)
const EXPENSE_CATEGORY_LIST = CATEGORY_LIST.filter((c) => c !== "Income");
// Budgets only make sense for money you *spend*; Savings is tracked separately.
const SPEND_CATEGORY_LIST = CATEGORY_LIST.filter((c) => c !== "Income" && c !== "Savings");
const categoriesFor = (moneyIn) => (moneyIn ? CATEGORY_LIST : EXPENSE_CATEGORY_LIST);

// `let` (not `const`) so members can be added/edited/removed at runtime — see
// addMember / updateMember / deleteMember in the App shell, which mutate this
// array, persist it to localStorage (see saveMembers below), and bump a tick
// counter to force a re-render.
//
// This is read from localStorage on load, same as every other persisted list
// in the app (expenses, goals, etc.) — it used to default to the seed value
// on every launch, which silently reset the group back to just "You" any
// time the app was closed and reopened. Existing ledger entries still
// referenced the vanished member ids, so their amounts looked "squared off"
// even though the actual expense data was untouched — the member records
// those ids pointed to had just disappeared. loadLS/saveLS are declared
// further down but are `function` declarations, so they're hoisted and
// callable here regardless of source order.
// Runs once per install/upgrade, BEFORE any state is read: renames categories in
// saved data, folds old recurring bills into the new list, etc. (see migrateStore).
// A brand-new install has nothing saved, so this just stamps the version.
function runStorageMigration() {
  try {
    if (typeof window === "undefined" || !window.localStorage) return;
    const ver = Number(loadLS("trucent_data_version", 1)) || 1;
    if (ver >= DATA_VERSION) return;
    const store = {};
    for (const k of BACKUP_KEYS) {
      const raw = window.localStorage.getItem(k);
      if (raw != null) { try { store[k] = JSON.parse(raw); } catch { /* skip unreadable key */ } }
    }
    const migrated = migrateStore(store, ver);
    for (const [k, v] of Object.entries(migrated)) saveLS(k, v);
    saveLS("trucent_data_version", DATA_VERSION);
  } catch { /* never block app start on a migration problem */ }
}
runStorageMigration();

const MEMBERS_KEY = "trucent_members";
let MEMBERS = loadLS(MEMBERS_KEY, [{ id: "you", name: "You", color: "#FBBF24" }]);
function saveMembers() { saveLS(MEMBERS_KEY, MEMBERS); }

const MEMBER_PALETTE = ["#8B5CF6", "#EC4899", "#FBBF24", "#34D399", "#60A5FA", "#F97316", "#14B8A6", "#F472B6"];

// ---------------------------------------------------------------------------
// No seed data in production — every list starts empty.
// ---------------------------------------------------------------------------
const seedExpenses = [];
const rawSeedTx = [];
const seedBudgets = [];
const seedGoals = [];
const seedPlanned = [];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function simplifyBalances(net) {
  const creditors = Object.entries(net).filter(([, v]) => v > 0.5)
    .map(([id, v]) => ({ id, amt: v })).sort((a, b) => b.amt - a.amt);
  const debtors = Object.entries(net).filter(([, v]) => v < -0.5)
    .map(([id, v]) => ({ id, amt: -v })).sort((a, b) => b.amt - a.amt);
  const settlements = [];
  let i = 0, j = 0;
  while (i < debtors.length && j < creditors.length) {
    const amt = Math.min(debtors[i].amt, creditors[j].amt);
    settlements.push({ from: debtors[i].id, to: creditors[j].id, amount: amt });
    debtors[i].amt -= amt; creditors[j].amt -= amt;
    if (debtors[i].amt < 0.5) i++;
    if (creditors[j].amt < 0.5) j++;
  }
  return settlements;
}
function memberName(id) { return MEMBERS.find((m) => m.id === id)?.name || id; }
function memberColor(id) { return MEMBERS.find((m) => m.id === id)?.color || T.textSoft; }

// ---------------------------------------------------------------------------
// Local persistence — survives closing/reopening the app on the same install.
// (Does not survive uninstall/reinstall or a new device — see Android Auto
// Backup notes in README for that.)
// ---------------------------------------------------------------------------
function loadLS(key, fallback) {
  try {
    if (typeof window === "undefined" || !window.localStorage) return fallback;
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}
function saveLS(key, value) {
  try {
    if (typeof window === "undefined" || !window.localStorage) return;
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage full/unavailable — app keeps working in-memory for this session
  }
}
function usePersistentState(key, initialValue) {
  const [state, setState] = useState(() => loadLS(key, initialValue));
  useEffect(() => { saveLS(key, state); }, [key, state]);
  return [state, setState];
}

// ---------------------------------------------------------------------------
// Money Coach — an on-device "agent" that reasons over the user's real,
// local data (budgets, goals, trends, settlements) using deterministic
// rules rather than a neural model. Every number in its output is computed
// live from actual app state; nothing here is canned copy or a network call.
// ---------------------------------------------------------------------------
const COACH_STEPS = [
  "Reading your transactions",
  "Checking budgets & goals",
  "Reviewing group settlements",
  "Generating recommendations",
];

function generateCoachReport(d) {
  const {
    income, totalSpend, saved, savedAmt = 0, savingsRate, overBudget, categoryTotals,
    goals, recurringMonthlyTotal, settlements, settleTotal, spendDelta,
  } = d;

  const hasData = income > 0 || totalSpend > 0 || savedAmt > 0;
  if (!hasData) return { hasData: false };

  const insights = [];

  overBudget
    .slice()
    .sort((a, b) => (b.spent - b.limit) - (a.spent - a.limit))
    .slice(0, 2)
    .forEach((b) => {
      insights.push({
        type: "warning", icon: AlertTriangle, title: `${b.category} is over budget`,
        detail: `You've spent ${inr(b.spent)} against a ${inr(b.limit)} limit — ${inr(b.spent - b.limit)} over.`,
        action: { label: "Review budget", tab: "plan" },
      });
    });

  const topCat = categoryTotals[0];
  if (topCat && totalSpend > 0) {
    const pct = (topCat.amount / categoryTotals.reduce((sum, c) => sum + c.amount, 0)) * 100;
    if (pct >= 35) {
      insights.push({
        type: "tip", icon: PiggyBank, title: `${topCat.category} dominates your spend`,
        detail: `${pct.toFixed(0)}% of everything you spent this month went to ${topCat.category} alone.`,
      });
    }
  }

  if (income > 0) {
    if (saved < 0) {
      insights.push({
        type: "warning", icon: TrendingDown, title: "You spent more than you earned",
        detail: `This month's spend outpaced income by ${inr(Math.abs(saved))}.`,
      });
    } else if (savingsRate >= 20) {
      insights.push({
        type: "success", icon: TrendingUp, title: "Strong savings rate",
        detail: `You kept ${savingsRate.toFixed(0)}% of your income this month — ahead of the usual 20% guideline.`,
      });
    } else {
      insights.push({
        type: "tip", icon: TrendingUp, title: "Room to grow your savings rate",
        detail: `You saved ${savingsRate.toFixed(0)}% of income this month. Most guides suggest aiming for 20%+.`,
      });
    }
  }

  if (savedAmt > 0) {
    insights.push({
      type: "success", icon: PiggyBank, title: `${inr(savedAmt)} moved into savings`,
      detail: income > 0
        ? `That's ${((savedAmt / income) * 100).toFixed(0)}% of what you earned this month, kept separate from your spending.`
        : "Tracked separately from your spending, so investing never makes a month look overspent.",
    });
  }

  if (income > 0 && recurringMonthlyTotal > 0 && recurringMonthlyTotal / income >= 0.4) {
    insights.push({
      type: "warning", icon: Repeat, title: "Recurring bills are heavy this month",
      detail: `${((recurringMonthlyTotal / income) * 100).toFixed(0)}% of your income is already committed before you spend anything else.`,
      action: { label: "View recurring bills", tab: "burn" },
    });
  }

  if (settlements.length > 0) {
    insights.push({
      type: "tip", icon: Users, title: `${settlements.length} settlement${settlements.length > 1 ? "s" : ""} pending`,
      detail: `${inr(settleTotal)} is still moving between the group — settle up to keep the books clean.`,
      action: { label: "Go to Split", tab: "split" },
    });
  }

  const activeGoal = goals.find((g) => g.saved < g.target);
  if (activeGoal && saved > 0) {
    const remaining = activeGoal.target - activeGoal.saved;
    const months = Math.max(1, Math.ceil(remaining / saved));
    insights.push({
      type: "prediction", icon: Target, title: `${activeGoal.name}: ~${months} month${months > 1 ? "s" : ""} to go`,
      detail: `At this month's saving pace (${inr(saved)}), you'd close the remaining ${inr(remaining)} gap in about ${months} month${months > 1 ? "s" : ""}.`,
      action: { label: "Add funds", tab: "plan" },
    });
  }

  if (totalSpend > 0 && Math.abs(spendDelta) >= 10) {
    insights.push({
      type: spendDelta <= 0 ? "success" : "tip",
      icon: spendDelta <= 0 ? TrendingDown : TrendingUp,
      title: spendDelta <= 0 ? "Spending is trending down" : "Spending is trending up",
      detail: `You're ${Math.abs(spendDelta).toFixed(0)}% ${spendDelta <= 0 ? "below" : "above"} last month's spend.`,
    });
  }

  if (insights.length === 0) {
    insights.push({
      type: "success", icon: Check, title: "Nothing needs attention",
      detail: "Budgets are in check, no pending settlements, and your savings rate looks reasonable. Solid month.",
    });
  }

  const weight = { warning: 0, tip: 1, prediction: 1, success: 2 };
  const sorted = insights.sort((a, b) => weight[a.type] - weight[b.type]).slice(0, 4);

  let score = 70;
  score -= overBudget.length * 10;
  if (saved < 0) score -= 20;
  else if (savingsRate >= 20) score += 15;
  else if (savingsRate < 10 && income > 0) score -= 5;
  if (income > 0 && recurringMonthlyTotal / income >= 0.4) score -= 10;
  score -= Math.min(10, settlements.length * 3);
  score = Math.max(5, Math.min(99, Math.round(score)));

  let verdict, verdictColor;
  if (score >= 80) { verdict = "Excellent"; verdictColor = T.green; }
  else if (score >= 60) { verdict = "Good"; verdictColor = T.gold; }
  else if (score >= 40) { verdict = "Needs attention"; verdictColor = "#FB923C"; }
  else { verdict = "At risk"; verdictColor = T.red; }

  return { hasData: true, score, verdict, verdictColor, insights: sorted };
}

// ---------------------------------------------------------------------------
// Shared UI atoms
// ---------------------------------------------------------------------------
// color: T.text here matters specifically for <button> elements — buttons get a
// browser/WebView default (often black) text color that breaks inheritance from
// the app root, unlike <div>s which inherit correctly either way. Cards built
// from a <div> are unaffected by this; cards built from a <button> (Settle Up,
// Next Bill, Goals, Upcoming, etc.) need it to avoid unreadable dark-on-dark text.
const glassCard = { background: T.gradDark, border: `1px solid ${T.border}`, borderRadius: 18, color: T.text };

function Avatar({ id, size = 30 }) {
  const name = memberName(id);
  return (
    <div style={{
      width: size, height: size, borderRadius: "50%", background: memberColor(id), color: "#0A0A0F",
      display: "flex", alignItems: "center", justifyContent: "center", fontSize: size * 0.42, fontWeight: 800, flexShrink: 0,
    }}>
      {name.trim()[0]}
    </div>
  );
}

function CategoryTag({ category }) {
  const meta = CATEGORY_META[category] || CATEGORY_META.Others;
  const Icon = meta.icon;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 10px", borderRadius: 20, fontSize: 12,
      background: meta.color + "26", color: meta.color, fontWeight: 700, whiteSpace: "nowrap", border: `1px solid ${meta.color}33`,
    }}>
      <Icon size={12} /> {category}
    </span>
  );
}

function Pill({ active, onClick, label }) {
  return (
    <button onClick={onClick} style={{
      border: `1px solid ${active ? "transparent" : T.border}`,
      background: active ? T.gradPrimary : "transparent",
      color: active ? "#fff" : T.textSoft, borderRadius: 20, padding: "6px 12px", fontSize: 12, fontWeight: 700,
    }}>
      {label}
    </button>
  );
}

function SectionTitle({ children, action }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
      <h2 style={{ fontSize: 13.5, fontWeight: 700, margin: 0, color: T.textSoft, letterSpacing: -0.1 }}>{children}</h2>
      {action}
    </div>
  );
}

// ---------------------------------------------------------------------------
// App shell
// ---------------------------------------------------------------------------
export default function TruCent() {
  const [tab, setTab] = useState("home");
  const [currentMember, setCurrentMember] = usePersistentState("trucent_current_member", "you");
  const [showProfile, setShowProfile] = useState(false);
  const [, setMembersTick] = useState(0); // bump to re-render after mutating the module-level MEMBERS array
  const [expenses, setExpenses] = usePersistentState("trucent_expenses", seedExpenses);
  const [txList, setTxList] = usePersistentState("trucent_tx", rawSeedTx);
  const [showForm, setShowForm] = useState(false);

  const [fDesc, setFDesc] = useState("");
  const [fAmount, setFAmount] = useState("");
  const [fCategory, setFCategory] = useState(EXPENSE_CATEGORY_LIST[0]);
  const [fPaidBy, setFPaidBy] = useState("you");
  const [fSplit, setFSplit] = useState(MEMBERS.map((m) => m.id));

  const [budgets, setBudgets] = usePersistentState("trucent_budgets", seedBudgets);
  const [goals, setGoals] = usePersistentState("trucent_goals", seedGoals);
  const [planned, setPlanned] = usePersistentState("trucent_planned", seedPlanned);

  const [bCategory, setBCategory] = useState(EXPENSE_CATEGORY_LIST[0]);
  const [bLimit, setBLimit] = useState("");
  const [gName, setGName] = useState("");
  const [gTarget, setGTarget] = useState("");
  const [gDeadline, setGDeadline] = useState("");
  const [pDesc, setPDesc] = useState("");
  const [pAmount, setPAmount] = useState("");
  const [pCategory, setPCategory] = useState(EXPENSE_CATEGORY_LIST[0]);
  const [pDate, setPDate] = useState("");

  const [oDesc, setODesc] = useState("");
  const [oAmount, setOAmount] = useState("");
  const [oCategory, setOCategory] = useState(EXPENSE_CATEGORY_LIST[0]);
  const [oMode, setOMode] = useState("Cash");
  const [oRecurring, setORecurring] = useState(false);
  const [oDate, setODate] = useState(todayISO());

  // Engagement/habit-loop state — see Streaks, Money Coach's recurring-charge
  // detector, SMS ingestion bookkeeping, and local notifications below.
  const [activityDates, setActivityDates] = usePersistentState("trucent_activity", []);
  const [smsIgnored, setSmsIgnored] = usePersistentState("trucent_sms_ignored", []);
  const [lastSmsSync, setLastSmsSync] = usePersistentState("trucent_last_sms_sync", null);
  const [smsSyncing, setSmsSyncing] = useState(false);
  const [notifState, setNotifState] = usePersistentState("trucent_notif_state", { init: false, keys: [] });
  const [recurringDismissed, setRecurringDismissed] = usePersistentState("trucent_recurring_dismissed", []);
  const [wrappedOpen, setWrappedOpen] = useState(false);
  const [smsPreviewTx, setSmsPreviewTx] = useState(null);

  // Recurring bills now have their own list (they used to be flagged entries in the
  // Split ledger). Rules = categories the app has learned from the user's corrections.
  const [recurring, setRecurring] = usePersistentState("trucent_recurring", []);
  const [rules, setRules] = usePersistentState("trucent_rules", []);
  const [billHistory, setBillHistory] = usePersistentState("trucent_bill_history", {});
  const [learnPrompt, setLearnPrompt] = useState(null);     // the bottom sheet after a re-categorisation
  const [confirmState, setConfirmState] = useState(null);   // the "are you sure?" popup
  const [restorePlan, setRestorePlan] = useState(null);     // a backup file waiting for confirmation
  const [showRules, setShowRules] = useState(false);

  // A logging action counts toward the daily streak — called from every
  // handler below that represents "the user did something in the app today".
  const recordActivity = () => {
    const d = todayISO();
    setActivityDates((prev) => (prev.includes(d) ? prev : [...prev, d].slice(-400)));
  };

  const askConfirm = ({ title, body, confirmLabel = "Delete", onConfirm }) => setConfirmState({ title, body, confirmLabel, onConfirm });

  const resetForm = () => {
    setFDesc(""); setFAmount(""); setFCategory(EXPENSE_CATEGORY_LIST[0]);
    setFPaidBy(currentMember); setFSplit(MEMBERS.map((m) => m.id));
  };
  const addExpense = () => {
    if (!fDesc.trim() || !fAmount || Number(fAmount) <= 0 || fSplit.length === 0) return;
    setExpenses((prev) => [{
      id: "e" + Date.now(), desc: fDesc.trim(), category: fCategory, amount: Number(fAmount),
      paidBy: fPaidBy, splitAmong: fSplit, date: todayISO(), recurring: false,
    }, ...prev]);
    resetForm(); setShowForm(false);
    recordActivity();
  };
  const updateExpense = (id, updates) => setExpenses((prev) => prev.map((e) => (e.id === id ? { ...e, ...updates } : e)));
  const deleteExpense = (id) => setExpenses((prev) => prev.filter((e) => e.id !== id));

  // Deleting an SMS-sourced transaction remembers its key so the next sync doesn't
  // silently bring it back — a delete should stay deleted. Deleting the payment that
  // settled a recurring bill puts that bill back to "due"; deleting one that settled an
  // Upcoming item brings that item back.
  const removeTx = (id) => {
    const victim = txList.find((t) => t.id === id);
    if (!victim) return;
    if (victim.smsKey) setSmsIgnored((ig) => (ig.includes(victim.smsKey) ? ig : [...ig, victim.smsKey]));
    if (victim.recurringId) {
      setRecurring((prev) => prev.map((r) => (r.id === victim.recurringId && r.paidTxId === victim.id ? { ...r, lastPaid: null, paidTxId: null } : r)));
    }
    if (victim.fromPlanned) {
      setPlanned((prev) => (prev.some((p) => p.id === victim.fromPlanned.id) ? prev : [victim.fromPlanned, ...prev]));
      if (victim.fromPlanned.billKey) setSmsIgnored((ig) => ig.filter((k) => k !== victim.fromPlanned.billKey));
    }
    setTxList((prev) => prev.filter((t) => t.id !== id));
  };
  const confirmRemoveTx = (id) => {
    const t = txList.find((x) => x.id === id);
    if (!t) return;
    askConfirm({
      title: "Delete this transaction?",
      body: `${t.desc} · ${inr(t.amount)} · ${fmtDateShort(t.date)}. It comes out of your totals${t.smsKey ? " and won't return when SMS syncs" : ""}.`,
      onConfirm: () => removeTx(id),
    });
  };

  // ---- Learning from corrections --------------------------------------------
  // Re-categorising a transaction teaches the app "this merchant -> this category".
  // People-like merchants ask first ("always, or just this once?").
  const applyNewRule = ({ key, dir, category, label }, previous, revertIds, excludeIds) => {
    const prevRule = rules.find((r) => r.id === `${dir}:${key}`) || null;
    const nextRules = upsertRule(rules, { key, dir, category, label });
    setRules(nextRules);
    const rule = nextRules[0];
    const pending = countMatching(txList.filter((t) => !excludeIds.includes(t.id)), rule);
    setLearnPrompt({ stage: "learned", rule, pending, prevRule, previous, revertIds });
  };
  const changeTxCategory = (id, category) => {
    const tx = txList.find((t) => t.id === id);
    if (!tx || tx.category === category) return;
    if (txDir(tx) === "out" && category === "Income") return;          // money out can never be income
    setTxList((prev) => prev.map((t) => (t.id === id ? { ...t, category } : t)));
    recordActivity();
    const key = ruleKeyOf(tx);
    if (!key || tx.excluded) return;                                     // never learn from excluded items
    const info = { key, dir: txDir(tx), category, label: tx.desc };
    if (isPersonLike(tx.desc, tx.mkey)) setLearnPrompt({ stage: "ask", ...info, previous: tx.category, revertIds: [id], excludeIds: [id] });
    else applyNewRule(info, tx.category, [id], [id]);
  };
  const assignGroup = (group, category) => {
    if (!category || category === "Income") return;
    setTxList((prev) => prev.map((t) => (group.ids.includes(t.id) ? { ...t, category } : t)));
    recordActivity();
    const info = { key: group.key, dir: "out", category, label: group.name };
    if (group.personLike) setLearnPrompt({ stage: "ask", ...info, previous: "Others", revertIds: group.ids, excludeIds: group.ids });
    else applyNewRule(info, "Others", group.ids, group.ids);
  };
  const confirmAlways = () => {
    const { key, dir, category, label, previous, revertIds, excludeIds } = learnPrompt;
    applyNewRule({ key, dir, category, label }, previous, revertIds, excludeIds || []);
  };
  const fixPastForRule = () => {
    const { rule } = learnPrompt;
    setTxList((prev) => applyRuleToTxList(prev, rule).list);
    setLearnPrompt(null);
  };
  const undoLearning = () => {
    const { rule, prevRule, previous, revertIds } = learnPrompt;
    setRules((prev) => (prevRule ? prev.map((r) => (r.id === rule.id ? prevRule : r)) : prev.filter((r) => r.id !== rule.id)));
    setTxList((prev) => prev.map((t) => (revertIds.includes(t.id) ? { ...t, category: previous } : t)));
    setLearnPrompt(null);
  };
  const updateRuleCategory = (ruleId, category) => {
    const r = rules.find((x) => x.id === ruleId);
    if (!r || r.category === category) return;
    const next = { ...r, category };
    setRules((prev) => prev.map((x) => (x.id === ruleId ? next : x)));
    setTxList((prev) => applyRuleToTxList(prev, next).list);     // editing a rule re-files matching past entries too
  };
  const deleteRule = (ruleId) => setRules((prev) => prev.filter((x) => x.id !== ruleId));

  const addMember = (name, color) => {
    if (!name.trim()) return;
    MEMBERS.push({ id: "m" + Date.now(), name: name.trim(), color: color || MEMBER_PALETTE[MEMBERS.length % MEMBER_PALETTE.length] });
    saveMembers();
    setMembersTick((t) => t + 1);
  };
  const updateMember = (id, updates) => {
    const m = MEMBERS.find((x) => x.id === id);
    if (m) Object.assign(m, updates);
    saveMembers();
    setMembersTick((t) => t + 1);
  };
  const deleteMember = (id) => {
    if (MEMBERS.length <= 1) return; // always keep at least one profile
    MEMBERS = MEMBERS.filter((m) => m.id !== id);
    saveMembers();
    setFSplit((prev) => prev.filter((x) => x !== id));
    if (currentMember === id) setCurrentMember(MEMBERS[0].id);
    if (fPaidBy === id) setFPaidBy(MEMBERS[0].id);
    setMembersTick((t) => t + 1);
  };

  const addOfflineExpense = () => {
    if (!oDesc.trim() || !oAmount || Number(oAmount) <= 0 || !oDate) return;
    const id = "tx" + Date.now();
    let recurringId;
    if (oRecurring) {
      recurringId = "r" + Date.now();
      setRecurring((prev) => [{
        id: recurringId, desc: oDesc.trim(), amount: Number(oAmount), category: oCategory,
        everyMonthDay: Number(oDate.slice(8, 10)) || getTodayDay(), lastPaid: oDate, paidTxId: id, source: "offline",
      }, ...prev]);
    }
    setTxList((prev) => [{
      id, desc: oDesc.trim(), amount: Number(oAmount), category: oCategory,
      source: `Offline · ${oMode}`, date: oDate, manual: true, ...(recurringId ? { recurringId } : {}),
    }, ...prev]);
    setODesc(""); setOAmount(""); setOCategory(EXPENSE_CATEGORY_LIST[0]); setOMode("Cash"); setORecurring(false); setODate(todayISO());
    recordActivity();
  };

  // ---- SMS import — bridges to the native SmsReader plugin (Android build only) ----
  // window.Capacitor.Plugins.SmsReader is injected by the native shell at runtime;
  // it simply won't exist in a browser, so this degrades safely to "unavailable" there.
  // The plugin only *fetches* raw messages — all parsing/categorizing happens in
  // lib.js's ingestMessages, which has its own unit-test suite (test/sms.test.mjs).
  const [smsStatus, setSmsStatus] = usePersistentState("trucent_sms_status", "idle"); // idle | requesting | granted | denied | unavailable
  const importFromSms = async () => {
    const plugin = typeof window !== "undefined" ? window.Capacitor?.Plugins?.SmsReader : null;
    if (!plugin) { setSmsStatus("unavailable"); return; }
    const alreadyGranted = smsStatus === "granted";
    setSmsStatus(alreadyGranted ? smsStatus : "requesting");
    setSmsSyncing(true);
    try {
      const perm = await plugin.requestPermission();
      if (!perm?.granted) { setSmsStatus("denied"); setSmsSyncing(false); return; }
      const res = await plugin.fetchMessages({ sinceDays: 180 });
      const today = todayISO();
      const txKeys = new Set(txList.map((t) => t.smsKey).filter(Boolean));
      // bills already seen (still in Upcoming, or only remembered in the history) are never re-added
      const billKeys = new Set([
        ...planned.map((p) => p.billKey).filter(Boolean),
        ...Object.values(billHistory).flat().map((h) => h.billKey),
      ]);
      const ignored = new Set(smsIgnored);
      const ing = ingestMessages(res?.messages || [], { txKeys, billKeys, ignored, today, rules });

      // 1) Bills: a biller seen in two consecutive months (or an EMI/auto-debit notice) becomes a
      //    recurring bill automatically; anything else is a one-off Upcoming item.
      const pb = processBills(ing.bills, ing.staleBills, { recurring, planned, history: billHistory, ignored, today });
      let nextRecurring = recurring.map((r) => {
        const u = pb.recurringUpdate.find((x) => x.id === r.id);
        return u ? { ...r, ...u.updates } : r;
      });
      nextRecurring = [...pb.recurringAdd, ...nextRecurring];
      let nextPlanned = [...pb.plannedAdd, ...planned.filter((p) => !pb.plannedRemoveIds.includes(p.id))];

      // 2) Payments: a bank debit that matches a bill you already marked/recorded is counted once —
      //    the SMS entry is kept and the manual one is dropped.
      const rc = reconcileNewTx(ing.txs, { txList, recurring: nextRecurring, planned: nextPlanned });
      nextRecurring = nextRecurring.map((r) => {
        const u = rc.recurringUpdates.find((x) => x.id === r.id);
        return u ? { ...r, ...u.updates } : r;
      });
      nextPlanned = nextPlanned.filter((p) => !rc.plannedRemove.some((x) => x.id === p.id));
      const resolvedKeys = rc.plannedRemove.map((x) => x.billKey).filter(Boolean);

      setTxList([...rc.txs, ...txList.filter((t) => !rc.removeTxIds.includes(t.id))]);
      setRecurring(nextRecurring);
      setPlanned(nextPlanned);
      setBillHistory(pb.history);
      if (resolvedKeys.length) setSmsIgnored((ig) => Array.from(new Set([...ig, ...resolvedKeys])));
      setLastSmsSync(Date.now());
      setSmsStatus("granted");
      recordActivity();
    } catch {
      setSmsStatus("denied");
    } finally {
      setSmsSyncing(false);
    }
  };
  // Auto-sync once on app open if SMS was already connected in a previous
  // session — so reopening the app shows fresh data without an extra tap.
  useEffect(() => {
    if (smsStatus === "granted") importFromSms();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const addBudget = () => {
    if (!bLimit || Number(bLimit) <= 0) return;
    setBudgets((prev) => {
      const exists = prev.find((b) => b.category === bCategory);
      if (exists) return prev.map((b) => (b.category === bCategory ? { ...b, limit: Number(bLimit) } : b));
      return [...prev, { category: bCategory, limit: Number(bLimit) }];
    });
    setBLimit("");
  };
  const removeBudget = (category) => setBudgets((prev) => prev.filter((b) => b.category !== category));

  const addGoal = () => {
    if (!gName.trim() || !gTarget || Number(gTarget) <= 0) return;
    setGoals((prev) => [...prev, {
      id: "g" + Date.now(), name: gName.trim(), target: Number(gTarget), saved: 0,
      deadline: gDeadline || null, color: MEMBER_PALETTE[prev.length % MEMBER_PALETTE.length],
    }]);
    setGName(""); setGTarget(""); setGDeadline("");
  };
  const addFundsToGoal = (id, amount) => {
    if (!amount || Number(amount) <= 0) return;
    setGoals((prev) => prev.map((g) => (g.id === id ? { ...g, saved: Math.min(g.target, g.saved + Number(amount)) } : g)));
  };
  const removeGoal = (id) => setGoals((prev) => prev.filter((g) => g.id !== id));

  const addPlanned = () => {
    if (!pDesc.trim() || !pAmount || Number(pAmount) <= 0 || !pDate) return;
    setPlanned((prev) => [...prev, { id: "p" + Date.now(), desc: pDesc.trim(), category: pCategory, amount: Number(pAmount), dueDate: pDate }]);
    setPDesc(""); setPAmount(""); setPCategory(EXPENSE_CATEGORY_LIST[0]); setPDate("");
    recordActivity();
  };
  // Same reasoning as removeTx: an SMS-detected bill the user dismisses should
  // stay dismissed, not reappear next time SMS is re-synced.
  const removePlanned = (id) => {
    const victim = planned.find((p) => p.id === id);
    if (victim?.fromSms && victim.billKey) setSmsIgnored((ig) => (ig.includes(victim.billKey) ? ig : [...ig, victim.billKey]));
    setPlanned((prev) => prev.filter((p) => p.id !== id));
  };
  // "Spent" records a personal transaction in Track — it counts in Spent/categories/budgets and
  // is NOT added to the Split ledger (a planned bill isn't a shared expense; the form never even
  // asks who shares it). If the bank debit SMS arrives later it replaces this entry (counted once).
  const markPlannedSpent = (item) => {
    const isCardBill = item.fromSms && item.billLabel === "credit card bill";
    const tx = {
      id: "tx" + Date.now(), desc: item.desc, amount: item.amount, category: item.category, date: todayISO(),
      source: "Upcoming · paid", manual: true, payRef: true, fromPlanned: item,
      ...(isCardBill ? { excluded: true, excludedReason: "Credit-card bill payment — card purchases are already counted" } : {}),
    };
    setTxList((prev) => [tx, ...prev]);
    if (item.fromSms && item.billKey) setSmsIgnored((ig) => (ig.includes(item.billKey) ? ig : [...ig, item.billKey]));
    setPlanned((prev) => prev.filter((p) => p.id !== item.id));
    recordActivity();
  };
  const updatePlanned = (id, updates) => setPlanned((prev) => prev.map((p) => (p.id === id ? { ...p, ...updates } : p)));

  // ---- Recurring bills -------------------------------------------------------
  const addRecurring = ({ name, amount, category, dueDay, alreadyPaid }) => {
    if (!name.trim() || !(Number(amount) > 0) || !(Number(dueDay) >= 1 && Number(dueDay) <= 31)) return false;
    setRecurring((prev) => [{
      id: "r" + Date.now(), desc: name.trim(), amount: Number(amount), category, everyMonthDay: Number(dueDay),
      lastPaid: alreadyPaid ? todayISO() : null, source: "manual",
    }, ...prev]);
    recordActivity();
    return true;
  };
  const updateRecurring = (id, updates) => setRecurring((prev) => prev.map((r) => (r.id === id ? { ...r, ...updates, isNew: false } : r)));
  // Deleting a bill that came from SMS is remembered, so it isn't quietly re-added.
  const deleteRecurring = (id) => {
    const victim = recurring.find((r) => r.id === id);
    if (victim?.billerKey) setSmsIgnored((ig) => (ig.includes("rec:" + victim.billerKey) ? ig : [...ig, "rec:" + victim.billerKey]));
    setRecurring((prev) => prev.filter((r) => r.id !== id));
  };
  // Marking a bill paid records that month's payment as a real transaction — this is what makes
  // it count in Spent (bills count when paid, not from the day they're created).
  const markRecurringPaid = (id) => {
    const r = recurring.find((x) => x.id === id);
    if (!r || isPaidForMonth(r, monthKey(todayISO()))) return;
    const txId = "tx" + Date.now();
    const isCardBill = r.billLabel === "credit card bill";
    const tx = {
      id: txId, desc: r.desc, amount: r.amount, category: r.category, date: todayISO(),
      source: "Marked paid", manual: true, payRef: true, recurringId: r.id,
      ...(isCardBill ? { excluded: true, excludedReason: "Credit-card bill payment — card purchases are already counted" } : {}),
    };
    setTxList((prev) => [tx, ...prev]);
    setRecurring((prev) => prev.map((x) => (x.id === id ? { ...x, lastPaid: todayISO(), paidTxId: txId, isNew: false } : x)));
    recordActivity();
  };
  const dismissRecurringNotice = () => setRecurring((prev) => prev.map((r) => (r.isNew ? { ...r, isNew: false } : r)));
  // Money Coach spotted a monthly charge -> make it a recurring bill, linked to the charges it came from.
  const makeRecurringFromCharge = (c) => {
    const id = "r" + Date.now();
    setRecurring((prev) => [{
      id, desc: c.name, amount: c.amount, category: c.category, everyMonthDay: Number(c.lastDate.slice(8, 10)),
      lastPaid: c.lastDate, paidTxId: c.lastId, source: "detected",
    }, ...prev]);
    setTxList((prev) => prev.map((t) => (c.ids.includes(t.id) ? { ...t, recurringId: id } : t)));
    recordActivity();
  };

  const netBalance = useMemo(() => {
    const net = {}; MEMBERS.forEach((m) => (net[m.id] = 0));
    expenses.filter((e) => !e.recurring).forEach((e) => {
      net[e.paidBy] += e.amount;
      const share = e.amount / e.splitAmong.length;
      e.splitAmong.forEach((id) => (net[id] -= share));
    });
    return net;
  }, [expenses]);
  const settlements = useMemo(() => simplifyBalances(netBalance), [netBalance]);
  const recurringItems = recurring;
  // Fixed monthly commitments — shown for information only. They are NOT added to Spent:
  // a bill counts as spending when it is actually paid (Mark paid, or the bank debit SMS).
  const recurringMonthlyTotal = recurringItems.reduce((s, e) => s + e.amount, 0);

  // Everything in the header/dashboard is for the CURRENT calendar month, as labelled.
  // (It used to add up everything imported — up to 180 days of SMS — under a "this month" label.)
  const curMonth = monthKey(todayISO());
  const monthTx = useMemo(() => txList.filter((t) => monthKey(t.date) === curMonth), [txList, curMonth]);
  const totals = useMemo(() => summarizeTx(monthTx), [monthTx]);
  const income = totals.income;
  const totalSpend = totals.spent;          // money out, net of refunds — excludes Savings and excluded items
  const savedAmt = totals.saved;            // money moved into Savings (SIPs, deposits…)
  const leftOver = totals.leftOver;         // Earned − Spent − Saved
  // What was not spent (Earned − Spent). Includes money moved to Savings, so investing helps the rate.
  const saved = totals.retained;
  const savingsRate = income ? Math.max(0, Math.min(100, (saved / income) * 100)) : 0;

  const categoryTotals = useMemo(() => {
    const map = {};
    monthTx.forEach((t) => {
      if (t.excluded || t.category === "Income" || t.category === "Savings") return;
      map[t.category] = (map[t.category] || 0) + t.amount;
    });
    return Object.entries(map).map(([category, amount]) => ({ category, amount })).filter((c) => c.amount > 0).sort((a, b) => b.amount - a.amount);
  }, [monthTx]);

  // Recurring + Upcoming items still unpaid this month
  const stillToPay = useMemo(() => dueThisMonth(recurringItems, planned, todayISO()), [recurringItems, planned]);

  // Earliest upcoming due date across household recurring bills AND anything
  // planned/SMS-detected in Plan → Upcoming (credit card bills, utility bills, etc).
  const nextBill = useMemo(
    () => computeNextBill(recurringItems, planned, todayISO()),
    [recurringItems, planned]
  );

  const monthlyTrend = useMemo(() => {
    const now = new Date();
    const months = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push({ key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`, month: d.toLocaleString("en-US", { month: "short" }) });
    }
    const byMonth = {};
    months.forEach((m) => (byMonth[m.key] = 0));
    txList.forEach((t) => {
      if (t.excluded || t.category === "Income" || t.category === "Savings") return;
      const k = t.date.slice(0, 7);
      if (k in byMonth) byMonth[k] += t.amount;
    });
    return months.map((m) => ({ month: m.month, spend: Math.max(0, byMonth[m.key]) }));
  }, [txList]);

  const prevMonthSpend = monthlyTrend[monthlyTrend.length - 2].spend;
  const curMonthSpend = monthlyTrend[monthlyTrend.length - 1].spend;
  const spendDelta = prevMonthSpend ? ((curMonthSpend - prevMonthSpend) / prevMonthSpend) * 100 : 0;

  const settleTotal = settlements.reduce((s, x) => s + x.amount, 0);

  const budgetsWithSpend = useMemo(() => budgets.map((b) => {
    const spent = categoryTotals.find((c) => c.category === b.category)?.amount || 0;
    return { ...b, spent, pct: b.limit ? Math.min(150, (spent / b.limit) * 100) : 0 };
  }), [budgets, categoryTotals]);
  const overBudget = budgetsWithSpend.filter((b) => b.spent > b.limit);

  const goalsTotals = useMemo(() => {
    const target = goals.reduce((s, g) => s + g.target, 0);
    const saved2 = goals.reduce((s, g) => s + g.saved, 0);
    return { target, saved: saved2, pct: target ? (saved2 / target) * 100 : 0 };
  }, [goals]);

  const plannedSorted = useMemo(() => [...planned].sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate)), [planned]);
  const upcomingTotal = planned.reduce((s, p) => s + p.amount, 0);

  const streak = useMemo(() => computeStreakInfo(activityDates, todayISO()), [activityDates]);

  const recurringCharges = useMemo(
    () => detectRecurringCharges(txList, todayISO(), new Set(recurringItems.map((r) => normMerchant(r.desc)))).filter((c) => !recurringDismissed.includes(c.key)),
    [txList, recurringDismissed, recurringItems]
  );
  const dismissRecurringCharge = (key) => setRecurringDismissed((prev) => (prev.includes(key) ? prev : [...prev, key]));

  const [wrappedKind, setWrappedKind] = useState("month");
  const wrapped = useMemo(
    () => computeWrapped({ txList, recurringItems, goals, activityDates, kind: wrappedKind, today: todayISO() }),
    [txList, recurringItems, goals, activityDates, wrappedKind]
  );

  const nameOf = (id) => memberName(id);

  // ---- WhatsApp nudge ----
  const [nudgePhone, setNudgePhone] = usePersistentState("trucent_nudge_phones", {});
  const sendNudge = (settlement, phoneOverride) => {
    const phone = phoneOverride ?? nudgePhone[settlement.from];
    if (!phone) return false;
    const text = buildNudgeText({
      debtorName: memberName(settlement.from),
      creditorName: memberName(settlement.to),
      creditorIsMe: settlement.to === currentMember,
      amount: settlement.amount,
      items: "shared expenses",
    });
    const link = waLink(phone, text);
    const browser = typeof window !== "undefined" ? window.Capacitor?.Plugins?.Browser : null;
    if (browser?.open) browser.open({ url: link }); else if (typeof window !== "undefined") window.open(link, "_blank");
    if (phoneOverride) setNudgePhone((prev) => ({ ...prev, [settlement.from]: phoneOverride }));
    return true;
  };

  // ---- Export (Excel / PDF) via the native share sheet ----
  // One Share action covers "email it" / "WhatsApp it" / "save to Drive" etc.,
  // since that's exactly what Android's native share sheet already offers —
  // rather than hardcoding separate per-app buttons.
  const [exportBusy, setExportBusy] = useState(false);

  // Shared by every export: write the file, then hand it to the native share
  // sheet (or fall back to a plain browser download in the web preview).
  const shareFile = async ({ bytes, filename, mime, title, text }) => {
    const base64 = bytesToBase64(bytes);
    const cap = typeof window !== "undefined" ? window.Capacitor : null;
    const fs = cap?.Plugins?.Filesystem, share = cap?.Plugins?.Share;
    if (fs && share) {
      const written = await fs.writeFile({ path: filename, data: base64, directory: "CACHE" });
      await share.share({ title, text, url: written.uri });
    } else if (typeof window !== "undefined") {
      const a = document.createElement("a");
      a.href = `data:${mime};base64,${base64}`;
      a.download = filename;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
    }
  };
  const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

  const exportStatement = async (format, kind) => {
    setExportBusy(true);
    try {
      const range = periodRange(kind, todayISO());
      const model = buildExportModel({ txList, expenses, recurringItems, nameOf, range, today: todayISO() });
      const bytes = format === "pdf" ? buildExportPdf(model, memberName(currentMember)) : buildExportXlsx(model);
      await shareFile({
        bytes, filename: `TruCent-${range.key}.${format === "pdf" ? "pdf" : "xlsx"}`,
        mime: format === "pdf" ? "application/pdf" : XLSX_MIME,
        title: "TruCent statement", text: `${range.label} statement from TruCent`,
      });
      recordActivity();
      return true;
    } catch {
      return false;
    } finally {
      setExportBusy(false);
    }
  };

  // Group ledger: shared one-off expenses + who owes whom. The share message
  // itself spells out the outstanding amounts, so whoever receives it (e.g. in
  // a WhatsApp group) can see what's owed without even opening the attachment.
  const exportGroupLedger = async (format) => {
    setExportBusy(true);
    try {
      const model = buildGroupLedgerModel({ expenses, settlements, members: MEMBERS, nameOf, today: todayISO() });
      const bytes = format === "pdf" ? buildGroupLedgerPdf(model, memberName(currentMember)) : buildGroupLedgerXlsx(model);
      const lines = model.settleRows.length
        ? model.settleRows.map(([from, to, amt]) => `• ${from} owes ${to} ${inr(amt)}`)
        : ["Everyone's square — nothing outstanding."];
      const text = `Group ledger from TruCent — ${model.count} shared expense${model.count !== 1 ? "s" : ""}, ${inr(model.totalSpend)} total.\n\nOutstanding:\n${lines.join("\n")}\n\nFull ledger attached.`;
      await shareFile({
        bytes, filename: `TruCent-group-ledger-${todayISO()}.${format === "pdf" ? "pdf" : "xlsx"}`,
        mime: format === "pdf" ? "application/pdf" : XLSX_MIME,
        title: "TruCent group ledger", text,
      });
      recordActivity();
      return true;
    } catch {
      return false;
    } finally {
      setExportBusy(false);
    }
  };

  // ---- Back up / restore ------------------------------------------------------
  // The backup is one JSON file with everything you've entered, your learned categories and the
  // list of SMS you deleted (so those don't reappear after a restore). It goes out through the
  // same share sheet as the exports — save it to Drive or email it to yourself.
  const exportBackup = async () => {
    setExportBusy(true);
    try {
      const store = {};
      for (const k of BACKUP_KEYS) {
        const raw = typeof window !== "undefined" ? window.localStorage?.getItem(k) : null;
        if (raw != null) { try { store[k] = JSON.parse(raw); } catch { /* skip unreadable key */ } }
      }
      const bytes = new TextEncoder().encode(JSON.stringify(buildBackup(store)));
      await shareFile({
        bytes, filename: `TruCent-backup-${todayISO()}.json`, mime: "application/json", title: "TruCent backup",
        text: "TruCent backup — keep this file somewhere safe (Drive, or email it to yourself). Restore it from the profile menu after reinstalling or on a new phone.",
      });
      return true;
    } catch {
      return false;
    } finally {
      setExportBusy(false);
    }
  };
  const pickBackupFile = async (file) => {
    if (!file) return;
    try {
      const text = typeof file.text === "function"
        ? await file.text()
        : await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = rej; r.readAsText(file); });
      const parsed = parseBackup(text);
      setRestorePlan(parsed.ok ? { store: parsed.store, summary: parsed.summary, createdAt: parsed.createdAt } : { error: parsed.error });
    } catch {
      setRestorePlan({ error: "Couldn't read that file." });
    }
  };
  const applyRestore = () => {
    if (!restorePlan || !restorePlan.store) return;
    // Replace everything: clear our keys first so nothing from the current data survives by accident.
    for (const k of BACKUP_KEYS) window.localStorage.removeItem(k);
    for (const [k, v] of Object.entries(restorePlan.store)) saveLS(k, v);
    saveLS("trucent_data_version", DATA_VERSION);
    window.location.reload();
  };

  // ---- Local notifications ----
  const scheduleNotifications = async () => {
    const cap = typeof window !== "undefined" ? window.Capacitor : null;
    const ln = cap?.Plugins?.LocalNotifications;
    if (!ln) return;
    try {
      const perm = await ln.requestPermissions();
      if (perm?.display !== "granted") return;
      const { immediate, scheduled, newKeys } = planNotifications({
        budgetsWithSpend, goals, planned, recurringItems, notifState, today: todayISO(),
      });
      if (immediate.length) {
        await ln.schedule({ notifications: immediate.map((n) => ({
          id: hashToInt(n.key), title: n.title, body: n.body, schedule: { at: new Date(Date.now() + 1000) },
        })) });
      }
      if (scheduled.length) {
        await ln.schedule({ notifications: scheduled.map((n) => ({
          id: n.id, title: n.title, body: n.body, schedule: { at: new Date(n.at) },
        })) });
      }
      if (newKeys.length) setNotifState((prev) => ({ init: true, keys: [...new Set([...(prev.keys || []), ...newKeys])] }));
    } catch {
      // notification permission denied or plugin unavailable — app works fine without it
    }
  };
  useEffect(() => {
    scheduleNotifications();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [budgetsWithSpend, goals, planned, recurringItems]);

  // ---- Home screen widget ----
  const pushWidgetUpdate = async () => {
    const cap = typeof window !== "undefined" ? window.Capacitor : null;
    const hw = cap?.Plugins?.HomeWidget;
    if (!hw) return;
    try {
      const payload = buildWidgetPayload({ income, totalSpend, saved: leftOver, nextBill, streak, today: todayISO() });
      await hw.updateWidget(payload);
    } catch {
      // widget plugin unavailable (e.g. browser preview) — safe to ignore
    }
  };
  useEffect(() => {
    pushWidgetUpdate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [income, totalSpend, leftOver, nextBill, streak.current]);

  // Every delete asks first (transactions have their own message, above).
  const confirmDeleteExpense = (id) => {
    const e = expenses.find((x) => x.id === id);
    askConfirm({ title: "Delete this expense?", body: e ? `${e.desc} · ${inr(e.amount)}. Balances between members will update.` : "", onConfirm: () => deleteExpense(id) });
  };
  const confirmRemovePlanned = (id) => {
    const p = planned.find((x) => x.id === id);
    askConfirm({
      title: "Remove this upcoming expense?",
      body: p ? `${p.desc} · ${inr(p.amount)} due ${fmtDateShort(p.dueDate)}.${p.fromSms ? " It won't be added again from SMS." : ""}` : "",
      onConfirm: () => removePlanned(id),
    });
  };
  const confirmDeleteRecurring = (id) => {
    const r = recurring.find((x) => x.id === id);
    askConfirm({
      title: "Delete this recurring bill?",
      body: r ? `${r.desc} · ${inr(r.amount)} on the ${r.everyMonthDay}${ordinal(r.everyMonthDay)} of each month. Payments you've already recorded stay.${r.billerKey ? " It won't be re-added from SMS." : ""}` : "",
      onConfirm: () => deleteRecurring(id),
    });
  };
  const confirmRemoveGoal = (id) => {
    const g = goals.find((x) => x.id === id);
    askConfirm({ title: "Delete this goal?", body: g ? `${g.name} — ${inr(g.saved)} saved of ${inr(g.target)}.` : "", onConfirm: () => removeGoal(id) });
  };
  const confirmRemoveBudget = (category) => {
    askConfirm({ title: "Delete this budget?", body: `Your ${category} budget will be removed. Your spending is untouched.`, onConfirm: () => removeBudget(category) });
  };
  const confirmDeleteMember = (id) => {
    askConfirm({
      title: "Remove this group member?",
      body: `${memberName(id)} will be removed from the group. Their past expenses stay in the ledger but will show without a name.`,
      onConfirm: () => deleteMember(id),
    });
  };
  const confirmDeleteRule = (id) => {
    const r = rules.find((x) => x.id === id);
    askConfirm({ title: "Forget this rule?", body: r ? `${r.label} will no longer be auto-filed as ${r.category}. Past transactions keep their category.` : "", onConfirm: () => deleteRule(id) });
  };

  const uncategorized = useMemo(() => groupUncategorized(txList), [txList]);
  const suggestFor = (key) => suggestCategory(key, rules);
  const curMonthLabel = monthLabel(curMonth);

  const shared = {
    expenses, settlements, recurringItems, markRecurringPaid, showForm, setShowForm,
    updateExpense, deleteExpense: confirmDeleteExpense,
    form: { fDesc, setFDesc, fAmount, setFAmount, fCategory, setFCategory, fPaidBy, setFPaidBy, fSplit, setFSplit },
    addExpense, txList, totalSpend, income, saved, savedAmt, leftOver, stillToPay, curMonthLabel,
    categoryTotals, changeTxCategory, removeTx: confirmRemoveTx,
    offlineForm: { oDesc, setODesc, oAmount, setOAmount, oCategory, setOCategory, oMode, setOMode, oRecurring, setORecurring, oDate, setODate, addOfflineExpense },
    smsStatus, importFromSms,
    recurringMonthlyTotal, nextBill, spendDelta, savingsRate, settleTotal,
    budgetsWithSpend, overBudget, removeBudget: confirmRemoveBudget,
    budgetForm: { bCategory, setBCategory, bLimit, setBLimit, addBudget },
    goals, goalsTotals, addFundsToGoal, removeGoal: confirmRemoveGoal,
    goalForm: { gName, setGName, gTarget, setGTarget, gDeadline, setGDeadline, addGoal },
    plannedSorted, upcomingTotal, removePlanned: confirmRemovePlanned, markPlannedSpent, updatePlanned,
    plannedForm: { pDesc, setPDesc, pAmount, setPAmount, pCategory, setPCategory, pDate, setPDate, addPlanned },
    currentMember, setCurrentMember, monthlyTrend,
    addRecurring, updateRecurring, deleteRecurring: confirmDeleteRecurring, dismissRecurringNotice, makeRecurringFromCharge,
    rules, uncategorized, suggestFor, assignGroup,
    streak, recurringCharges, dismissRecurringCharge,
    wrapped, wrappedKind, setWrappedKind, wrappedOpen, setWrappedOpen,
    sendNudge, nudgePhone,
    exportStatement, exportGroupLedger, exportBusy,
    smsSyncing, lastSmsSync, smsPreviewTx, setSmsPreviewTx,
    nameOf,
  };

  return (
    <div style={{
      fontFamily: "'Inter', -apple-system, sans-serif", background: T.bg, color: T.text, minHeight: "100%",
      padding: "18px 14px 100px", maxWidth: 640, margin: "0 auto", position: "relative",
      backgroundImage: `radial-gradient(circle at 15% 0%, rgba(139,92,246,0.18), transparent 45%), radial-gradient(circle at 100% 8%, rgba(236,72,153,0.13), transparent 40%)`,
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&family=Baloo+2:wght@700;800&display=swap');
        * { box-sizing: border-box; font-variant-numeric: tabular-nums; }
        button { font-family: inherit; cursor: pointer; -webkit-tap-highlight-color: transparent; }
        input, select { font-family: inherit; }
        ::placeholder { color: ${T.textMute}; }
        select option { background: ${T.surfaceHi}; color: ${T.text}; }
        ::-webkit-scrollbar { display: none; }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .coach-spin { animation: spin 1s linear infinite; }
      `}</style>

      {/* ---------------- Header ---------------- */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
          <div style={{ position: "relative", display: "inline-flex", alignItems: "baseline" }}>
            <span style={{ fontFamily: "'Baloo 2', cursive", fontWeight: 800, fontSize: 27, color: "#fff", letterSpacing: -0.5, lineHeight: 1 }}>tru</span>
            <span style={{
              fontFamily: "'Baloo 2', cursive", fontWeight: 800, fontSize: 27, letterSpacing: -0.5, lineHeight: 1,
              background: T.gradPrimary, WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent",
            }}>
              cent
            </span>
            {/* decorative accent, echoing the dot + pixel-trail motif */}
            <div style={{ position: "absolute", top: -9, right: -10, display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2 }}>
              <div style={{ width: 5, height: 5, borderRadius: "50%", background: T.gold }} />
              <div style={{ display: "flex", gap: 2, alignItems: "flex-end" }}>
                <div style={{ width: 6, height: 6, borderRadius: 2, background: T.pink }} />
                <div style={{ width: 4, height: 4, borderRadius: 1.5, background: T.purple }} />
              </div>
            </div>
          </div>
          <span style={{
            fontSize: 9.5, fontWeight: 800, color: T.textMute, background: T.surfaceHi,
            border: `1px solid ${T.border}`, borderRadius: 6, padding: "2px 6px", letterSpacing: 0.3,
          }}>
            V-001.P
          </span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {streak.current > 0 && (
            <div
              style={{
                display: "flex", alignItems: "center", gap: 3, background: T.surfaceHi,
                border: `1px solid ${streak.atRisk ? "#FB923C55" : T.border}`, borderRadius: 20, padding: "4px 9px 4px 7px",
              }}
              title={streak.atRisk ? "Log something today to keep your streak" : "Current streak"}
            >
              <Flame size={12} color={streak.atRisk ? T.textMute : "#FB923C"} />
              <span style={{ fontSize: 11.5, fontWeight: 800, color: streak.atRisk ? T.textSoft : T.text }}>{streak.current}</span>
            </div>
          )}
          <button
            data-testid="profile-btn"
            onClick={() => setShowProfile((s) => !s)}
            style={{
              width: 34, height: 34, borderRadius: "50%", background: T.surfaceHi,
              border: `1px solid ${showProfile ? T.borderHi : T.border}`, display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 12.5, fontWeight: 800, color: memberColor(currentMember), flexShrink: 0,
            }}
          >
            {memberName(currentMember).trim()[0]}
          </button>
        </div>
      </div>

      {showProfile && (
        <ProfilePanel
          currentMember={currentMember}
          setCurrentMember={setCurrentMember}
          onClose={() => setShowProfile(false)}
          addMember={addMember}
          updateMember={updateMember}
          deleteMember={confirmDeleteMember}
          onBackup={exportBackup}
          onPickBackup={pickBackupFile}
          backupBusy={exportBusy}
          rulesCount={rules.length}
          onOpenRules={() => { setShowProfile(false); setShowRules(true); }}
        />
      )}

      {/* ---------------- Earned / Spent / Left over — visible on every tab ---------------- */}
      <div style={{ ...glassCard, padding: "10px 14px", marginBottom: 18 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 6 }}>
            <TrendingUp size={13} color={T.green} />
            <div>
              <div style={{ fontSize: 9.5, color: T.textMute, fontWeight: 700 }}>EARNED</div>
              <div data-testid="hdr-earned" style={{ fontSize: 12.5, fontWeight: 800, color: T.green }}>{inr(income)}</div>
            </div>
          </div>
          <div style={{ width: 1, height: 26, background: T.border }} />
          <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 6, justifyContent: "center" }}>
            <TrendingDown size={13} color={T.red} />
            <div>
              <div style={{ fontSize: 9.5, color: T.textMute, fontWeight: 700 }}>SPENT</div>
              <div data-testid="hdr-spent" style={{ fontSize: 12.5, fontWeight: 800, color: T.red }}>{inr(totalSpend)}</div>
            </div>
          </div>
          <div style={{ width: 1, height: 26, background: T.border }} />
          <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 6, justifyContent: "flex-end" }}>
            <Scale size={13} color={leftOver >= 0 ? T.gold : T.red} />
            <div>
              <div style={{ fontSize: 9.5, color: T.textMute, fontWeight: 700 }}>LEFT OVER</div>
              <div data-testid="hdr-left" style={{
                fontSize: 12.5, fontWeight: 800,
                ...(leftOver >= 0
                  ? { background: T.gradGold, WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" }
                  : { color: T.red }),
              }}>
                {leftOver >= 0 ? "+" : "−"}{inr(leftOver)}
              </div>
            </div>
          </div>
        </div>
        <div style={{
          display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", marginTop: 8, paddingTop: 8,
          borderTop: `1px solid ${T.border}`, fontSize: 10.5, color: T.textMute,
        }}>
          <span>{curMonthLabel}</span>
          {savedAmt !== 0 && (
            <span data-testid="hdr-saved">{savedAmt > 0 ? "Saved" : "Withdrawn"} <b style={{ color: "#22D3EE" }}>{inr(savedAmt)}</b></span>
          )}
          {stillToPay.total > 0 && (
            <span data-testid="hdr-still">Still to pay <b style={{ color: T.gold }}>{inr(stillToPay.total)}</b></span>
          )}
        </div>
      </div>

      {tab === "home" && <HomeTab {...shared} setTab={setTab} />}
      {tab === "burn" && <BurnTab {...shared} />}
      {tab === "plan" && <PlanTab {...shared} />}
      {tab === "split" && <SplitTab {...shared} />}

      <BottomNav tab={tab} setTab={setTab} />

      <LearnSheet prompt={learnPrompt} onAlways={confirmAlways} onOnce={() => setLearnPrompt(null)} onFixPast={fixPastForRule} onUndo={undoLearning} onClose={() => setLearnPrompt(null)} />
      {showRules && (
        <RulesModal rules={rules} txList={txList} onClose={() => setShowRules(false)} onChangeCategory={updateRuleCategory} onDelete={confirmDeleteRule} />
      )}
      <RestoreDialog plan={restorePlan} onClose={() => setRestorePlan(null)} onConfirm={applyRestore} />
      <ConfirmDialog state={confirmState} onClose={() => setConfirmState(null)} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bottom navigation
// ---------------------------------------------------------------------------
function BottomNav({ tab, setTab }) {
  const items = [
    { id: "home", label: "Home", icon: LayoutGrid },
    { id: "burn", label: "Track", icon: Wallet },
    { id: "plan", label: "Plan", icon: Target },
    { id: "split", label: "Split", icon: Users },
  ];
  return (
    <div style={{
      position: "fixed", bottom: 16, left: "50%", transform: "translateX(-50%)",
      width: "calc(100% - 28px)", maxWidth: 612, display: "flex", gap: 4,
      background: "rgba(21,21,29,0.85)", backdropFilter: "blur(16px)",
      border: `1px solid ${T.borderHi}`, borderRadius: 20, padding: 6,
      boxShadow: "0 12px 32px rgba(0,0,0,0.5)", zIndex: 10,
    }}>
      {items.map((it) => {
        const Icon = it.icon;
        const active = tab === it.id;
        return (
          <button key={it.id} onClick={() => setTab(it.id)} style={{
            flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 3,
            padding: "9px 0", borderRadius: 14, border: "none",
            background: active ? T.gradPrimary : "transparent",
            color: active ? "#fff" : T.textMute, boxShadow: active ? "0 4px 14px rgba(139,92,246,0.4)" : "none",
          }}>
            <Icon size={17} />
            <span style={{ fontSize: 10, fontWeight: 700 }}>{it.label}</span>
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Profile switcher panel
// ---------------------------------------------------------------------------
function ProfilePanel({ currentMember, setCurrentMember, onClose, addMember, updateMember, deleteMember, onBackup, onPickBackup, backupBusy, rulesCount, onOpenRules }) {
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState("");
  const [editColor, setEditColor] = useState(MEMBER_PALETTE[0]);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState(MEMBER_PALETTE[0]);

  const startEdit = (m) => { setEditingId(m.id); setEditName(m.name); setEditColor(m.color); setShowAddForm(false); };
  const saveEdit = () => {
    if (!editName.trim()) return;
    updateMember(editingId, { name: editName.trim(), color: editColor });
    setEditingId(null);
  };

  const swatchRow = (value, onPick) => (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", margin: "8px 0" }}>
      {MEMBER_PALETTE.map((c) => (
        <button key={c} onClick={() => onPick(c)} style={{
          width: 20, height: 20, borderRadius: "50%", background: c, border: value === c ? `2px solid ${T.text}` : "2px solid transparent",
          padding: 0,
        }} />
      ))}
    </div>
  );

  return (
    <div style={{
      ...glassCard, position: "absolute", top: 58, right: 14, width: 270, zIndex: 20,
      padding: 14, boxShadow: "0 16px 40px rgba(0,0,0,0.5)",
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <div style={{ fontSize: 12.5, fontWeight: 800 }}>Group profiles</div>
        <button onClick={onClose} style={iconBtn}><X size={14} color={T.textMute} /></button>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 280, overflowY: "auto" }}>
        {MEMBERS.map((m) => {
          const active = m.id === currentMember;
          if (editingId === m.id) {
            return (
              <div key={m.id} style={{ background: T.surfaceHi, borderRadius: 10, padding: "9px 9px 10px" }}>
                <input value={editName} onChange={(e) => setEditName(e.target.value)} style={{ ...inputStyle, padding: "6px 8px", fontSize: 12, marginBottom: 2 }} />
                {swatchRow(editColor, setEditColor)}
                <div style={{ display: "flex", gap: 6 }}>
                  <button onClick={saveEdit} style={{ ...primaryBtn, padding: "6px 0", fontSize: 11.5, flex: 1, marginTop: 0 }}>Save</button>
                  <button onClick={() => setEditingId(null)} style={{ ...iconBtn, background: T.surface, borderRadius: 8, padding: "6px 10px" }}>
                    <X size={12} color={T.textMute} />
                  </button>
                </div>
              </div>
            );
          }
          return (
            <div key={m.id} style={{ display: "flex", alignItems: "center", gap: 6, borderRadius: 10, background: active ? T.surfaceHi : "transparent" }}>
              <button
                onClick={() => { setCurrentMember(m.id); onClose(); }}
                style={{ flex: 1, display: "flex", alignItems: "center", gap: 9, border: "none", background: "transparent", textAlign: "left", padding: "8px 9px" }}
              >
                <Avatar id={m.id} size={26} />
                <span style={{ flex: 1, fontSize: 12.5, fontWeight: active ? 800 : 600, color: active ? T.text : T.textSoft, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {m.name}
                </span>
                {active && <Check size={13} color={T.green} />}
              </button>
              <button onClick={() => startEdit(m)} style={iconBtn}><Edit2 size={12} color={T.textMute} /></button>
              {MEMBERS.length > 1 && (
                <button onClick={() => deleteMember(m.id)} style={{ ...iconBtn, marginRight: 6 }}>
                  <Trash2 size={12} color={T.textMute} />
                </button>
              )}
            </div>
          );
        })}
      </div>

      {showAddForm ? (
        <div style={{ background: T.surfaceHi, borderRadius: 10, padding: 10, marginTop: 8 }}>
          <input placeholder="Name" value={newName} onChange={(e) => setNewName(e.target.value)} style={{ ...inputStyle, padding: "6px 8px", fontSize: 12 }} />
          {swatchRow(newColor, setNewColor)}
          <div style={{ display: "flex", gap: 6 }}>
            <button
              onClick={() => { addMember(newName, newColor); setNewName(""); setNewColor(MEMBER_PALETTE[0]); setShowAddForm(false); }}
              style={{ ...primaryBtn, padding: "6px 0", fontSize: 11.5, flex: 1, marginTop: 0 }}
            >
              Add
            </button>
            <button onClick={() => setShowAddForm(false)} style={{ ...iconBtn, background: T.surface, borderRadius: 8, padding: "6px 10px" }}>
              <X size={12} color={T.textMute} />
            </button>
          </div>
        </div>
      ) : (
        <button onClick={() => setShowAddForm(true)} style={{ ...navAddBtn(false), width: "100%", justifyContent: "center", marginTop: 8 }}>
          <Plus size={13} /> Add group member
        </button>
      )}

      <div style={{ fontSize: 10.5, color: T.textMute, marginTop: 10, lineHeight: 1.4 }}>
        Viewing as <b style={{ color: T.textSoft }}>{memberName(currentMember)}</b> — this sets who's selected by default when you log a new expense.
      </div>

      <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${T.border}` }}>
        <div style={{ fontSize: 10.5, fontWeight: 700, color: T.textMute, marginBottom: 8, letterSpacing: 0.3 }}>YOUR DATA</div>
        <div style={{ display: "flex", gap: 8 }}>
          <button data-testid="backup-btn" disabled={backupBusy} onClick={onBackup} style={{ ...navAddBtn(false), flex: 1, justifyContent: "center", opacity: backupBusy ? 0.6 : 1 }}>
            <Download size={13} /> Back up
          </button>
          <label data-testid="restore-label" style={{ ...navAddBtn(false), flex: 1, justifyContent: "center", cursor: "pointer" }}>
            <Upload size={13} /> Restore
            <input
              data-testid="restore-input" type="file" accept=".json,application/json" style={{ display: "none" }}
              onChange={(e) => { const f = e.target.files && e.target.files[0]; e.target.value = ""; onPickBackup(f); }}
            />
          </label>
        </div>
        <button data-testid="rules-open" onClick={onOpenRules} style={{ ...navAddBtn(false), width: "100%", justifyContent: "space-between", marginTop: 8 }}>
          <span style={{ display: "flex", alignItems: "center", gap: 6 }}><Tag size={13} /> Learned categories</span>
          <span style={{ color: T.textMute }}>{rulesCount}</span>
        </button>
        <div style={{ fontSize: 10.5, color: T.textMute, marginTop: 8, lineHeight: 1.45 }}>
          Everything is stored only on this phone — uninstalling erases it. Back up to a file and keep it in Drive, or email it to yourself.
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// HOME — bento analytics dashboard
// ---------------------------------------------------------------------------
function HomeTab(props) {
  const {
    saved, income, totalSpend, categoryTotals, recurringMonthlyTotal, nextBill,
    spendDelta, savingsRate, settleTotal, settlements, setTab,
    overBudget, goalsTotals, plannedSorted, upcomingTotal, monthlyTrend, goals,
    streak, recurringCharges, dismissRecurringCharge, wrapped, wrappedKind, setWrappedKind, wrappedOpen, setWrappedOpen,
    savedAmt, leftOver, stillToPay, makeRecurringFromCharge,
  } = props;

  const topCat = categoryTotals[0];
  const curMonthSpendNonZero = (monthlyTrend[monthlyTrend.length - 1]?.spend || 0) > 0;
  const insights = [
    overBudget.length > 0 && {
      icon: AlertTriangle,
      color: T.red,
      text: `${overBudget[0].category} is over budget by ${inr(overBudget[0].spent - overBudget[0].limit)}`,
    },
    topCat && {
      icon: topCat.amount / categoryTotals.reduce((sum, c) => sum + c.amount, 0) > 0.25 ? TrendingUp : Sparkles,
      color: CATEGORY_META[topCat.category]?.color || T.purple,
      text: `${topCat.category} is your top spend — ${inr(topCat.amount)} this month`,
    },
    curMonthSpendNonZero && {
      icon: spendDelta <= 0 ? ArrowDownRight : ArrowUpRight,
      color: spendDelta <= 0 ? T.green : T.red,
      text: `Spending is ${Math.abs(spendDelta).toFixed(0)}% ${spendDelta <= 0 ? "lower" : "higher"} than last month`,
    },
    recurringMonthlyTotal > 0 && {
      icon: Repeat,
      color: T.purple,
      text: `${inr(recurringMonthlyTotal)}/month locked into recurring bills`,
    },
    {
      icon: Users,
      color: settlements.length ? T.gold : T.green,
      text: settlements.length ? `${settlements.length} settlement${settlements.length > 1 ? "s" : ""} pending, ${inr(settleTotal)} in motion` : "Everyone in the group is settled up",
    },
    goalsTotals.target > 0 && {
      icon: Target,
      color: T.gold,
      text: `${goalsTotals.pct.toFixed(0)}% of the way to ${inr(goalsTotals.target)} in combined goals`,
    },
  ].filter(Boolean);

  const hasIncome = income > 0;
  const hasAnyData = income > 0 || totalSpend > 0 || savedAmt > 0;
  let heroLabel, heroValue, heroIsGold;
  if (!hasAnyData) {
    heroLabel = "NOTHING TRACKED YET"; heroValue = 0; heroIsGold = false;
  } else if (!hasIncome) {
    heroLabel = "SPENT THIS MONTH"; heroValue = totalSpend; heroIsGold = false;
  } else if (leftOver >= 0) {
    heroLabel = "LEFT OVER THIS MONTH"; heroValue = leftOver; heroIsGold = true;
  } else if (saved >= 0) {
    heroLabel = "SPENT + SAVED ABOVE INCOME"; heroValue = Math.abs(leftOver); heroIsGold = false;   // moved more to savings than earned this month
  } else {
    heroLabel = "OVERSPENT THIS MONTH"; heroValue = Math.abs(leftOver); heroIsGold = false;
  }

  return (
    <div>
      {/* Hero */}
      <div style={{
        ...glassCard, background: T.gradHero, padding: "20px 18px", marginBottom: 14, position: "relative", overflow: "hidden",
      }}>
        <div style={{ position: "absolute", top: -30, right: -30, width: 140, height: 140, borderRadius: "50%", background: T.pink, opacity: 0.18, filter: "blur(30px)" }} />
        <div style={{ fontSize: 11.5, color: "rgba(255,255,255,0.6)", fontWeight: 700, marginBottom: 6, letterSpacing: 0.2 }}>
          {heroLabel}
        </div>
        <div style={{
          fontSize: 36, fontWeight: 900, letterSpacing: -1, marginBottom: 10,
          ...(heroIsGold
            ? { background: T.gradGold, WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" }
            : { color: hasAnyData ? T.red : "#fff" }),
        }}>
          {inr(heroValue)}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 14 }}>
          <span style={{ fontSize: 12, color: "rgba(255,255,255,0.65)" }}>Income {inr(income)}</span>
          <span style={{ fontSize: 12, color: "rgba(255,255,255,0.65)" }}>Spent {inr(totalSpend)}</span>
          {savedAmt > 0 && <span style={{ fontSize: 12, color: "rgba(255,255,255,0.65)" }}>Saved {inr(savedAmt)}</span>}
        </div>
        <div style={{ height: 46 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={monthlyTrend} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="heroLine" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor="#FBBF24" />
                  <stop offset="100%" stopColor="#EC4899" />
                </linearGradient>
              </defs>
              <Line type="monotone" dataKey="spend" stroke="url(#heroLine)" strokeWidth={2.5} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <MoneyCoachCard
        setTab={setTab}
        coachData={{
          income, totalSpend, saved, savingsRate, overBudget, categoryTotals,
          goals, recurringMonthlyTotal, settlements, settleTotal, spendDelta, savedAmt,
        }}
        recurringCharges={recurringCharges}
        dismissRecurringCharge={dismissRecurringCharge}
        makeRecurringFromCharge={makeRecurringFromCharge}
      />

      {/* Streak + Money Wrapped */}
      <div style={{ display: "grid", gridTemplateColumns: streak.current > 0 ? "1fr 1fr" : "1fr", gap: 10, marginBottom: 16 }}>
        {streak.current > 0 && (
          <div style={{ ...glassCard, padding: "14px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 8 }}>
              <Flame size={14} color="#FB923C" />
              <div style={{ fontSize: 10.5, color: T.textMute, fontWeight: 700 }}>STREAK</div>
            </div>
            <div style={{ fontSize: 17, fontWeight: 800, marginBottom: 6 }}>
              {streak.current} day{streak.current !== 1 ? "s" : ""}
              {streak.best > streak.current && <span style={{ fontSize: 10.5, color: T.textMute, fontWeight: 600 }}> · best {streak.best}</span>}
            </div>
            <div style={{ display: "flex", gap: 4 }}>
              {streak.last7.map((d) => (
                <div key={d.date} style={{
                  width: 14, height: 14, borderRadius: 4,
                  background: d.done ? "#FB923C" : T.surfaceHi,
                  border: `1px solid ${d.done ? "#FB923C" : T.border}`,
                }} title={d.date} />
              ))}
            </div>
          </div>
        )}
        <button onClick={() => setWrappedOpen(true)} style={{ ...glassCard, textAlign: "left", padding: "14px", background: T.gradHero }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 8 }}>
            <Gift size={14} color={T.gold} />
            <div style={{ fontSize: 10.5, color: "rgba(255,255,255,0.65)", fontWeight: 700 }}>MONEY WRAPPED</div>
          </div>
          <div style={{ fontSize: 13.5, fontWeight: 800 }}>See your recap</div>
          <div style={{ fontSize: 10.5, color: "rgba(255,255,255,0.6)", marginTop: 2 }}>Top category, biggest win & more</div>
        </button>
      </div>

      {wrappedOpen && (
        <WrappedModal wrapped={wrapped} kind={wrappedKind} setKind={setWrappedKind} onClose={() => setWrappedOpen(false)} />
      )}

      {/* Insight chips */}
      <div style={{ display: "flex", gap: 8, overflowX: "auto", marginBottom: 16, paddingBottom: 2 }}>
        {insights.map((ins, i) => {
          const Icon = ins.icon;
          return (
            <div key={i} style={{
              ...glassCard, flex: "0 0 auto", minWidth: 210, padding: "11px 13px",
              display: "flex", alignItems: "flex-start", gap: 8,
            }}>
              <div style={{
                width: 26, height: 26, borderRadius: 8, background: ins.color + "22",
                display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
              }}>
                <Icon size={13} color={ins.color} />
              </div>
              <div style={{ fontSize: 11.5, color: T.textSoft, lineHeight: 1.4 }}>{ins.text}</div>
            </div>
          );
        })}
      </div>

      {/* Bento grid */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
        {/* Settle up */}
        <button onClick={() => setTab("split")} style={{
          ...glassCard, textAlign: "left", padding: "14px", border: `1px solid ${T.border}`,
        }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <div style={{ width: 30, height: 30, borderRadius: 9, background: T.gold + "22", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Users size={15} color={T.gold} />
            </div>
            <ArrowRight size={13} color={T.textMute} />
          </div>
          <div style={{ fontSize: 10.5, color: T.textMute, fontWeight: 600, marginBottom: 2 }}>SETTLE UP</div>
          <div style={{ fontSize: 17, fontWeight: 800 }}>
            {settlements.length ? inr(settleTotal) : "All clear"}
          </div>
          <div style={{ fontSize: 10.5, color: T.textSoft, marginTop: 2 }}>
            {settlements.length ? `${settlements.length} pending` : "no dues"}
          </div>
        </button>

        {/* Next bill */}
        <div style={{ ...glassCard, padding: "14px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <div style={{ width: 30, height: 30, borderRadius: 9, background: T.red + "22", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Bell size={14} color={T.red} />
            </div>
          </div>
          <div style={{ fontSize: 10.5, color: T.textMute, fontWeight: 600, marginBottom: 2 }}>NEXT BILL</div>
          {nextBill ? (
            <>
              <div style={{ fontSize: 17, fontWeight: 800 }}>{inr(nextBill.amount)}</div>
              <div style={{ fontSize: 10.5, color: T.textSoft, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {nextBill.name} · {nextBill.days <= 0 ? "due today" : `in ${nextBill.days}d`}
              </div>
            </>
          ) : <div style={{ fontSize: 13, color: T.textSoft }}>Nothing due</div>}
        </div>
      </div>

      {/* Category donut */}
      <div style={{ ...glassCard, padding: "16px", marginBottom: 10 }}>
        <SectionTitle>Spend by category</SectionTitle>
        {categoryTotals.length === 0 ? (
          <EmptyHint text="Connect SMS or log an expense to see your spend breakdown here." />
        ) : (
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{ width: 108, height: 108, flexShrink: 0 }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={categoryTotals} dataKey="amount" nameKey="category" innerRadius={34} outerRadius={52} paddingAngle={3} stroke="none">
                  {categoryTotals.map((c, i) => (
                    <Cell key={i} fill={CATEGORY_META[c.category]?.color || T.textSoft} />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
            {categoryTotals.slice(0, 5).map((c) => {
              const pct = ((c.amount / categoryTotals.reduce((sum, x) => sum + x.amount, 0)) * 100).toFixed(0);
              const color = CATEGORY_META[c.category]?.color || T.textSoft;
              return (
                <div key={c.category} style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 11.5 }}>
                  <div style={{ width: 7, height: 7, borderRadius: "50%", background: color, flexShrink: 0 }} />
                  <div style={{ flex: 1, color: T.textSoft, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.category}</div>
                  <div style={{ fontWeight: 700, color: T.text }}>{pct}%</div>
                </div>
              );
            })}
          </div>
        </div>
        )}
      </div>

      {/* Savings ring + recurring load */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <div style={{ ...glassCard, padding: "14px", display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 66, height: 66, position: "relative", flexShrink: 0 }}>
            <ResponsiveContainer width="100%" height="100%">
              <RadialBarChart
                innerRadius="72%" outerRadius="100%" data={[{ value: savingsRate }]}
                startAngle={90} endAngle={-270}
              >
                <defs>
                  <linearGradient id="ringGrad" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" stopColor="#FDE68A" />
                    <stop offset="100%" stopColor="#F59E0B" />
                  </linearGradient>
                </defs>
                <RadialBar dataKey="value" cornerRadius={8} fill="url(#ringGrad)" background={{ fill: T.surfaceHi }} max={100} />
              </RadialBarChart>
            </ResponsiveContainer>
            <div style={{
              position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 12.5, fontWeight: 800, color: T.gold,
            }}>
              {savingsRate.toFixed(0)}%
            </div>
          </div>
          <div>
            <div style={{ fontSize: 10.5, color: T.textMute, fontWeight: 600, marginBottom: 2 }}>SAVINGS RATE</div>
            <div style={{ fontSize: 11.5, color: T.textSoft, lineHeight: 1.4 }}>of income kept this month</div>
          </div>
        </div>

        <div style={{ ...glassCard, padding: "14px" }}>
          <div style={{ width: 30, height: 30, borderRadius: 9, background: T.purple + "22", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 8 }}>
            <PiggyBank size={15} color={T.purple} />
          </div>
          <div style={{ fontSize: 10.5, color: T.textMute, fontWeight: 600, marginBottom: 2 }}>RECURRING LOAD</div>
          <div style={{ fontSize: 17, fontWeight: 800 }}>{inr(recurringMonthlyTotal)}</div>
          <div style={{ fontSize: 10.5, color: T.textSoft, marginTop: 2 }}>fixed every month</div>
        </div>
      </div>

      {/* Saved (kept apart from Spent) + what's still due this month */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 10 }}>
        <div data-testid="tile-saved" style={{ ...glassCard, padding: "14px" }}>
          <div style={{ width: 30, height: 30, borderRadius: 9, background: "#22D3EE22", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 8 }}>
            <PiggyBank size={15} color="#22D3EE" />
          </div>
          <div style={{ fontSize: 10.5, color: T.textMute, fontWeight: 600, marginBottom: 2 }}>SAVED THIS MONTH</div>
          <div style={{ fontSize: 17, fontWeight: 800 }}>{inr(savedAmt)}</div>
          <div style={{ fontSize: 10.5, color: T.textSoft, marginTop: 2 }}>SIPs, deposits & savings</div>
        </div>
        <button data-testid="tile-still" onClick={() => setTab("burn")} style={{ ...glassCard, textAlign: "left", padding: "14px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <div style={{ width: 30, height: 30, borderRadius: 9, background: T.gold + "22", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <CalendarClock size={15} color={T.gold} />
            </div>
            <ArrowRight size={13} color={T.textMute} />
          </div>
          <div style={{ fontSize: 10.5, color: T.textMute, fontWeight: 600, marginBottom: 2 }}>STILL TO PAY</div>
          <div style={{ fontSize: 17, fontWeight: 800 }}>{inr(stillToPay.total)}</div>
          <div style={{ fontSize: 10.5, color: T.textSoft, marginTop: 2 }}>
            {stillToPay.items.length ? `${stillToPay.items.length} bill${stillToPay.items.length !== 1 ? "s" : ""} left this month` : "all paid up"}
          </div>
        </button>
      </div>

      {/* Goals + Upcoming — link into Plan tab */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 10 }}>
        <button onClick={() => setTab("plan")} style={{ ...glassCard, textAlign: "left", padding: "14px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <div style={{ width: 30, height: 30, borderRadius: 9, background: T.gold + "22", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Target size={15} color={T.gold} />
            </div>
            <ArrowRight size={13} color={T.textMute} />
          </div>
          <div style={{ fontSize: 10.5, color: T.textMute, fontWeight: 600, marginBottom: 2 }}>GOALS</div>
          <div style={{ fontSize: 17, fontWeight: 800 }}>{goalsTotals.pct.toFixed(0)}%</div>
          <div style={{ fontSize: 10.5, color: T.textSoft, marginTop: 2 }}>{inr(goalsTotals.saved)} of {inr(goalsTotals.target)}</div>
        </button>

        <button onClick={() => setTab("plan")} style={{ ...glassCard, textAlign: "left", padding: "14px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <div style={{ width: 30, height: 30, borderRadius: 9, background: T.blue + "22", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <CalendarClock size={14} color={T.blue} />
            </div>
            <ArrowRight size={13} color={T.textMute} />
          </div>
          <div style={{ fontSize: 10.5, color: T.textMute, fontWeight: 600, marginBottom: 2 }}>UPCOMING</div>
          <div style={{ fontSize: 17, fontWeight: 800 }}>{inr(upcomingTotal)}</div>
          <div style={{ fontSize: 10.5, color: T.textSoft, marginTop: 2 }}>
            {plannedSorted.length} planned expense{plannedSorted.length !== 1 ? "s" : ""}
          </div>
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Money Coach — the agentic UI: a staged "thinking" reveal over instant,
// on-device computation, so the multi-step reasoning is visible even though
// it all runs locally in milliseconds. No network call happens at any point.
// ---------------------------------------------------------------------------
function MoneyCoachCard({ coachData, setTab, recurringCharges, dismissRecurringCharge, makeRecurringFromCharge }) {
  const [stage, setStage] = useState("idle"); // idle | running | empty | done
  const [stepIndex, setStepIndex] = useState(0);
  const [report, setReport] = useState(null);

  const run = () => {
    const result = generateCoachReport(coachData);
    if (!result.hasData) { setStage("empty"); return; }
    setReport(result);
    setStepIndex(0);
    setStage("running");
  };

  useEffect(() => {
    if (stage !== "running") return;
    if (stepIndex >= COACH_STEPS.length) { setStage("done"); return; }
    const t = setTimeout(() => setStepIndex((i) => i + 1), 480);
    return () => clearTimeout(t);
  }, [stage, stepIndex]);

  const typeColor = { warning: T.red, tip: T.gold, prediction: T.blue, success: T.green };

  return (
    <div style={{ ...glassCard, padding: 16, marginBottom: 16, border: `1px solid ${T.borderHi}` }}>
      <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: stage === "idle" || stage === "empty" ? 8 : 12 }}>
        <div style={{
          width: 30, height: 30, borderRadius: 9, background: T.gradPrimary,
          display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
          boxShadow: "0 3px 12px rgba(139,92,246,0.4)",
        }}>
          <Bot size={15} color="#fff" />
        </div>
        <div style={{ fontSize: 13.5, fontWeight: 800 }}>Money Coach</div>
        <span style={{ fontSize: 9, fontWeight: 800, color: T.textMute, background: T.surfaceHi, borderRadius: 5, padding: "2px 5px", letterSpacing: 0.3 }}>
          ON-DEVICE
        </span>
      </div>

      {stage === "idle" && (
        <>
          <p style={{ fontSize: 11.5, color: T.textSoft, lineHeight: 1.5, margin: "0 0 12px" }}>
            Runs a full pass over your budgets, goals, and settlements right on your phone —
            nothing is sent anywhere — and hands back what actually needs your attention.
          </p>
          <button onClick={run} style={{ ...primaryBtn, marginTop: 0, width: "100%" }}>Run analysis</button>
        </>
      )}

      {stage === "empty" && (
        <p style={{ fontSize: 11.5, color: T.textMute, lineHeight: 1.5, margin: 0 }}>
          Add a few transactions first — your coach needs something on the books to analyze.
        </p>
      )}

      {stage === "running" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {COACH_STEPS.map((label, i) => {
            const done = i < stepIndex;
            const active = i === stepIndex;
            return (
              <div key={label} style={{ display: "flex", alignItems: "center", gap: 9 }}>
                <div style={{
                  width: 20, height: 20, borderRadius: "50%", flexShrink: 0,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  background: done ? "rgba(52,211,153,0.18)" : active ? "rgba(139,92,246,0.18)" : T.surfaceHi,
                }}>
                  {done ? <Check size={11} color={T.green} /> : active ? <Loader2 size={11} color={T.purple} className="coach-spin" /> : null}
                </div>
                <span style={{ fontSize: 12, color: done ? T.textSoft : active ? T.text : T.textMute, fontWeight: active ? 700 : 500 }}>
                  {label}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {stage === "done" && report && (
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
            <div style={{
              width: 52, height: 52, borderRadius: "50%", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center",
              background: report.verdictColor + "1A", border: `2px solid ${report.verdictColor}`,
            }}>
              <span style={{ fontSize: 16, fontWeight: 900, color: report.verdictColor }}>{report.score}</span>
            </div>
            <div>
              <div style={{ fontSize: 14.5, fontWeight: 800, color: report.verdictColor }}>{report.verdict}</div>
              <div style={{ fontSize: 11, color: T.textMute }}>Money Coach score, out of 100</div>
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {report.insights.map((ins, i) => {
              const Icon = ins.icon;
              const color = typeColor[ins.type] || T.textSoft;
              return (
                <div key={i} style={{ background: T.surfaceHi, borderRadius: 12, padding: "11px 12px" }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                    <div style={{ width: 24, height: 24, borderRadius: 7, background: color + "22", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 1 }}>
                      <Icon size={12} color={color} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 3 }}>{ins.title}</div>
                      <div style={{ fontSize: 11, color: T.textSoft, lineHeight: 1.45 }}>{ins.detail}</div>
                      {ins.action && (
                        <button
                          onClick={() => setTab(ins.action.tab)}
                          style={{ marginTop: 7, border: "none", background: "transparent", color, fontSize: 11, fontWeight: 700, display: "flex", alignItems: "center", gap: 3, padding: 0 }}
                        >
                          {ins.action.label} <ArrowRight size={11} />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {recurringCharges && recurringCharges.length > 0 && (
            <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ fontSize: 10.5, fontWeight: 700, color: T.textMute, letterSpacing: 0.3 }}>
                STILL PAYING FOR THESE?
              </div>
              {recurringCharges.map((c) => (
                <div key={c.key} style={{ background: T.surfaceHi, borderRadius: 12, padding: "11px 12px" }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                    <div style={{ width: 24, height: 24, borderRadius: 7, background: T.gold + "22", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 1 }}>
                      <RotateCcw size={12} color={T.gold} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 3 }}>{c.name}</div>
                      <div style={{ fontSize: 11, color: T.textSoft, lineHeight: 1.45 }}>
                        {inr(c.amount)} repeated {c.count} months running — about {inr(c.yearly)}/year. Haven't flagged it as recurring yet.
                      </div>
                      <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 8, flexWrap: "wrap" }}>
                        <button
                          data-testid="make-recurring"
                          onClick={() => makeRecurringFromCharge(c)}
                          style={{ border: "none", borderRadius: 8, background: T.gold + "26", color: T.gold, fontSize: 11, fontWeight: 800, padding: "6px 10px", display: "flex", alignItems: "center", gap: 4 }}
                        >
                          <Repeat size={11} /> Make this recurring
                        </button>
                        <button
                          onClick={() => dismissRecurringCharge(c.key)}
                          style={{ border: "none", background: "transparent", color: T.textMute, fontSize: 11, fontWeight: 700, display: "flex", alignItems: "center", gap: 3, padding: 0 }}
                        >
                          Still using it, got it <Check size={11} />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          <button onClick={() => setStage("idle")} style={{ border: "none", background: "transparent", color: T.textMute, fontSize: 11, fontWeight: 700, marginTop: 12, padding: 0 }}>
            Run again
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// SPLIT & TRACK
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Money Wrapped — a Spotify-Wrapped-style recap. Every number here is read
// straight off computeWrapped() in lib.js; nothing is invented for effect.
// ---------------------------------------------------------------------------
function WrappedModal({ wrapped, kind, setKind, onClose }) {
  const c = wrapped.cur;
  const tabs = [
    { id: "month", label: "This month" },
    { id: "lastMonth", label: "Last month" },
    { id: "year", label: "This year" },
  ];
  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(5,5,8,0.85)", zIndex: 50,
      display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
    }} onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%", maxWidth: 380, maxHeight: "88vh", overflowY: "auto", borderRadius: 24,
          background: "linear-gradient(160deg, #1B1730 0%, #2A1740 45%, #3A1830 100%)",
          border: `1px solid ${T.borderHi}`, padding: 22, position: "relative",
        }}
      >
        <button onClick={onClose} style={{ position: "absolute", top: 14, right: 14, border: "none", background: T.surfaceHi, borderRadius: "50%", width: 28, height: 28, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <X size={14} color={T.textSoft} />
        </button>

        <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 4 }}>
          <Gift size={16} color={T.gold} />
          <span style={{ fontSize: 12, fontWeight: 800, color: T.gold, letterSpacing: 0.3 }}>MONEY WRAPPED</span>
        </div>
        <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 14 }}>{wrapped.range.label}</div>

        <div style={{ display: "flex", gap: 6, marginBottom: 18 }}>
          {tabs.map((t) => (
            <button key={t.id} onClick={() => setKind(t.id)} style={{
              border: "none", borderRadius: 20, padding: "5px 11px", fontSize: 11, fontWeight: 700,
              background: kind === t.id ? T.gradPrimary : T.surfaceHi, color: kind === t.id ? "#fff" : T.textSoft,
            }}>
              {t.label}
            </button>
          ))}
        </div>

        {!wrapped.hasData ? (
          <div style={{ fontSize: 13, color: T.textSoft, lineHeight: 1.6, padding: "20px 0" }}>
            Nothing logged for this period yet — connect SMS or add a few transactions, then check back.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {wrapped.win && (
              <div style={{ background: "rgba(251,191,36,0.1)", border: "1px solid rgba(251,191,36,0.3)", borderRadius: 16, padding: 16 }}>
                <div style={{ fontSize: 10.5, fontWeight: 700, color: T.gold, marginBottom: 4, letterSpacing: 0.3 }}>BIGGEST WIN</div>
                <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 3 }}>{wrapped.win.title}</div>
                <div style={{ fontSize: 11.5, color: T.textSoft }}>{wrapped.win.detail}</div>
              </div>
            )}

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div style={{ background: T.surfaceHi, borderRadius: 14, padding: 14 }}>
                <div style={{ fontSize: 10, color: T.textMute, fontWeight: 700, marginBottom: 4 }}>EARNED</div>
                <div style={{ fontSize: 16, fontWeight: 800, color: T.green }}>{inr(c.income)}</div>
              </div>
              <div style={{ background: T.surfaceHi, borderRadius: 14, padding: 14 }}>
                <div style={{ fontSize: 10, color: T.textMute, fontWeight: 700, marginBottom: 4 }}>SPENT</div>
                <div style={{ fontSize: 16, fontWeight: 800, color: T.red }}>{inr(c.spend)}</div>
              </div>
            </div>

            {c.topCategory && (
              <div style={{ background: T.surfaceHi, borderRadius: 14, padding: 14 }}>
                <div style={{ fontSize: 10, color: T.textMute, fontWeight: 700, marginBottom: 6 }}>TOP CATEGORY</div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {(() => { const Icon = CATEGORY_META[c.topCategory.category]?.icon || Wallet; return <Icon size={16} color={CATEGORY_META[c.topCategory.category]?.color || T.textSoft} />; })()}
                  <div style={{ fontSize: 14, fontWeight: 700 }}>{c.topCategory.category}</div>
                  <div style={{ marginLeft: "auto", fontSize: 13, fontWeight: 800, color: T.gold }}>{c.topCategory.pct.toFixed(0)}%</div>
                </div>
              </div>
            )}

            {c.topMerchant && (
              <div style={{ background: T.surfaceHi, borderRadius: 14, padding: 14 }}>
                <div style={{ fontSize: 10, color: T.textMute, fontWeight: 700, marginBottom: 4 }}>MOST VISITED</div>
                <div style={{ fontSize: 14, fontWeight: 700 }}>{c.topMerchant.name}</div>
                <div style={{ fontSize: 11, color: T.textSoft, marginTop: 2 }}>{c.topMerchant.n} transactions · {inr(c.topMerchant.total)} total</div>
              </div>
            )}

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div style={{ background: T.surfaceHi, borderRadius: 14, padding: 14 }}>
                <div style={{ fontSize: 10, color: T.textMute, fontWeight: 700, marginBottom: 4 }}>SAVING STREAK</div>
                <div style={{ fontSize: 16, fontWeight: 800 }}>{wrapped.savingsStreak} month{wrapped.savingsStreak !== 1 ? "s" : ""}</div>
              </div>
              <div style={{ background: T.surfaceHi, borderRadius: 14, padding: 14 }}>
                <div style={{ fontSize: 10, color: T.textMute, fontWeight: 700, marginBottom: 4 }}>LOGGING STREAK</div>
                <div style={{ fontSize: 16, fontWeight: 800 }}>{wrapped.streak.current} day{wrapped.streak.current !== 1 ? "s" : ""}</div>
              </div>
            </div>

            {c.saved > 0 && (
              <div style={{ fontSize: 11.5, color: T.textSoft, textAlign: "center" }}>
                You also moved <b style={{ color: "#22D3EE" }}>{inr(c.saved)}</b> into savings — counted separately from what you spent.
              </div>
            )}
            {c.refunds > 0 && (
              <div style={{ fontSize: 11.5, color: T.textSoft, textAlign: "center" }}>
                Plus {inr(c.refunds)} came back to you in refunds this period.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared pop-ups
// ---------------------------------------------------------------------------
function ConfirmDialog({ state, onClose }) {
  if (!state) return null;
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(5,5,8,0.78)", zIndex: 80, display: "flex", alignItems: "center", justifyContent: "center", padding: 22 }} onClick={onClose}>
      <div role="dialog" aria-modal="true" data-testid="confirm-dialog" onClick={(e) => e.stopPropagation()} style={{
        width: "100%", maxWidth: 340, background: T.surfaceHi, border: `1px solid ${T.borderHi}`, borderRadius: 18, padding: 20,
      }}>
        <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 8 }}>{state.title}</div>
        {state.body && <div style={{ fontSize: 12.5, color: T.textSoft, lineHeight: 1.55, marginBottom: 16 }}>{state.body}</div>}
        <div style={{ display: "flex", gap: 8 }}>
          <button data-testid="confirm-cancel" onClick={onClose} style={{ flex: 1, border: `1px solid ${T.border}`, background: "transparent", color: T.textSoft, borderRadius: 12, padding: "11px 0", fontSize: 13, fontWeight: 700 }}>
            Cancel
          </button>
          <button data-testid="confirm-ok" onClick={() => { const fn = state.onConfirm; onClose(); fn(); }} style={{ flex: 1, border: "none", background: T.red, color: "#fff", borderRadius: 12, padding: "11px 0", fontSize: 13, fontWeight: 800 }}>
            {state.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// Appears after you re-categorise something. "ask" = a person-like payee, so ask whether to
// remember it; "learned" = a rule now exists, with the option to fix past entries or undo.
function LearnSheet({ prompt, onAlways, onOnce, onFixPast, onUndo, onClose }) {
  if (!prompt) return null;
  const isAsk = prompt.stage === "ask";
  const cat = isAsk ? prompt.category : prompt.rule.category;
  const label = isAsk ? prompt.label : prompt.rule.label;
  const dir = isAsk ? prompt.dir : prompt.rule.dir;
  const Icon = CATEGORY_META[cat]?.icon || Tag;
  const btn = (extra) => ({ border: "none", borderRadius: 10, padding: "9px 12px", fontSize: 12, fontWeight: 800, ...extra });
  return (
    <div style={{ position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 60, display: "flex", justifyContent: "center", padding: "0 12px 92px", pointerEvents: "none" }}>
      <div role="status" data-testid="learn-sheet" style={{
        pointerEvents: "auto", width: "100%", maxWidth: 440, background: T.surfaceHi, border: `1px solid ${T.borderHi}`,
        borderRadius: 18, padding: 14, boxShadow: "0 12px 40px rgba(0,0,0,0.55)",
      }}>
        <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
          <div style={{ width: 30, height: 30, borderRadius: 9, background: (CATEGORY_META[cat]?.color || T.purple) + "22", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <Icon size={15} color={CATEGORY_META[cat]?.color || T.purple} />
          </div>
          <div style={{ flex: 1, minWidth: 0, fontSize: 12.5, lineHeight: 1.5 }}>
            {isAsk ? (
              <>
                Always file {dir === "in" ? "money received from" : "payments to"} <b>{label}</b> under <b>{cat}</b>?
                <div style={{ color: T.textMute, fontSize: 11, marginTop: 2 }}>This looks like a person, so I'm checking — it could be a one-off.</div>
              </>
            ) : (
              <>
                Learned: <b>{label}</b> → <b>{cat}</b>{dir === "in" ? " (money received)" : ""}
                <div style={{ color: T.textMute, fontSize: 11, marginTop: 2 }}>
                  {prompt.pending > 0 ? `${prompt.pending} older transaction${prompt.pending !== 1 ? "s" : ""} match.` : "No older transactions match."}
                </div>
              </>
            )}
          </div>
          <button onClick={onClose} aria-label="Close" style={{ border: "none", background: "transparent", padding: 2 }}><X size={14} color={T.textMute} /></button>
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
          {isAsk ? (
            <>
              <button data-testid="learn-always" onClick={onAlways} style={btn({ background: T.gradPrimary, color: "#fff", flex: 1 })}>Always</button>
              <button data-testid="learn-once" onClick={onOnce} style={btn({ background: T.surface, color: T.textSoft, flex: 1 })}>Just this once</button>
            </>
          ) : (
            <>
              {prompt.pending > 0 && (
                <button data-testid="learn-fix" onClick={onFixPast} style={btn({ background: T.gradPrimary, color: "#fff", flex: 1 })}>Fix {prompt.pending} past</button>
              )}
              <button data-testid="learn-undo" onClick={onUndo} style={btn({ background: T.surface, color: T.textSoft, flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 5 })}>
                <Undo2 size={12} /> Undo
              </button>
              <button data-testid="learn-done" onClick={onClose} style={btn({ background: "transparent", color: T.textMute })}>Done</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function RulesModal({ rules, txList, onClose, onChangeCategory, onDelete }) {
  const matches = (r) => txList.filter((t) => !t.excluded && txDir(t) === r.dir && ruleKeyOf(t) === r.key).length;
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(5,5,8,0.85)", zIndex: 50, display: "flex", alignItems: "flex-end", justifyContent: "center" }} onClick={onClose}>
      <div data-testid="rules-modal" onClick={(e) => e.stopPropagation()} style={{
        width: "100%", maxWidth: 480, maxHeight: "82vh", overflowY: "auto", background: T.surfaceHi, border: `1px solid ${T.borderHi}`,
        borderBottom: "none", borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 20,
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
          <div style={{ fontSize: 15, fontWeight: 800 }}>Learned categories</div>
          <button onClick={onClose} style={{ ...iconBtn, background: T.surface, borderRadius: "50%", width: 28, height: 28 }}><X size={13} color={T.textMute} /></button>
        </div>
        <div style={{ fontSize: 11.5, color: T.textMute, lineHeight: 1.5, marginBottom: 14 }}>
          Merchants TruCent has learned from your corrections. Changing one re-files its past transactions too; forgetting one only affects future ones.
        </div>
        {rules.length === 0 ? (
          <EmptyHint text="Nothing learned yet. When you change a transaction's category, TruCent remembers it here." />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {rules.map((r) => (
              <div key={r.id} data-testid="rule-row" style={{ background: T.surface, borderRadius: 12, padding: "10px 12px", display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.label}</div>
                  <div style={{ fontSize: 10.5, color: T.textMute }}>{r.dir === "in" ? "money received" : "payments"} · {matches(r)} transaction{matches(r) !== 1 ? "s" : ""}</div>
                </div>
                <select value={r.category} onChange={(e) => onChangeCategory(r.id, e.target.value)} style={{ ...inputStyle, width: "auto", padding: "6px 8px", fontSize: 11.5 }}>
                  {categoriesFor(r.dir === "in").map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                <button onClick={() => onDelete(r.id)} aria-label="Forget rule" style={iconBtn}><Trash2 size={13} color={T.textMute} /></button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function RestoreDialog({ plan, onClose, onConfirm }) {
  if (!plan) return null;
  const sm = plan.summary;
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(5,5,8,0.82)", zIndex: 80, display: "flex", alignItems: "center", justifyContent: "center", padding: 22 }} onClick={onClose}>
      <div role="dialog" aria-modal="true" data-testid="restore-dialog" onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 350, background: T.surfaceHi, border: `1px solid ${T.borderHi}`, borderRadius: 18, padding: 20 }}>
        {plan.error ? (
          <>
            <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 8 }}>Can't restore that file</div>
            <div style={{ fontSize: 12.5, color: T.textSoft, lineHeight: 1.55, marginBottom: 16 }}>{plan.error}</div>
            <button onClick={onClose} style={{ ...primaryBtn, marginTop: 0 }}>OK</button>
          </>
        ) : (
          <>
            <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 8 }}>Restore this backup?</div>
            <div style={{ fontSize: 12.5, color: T.textSoft, lineHeight: 1.6, marginBottom: 6 }}>
              {plan.createdAt ? `Made ${String(plan.createdAt).slice(0, 10)}. ` : ""}Contains {sm.transactions} transaction{sm.transactions !== 1 ? "s" : ""}, {sm.members} group member{sm.members !== 1 ? "s" : ""}, {sm.groupExpenses} group expense{sm.groupExpenses !== 1 ? "s" : ""}, {sm.recurring} recurring bill{sm.recurring !== 1 ? "s" : ""}, {sm.goals} goal{sm.goals !== 1 ? "s" : ""} and {sm.rules} learned categor{sm.rules !== 1 ? "ies" : "y"}.
            </div>
            <div style={{ fontSize: 12.5, color: T.red, fontWeight: 700, lineHeight: 1.5, marginBottom: 16 }}>
              This replaces everything currently in the app. The app will restart.
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button data-testid="restore-cancel" onClick={onClose} style={{ flex: 1, border: `1px solid ${T.border}`, background: "transparent", color: T.textSoft, borderRadius: 12, padding: "11px 0", fontSize: 13, fontWeight: 700 }}>Cancel</button>
              <button data-testid="restore-ok" onClick={onConfirm} style={{ flex: 1, border: "none", background: T.red, color: "#fff", borderRadius: 12, padding: "11px 0", fontSize: 13, fontWeight: 800 }}>Replace & restart</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function SplitTab({ expenses, settlements, showForm, setShowForm, form, addExpense, updateExpense, deleteExpense, sendNudge, nudgePhone, exportGroupLedger, exportBusy }) {
  const oneOffExpenses = expenses.filter((e) => !e.recurring);
  const [showExport, setShowExport] = useState(false);

  const [editingId, setEditingId] = useState(null);
  const [eDesc, setEDesc] = useState("");
  const [eAmount, setEAmount] = useState("");
  const [eCategory, setECategory] = useState(EXPENSE_CATEGORY_LIST[0]);
  const [ePaidBy, setEPaidBy] = useState("you");
  const [eSplit, setESplit] = useState([]);

  const [nudgingIdx, setNudgingIdx] = useState(null);
  const [nudgePhoneInput, setNudgePhoneInput] = useState("");
  const startNudge = (s, idx) => {
    if (nudgePhone[s.from]) { sendNudge(s); return; }
    setNudgingIdx(idx); setNudgePhoneInput("");
  };
  const confirmNudge = (s) => {
    if (!nudgePhoneInput.trim()) return;
    sendNudge(s, nudgePhoneInput.trim());
    setNudgingIdx(null);
  };

  const startEdit = (e) => {
    setEditingId(e.id); setEDesc(e.desc); setEAmount(String(e.amount));
    setECategory(e.category); setEPaidBy(e.paidBy); setESplit(e.splitAmong);
  };
  const saveEdit = () => {
    if (!eDesc.trim() || !eAmount || Number(eAmount) <= 0 || eSplit.length === 0) return;
    updateExpense(editingId, { desc: eDesc.trim(), amount: Number(eAmount), category: eCategory, paidBy: ePaidBy, splitAmong: eSplit });
    setEditingId(null);
  };
  return (
    <div>
      <h2 style={{ fontSize: 20, fontWeight: 800, margin: "2px 0 16px", letterSpacing: -0.4 }}>Split & Track</h2>

      <SectionTitle action={
        oneOffExpenses.length > 0 && (
          <button onClick={() => setShowExport((v) => !v)} style={navAddBtn(showExport)}>
            {showExport ? <X size={13} /> : <Share2 size={13} />} {showExport ? "Close" : "Share"}
          </button>
        )
      }>
        Settle up
      </SectionTitle>

      {showExport && (
        <div style={{ ...glassCard, padding: 14, marginBottom: 14, display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ fontSize: 11.5, color: T.textSoft, lineHeight: 1.5 }}>
            Send the group a copy of the ledger and who owes what — for reference, or to ask for payment.
            Opens your phone's share sheet, so you can pick WhatsApp, Email, Drive, or anything else you have.
            The message itself lists the outstanding amounts, with the full ledger attached.
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button disabled={exportBusy} onClick={() => exportGroupLedger("xlsx")} style={{ ...primaryBtn, marginTop: 0, flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, opacity: exportBusy ? 0.6 : 1 }}>
              <FileSpreadsheet size={13} /> Excel
            </button>
            <button disabled={exportBusy} onClick={() => exportGroupLedger("pdf")} style={{ ...primaryBtn, marginTop: 0, flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, opacity: exportBusy ? 0.6 : 1 }}>
              <FileText size={13} /> PDF
            </button>
          </div>
          {exportBusy && <div style={{ fontSize: 11, color: T.textMute, textAlign: "center" }}>Preparing your file…</div>}
        </div>
      )}
      {settlements.length === 0 ? (
        <div style={{ ...glassCard, color: T.green, padding: "13px 15px", fontSize: 13, fontWeight: 600, background: "rgba(52,211,153,0.08)", borderColor: "rgba(52,211,153,0.25)", marginBottom: 22 }}>
          Everyone's square. No one owes anyone right now.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 22 }}>
          {settlements.map((s, i) => (
            <div key={i} style={{ ...glassCard, padding: "12px 14px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <Avatar id={s.from} />
                <div style={{ flex: 1, fontSize: 13.5, color: T.textSoft }}>
                  <b style={{ color: T.text }}>{memberName(s.from)}</b> owes <b style={{ color: T.text }}>{memberName(s.to)}</b>
                </div>
                <ArrowRight size={14} color={T.textMute} />
                <Avatar id={s.to} />
                <div style={{ marginLeft: 4, fontWeight: 800, fontSize: 15, background: T.gradGold, WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" }}>
                  {inr(s.amount)}
                </div>
                <button onClick={() => startNudge(s, i)} title="Nudge on WhatsApp" style={{
                  border: "none", background: "rgba(37,211,102,0.15)", borderRadius: 8, padding: "6px 8px",
                  display: "flex", alignItems: "center", justifyContent: "center", marginLeft: 4,
                }}>
                  <MessageCircle size={13} color="#25D366" />
                </button>
              </div>
              {nudgingIdx === i && (
                <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
                  <input
                    value={nudgePhoneInput}
                    onChange={(e) => setNudgePhoneInput(e.target.value)}
                    placeholder={`${memberName(s.from)}'s WhatsApp number`}
                    style={{ ...inputStyle, flex: 1, padding: "7px 10px", fontSize: 12 }}
                  />
                  <button onClick={() => confirmNudge(s)} style={{ border: "none", borderRadius: 8, background: "#25D366", color: "#07280F", padding: "0 12px", fontSize: 12, fontWeight: 700 }}>
                    Send
                  </button>
                  <button onClick={() => setNudgingIdx(null)} style={{ ...iconBtn, background: T.surfaceHi, borderRadius: 8, padding: "7px 9px" }}>
                    <X size={12} color={T.textMute} />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <div style={{ ...glassCard, padding: "10px 13px", marginBottom: 22, display: "flex", alignItems: "center", gap: 8, background: T.surface }}>
        <Repeat size={13} color={T.textMute} style={{ flexShrink: 0 }} />
        <span style={{ fontSize: 11.5, color: T.textSoft }}>
          Recurring bills (rent, subscriptions, memberships) aren't split here — they're fixed costs, not shared debts. Find them under <b style={{ color: T.textSoft }}>Where It Went</b>.
        </span>
      </div>

      <SectionTitle action={
        <button onClick={() => setShowForm((s) => !s)} style={{
          display: "flex", alignItems: "center", gap: 5, border: "none",
          background: showForm ? T.surfaceHi : T.gradPrimary, color: "#fff", borderRadius: 20,
          padding: "7px 13px", fontSize: 12.5, fontWeight: 700,
          boxShadow: showForm ? "none" : "0 3px 12px rgba(139,92,246,0.35)",
        }}>
          {showForm ? <X size={13} /> : <Plus size={13} />} {showForm ? "Close" : "Add expense"}
        </button>
      }>
        Ledger
      </SectionTitle>

      {showForm && (
        <div style={{ ...glassCard, padding: 16, marginBottom: 12, display: "flex", flexDirection: "column", gap: 11 }}>
          <input placeholder="What was it for?" value={form.fDesc} onChange={(e) => form.setFDesc(e.target.value)} style={inputStyle} />
          <div style={{ display: "flex", gap: 8 }}>
            <div style={{ position: "relative", flex: 1 }}>
              <span style={{ position: "absolute", left: 12, top: 11, fontSize: 13, color: T.textMute }}>₹</span>
              <input placeholder="Amount" type="number" value={form.fAmount} onChange={(e) => form.setFAmount(e.target.value)} style={{ ...inputStyle, paddingLeft: 24 }} />
            </div>
            <select value={form.fCategory} onChange={(e) => form.setFCategory(e.target.value)} style={{ ...inputStyle, flex: 1 }}>
              {EXPENSE_CATEGORY_LIST.map((c) => <option key={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <div style={{ fontSize: 11, color: T.textMute, marginBottom: 6, fontWeight: 600 }}>Paid by</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {MEMBERS.map((m) => <Pill key={m.id} active={form.fPaidBy === m.id} onClick={() => form.setFPaidBy(m.id)} label={m.name} />)}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: T.textMute, marginBottom: 6, fontWeight: 600 }}>Split among</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {MEMBERS.map((m) => {
                const active = form.fSplit.includes(m.id);
                return <Pill key={m.id} active={active} onClick={() => form.setFSplit((prev) => active ? prev.filter((id) => id !== m.id) : [...prev, m.id])} label={m.name} />;
              })}
            </div>
          </div>
          <button onClick={addExpense} style={{
            border: "none", borderRadius: 12, padding: "12px 0", fontWeight: 800, fontSize: 14,
            background: T.gradPrimary, color: "#fff", marginTop: 2, boxShadow: "0 4px 16px rgba(139,92,246,0.4)",
          }}>
            Add to ledger
          </button>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {oneOffExpenses.length === 0 && <EmptyHint text="No shared one-off expenses yet." />}
        {oneOffExpenses.slice(0, 12).map((e) => {
          if (editingId === e.id) {
            return (
              <div key={e.id} style={{ ...glassCard, padding: 14, margin: "6px 0", display: "flex", flexDirection: "column", gap: 10 }}>
                <input value={eDesc} onChange={(ev) => setEDesc(ev.target.value)} style={inputStyle} placeholder="What was it for?" />
                <div style={{ display: "flex", gap: 8 }}>
                  <div style={{ position: "relative", flex: 1 }}>
                    <span style={{ position: "absolute", left: 12, top: 11, fontSize: 13, color: T.textMute }}>₹</span>
                    <input type="number" value={eAmount} onChange={(ev) => setEAmount(ev.target.value)} style={{ ...inputStyle, paddingLeft: 24 }} />
                  </div>
                  <select value={eCategory} onChange={(ev) => setECategory(ev.target.value)} style={{ ...inputStyle, flex: 1 }}>
                    {EXPENSE_CATEGORY_LIST.map((c) => <option key={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: T.textMute, marginBottom: 6, fontWeight: 600 }}>Paid by</div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {MEMBERS.map((m) => <Pill key={m.id} active={ePaidBy === m.id} onClick={() => setEPaidBy(m.id)} label={m.name} />)}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: T.textMute, marginBottom: 6, fontWeight: 600 }}>Split among</div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {MEMBERS.map((m) => {
                      const active = eSplit.includes(m.id);
                      return <Pill key={m.id} active={active} onClick={() => setESplit((prev) => active ? prev.filter((id) => id !== m.id) : [...prev, m.id])} label={m.name} />;
                    })}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  <button onClick={saveEdit} style={{ ...primaryBtn, flex: 1, padding: "9px 0", marginTop: 0 }}>Save changes</button>
                  <button onClick={() => setEditingId(null)} style={{ ...iconBtn, background: T.surfaceHi, borderRadius: 10, padding: "9px 14px" }}>
                    <X size={14} color={T.textMute} />
                  </button>
                </div>
              </div>
            );
          }
          return (
            <div key={e.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "11px 6px", borderBottom: `1px solid ${T.border}` }}>
              <div style={{ width: 3, alignSelf: "stretch", background: CATEGORY_META[e.category]?.color || T.textMute, borderRadius: 2, opacity: 0.7 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.desc}</div>
                <div style={{ display: "flex", gap: 6, marginTop: 4, alignItems: "center", flexWrap: "wrap" }}>
                  <CategoryTag category={e.category} />
                  <span style={{ fontSize: 10.5, color: T.textMute }}>{e.date} · {memberName(e.paidBy)}</span>
                </div>
              </div>
              <div style={{ fontWeight: 800, fontSize: 13.5 }}>{inr(e.amount)}</div>
              <button onClick={() => startEdit(e)} style={iconBtn}><Edit2 size={12} color={T.textMute} /></button>
              <button onClick={() => deleteExpense(e.id)} style={iconBtn}><Trash2 size={12} color={T.textMute} /></button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// PLAN — budgets, goals, and future/planned expenses
// ---------------------------------------------------------------------------
function PlanTab({
  budgetsWithSpend, removeBudget, budgetForm,
  goals, goalsTotals, addFundsToGoal, removeGoal, goalForm,
  plannedSorted, upcomingTotal, removePlanned, markPlannedSpent, updatePlanned, plannedForm,
}) {
  const [showBudgetForm, setShowBudgetForm] = useState(false);
  const [showGoalForm, setShowGoalForm] = useState(false);
  const [showPlannedForm, setShowPlannedForm] = useState(false);
  const [fundInputs, setFundInputs] = useState({});

  // Upcoming items are editable (an SMS-detected bill can have a wrong amount or date).
  const [editingPid, setEditingPid] = useState(null);
  const [epDesc, setEpDesc] = useState("");
  const [epAmount, setEpAmount] = useState("");
  const [epCategory, setEpCategory] = useState(EXPENSE_CATEGORY_LIST[0]);
  const [epDate, setEpDate] = useState("");
  const startEditPlanned = (p) => { setEditingPid(p.id); setEpDesc(p.desc); setEpAmount(String(p.amount)); setEpCategory(p.category); setEpDate(p.dueDate); };
  const saveEditPlanned = () => {
    if (!epDesc.trim() || !(Number(epAmount) > 0) || !epDate) return;
    updatePlanned(editingPid, { desc: epDesc.trim(), amount: Number(epAmount), category: epCategory, dueDate: epDate });
    setEditingPid(null);
  };

  return (
    <div>
      <h2 style={{ fontSize: 20, fontWeight: 800, margin: "2px 0 4px", letterSpacing: -0.4 }}>Plan Ahead</h2>
      <p style={{ fontSize: 12.5, color: T.textSoft, margin: "0 0 16px" }}>
        Budgets, goals, and expenses you know are coming.
      </p>

      {/* ---------------- Budgets ---------------- */}
      <SectionTitle action={
        <button onClick={() => setShowBudgetForm((s) => !s)} style={navAddBtn(showBudgetForm)}>
          {showBudgetForm ? <X size={13} /> : <Plus size={13} />} {showBudgetForm ? "Close" : "Set budget"}
        </button>
      }>
        Monthly budgets
      </SectionTitle>

      {showBudgetForm && (
        <div style={{ ...glassCard, padding: 16, marginBottom: 12, display: "flex", flexDirection: "column", gap: 11 }}>
          <div style={{ display: "flex", gap: 8 }}>
            <select value={budgetForm.bCategory} onChange={(e) => budgetForm.setBCategory(e.target.value)} style={{ ...inputStyle, flex: 1 }}>
              {SPEND_CATEGORY_LIST.map((c) => <option key={c}>{c}</option>)}
            </select>
            <div style={{ position: "relative", flex: 1 }}>
              <span style={{ position: "absolute", left: 12, top: 11, fontSize: 13, color: T.textMute }}>₹</span>
              <input placeholder="Monthly limit" type="number" value={budgetForm.bLimit}
                onChange={(e) => budgetForm.setBLimit(e.target.value)} style={{ ...inputStyle, paddingLeft: 24 }} />
            </div>
          </div>
          <button onClick={() => { budgetForm.addBudget(); setShowBudgetForm(false); }} style={primaryBtn}>
            Save budget
          </button>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 22 }}>
        {budgetsWithSpend.length === 0 && <EmptyHint text="No budgets set yet — add one above to start tracking limits." />}
        {budgetsWithSpend.map((b) => {
          const meta = CATEGORY_META[b.category] || CATEGORY_META.Others;
          const Icon = meta.icon;
          const over = b.spent > b.limit;
          const barColor = over ? T.red : b.pct > 80 ? T.gold : T.green;
          return (
            <div key={b.category} style={{ ...glassCard, padding: "12px 14px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <Icon size={13} color={meta.color} />
                <div style={{ flex: 1, fontSize: 12.5, fontWeight: 700 }}>{b.category}</div>
                <div style={{ fontSize: 12, fontWeight: 700, color: over ? T.red : T.text }}>
                  {inr(b.spent)} <span style={{ color: T.textMute, fontWeight: 500 }}>/ {inr(b.limit)}</span>
                </div>
                <button onClick={() => removeBudget(b.category)} style={iconBtn}><Trash2 size={12} color={T.textMute} /></button>
              </div>
              <div style={{ background: T.surfaceHi, borderRadius: 6, height: 8, overflow: "hidden" }}>
                <div style={{ width: `${Math.min(100, b.pct)}%`, height: "100%", background: barColor, borderRadius: 6 }} />
              </div>
              {over && <div style={{ fontSize: 10.5, color: T.red, marginTop: 5, fontWeight: 600 }}>Over by {inr(b.spent - b.limit)}</div>}
            </div>
          );
        })}
      </div>

      {/* ---------------- Goals ---------------- */}
      <SectionTitle action={
        <button onClick={() => setShowGoalForm((s) => !s)} style={navAddBtn(showGoalForm)}>
          {showGoalForm ? <X size={13} /> : <Plus size={13} />} {showGoalForm ? "Close" : "New goal"}
        </button>
      }>
        Savings goals
      </SectionTitle>

      {showGoalForm && (
        <div style={{ ...glassCard, padding: 16, marginBottom: 12, display: "flex", flexDirection: "column", gap: 11 }}>
          <input placeholder="Goal name (e.g. Family trip)" value={goalForm.gName} onChange={(e) => goalForm.setGName(e.target.value)} style={inputStyle} />
          <div style={{ display: "flex", gap: 8 }}>
            <div style={{ position: "relative", flex: 1 }}>
              <span style={{ position: "absolute", left: 12, top: 11, fontSize: 13, color: T.textMute }}>₹</span>
              <input placeholder="Target amount" type="number" value={goalForm.gTarget}
                onChange={(e) => goalForm.setGTarget(e.target.value)} style={{ ...inputStyle, paddingLeft: 24 }} />
            </div>
            <input type="date" value={goalForm.gDeadline} onChange={(e) => goalForm.setGDeadline(e.target.value)} style={{ ...inputStyle, flex: 1 }} />
          </div>
          <button onClick={() => { goalForm.addGoal(); setShowGoalForm(false); }} style={primaryBtn}>
            Create goal
          </button>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 22 }}>
        {goals.length === 0 && <EmptyHint text="No goals yet — create one to start putting money aside with purpose." />}
        {goals.map((g) => {
          const pct = Math.min(100, (g.saved / g.target) * 100);
          const done = g.saved >= g.target;
          const dLeft = g.deadline ? daysUntilDate(g.deadline) : null;
          return (
            <div key={g.id} style={{ ...glassCard, padding: "14px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <div style={{ width: 8, height: 8, borderRadius: "50%", background: g.color, flexShrink: 0 }} />
                <div style={{ flex: 1, fontSize: 13.5, fontWeight: 700 }}>{g.name}</div>
                {done ? (
                  <span style={{ fontSize: 10.5, fontWeight: 700, color: T.green, display: "flex", alignItems: "center", gap: 3 }}>
                    <Check size={11} /> Achieved
                  </span>
                ) : (
                  <button onClick={() => removeGoal(g.id)} style={iconBtn}><Trash2 size={12} color={T.textMute} /></button>
                )}
              </div>
              <div style={{ background: T.surfaceHi, borderRadius: 6, height: 8, overflow: "hidden", marginBottom: 8 }}>
                <div style={{ width: `${pct}%`, height: "100%", background: g.color, borderRadius: 6 }} />
              </div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ fontSize: 11.5, color: T.textSoft }}>
                  {inr(g.saved)} of {inr(g.target)}
                  {dLeft != null && !done && <span style={{ color: T.textMute }}> · {dLeft > 0 ? `${dLeft}d left` : "past due"}</span>}
                </div>
                {!done && (
                  <div style={{ display: "flex", gap: 5 }}>
                    <input
                      placeholder="₹ add"
                      type="number"
                      value={fundInputs[g.id] || ""}
                      onChange={(e) => setFundInputs((prev) => ({ ...prev, [g.id]: e.target.value }))}
                      style={{ ...inputStyle, width: 74, padding: "5px 8px", fontSize: 11.5 }}
                    />
                    <button
                      onClick={() => { addFundsToGoal(g.id, fundInputs[g.id]); setFundInputs((prev) => ({ ...prev, [g.id]: "" })); }}
                      style={{ border: "none", borderRadius: 8, background: T.gradPrimary, color: "#fff", padding: "0 9px", display: "flex", alignItems: "center" }}
                    >
                      <ArrowUpCircle size={14} />
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* ---------------- Planned / future expenses ---------------- */}
      <SectionTitle action={
        <button onClick={() => setShowPlannedForm((s) => !s)} style={navAddBtn(showPlannedForm)}>
          {showPlannedForm ? <X size={13} /> : <Plus size={13} />} {showPlannedForm ? "Close" : "Add planned"}
        </button>
      }>
        Upcoming expenses
      </SectionTitle>

      {showPlannedForm && (
        <div style={{ ...glassCard, padding: 16, marginBottom: 12, display: "flex", flexDirection: "column", gap: 11 }}>
          <input placeholder="What's coming up?" value={plannedForm.pDesc} onChange={(e) => plannedForm.setPDesc(e.target.value)} style={inputStyle} />
          <div style={{ display: "flex", gap: 8 }}>
            <div style={{ position: "relative", flex: 1 }}>
              <span style={{ position: "absolute", left: 12, top: 11, fontSize: 13, color: T.textMute }}>₹</span>
              <input placeholder="Amount" type="number" value={plannedForm.pAmount}
                onChange={(e) => plannedForm.setPAmount(e.target.value)} style={{ ...inputStyle, paddingLeft: 24 }} />
            </div>
            <select value={plannedForm.pCategory} onChange={(e) => plannedForm.setPCategory(e.target.value)} style={{ ...inputStyle, flex: 1 }}>
              {EXPENSE_CATEGORY_LIST.map((c) => <option key={c}>{c}</option>)}
            </select>
          </div>
          <input type="date" value={plannedForm.pDate} onChange={(e) => plannedForm.setPDate(e.target.value)} style={inputStyle} />
          <button onClick={() => { plannedForm.addPlanned(); setShowPlannedForm(false); }} style={primaryBtn}>
            Add to plan
          </button>
        </div>
      )}

      <div style={{ ...glassCard, padding: "10px 6px", marginBottom: 10 }}>
        <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 10px", fontSize: 11.5, color: T.textSoft }}>
          <span>{plannedSorted.length} upcoming</span>
          <span style={{ fontWeight: 700, color: T.text }}>{inr(upcomingTotal)} total</span>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {plannedSorted.length === 0 && <EmptyHint text="Nothing planned — add a known future expense so it doesn't catch you off guard." />}
        {plannedSorted.map((p) => {
          const d = daysUntilDate(p.dueDate);
          if (editingPid === p.id) {
            return (
              <div key={p.id} data-testid="planned-edit" style={{ ...glassCard, padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
                <input value={epDesc} onChange={(e) => setEpDesc(e.target.value)} style={inputStyle} placeholder="What is it?" />
                <div style={{ display: "flex", gap: 8 }}>
                  <div style={{ position: "relative", flex: 1 }}>
                    <span style={{ position: "absolute", left: 12, top: 11, fontSize: 13, color: T.textMute }}>₹</span>
                    <input type="number" value={epAmount} onChange={(e) => setEpAmount(e.target.value)} style={{ ...inputStyle, paddingLeft: 24 }} />
                  </div>
                  <select value={epCategory} onChange={(e) => setEpCategory(e.target.value)} style={{ ...inputStyle, flex: 1 }}>
                    {EXPENSE_CATEGORY_LIST.map((c) => <option key={c}>{c}</option>)}
                  </select>
                </div>
                <input type="date" value={epDate} onChange={(e) => setEpDate(e.target.value)} style={inputStyle} />
                <div style={{ display: "flex", gap: 8 }}>
                  <button data-testid="planned-save" onClick={saveEditPlanned} style={{ ...primaryBtn, marginTop: 0, flex: 1 }}>Save</button>
                  <button onClick={() => setEditingPid(null)} style={{ ...iconBtn, background: T.surfaceHi, borderRadius: 10, padding: "0 14px", fontSize: 12, color: T.textSoft, fontWeight: 700 }}>Cancel</button>
                </div>
              </div>
            );
          }
          return (
            <div key={p.id} style={{ ...glassCard, display: "flex", alignItems: "center", gap: 10, padding: "12px 14px" }}>
              <div style={{
                width: 40, height: 40, borderRadius: 10, background: T.surfaceHi, flexShrink: 0,
                display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
              }}>
                <div style={{ fontSize: 13, fontWeight: 800, lineHeight: 1 }}>{d >= 0 ? d : "–"}</div>
                <div style={{ fontSize: 8, color: T.textMute, fontWeight: 700 }}>{d >= 0 ? "DAYS" : "PAST"}</div>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.desc}</div>
                <div style={{ display: "flex", gap: 6, marginTop: 4, alignItems: "center", flexWrap: "wrap" }}>
                  <CategoryTag category={p.category} />
                  <span style={{ fontSize: 10.5, color: T.textMute }}>{p.dueDate}</span>
                  {p.fromSms && (
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 9.5, fontWeight: 700, color: T.textMute }}>
                      <Smartphone size={9} /> from SMS
                    </span>
                  )}
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
                <div style={{ fontWeight: 800, fontSize: 13.5 }}>{inr(p.amount)}</div>
                <div style={{ display: "flex", gap: 4 }}>
                  <button data-testid="planned-spent" onClick={() => markPlannedSpent(p)} title="Mark as spent — records it in Track" style={{
                    border: "none", borderRadius: 7, background: "rgba(52,211,153,0.15)", color: T.green,
                    padding: "3px 7px", fontSize: 10, fontWeight: 700, display: "flex", alignItems: "center", gap: 3,
                  }}>
                    <Check size={10} /> Spent
                  </button>
                  <button data-testid="planned-edit-btn" onClick={() => startEditPlanned(p)} aria-label="Edit" style={iconBtn}><Edit2 size={12} color={T.textMute} /></button>
                  <button data-testid="planned-delete" onClick={() => removePlanned(p.id)} aria-label="Delete" style={iconBtn}><Trash2 size={12} color={T.textMute} /></button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function EmptyHint({ text }) {
  return (
    <div style={{
      ...glassCard, color: T.textSoft, padding: "13px 15px", fontSize: 12.5, fontWeight: 500,
      background: T.surface, borderStyle: "dashed",
    }}>
      {text}
    </div>
  );
}

const navAddBtn = (active) => ({
  display: "flex", alignItems: "center", gap: 5, border: "none",
  background: active ? T.surfaceHi : T.gradPrimary, color: "#fff", borderRadius: 20,
  padding: "7px 13px", fontSize: 12.5, fontWeight: 700,
  boxShadow: active ? "none" : "0 3px 12px rgba(139,92,246,0.35)",
});

const primaryBtn = {
  border: "none", borderRadius: 12, padding: "12px 0", fontWeight: 800, fontSize: 14,
  background: T.gradPrimary, color: "#fff", marginTop: 2, boxShadow: "0 4px 16px rgba(139,92,246,0.4)",
};

const iconBtn = {
  border: "none", background: "transparent", padding: 4, display: "flex", alignItems: "center", justifyContent: "center",
};

// ---------------------------------------------------------------------------
// WHERE IT WENT
// ---------------------------------------------------------------------------
function RecurringForm({ initial, onSubmit, onCancel, submitLabel, showPaid }) {
  const [name, setName] = useState(initial.name || "");
  const [amount, setAmount] = useState(initial.amount ? String(initial.amount) : "");
  const [category, setCategory] = useState(initial.category || EXPENSE_CATEGORY_LIST[0]);
  const [day, setDay] = useState(String(initial.dueDay || getTodayDay()));
  const [paid, setPaid] = useState(initial.alreadyPaid ?? Number(initial.dueDay || getTodayDay()) <= getTodayDay());
  const valid = name.trim() && Number(amount) > 0 && Number(day) >= 1 && Number(day) <= 31;
  return (
    <div data-testid="recurring-form" style={{ ...glassCard, padding: 16, display: "flex", flexDirection: "column", gap: 11 }}>
      <input data-testid="rec-name" placeholder="What is it? (rent, Netflix, gym…)" value={name} onChange={(e) => setName(e.target.value)} style={inputStyle} />
      <div style={{ display: "flex", gap: 8 }}>
        <div style={{ position: "relative", flex: 1 }}>
          <span style={{ position: "absolute", left: 12, top: 11, fontSize: 13, color: T.textMute }}>₹</span>
          <input data-testid="rec-amount" placeholder="Amount" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} style={{ ...inputStyle, paddingLeft: 24 }} />
        </div>
        <select data-testid="rec-category" value={category} onChange={(e) => setCategory(e.target.value)} style={{ ...inputStyle, flex: 1 }}>
          {EXPENSE_CATEGORY_LIST.map((c) => <option key={c}>{c}</option>)}
        </select>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ fontSize: 12, color: T.textSoft }}>Due on the</div>
        <select data-testid="rec-day" value={day} onChange={(e) => setDay(e.target.value)} style={{ ...inputStyle, width: 90 }}>
          {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => <option key={d} value={d}>{d}{ordinal(d)}</option>)}
        </select>
        <div style={{ fontSize: 11, color: T.textMute }}>of every month</div>
      </div>
      {showPaid && (
        <label style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12.5, color: T.textSoft }}>
          <input data-testid="rec-paid" type="checkbox" checked={paid} onChange={(e) => setPaid(e.target.checked)} />
          Already paid this month
        </label>
      )}
      <div style={{ display: "flex", gap: 8 }}>
        <button data-testid="rec-save" disabled={!valid} onClick={() => onSubmit({ name, amount, category, dueDay: Number(day), alreadyPaid: paid })}
          style={{ ...primaryBtn, marginTop: 0, flex: 1, opacity: valid ? 1 : 0.5 }}>{submitLabel}</button>
        <button onClick={onCancel} style={{ ...iconBtn, background: T.surfaceHi, borderRadius: 10, padding: "0 14px", fontSize: 12, color: T.textSoft, fontWeight: 700 }}>Cancel</button>
      </div>
    </div>
  );
}

function BurnTab({
  txList, categoryTotals, changeTxCategory, recurringItems, markRecurringPaid,
  offlineForm, removeTx, monthlyTrend, smsStatus, importFromSms,
  smsSyncing, lastSmsSync, smsPreviewTx, setSmsPreviewTx, exportStatement, exportBusy,
  addRecurring, updateRecurring, deleteRecurring, dismissRecurringCharge, dismissRecurringNotice,
  uncategorized, suggestFor, assignGroup, curMonthLabel,
}) {
  const [showOfflineForm, setShowOfflineForm] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [showRecForm, setShowRecForm] = useState(false);
  const [editingRid, setEditingRid] = useState(null);
  const [showInbox, setShowInbox] = useState(false);
  const [openMonths, setOpenMonths] = useState(null);       // null = use the default (newest month open)
  const maxCat = categoryTotals[0]?.amount || 1;
  const paymentModes = ["Cash", "Card", "Cheque", "UPI (not detected)", "Other"];

  const today = todayISO();
  const curKey = monthKey(today);
  const groups = useMemo(() => groupTxByMonth(txList), [txList]);
  const defaultOpenKey = groups.some((g) => g.key === curKey) ? curKey : groups[0]?.key;
  const isOpen = (key) => (openMonths ? openMonths.has(key) : key === defaultOpenKey);
  const toggleMonth = (key) => setOpenMonths((prev) => {
    const next = prev ? new Set(prev) : new Set(defaultOpenKey ? [defaultOpenKey] : []);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  const newFromSms = recurringItems.filter((r) => r.isNew);
  const dueInfo = (r) => {
    const { y, m } = { y: Number(curKey.slice(0, 4)), m: Number(curKey.slice(5, 7)) };
    const due = `${curKey}-${String(Math.min(r.everyMonthDay, lastDayOfMonth(y, m))).padStart(2, "0")}`;
    const paid = isPaidForMonth(r, curKey);
    const d = daysUntilDate(due);
    const label = paid ? "Paid this month" : d < 0 ? `Overdue by ${-d} day${-d !== 1 ? "s" : ""}` : d === 0 ? "Due today" : `Due in ${d} day${d !== 1 ? "s" : ""}`;
    return { paid, overdue: !paid && d < 0, label };
  };
  const sourceTag = (r) => (r.source === "sms" ? "Added from SMS" : r.source === "detected" ? "From Money Coach" : null);
  const shortBtn = { display: "flex", alignItems: "center", gap: 4, border: "none", borderRadius: 20, padding: "7px 12px", fontSize: 11.5, fontWeight: 700 };

  return (
    <div>
      <h2 style={{ fontSize: 20, fontWeight: 800, margin: "2px 0 16px", letterSpacing: -0.4 }}>Where It Went</h2>

      <SmsConnectCard status={smsStatus} onConnect={importFromSms} syncing={smsSyncing} lastSync={lastSmsSync} />

      {smsPreviewTx && <SmsPreviewModal tx={smsPreviewTx} onClose={() => setSmsPreviewTx(null)} />}

      {/* ---------------- Needs a category ---------------- */}
      {uncategorized.length > 0 && (
        <div data-testid="inbox" style={{ ...glassCard, marginBottom: 22, padding: 0, overflow: "hidden", borderColor: T.gold + "55" }}>
          <button data-testid="inbox-toggle" onClick={() => setShowInbox((v) => !v)} style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "13px 14px", border: "none", background: "transparent", color: T.text, textAlign: "left" }}>
            <div style={{ width: 30, height: 30, borderRadius: 9, background: T.gold + "22", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <Tag size={15} color={T.gold} />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 800 }}>Needs a category</div>
              <div style={{ fontSize: 11, color: T.textSoft }}>{uncategorized.length} merchant{uncategorized.length !== 1 ? "s" : ""} · sort each once and TruCent remembers</div>
            </div>
            <ChevronDown size={15} color={T.textMute} style={{ transform: showInbox ? "rotate(180deg)" : "none", transition: "transform .15s" }} />
          </button>
          {showInbox && (
            <div style={{ padding: "0 14px 12px", display: "flex", flexDirection: "column", gap: 8 }}>
              {uncategorized.slice(0, 15).map((g) => {
                const sug = suggestFor(g.key);
                return (
                  <div key={g.key} data-testid="inbox-row" style={{ background: T.surfaceHi, borderRadius: 12, padding: "10px 12px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12.5, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {g.name}{g.personLike && <span style={{ fontSize: 9, fontWeight: 800, color: T.textMute, marginLeft: 6 }}>PERSON</span>}
                        </div>
                        <div style={{ fontSize: 10.5, color: T.textMute }}>{g.count} transaction{g.count !== 1 ? "s" : ""} · {inr(g.total)}</div>
                      </div>
                      <select data-testid="inbox-select" value="" onChange={(e) => assignGroup(g, e.target.value)} style={{ ...inputStyle, width: "auto", padding: "6px 8px", fontSize: 11.5 }}>
                        <option value="" disabled>Choose…</option>
                        {EXPENSE_CATEGORY_LIST.filter((c) => c !== "Others").map((c) => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </div>
                    {sug && (
                      <button data-testid="inbox-suggest" onClick={() => assignGroup(g, sug.category)} style={{ marginTop: 7, border: "none", background: "transparent", padding: 0, color: T.gold, fontSize: 11, fontWeight: 700, display: "flex", alignItems: "center", gap: 4, textAlign: "left" }}>
                        <Sparkles size={11} /> Looks like {sug.category} (like {sug.because}) — apply
                      </button>
                    )}
                  </div>
                );
              })}
              {uncategorized.length > 15 && <div style={{ fontSize: 11, color: T.textMute }}>…and {uncategorized.length - 15} more — sort these first.</div>}
            </div>
          )}
        </div>
      )}

      {/* ---------------- Recurring bills (one list) ---------------- */}
      <SectionTitle action={
        <button data-testid="rec-add-toggle" onClick={() => { setShowRecForm((v) => !v); setEditingRid(null); }} style={navAddBtn(showRecForm)}>
          {showRecForm ? <X size={13} /> : <Plus size={13} />} {showRecForm ? "Close" : "Add"}
        </button>
      }>
        Recurring bills · rent, subscriptions, EMIs
      </SectionTitle>

      {newFromSms.length > 0 && (
        <div data-testid="rec-notice" style={{ ...glassCard, padding: "11px 13px", marginBottom: 10, background: T.surface, borderColor: T.purple + "66", display: "flex", gap: 10, alignItems: "flex-start" }}>
          <Smartphone size={14} color={T.purple} style={{ flexShrink: 0, marginTop: 2 }} />
          <div style={{ flex: 1, fontSize: 11.5, color: T.textSoft, lineHeight: 1.5 }}>
            Added {newFromSms.length === 1 ? "a recurring bill" : `${newFromSms.length} recurring bills`} from your SMS: <b style={{ color: T.text }}>{newFromSms.map((r) => r.desc).join(", ")}</b>. Edit or delete anything that's wrong.
          </div>
          <button onClick={dismissRecurringNotice} style={{ border: "none", background: "transparent", color: T.purple, fontSize: 11, fontWeight: 800, padding: 0 }}>Got it</button>
        </div>
      )}

      {showRecForm && (
        <div style={{ marginBottom: 12 }}>
          <RecurringForm initial={{}} submitLabel="Add recurring bill" showPaid
            onCancel={() => setShowRecForm(false)}
            onSubmit={(v) => { if (addRecurring(v)) setShowRecForm(false); }} />
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 22 }}>
        {recurringItems.length === 0 && !showRecForm && (
          <EmptyHint text="No recurring bills yet. Add one, or they appear on their own when the same bill turns up in your SMS two months running." />
        )}
        {recurringItems.map((r) => {
          if (editingRid === r.id) {
            return (
              <RecurringForm key={r.id} initial={{ name: r.desc, amount: r.amount, category: r.category, dueDay: r.everyMonthDay }} submitLabel="Save changes"
                onCancel={() => setEditingRid(null)}
                onSubmit={(v) => {
                  if (!v.name.trim() || !(Number(v.amount) > 0)) return;
                  updateRecurring(r.id, { desc: v.name.trim(), amount: Number(v.amount), category: v.category, everyMonthDay: v.dueDay });
                  setEditingRid(null);
                }} />
            );
          }
          const info = dueInfo(r);
          const tag = sourceTag(r);
          return (
            <div key={r.id} data-testid="rec-row" style={{ ...glassCard, padding: "12px 14px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.desc}</div>
                <div style={{ fontWeight: 800, fontSize: 14.5, whiteSpace: "nowrap" }}>{inr(r.amount)}</div>
              </div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginTop: 8 }}>
                <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", minWidth: 0, flex: 1 }}>
                  <CategoryTag category={r.category} />
                  <span style={{ fontSize: 11, color: T.textMute }}>Due {r.everyMonthDay}{ordinal(r.everyMonthDay)}</span>
                  <span style={{ fontSize: 10.5, fontWeight: 700, color: info.paid ? T.green : info.overdue ? T.red : T.textSoft }}>· {info.label}</span>
                  {tag && <span style={{ fontSize: 9.5, fontWeight: 700, color: T.purple }}>· {tag}</span>}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                  <button data-testid="rec-markpaid" onClick={() => markRecurringPaid(r.id)} disabled={info.paid} style={{
                    ...shortBtn,
                    background: info.paid ? "rgba(52,211,153,0.15)" : T.gradPrimary,
                    color: info.paid ? T.green : "#fff",
                    boxShadow: info.paid ? "none" : "0 3px 12px rgba(139,92,246,0.35)",
                  }}>
                    <Check size={12} /> {info.paid ? "Paid" : "Mark paid"}
                  </button>
                  <button data-testid="rec-edit" onClick={() => { setEditingRid(r.id); setShowRecForm(false); }} aria-label="Edit" style={iconBtn}><Edit2 size={13} color={T.textMute} /></button>
                  <button data-testid="rec-delete" onClick={() => deleteRecurring(r.id)} aria-label="Delete" style={iconBtn}><Trash2 size={13} color={T.textMute} /></button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* ---------------- Missed by SMS ---------------- */}
      <SectionTitle action={
        <button onClick={() => setShowOfflineForm((s) => !s)} style={navAddBtn(showOfflineForm)}>
          {showOfflineForm ? <X size={13} /> : <Receipt size={13} />} {showOfflineForm ? "Close" : "Add offline expense"}
        </button>
      }>
        Missed by SMS?
      </SectionTitle>

      {!showOfflineForm && (
        <div style={{
          ...glassCard, padding: "12px 14px", marginBottom: 22, display: "flex", alignItems: "center", gap: 9,
          background: T.surface,
        }}>
          <Banknote size={14} color={T.textMute} style={{ flexShrink: 0 }} />
          <span style={{ fontSize: 11.5, color: T.textSoft }}>
            Cash payments, cheques, and anything paid outside UPI won't show up on their own — log them here.
          </span>
        </div>
      )}

      {showOfflineForm && (
        <div style={{ ...glassCard, padding: 16, marginBottom: 22, display: "flex", flexDirection: "column", gap: 11 }}>
          <input placeholder="What was it for?" value={offlineForm.oDesc} onChange={(e) => offlineForm.setODesc(e.target.value)} style={inputStyle} />
          <div style={{ display: "flex", gap: 8 }}>
            <div style={{ position: "relative", flex: 1 }}>
              <span style={{ position: "absolute", left: 12, top: 11, fontSize: 13, color: T.textMute }}>₹</span>
              <input placeholder="Amount" type="number" value={offlineForm.oAmount}
                onChange={(e) => offlineForm.setOAmount(e.target.value)} style={{ ...inputStyle, paddingLeft: 24 }} />
            </div>
            <select value={offlineForm.oCategory} onChange={(e) => offlineForm.setOCategory(e.target.value)} style={{ ...inputStyle, flex: 1 }}>
              {EXPENSE_CATEGORY_LIST.map((c) => <option key={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <div style={{ fontSize: 11, color: T.textMute, marginBottom: 6, fontWeight: 600 }}>Payment mode</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {paymentModes.map((m) => (
                <Pill key={m} active={offlineForm.oMode === m} onClick={() => offlineForm.setOMode(m)} label={m} />
              ))}
            </div>
          </div>
          <input type="date" value={offlineForm.oDate} onChange={(e) => offlineForm.setODate(e.target.value)} style={inputStyle} />
          <label style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12.5, color: T.textSoft }}>
            <input type="checkbox" checked={offlineForm.oRecurring} onChange={(e) => offlineForm.setORecurring(e.target.checked)} />
            <Repeat size={13} /> This repeats every month (adds it to Recurring bills)
          </label>
          <button onClick={() => { offlineForm.addOfflineExpense(); setShowOfflineForm(false); }} style={primaryBtn}>
            Add expense
          </button>
        </div>
      )}

      <SectionTitle>By category · {curMonthLabel}</SectionTitle>
      <div style={{ ...glassCard, padding: 16, marginBottom: 22, display: "flex", flexDirection: "column", gap: 11 }}>
        {categoryTotals.length === 0 && <EmptyHint text="No spending logged this month — connect SMS or add an expense below." />}
        {categoryTotals.map((c) => {
          const meta = CATEGORY_META[c.category] || CATEGORY_META.Others;
          const Icon = meta.icon;
          return (
            <div key={c.category} style={{ display: "flex", alignItems: "center", gap: 9 }}>
              <Icon size={14} color={meta.color} style={{ flexShrink: 0 }} />
              <div style={{ fontSize: 12, width: 92, flexShrink: 0, color: T.textSoft }}>{c.category}</div>
              <div style={{ flex: 1, background: T.surfaceHi, borderRadius: 6, height: 9, overflow: "hidden" }}>
                <div style={{ width: `${(c.amount / maxCat) * 100}%`, height: "100%", background: meta.color, borderRadius: 6 }} />
              </div>
              <div style={{ fontSize: 12, fontWeight: 700, width: 62, textAlign: "right" }}>{inr(c.amount)}</div>
            </div>
          );
        })}
      </div>

      <SectionTitle>6-month trend</SectionTitle>
      <div style={{ ...glassCard, height: 170, padding: "12px 6px", marginBottom: 22 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={monthlyTrend} margin={{ top: 5, right: 14, left: -18, bottom: 0 }}>
            <defs>
              <linearGradient id="lineGrad2" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor={T.purple} />
                <stop offset="100%" stopColor={T.pink} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke={T.border} vertical={false} />
            <XAxis dataKey="month" tick={{ fontSize: 11, fill: T.textMute }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 10, fill: T.textMute }} axisLine={false} tickLine={false} width={44} tickFormatter={(v) => `₹${v / 1000}k`} />
            <Tooltip formatter={(v) => inr(v)} contentStyle={{ fontSize: 12, borderRadius: 10, border: `1px solid ${T.border}`, background: T.surfaceHi, color: T.text }} />
            <Line type="monotone" dataKey="spend" stroke="url(#lineGrad2)" strokeWidth={3} dot={{ r: 3.5, fill: T.pink, strokeWidth: 0 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* ---------------- All transactions, by month ---------------- */}
      <SectionTitle action={
        <button onClick={() => setShowExport((s) => !s)} style={navAddBtn(showExport)}>
          {showExport ? <X size={13} /> : <Share2 size={13} />} {showExport ? "Close" : "Export"}
        </button>
      }>
        All transactions
      </SectionTitle>

      {showExport && (
        <div style={{ ...glassCard, padding: 14, marginBottom: 14, display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ fontSize: 11, color: T.textSoft, marginBottom: 2 }}>
            Builds a statement for this month and opens your phone's share sheet — pick Email, WhatsApp, Drive, whatever you've got.
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button disabled={exportBusy} onClick={() => exportStatement("xlsx", "month")} style={{ ...primaryBtn, marginTop: 0, flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, opacity: exportBusy ? 0.6 : 1 }}>
              <FileSpreadsheet size={13} /> Excel
            </button>
            <button disabled={exportBusy} onClick={() => exportStatement("pdf", "month")} style={{ ...primaryBtn, marginTop: 0, flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, opacity: exportBusy ? 0.6 : 1 }}>
              <FileText size={13} /> PDF
            </button>
          </div>
        </div>
      )}

      {txList.length === 0 && <EmptyHint text="Nothing yet — connect SMS above, or log an offline expense above." />}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {groups.map((g) => {
          const open = isOpen(g.key);
          return (
            <div key={g.key} data-testid="month-group" style={{ ...glassCard, padding: 0, overflow: "hidden" }}>
              <button data-testid="month-header" aria-expanded={open} onClick={() => toggleMonth(g.key)} style={{
                width: "100%", display: "flex", alignItems: "center", gap: 8, padding: "12px 14px", border: "none", background: "transparent", color: T.text, textAlign: "left",
              }}>
                <ChevronRight size={15} color={T.textMute} style={{ transform: open ? "rotate(90deg)" : "none", transition: "transform .15s", flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 800 }}>{g.label}</div>
                  <div style={{ fontSize: 10.5, color: T.textMute }}>
                    {g.count} entr{g.count !== 1 ? "ies" : "y"}
                    {g.income > 0 && <> · In <b style={{ color: T.green }}>{inr(g.income)}</b></>}
                    {" "}· Spent <b style={{ color: T.textSoft }}>{inr(g.spent)}</b>
                    {g.saved > 0 && <> · Saved <b style={{ color: "#22D3EE" }}>{inr(g.saved)}</b></>}
                  </div>
                </div>
              </button>
              {open && (
                <div style={{ padding: "0 8px 6px" }}>
                  {g.items.map((t) => {
                    // Money IN is any negative-amount entry — income or a refund/reimbursement.
                    const isMoneyIn = t.amount < 0;
                    const hasFullText = !!t.body;
                    return (
                      <div
                        key={t.id}
                        data-testid="tx-row"
                        onClick={() => hasFullText && setSmsPreviewTx(t)}
                        style={{ padding: "10px 6px", borderTop: `1px solid ${T.border}`, cursor: hasFullText ? "pointer" : "default" }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <div style={{ width: 28, height: 28, borderRadius: 9, background: T.surfaceHi, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                            {t.manual ? <Receipt size={13} color={T.gold} /> : <Smartphone size={13} color={T.textSoft} />}
                          </div>
                          <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 5 }}>
                            <span style={{ fontSize: 13, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>{t.desc}</span>
                            {isMoneyIn && t.category !== "Income" && (
                              <span style={{ fontSize: 9, fontWeight: 800, color: T.green, background: "rgba(52,211,153,0.15)", borderRadius: 5, padding: "1px 5px", flexShrink: 0 }}>REFUND</span>
                            )}
                            {t.excluded && (
                              <span title={t.excludedReason} style={{ fontSize: 9, fontWeight: 800, color: T.textMute, background: T.surfaceHi, borderRadius: 5, padding: "1px 5px", whiteSpace: "nowrap", flexShrink: 0 }}>NOT COUNTED</span>
                            )}
                          </div>
                          <div style={{ fontWeight: 800, fontSize: 13.5, color: isMoneyIn ? T.green : T.text, whiteSpace: "nowrap", flexShrink: 0 }}>
                            {isMoneyIn ? "+" : "−"}{inr(t.amount)}
                          </div>
                          <button data-testid="tx-delete" aria-label="Delete transaction" onClick={(e) => { e.stopPropagation(); removeTx(t.id); }} style={{ ...iconBtn, flexShrink: 0 }}>
                            <Trash2 size={13} color={T.textMute} />
                          </button>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginTop: 6, paddingLeft: 36 }}>
                          <div style={{ fontSize: 10.5, color: T.textMute, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>{t.source} · {fmtDateShort(t.date)}</div>
                          <div onClick={(e) => e.stopPropagation()} style={{ flexShrink: 0 }}>
                            <CategorySelect value={t.category} moneyIn={isMoneyIn} onChange={(cat) => changeTxCategory(t.id, cat)} />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SmsPreviewModal({ tx, onClose }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(5,5,8,0.8)", zIndex: 50, display: "flex", alignItems: "flex-end", justifyContent: "center" }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{
        width: "100%", maxWidth: 480, background: T.surfaceHi, borderTopLeftRadius: 22, borderTopRightRadius: 22,
        border: `1px solid ${T.borderHi}`, borderBottom: "none", padding: 20, maxHeight: "70vh", overflowY: "auto",
      }}>
        <div style={{ width: 36, height: 4, borderRadius: 2, background: T.border, margin: "0 auto 14px" }} />
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <div style={{ fontSize: 13.5, fontWeight: 800 }}>Original message</div>
          <button onClick={onClose} style={{ ...iconBtn, background: T.surface, borderRadius: "50%", width: 26, height: 26 }}>
            <X size={13} color={T.textMute} />
          </button>
        </div>
        <div style={{ fontSize: 11, color: T.textMute, marginBottom: 10 }}>{tx.sender || tx.source} · {tx.date}</div>
        <div style={{ background: T.surface, borderRadius: 12, padding: 14, fontSize: 13, lineHeight: 1.6, color: T.textSoft, whiteSpace: "pre-wrap" }}>
          {tx.body}
        </div>
        <div style={{ marginTop: 12, fontSize: 11, color: T.textMute }}>
          Parsed as: <b style={{ color: T.textSoft }}>{inr(Math.abs(tx.amount))}</b> · {tx.category} — if that's wrong, use the category dropdown to fix it.
        </div>
      </div>
    </div>
  );
}

function timeAgo(ms) {
  if (!ms) return null;
  const diff = Math.max(0, Date.now() - ms);
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function SmsConnectCard({ status, onConnect, syncing, lastSync }) {
  const [debugInfo, setDebugInfo] = useState(null);

  useEffect(() => {
    if (status !== "unavailable") return;
    try {
      const cap = typeof window !== "undefined" ? window.Capacitor : undefined;
      setDebugInfo({
        capacitorObjectExists: !!cap,
        isNativePlatform: cap?.isNativePlatform ? cap.isNativePlatform() : "n/a (method missing)",
        platform: cap?.getPlatform ? cap.getPlatform() : "n/a (method missing)",
        registeredPluginNames: cap?.Plugins ? Object.keys(cap.Plugins) : "n/a (no Plugins object)",
      });
    } catch (e) {
      setDebugInfo({ error: e.message });
    }
  }, [status]);

  if (status === "granted") {
    return (
      <div style={{ ...glassCard, display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", marginBottom: 18, borderColor: "rgba(52,211,153,0.3)" }}>
        <div style={{ width: 32, height: 32, borderRadius: 9, background: "rgba(52,211,153,0.18)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <Check size={15} color={T.green} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, color: T.textSoft }}>SMS connected</div>
          <div style={{ fontSize: 10.5, color: T.textMute, marginTop: 1 }}>
            {syncing ? "Syncing…" : lastSync ? `Synced ${timeAgo(lastSync)}` : "Not synced yet"}
          </div>
        </div>
        <button onClick={onConnect} disabled={syncing} title="Check for new messages" style={{ ...iconBtn, background: T.surfaceHi, borderRadius: 8, padding: "7px" }}>
          <RefreshCw size={14} color={T.textSoft} className={syncing ? "coach-spin" : ""} />
        </button>
      </div>
    );
  }

  return (
    <div style={{ ...glassCard, padding: "16px", marginBottom: 18, background: T.gradHero }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
        <div style={{
          width: 36, height: 36, borderRadius: 10, background: T.gradPrimary,
          display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
          boxShadow: "0 4px 14px rgba(139,92,246,0.4)",
        }}>
          <Smartphone size={17} color="#fff" />
        </div>
        <div style={{ fontSize: 13.5, fontWeight: 800 }}>Connect SMS to auto-track spending</div>
      </div>
      <p style={{ fontSize: 11.5, color: T.textSoft, lineHeight: 1.5, margin: "0 0 12px" }}>
        Reads bank & UPI debit/credit alerts on this phone to fill in transactions automatically.
        Nothing leaves your device. You can revoke this anytime from Android Settings.
      </p>

      {status === "unavailable" && (
        <div style={{ fontSize: 11, color: T.textMute, background: T.surface, borderRadius: 8, padding: "8px 10px", marginBottom: 10 }}>
          <div style={{ marginBottom: debugInfo ? 8 : 0 }}>
            Not available — this either means you're viewing this in a browser preview, or the app
            is installed but the native SMS plugin isn't reaching the bridge. Diagnostic info below
            (screenshot this if the SMS card still doesn't work on your installed Android app):
          </div>
          {debugInfo && (
            <pre style={{
              fontSize: 9.5, background: T.bg, borderRadius: 6, padding: 8, margin: 0,
              whiteSpace: "pre-wrap", wordBreak: "break-word", color: T.textSoft,
              fontFamily: "monospace", border: `1px solid ${T.border}`,
            }}>
              {JSON.stringify(debugInfo, null, 2)}
            </pre>
          )}
        </div>
      )}
      {status === "denied" && (
        <div style={{ fontSize: 11, color: T.red, background: "rgba(251,113,133,0.1)", borderRadius: 8, padding: "8px 10px", marginBottom: 10 }}>
          Permission wasn't granted. You can retry, or keep adding expenses manually / offline below.
        </div>
      )}

      <button
        onClick={onConnect}
        disabled={status === "requesting"}
        style={{ ...primaryBtn, marginTop: 0, width: "100%", opacity: status === "requesting" ? 0.6 : 1 }}
      >
        {status === "requesting" ? "Requesting permission…" : status === "denied" ? "Try again" : "Allow SMS access"}
      </button>
    </div>
  );
}

function CategorySelect({ value, onChange, moneyIn = false }) {
  const color = CATEGORY_META[value]?.color || T.textSoft;
  const base = categoriesFor(moneyIn);
  const options = base.includes(value) ? base : [value, ...base];
  return (
    <div style={{ position: "relative" }}>
      <select data-testid="cat-select" value={value} onChange={(e) => onChange(e.target.value)} style={{
        appearance: "none", border: `1px solid ${color}33`, background: color + "1F",
        color, borderRadius: 20, padding: "4px 22px 4px 10px", fontSize: 11, fontWeight: 700,
      }}>
        {options.map((c) => <option key={c} value={c}>{c}</option>)}
      </select>
      <ChevronDown size={11} style={{ position: "absolute", right: 6, top: 6.5, pointerEvents: "none", color }} />
    </div>
  );
}

const inputStyle = {
  border: `1px solid ${T.border}`, borderRadius: 10, padding: "10px 11px",
  fontSize: 13, background: T.surfaceHi, color: T.text, width: "100%", outline: "none",
};
