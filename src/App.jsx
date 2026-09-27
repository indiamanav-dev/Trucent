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
} from "lucide-react";

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
  "Tuition / Education": { icon: GraduationCap, color: "#A78BFA" },
  "Utilities": { icon: Zap, color: T.red },
  "Dining Out": { icon: Utensils, color: "#FB923C" },
  "Transport": { icon: Car, color: T.blue },
  "Shopping": { icon: ShoppingBag, color: T.pink },
  "Entertainment": { icon: Sparkles, color: "#38BDF8" },
  "Others": { icon: Wallet, color: T.textSoft },
};
const CATEGORY_LIST = Object.keys(CATEGORY_META);

// `let` (not `const`) so members can be added/edited/removed at runtime — see
// addMember / updateMember / deleteMember in the App shell, which mutate this
// array and bump a tick counter to force a re-render.
// V-001.P — production build: single default profile ("You"), no seed data.
// Add more group members from the profile switcher after install.
let MEMBERS = [{ id: "you", name: "You", color: "#FBBF24" }];

const MEMBER_PALETTE = ["#8B5CF6", "#EC4899", "#FBBF24", "#34D399", "#60A5FA", "#F97316", "#14B8A6", "#F472B6"];

// Real device date — no more fixed demo date.
const todayISO = () => new Date().toISOString().slice(0, 10);
const getTodayDay = () => new Date().getDate();
const inr = (n) => "₹" + Math.round(Math.abs(n)).toLocaleString("en-IN");

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
function ordinal(n) {
  if (!n) return "";
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return s[(v - 20) % 10] || s[v] || s[0];
}
function daysUntil(dueDay) {
  const now = new Date();
  const today = now.getDate();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  return dueDay >= today ? dueDay - today : daysInMonth - today + dueDay;
}
function daysUntilDate(dateStr) {
  const diff = (new Date(dateStr) - new Date(todayISO())) / (1000 * 60 * 60 * 24);
  return Math.round(diff);
}
function guessCategory(desc = "") {
  const d = desc.toLowerCase();
  if (/salary|credited|neft|imps cr|income/.test(d)) return "Income";
  if (/swiggy|zomato|restaurant|cafe|dominos|pizza|dine/.test(d)) return "Dining Out";
  if (/uber|ola|rapido|petrol|diesel|fuel|metro|cab/.test(d)) return "Transport";
  if (/amazon|myntra|flipkart|ajio|mall|nykaa/.test(d)) return "Shopping";
  if (/bigbasket|dmart|grocery|kirana|supermarket|blinkit|zepto|instamart/.test(d)) return "Groceries";
  if (/netflix|spotify|prime video|hotstar|movie|cinema|pvr|inox/.test(d)) return "Entertainment";
  if (/electricity|water bill|gas bill|broadband|wifi|dth|recharge/.test(d)) return "Utilities";
  if (/school|tuition|fees|college|academy/.test(d)) return "Tuition / Education";
  if (/maid|cook|domestic help|servant/.test(d)) return "Domestic Help";
  if (/society|maintenance|rwa/.test(d)) return "Society Maintenance";
  return "Others";
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
    income, totalSpend, saved, savingsRate, overBudget, categoryTotals,
    goals, recurringMonthlyTotal, settlements, settleTotal, spendDelta,
  } = d;

  const hasData = income > 0 || totalSpend > 0;
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
    const pct = (topCat.amount / totalSpend) * 100;
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
const glassCard = { background: T.gradDark, border: `1px solid ${T.border}`, borderRadius: 18 };

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
  const [currentMember, setCurrentMember] = useState("you");
  const [showProfile, setShowProfile] = useState(false);
  const [, setMembersTick] = useState(0); // bump to re-render after mutating the module-level MEMBERS array
  const [expenses, setExpenses] = useState(seedExpenses);
  const [txList, setTxList] = useState(rawSeedTx);
  const [showForm, setShowForm] = useState(false);

  const [fDesc, setFDesc] = useState("");
  const [fAmount, setFAmount] = useState("");
  const [fCategory, setFCategory] = useState(CATEGORY_LIST[0]);
  const [fPaidBy, setFPaidBy] = useState("you");
  const [fSplit, setFSplit] = useState(MEMBERS.map((m) => m.id));
  const [fRecurring, setFRecurring] = useState(false);

  const [budgets, setBudgets] = useState(seedBudgets);
  const [goals, setGoals] = useState(seedGoals);
  const [planned, setPlanned] = useState(seedPlanned);

  const [bCategory, setBCategory] = useState(CATEGORY_LIST[0]);
  const [bLimit, setBLimit] = useState("");
  const [gName, setGName] = useState("");
  const [gTarget, setGTarget] = useState("");
  const [gDeadline, setGDeadline] = useState("");
  const [pDesc, setPDesc] = useState("");
  const [pAmount, setPAmount] = useState("");
  const [pCategory, setPCategory] = useState(CATEGORY_LIST[0]);
  const [pDate, setPDate] = useState("");

  const [oDesc, setODesc] = useState("");
  const [oAmount, setOAmount] = useState("");
  const [oCategory, setOCategory] = useState(CATEGORY_LIST[0]);
  const [oMode, setOMode] = useState("Cash");
  const [oRecurring, setORecurring] = useState(false);
  const [oDate, setODate] = useState(todayISO());

  const resetForm = () => {
    setFDesc(""); setFAmount(""); setFCategory(CATEGORY_LIST[0]);
    setFPaidBy(currentMember); setFSplit(MEMBERS.map((m) => m.id)); setFRecurring(false);
  };
  const addExpense = () => {
    if (!fDesc.trim() || !fAmount || Number(fAmount) <= 0 || fSplit.length === 0) return;
    setExpenses((prev) => [{
      id: "e" + Date.now(), desc: fDesc.trim(), category: fCategory, amount: Number(fAmount),
      paidBy: fPaidBy, splitAmong: fSplit, date: todayISO(), recurring: fRecurring,
      everyMonthDay: fRecurring ? getTodayDay() : undefined, lastPaid: fRecurring ? todayISO() : undefined,
    }, ...prev]);
    resetForm(); setShowForm(false);
  };
  const markRecurringPaid = (id) => setExpenses((prev) => prev.map((e) => e.id === id ? { ...e, lastPaid: todayISO() } : e));
  const updateExpense = (id, updates) => setExpenses((prev) => prev.map((e) => (e.id === id ? { ...e, ...updates } : e)));
  const deleteExpense = (id) => setExpenses((prev) => prev.filter((e) => e.id !== id));
  const updateTxCategory = (id, category) => setTxList((prev) => prev.map((t) => t.id === id ? { ...t, category } : t));
  const removeTx = (id) => setTxList((prev) => prev.filter((t) => t.id !== id));

  const addMember = (name, color) => {
    if (!name.trim()) return;
    MEMBERS.push({ id: "m" + Date.now(), name: name.trim(), color: color || MEMBER_PALETTE[MEMBERS.length % MEMBER_PALETTE.length] });
    setMembersTick((t) => t + 1);
  };
  const updateMember = (id, updates) => {
    const m = MEMBERS.find((x) => x.id === id);
    if (m) Object.assign(m, updates);
    setMembersTick((t) => t + 1);
  };
  const deleteMember = (id) => {
    if (MEMBERS.length <= 1) return; // always keep at least one profile
    MEMBERS = MEMBERS.filter((m) => m.id !== id);
    setFSplit((prev) => prev.filter((x) => x !== id));
    if (currentMember === id) setCurrentMember(MEMBERS[0].id);
    if (fPaidBy === id) setFPaidBy(MEMBERS[0].id);
    setMembersTick((t) => t + 1);
  };

  const addOfflineExpense = () => {
    if (!oDesc.trim() || !oAmount || Number(oAmount) <= 0 || !oDate) return;
    setTxList((prev) => [{
      id: "tx" + Date.now(), desc: oDesc.trim(), amount: Number(oAmount), category: oCategory,
      source: `Offline · ${oMode}`, date: oDate, recurring: oRecurring, manual: true,
    }, ...prev]);
    setODesc(""); setOAmount(""); setOCategory(CATEGORY_LIST[0]); setOMode("Cash"); setORecurring(false); setODate(todayISO());
  };

  // ---- SMS import — bridges to the native SmsReader plugin (Android build only) ----
  // window.Capacitor.Plugins.SmsReader is injected by the native shell at runtime;
  // it simply won't exist in a browser, so this degrades safely to "unavailable" there.
  const [smsStatus, setSmsStatus] = useState("idle"); // idle | requesting | granted | denied | unavailable
  const importFromSms = async () => {
    const plugin = typeof window !== "undefined" ? window.Capacitor?.Plugins?.SmsReader : null;
    if (!plugin) { setSmsStatus("unavailable"); return; }
    setSmsStatus("requesting");
    try {
      const perm = await plugin.requestPermission();
      if (!perm?.granted) { setSmsStatus("denied"); return; }
      // Native side returns { desc, amount: <always positive>, date, type: "debit"|"credit", sender }
      const res = await plugin.fetchTransactions({ sinceDays: 90 });
      const existingKeys = new Set(txList.map((t) => `${t.date}_${Math.abs(t.amount)}_${t.desc}`));
      const imported = (res?.transactions || [])
        .filter((t) => !existingKeys.has(`${t.date}_${t.amount}_${t.desc}`))
        .map((t, i) => ({
          id: "sms" + Date.now() + i,
          desc: t.desc,
          amount: t.type === "credit" ? -Math.abs(t.amount) : Math.abs(t.amount),
          date: t.date,
          source: `SMS · ${t.sender || "Bank"}`,
          category: t.type === "credit" ? "Income" : guessCategory(t.desc),
        }));
      setTxList((prev) => [...imported, ...prev]);
      setSmsStatus("granted");
    } catch {
      setSmsStatus("denied");
    }
  };

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
    setPDesc(""); setPAmount(""); setPCategory(CATEGORY_LIST[0]); setPDate("");
  };
  const removePlanned = (id) => setPlanned((prev) => prev.filter((p) => p.id !== id));
  const convertPlannedToExpense = (item) => {
    setExpenses((prev) => [{
      id: "e" + Date.now(), desc: item.desc, category: item.category, amount: item.amount,
      paidBy: currentMember, splitAmong: MEMBERS.map((m) => m.id), date: todayISO(), recurring: false,
    }, ...prev]);
    removePlanned(item.id);
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
  const recurringItems = expenses.filter((e) => e.recurring);
  const recurringMonthlyTotal = recurringItems.reduce((s, e) => s + e.amount, 0);

  const spendTx = txList.filter((t) => t.amount > 0);
  const totalSpend = spendTx.reduce((s, t) => s + t.amount, 0) + recurringMonthlyTotal;
  const income = Math.abs(txList.find((t) => t.category === "Income")?.amount || 0);
  const saved = income - totalSpend;
  const savingsRate = income ? Math.max(0, Math.min(100, (saved / income) * 100)) : 0;

  const categoryTotals = useMemo(() => {
    const map = {};
    spendTx.forEach((t) => { map[t.category] = (map[t.category] || 0) + t.amount; });
    recurringItems.forEach((e) => { map[e.category] = (map[e.category] || 0) + e.amount; });
    return Object.entries(map).map(([category, amount]) => ({ category, amount })).sort((a, b) => b.amount - a.amount);
  }, [spendTx, recurringItems]);

  const nextBill = useMemo(() => {
    if (recurringItems.length === 0) return null;
    return [...recurringItems].sort((a, b) => daysUntil(a.everyMonthDay) - daysUntil(b.everyMonthDay))[0];
  }, [recurringItems]);

  const monthlyTrend = useMemo(() => {
    const now = new Date();
    const months = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push({ key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`, month: d.toLocaleString("en-US", { month: "short" }) });
    }
    const totals = {};
    months.forEach((m) => (totals[m.key] = 0));
    spendTx.forEach((t) => { const k = t.date.slice(0, 7); if (k in totals) totals[k] += t.amount; });
    recurringItems.forEach((e) => { const k = todayISO().slice(0, 7); if (k in totals) totals[k] += e.amount; });
    return months.map((m) => ({ month: m.month, spend: totals[m.key] }));
  }, [spendTx, recurringItems]);

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

  const personalRecurringTx = txList.filter((t) => t.recurring && t.category !== "Income");

  const shared = {
    expenses, settlements, recurringItems, markRecurringPaid, showForm, setShowForm,
    updateExpense, deleteExpense,
    form: { fDesc, setFDesc, fAmount, setFAmount, fCategory, setFCategory, fPaidBy, setFPaidBy, fSplit, setFSplit, fRecurring, setFRecurring },
    addExpense, txList, totalSpend, income, saved, categoryTotals, updateTxCategory, removeTx,
    personalRecurringTx,
    offlineForm: { oDesc, setODesc, oAmount, setOAmount, oCategory, setOCategory, oMode, setOMode, oRecurring, setORecurring, oDate, setODate, addOfflineExpense },
    smsStatus, importFromSms,
    recurringMonthlyTotal, nextBill, spendDelta, savingsRate, settleTotal,
    budgetsWithSpend, overBudget, removeBudget,
    budgetForm: { bCategory, setBCategory, bLimit, setBLimit, addBudget },
    goals, goalsTotals, addFundsToGoal, removeGoal,
    goalForm: { gName, setGName, gTarget, setGTarget, gDeadline, setGDeadline, addGoal },
    plannedSorted, upcomingTotal, removePlanned, convertPlannedToExpense,
    plannedForm: { pDesc, setPDesc, pAmount, setPAmount, pCategory, setPCategory, pDate, setPDate, addPlanned },
    currentMember, setCurrentMember, monthlyTrend,
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

        <button
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

      {showProfile && (
        <ProfilePanel
          currentMember={currentMember}
          setCurrentMember={setCurrentMember}
          onClose={() => setShowProfile(false)}
          addMember={addMember}
          updateMember={updateMember}
          deleteMember={deleteMember}
        />
      )}

      {/* ---------------- Net position — visible on every tab ---------------- */}
      <div style={{
        ...glassCard, display: "flex", alignItems: "center", padding: "10px 14px", marginBottom: 18, gap: 6,
      }}>
        <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 6 }}>
          <TrendingUp size={13} color={T.green} />
          <div>
            <div style={{ fontSize: 9.5, color: T.textMute, fontWeight: 700 }}>EARNED</div>
            <div style={{ fontSize: 12.5, fontWeight: 800, color: T.green }}>{inr(income)}</div>
          </div>
        </div>
        <div style={{ width: 1, height: 26, background: T.border }} />
        <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 6, justifyContent: "center" }}>
          <TrendingDown size={13} color={T.red} />
          <div>
            <div style={{ fontSize: 9.5, color: T.textMute, fontWeight: 700 }}>SPENT</div>
            <div style={{ fontSize: 12.5, fontWeight: 800, color: T.red }}>{inr(totalSpend)}</div>
          </div>
        </div>
        <div style={{ width: 1, height: 26, background: T.border }} />
        <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 6, justifyContent: "flex-end" }}>
          <Scale size={13} color={saved >= 0 ? T.gold : T.red} />
          <div>
            <div style={{ fontSize: 9.5, color: T.textMute, fontWeight: 700 }}>NET</div>
            <div style={{
              fontSize: 12.5, fontWeight: 800,
              ...(saved >= 0
                ? { background: T.gradGold, WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" }
                : { color: T.red }),
            }}>
              {saved >= 0 ? "+" : "−"}{inr(saved)}
            </div>
          </div>
        </div>
      </div>

      {tab === "home" && <HomeTab {...shared} setTab={setTab} />}
      {tab === "burn" && <BurnTab {...shared} />}
      {tab === "plan" && <PlanTab {...shared} />}
      {tab === "split" && <SplitTab {...shared} />}

      <BottomNav tab={tab} setTab={setTab} />
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
function ProfilePanel({ currentMember, setCurrentMember, onClose, addMember, updateMember, deleteMember }) {
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
      icon: topCat.amount / totalSpend > 0.25 ? TrendingUp : Sparkles,
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
  const hasAnyData = income > 0 || totalSpend > 0;
  let heroLabel, heroValue, heroIsGold;
  if (!hasAnyData) {
    heroLabel = "NOTHING TRACKED YET"; heroValue = 0; heroIsGold = false;
  } else if (!hasIncome) {
    heroLabel = "SPENT THIS MONTH"; heroValue = totalSpend; heroIsGold = false;
  } else if (saved >= 0) {
    heroLabel = "SAVED THIS MONTH"; heroValue = saved; heroIsGold = true;
  } else {
    heroLabel = "OVERSPENT THIS MONTH"; heroValue = Math.abs(saved); heroIsGold = false;
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
          goals, recurringMonthlyTotal, settlements, settleTotal, spendDelta,
        }}
      />

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
                {nextBill.desc} · {daysUntil(nextBill.everyMonthDay) === 0 ? "due today" : `in ${daysUntil(nextBill.everyMonthDay)}d`}
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
              const pct = ((c.amount / totalSpend) * 100).toFixed(0);
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
function MoneyCoachCard({ coachData, setTab }) {
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
function SplitTab({ expenses, settlements, showForm, setShowForm, form, addExpense, updateExpense, deleteExpense }) {
  const oneOffExpenses = expenses.filter((e) => !e.recurring);

  const [editingId, setEditingId] = useState(null);
  const [eDesc, setEDesc] = useState("");
  const [eAmount, setEAmount] = useState("");
  const [eCategory, setECategory] = useState(CATEGORY_LIST[0]);
  const [ePaidBy, setEPaidBy] = useState("you");
  const [eSplit, setESplit] = useState([]);

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

      <SectionTitle>Settle up</SectionTitle>
      {settlements.length === 0 ? (
        <div style={{ ...glassCard, color: T.green, padding: "13px 15px", fontSize: 13, fontWeight: 600, background: "rgba(52,211,153,0.08)", borderColor: "rgba(52,211,153,0.25)", marginBottom: 22 }}>
          Everyone's square. No one owes anyone right now.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 22 }}>
          {settlements.map((s, i) => (
            <div key={i} style={{ ...glassCard, display: "flex", alignItems: "center", gap: 10, padding: "12px 14px" }}>
              <Avatar id={s.from} />
              <div style={{ flex: 1, fontSize: 13.5, color: T.textSoft }}>
                <b style={{ color: T.text }}>{memberName(s.from)}</b> owes <b style={{ color: T.text }}>{memberName(s.to)}</b>
              </div>
              <ArrowRight size={14} color={T.textMute} />
              <Avatar id={s.to} />
              <div style={{ marginLeft: 4, fontWeight: 800, fontSize: 15, background: T.gradGold, WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" }}>
                {inr(s.amount)}
              </div>
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
              {CATEGORY_LIST.map((c) => <option key={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <div style={{ fontSize: 11, color: T.textMute, marginBottom: 6, fontWeight: 600 }}>Paid by</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {MEMBERS.map((m) => <Pill key={m.id} active={form.fPaidBy === m.id} onClick={() => form.setFPaidBy(m.id)} label={m.name} />)}
            </div>
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12.5, color: T.textSoft }}>
            <input type="checkbox" checked={form.fRecurring} onChange={(e) => form.setFRecurring(e.target.checked)} />
            <Repeat size={13} /> Repeats monthly (fixed bill, not split)
          </label>
          {form.fRecurring ? (
            <div style={{ fontSize: 11, color: T.textMute, background: T.surfaceHi, borderRadius: 8, padding: "8px 10px" }}>
              This will show under <b style={{ color: T.textSoft }}>Where It Went</b> as a recurring bill, not in this ledger.
            </div>
          ) : (
            <div>
              <div style={{ fontSize: 11, color: T.textMute, marginBottom: 6, fontWeight: 600 }}>Split among</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {MEMBERS.map((m) => {
                  const active = form.fSplit.includes(m.id);
                  return <Pill key={m.id} active={active} onClick={() => form.setFSplit((prev) => active ? prev.filter((id) => id !== m.id) : [...prev, m.id])} label={m.name} />;
                })}
              </div>
            </div>
          )}
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
                    {CATEGORY_LIST.map((c) => <option key={c}>{c}</option>)}
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
  plannedSorted, upcomingTotal, removePlanned, convertPlannedToExpense, plannedForm,
}) {
  const [showBudgetForm, setShowBudgetForm] = useState(false);
  const [showGoalForm, setShowGoalForm] = useState(false);
  const [showPlannedForm, setShowPlannedForm] = useState(false);
  const [fundInputs, setFundInputs] = useState({});

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
              {CATEGORY_LIST.map((c) => <option key={c}>{c}</option>)}
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
              {CATEGORY_LIST.map((c) => <option key={c}>{c}</option>)}
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
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
                <div style={{ fontWeight: 800, fontSize: 13.5 }}>{inr(p.amount)}</div>
                <div style={{ display: "flex", gap: 4 }}>
                  <button onClick={() => convertPlannedToExpense(p)} title="Mark as spent" style={{
                    border: "none", borderRadius: 7, background: "rgba(52,211,153,0.15)", color: T.green,
                    padding: "3px 7px", fontSize: 10, fontWeight: 700, display: "flex", alignItems: "center", gap: 3,
                  }}>
                    <Check size={10} /> Spent
                  </button>
                  <button onClick={() => removePlanned(p.id)} style={iconBtn}><Trash2 size={12} color={T.textMute} /></button>
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
function BurnTab({
  txList, totalSpend, categoryTotals, updateTxCategory, recurringItems, markRecurringPaid,
  personalRecurringTx, offlineForm, removeTx, monthlyTrend, smsStatus, importFromSms,
}) {
  const [showOfflineForm, setShowOfflineForm] = useState(false);
  const maxCat = categoryTotals[0]?.amount || 1;
  const paymentModes = ["Cash", "Card", "Cheque", "UPI (not detected)", "Other"];
  return (
    <div>
      <h2 style={{ fontSize: 20, fontWeight: 800, margin: "2px 0 16px", letterSpacing: -0.4 }}>Where It Went</h2>

      <SmsConnectCard status={smsStatus} onConnect={importFromSms} />

      <SectionTitle>Recurring bills · rent, subscriptions, memberships</SectionTitle>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 22 }}>
        {recurringItems.length === 0 && <EmptyHint text="No recurring bills set up yet." />}
        {recurringItems.map((e) => {
          const paidThisMonth = e.lastPaid && e.lastPaid.slice(0, 7) === todayISO().slice(0, 7);
          return (
            <div key={e.id} style={{ ...glassCard, display: "flex", alignItems: "center", gap: 10, padding: "12px 14px" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 700 }}>{e.desc}</div>
                <div style={{ display: "flex", gap: 6, marginTop: 5, alignItems: "center", flexWrap: "wrap" }}>
                  <CategoryTag category={e.category} />
                  <span style={{ fontSize: 11, color: T.textMute }}>Due {e.everyMonthDay}{ordinal(e.everyMonthDay)} · {memberName(e.paidBy)}</span>
                </div>
              </div>
              <div style={{ fontWeight: 800, fontSize: 14.5 }}>{inr(e.amount)}</div>
              <button onClick={() => markRecurringPaid(e.id)} disabled={paidThisMonth} style={{
                display: "flex", alignItems: "center", gap: 4, border: "none", borderRadius: 20, padding: "7px 12px",
                fontSize: 11.5, fontWeight: 700,
                background: paidThisMonth ? "rgba(52,211,153,0.15)" : T.gradPrimary,
                color: paidThisMonth ? T.green : "#fff",
                boxShadow: paidThisMonth ? "none" : "0 3px 12px rgba(139,92,246,0.35)",
              }}>
                <Check size={12} /> {paidThisMonth ? "Paid" : "Mark paid"}
              </button>
            </div>
          );
        })}
      </div>

      {personalRecurringTx.length > 0 && (
        <>
          <SectionTitle>Personal recurring · from offline entries</SectionTitle>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 22 }}>
            {personalRecurringTx.map((t) => (
              <div key={t.id} style={{ ...glassCard, display: "flex", alignItems: "center", gap: 10, padding: "12px 14px" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.desc}</div>
                  <div style={{ display: "flex", gap: 6, marginTop: 5, alignItems: "center", flexWrap: "wrap" }}>
                    <CategoryTag category={t.category} />
                    <span style={{ fontSize: 10.5, color: T.textMute }}>{t.source} · {t.date}</span>
                  </div>
                </div>
                <div style={{ fontWeight: 800, fontSize: 13.5 }}>{inr(t.amount)}</div>
                <button onClick={() => removeTx(t.id)} style={iconBtn}><Trash2 size={12} color={T.textMute} /></button>
              </div>
            ))}
          </div>
        </>
      )}

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
              {CATEGORY_LIST.map((c) => <option key={c}>{c}</option>)}
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
            <Repeat size={13} /> This repeats regularly
          </label>
          <button onClick={() => { offlineForm.addOfflineExpense(); setShowOfflineForm(false); }} style={primaryBtn}>
            Add expense
          </button>
        </div>
      )}

      <SectionTitle>By category</SectionTitle>
      <div style={{ ...glassCard, padding: 16, marginBottom: 22, display: "flex", flexDirection: "column", gap: 11 }}>
        {categoryTotals.length === 0 && <EmptyHint text="No spending logged yet — connect SMS or add an expense below." />}
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

      <SectionTitle>All transactions</SectionTitle>
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {txList.length === 0 && <EmptyHint text="Nothing yet — connect SMS above, or log an offline expense below." />}
        {txList.map((t) => (
          <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 9, padding: "10px 6px", borderBottom: `1px solid ${T.border}` }}>
            <div style={{ width: 28, height: 28, borderRadius: 9, background: T.surfaceHi, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              {t.manual ? <Receipt size={13} color={T.gold} /> : <Smartphone size={13} color={T.textSoft} />}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12.5, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.desc}</div>
              <div style={{ fontSize: 10.5, color: T.textMute }}>{t.source} · {t.date}</div>
            </div>
            {t.category !== "Income" ? (
              <CategorySelect value={t.category} onChange={(cat) => updateTxCategory(t.id, cat)} />
            ) : <CategoryTag category="Income" />}
            <div style={{ fontWeight: 800, fontSize: 13, width: 68, textAlign: "right", color: t.category === "Income" ? T.green : T.text }}>
              {t.category === "Income" ? "+" : "−"}{inr(t.amount)}
            </div>
            {t.manual && <button onClick={() => removeTx(t.id)} style={iconBtn}><Trash2 size={12} color={T.textMute} /></button>}
          </div>
        ))}
      </div>
    </div>
  );
}

function SmsConnectCard({ status, onConnect }) {
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
        <div style={{ flex: 1, fontSize: 12, color: T.textSoft }}>SMS connected — new transactions sync automatically.</div>
        <button onClick={onConnect} style={{ ...iconBtn, background: T.surfaceHi, borderRadius: 8, padding: "6px 9px" }}>
          <Smartphone size={12} color={T.textMute} />
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

function CategorySelect({ value, onChange }) {
  const color = CATEGORY_META[value]?.color || T.textSoft;
  return (
    <div style={{ position: "relative" }}>
      <select value={value} onChange={(e) => onChange(e.target.value)} style={{
        appearance: "none", border: `1px solid ${color}33`, background: color + "1F",
        color, borderRadius: 20, padding: "4px 22px 4px 10px", fontSize: 11, fontWeight: 700,
      }}>
        {CATEGORY_LIST.map((c) => <option key={c} value={c}>{c}</option>)}
      </select>
      <ChevronDown size={11} style={{ position: "absolute", right: 6, top: 6.5, pointerEvents: "none", color }} />
    </div>
  );
}

const inputStyle = {
  border: `1px solid ${T.border}`, borderRadius: 10, padding: "10px 11px",
  fontSize: 13, background: T.surfaceHi, color: T.text, width: "100%", outline: "none",
};
