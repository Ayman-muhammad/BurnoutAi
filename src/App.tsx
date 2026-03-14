/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import * as React from 'react';
import { useState, useMemo, useEffect } from 'react';
import { 
  TrendingDown, 
  TrendingUp, 
  Wallet, 
  Calendar, 
  Plus, 
  Trash2, 
  MessageSquare, 
  Sparkles,
  AlertCircle,
  ChevronRight,
  PieChart as PieChartIcon,
  DollarSign,
  LogOut,
  LogIn,
  User as UserIcon
} from 'lucide-react';
import { 
  PieChart, 
  Pie, 
  Cell, 
  ResponsiveContainer, 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  Tooltip, 
  Legend 
} from 'recharts';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { analyzeBurn } from './services/geminiService';
import { BurnData, Expense, AnalysisResult } from './types';
import { 
  auth, 
  db, 
  googleProvider, 
  signInWithPopup, 
  signOut, 
  onAuthStateChanged 
} from './firebase';
import { 
  collection, 
  query, 
  onSnapshot, 
  addDoc, 
  deleteDoc, 
  doc, 
  updateDoc, 
  setDoc,
  serverTimestamp,
  orderBy,
  getDoc
} from 'firebase/firestore';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// --- Error Handling ---
enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// --- Error Boundary ---
class ErrorBoundary extends React.Component<any, any> {
  constructor(props: any) {
    super(props);
    (this as any).state = { hasError: false, error: null };
  }
  public static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }
  public componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("Uncaught error:", error, errorInfo);
  }
  public render() {
    const _this = this as any;
    if (_this.state.hasError) {
      let message = "Something went wrong.";
      try {
        const parsed = JSON.parse(_this.state.error?.message || "");
        if (parsed.error) message = `Database Error: ${parsed.error}`;
      } catch {
        message = _this.state.error?.message || message;
      }
      return (
        <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
          <div className="bg-white p-8 rounded-3xl shadow-xl max-w-md w-full border border-rose-100">
            <AlertCircle className="text-rose-500 mb-4" size={48} />
            <h1 className="text-2xl font-bold text-slate-900 mb-2">Application Error</h1>
            <p className="text-slate-600 mb-6">{message}</p>
            <button 
              onClick={() => window.location.reload()}
              className="w-full bg-slate-900 text-white py-3 rounded-xl font-medium hover:bg-slate-800 transition-colors"
            >
              Reload Application
            </button>
          </div>
        </div>
      );
    }
    return _this.props.children;
  }
}

function BurnWiseApp() {
  const [user, setUser] = useState(auth.currentUser);
  const [isAuthReady, setIsAuthReady] = useState(false);
  
  const [cashBalance, setCashBalance] = useState<number>(15000);
  const [monthlyRevenue, setMonthlyRevenue] = useState<number>(1200);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [showAddExpense, setShowAddExpense] = useState(false);

  // Form state for new expense
  const [newExpense, setNewExpense] = useState({
    category: 'SaaS',
    amount: 0,
    description: '',
    isSubscription: true
  });

  // Auth Listener
  useEffect(() => {
    return onAuthStateChanged(auth, (u) => {
      setUser(u);
      setIsAuthReady(true);
    });
  }, []);

  // Firestore Sync: User Profile
  useEffect(() => {
    if (!user || !isAuthReady) return;

    const userDocRef = doc(db, 'users', user.uid);
    const unsubscribe = onSnapshot(userDocRef, (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        if (data.cashBalance !== undefined) setCashBalance(data.cashBalance);
        if (data.monthlyRevenue !== undefined) setMonthlyRevenue(data.monthlyRevenue);
      } else {
        // Initialize profile
        setDoc(userDocRef, { uid: user.uid, cashBalance: 15000, monthlyRevenue: 1200 })
          .catch(e => handleFirestoreError(e, OperationType.WRITE, `users/${user.uid}`));
      }
    }, (err) => handleFirestoreError(err, OperationType.GET, `users/${user.uid}`));

    return () => unsubscribe();
  }, [user, isAuthReady]);

  // Firestore Sync: Expenses
  useEffect(() => {
    if (!user || !isAuthReady) {
      setExpenses([]);
      return;
    }

    const expensesRef = collection(db, 'users', user.uid, 'expenses');
    const q = query(expensesRef, orderBy('createdAt', 'desc'));
    
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const list = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Expense[];
      setExpenses(list);
    }, (err) => handleFirestoreError(err, OperationType.LIST, `users/${user.uid}/expenses`));

    return () => unsubscribe();
  }, [user, isAuthReady]);

  const stats = useMemo(() => {
    const totalExpenses = expenses.reduce((sum, e) => sum + e.amount, 0);
    const netBurn = totalExpenses - monthlyRevenue;
    const runway = netBurn > 0 ? cashBalance / netBurn : Infinity;
    
    const categoryData = expenses.reduce((acc: any[], curr) => {
      const existing = acc.find(item => item.name === curr.category);
      if (existing) {
        existing.value += curr.amount;
      } else {
        acc.push({ name: curr.category, value: curr.amount });
      }
      return acc;
    }, []);

    return { totalExpenses, netBurn, runway, categoryData };
  }, [expenses, monthlyRevenue, cashBalance]);

  const COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];

  const handleAnalyze = async () => {
    if (expenses.length === 0) return;
    setIsAnalyzing(true);
    try {
      const data: BurnData = { cashBalance, monthlyRevenue, expenses };
      const result = await analyzeBurn(data);
      setAnalysis(result);
    } catch (error) {
      console.error("Analysis failed:", error);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const addExpense = async () => {
    if (!user || newExpense.amount <= 0 || !newExpense.description) return;
    
    const path = `users/${user.uid}/expenses`;
    try {
      await addDoc(collection(db, path), {
        ...newExpense,
        uid: user.uid,
        createdAt: serverTimestamp()
      });
      setNewExpense({ category: 'SaaS', amount: 0, description: '', isSubscription: true });
      setShowAddExpense(false);
    } catch (e) {
      handleFirestoreError(e, OperationType.CREATE, path);
    }
  };

  const removeExpense = async (id: string) => {
    if (!user) return;
    const path = `users/${user.uid}/expenses/${id}`;
    try {
      await deleteDoc(doc(db, path));
    } catch (e) {
      handleFirestoreError(e, OperationType.DELETE, path);
    }
  };

  const updateProfile = async (updates: Partial<{ cashBalance: number, monthlyRevenue: number }>) => {
    if (!user) return;
    const path = `users/${user.uid}`;
    try {
      await updateDoc(doc(db, path), updates);
    } catch (e) {
      handleFirestoreError(e, OperationType.UPDATE, path);
    }
  };

  const handleLogin = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (error) {
      console.error("Login failed:", error);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      setAnalysis(null);
    } catch (error) {
      console.error("Logout failed:", error);
    }
  };

  if (!isAuthReady) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f5f5f5]">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-emerald-600 border-t-transparent rounded-full animate-spin"></div>
          <p className="text-slate-500 font-medium">Loading BurnWise...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-[#f5f5f5] flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-3xl shadow-2xl p-10 text-center border border-slate-100">
          <div className="w-20 h-20 bg-emerald-600 rounded-3xl flex items-center justify-center text-white mx-auto mb-8 shadow-lg shadow-emerald-200">
            <TrendingDown size={40} />
          </div>
          <h1 className="text-3xl font-bold text-slate-900 mb-4 tracking-tight">Welcome to BurnWise</h1>
          <p className="text-slate-600 mb-10 leading-relaxed">
            Take control of your financial runway. Sign in to track expenses, analyze burn, and extend your business health.
          </p>
          <button 
            onClick={handleLogin}
            className="w-full flex items-center justify-center gap-3 bg-slate-900 text-white py-4 rounded-2xl font-semibold hover:bg-slate-800 transition-all transform hover:scale-[1.02] active:scale-[0.98]"
          >
            <LogIn size={20} />
            Sign in with Google
          </button>
          <p className="mt-6 text-xs text-slate-400">Secure data persistence powered by Firebase</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f5f5f5] text-slate-900 font-sans selection:bg-emerald-100">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-emerald-600 rounded-lg flex items-center justify-center text-white">
              <TrendingDown size={20} />
            </div>
            <h1 className="text-xl font-semibold tracking-tight">BurnWise AI</h1>
          </div>
          <div className="flex items-center gap-4">
            <div className="hidden md:flex items-center gap-3 mr-4 px-3 py-1.5 bg-slate-50 rounded-full border border-slate-100">
              {user.photoURL ? (
                <img src={user.photoURL} alt={user.displayName || ''} className="w-6 h-6 rounded-full" referrerPolicy="no-referrer" />
              ) : (
                <UserIcon size={16} className="text-slate-400" />
              )}
              <span className="text-xs font-medium text-slate-600">{user.displayName}</span>
            </div>
            <button 
              onClick={handleAnalyze}
              disabled={isAnalyzing || expenses.length === 0}
              className="flex items-center gap-2 bg-slate-900 text-white px-4 py-2 rounded-full text-sm font-medium hover:bg-slate-800 transition-all disabled:opacity-50"
            >
              {isAnalyzing ? <Sparkles className="animate-spin" size={16} /> : <Sparkles size={16} />}
              Analyze
            </button>
            <button 
              onClick={handleLogout}
              className="p-2 text-slate-400 hover:text-rose-500 transition-colors"
              title="Logout"
            >
              <LogOut size={20} />
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          
          {/* Left Column: Stats & Input */}
          <div className="lg:col-span-8 space-y-8">
            
            {/* Top Stats Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
                <div className="flex items-center justify-between mb-4">
                  <span className="text-sm font-medium text-slate-500 uppercase tracking-wider">Cash Balance</span>
                  <Wallet className="text-emerald-600" size={20} />
                </div>
                <div className="flex items-baseline gap-2">
                  <span className="text-3xl font-light">${cashBalance.toLocaleString()}</span>
                </div>
                <input 
                  type="range" 
                  min="0" 
                  max="200000" 
                  step="1000"
                  value={cashBalance}
                  onChange={(e) => updateProfile({ cashBalance: Number(e.target.value) })}
                  className="w-full mt-4 h-1.5 bg-slate-100 rounded-lg appearance-none cursor-pointer accent-emerald-600"
                />
              </div>

              <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
                <div className="flex items-center justify-between mb-4">
                  <span className="text-sm font-medium text-slate-500 uppercase tracking-wider">Monthly Burn</span>
                  <TrendingDown className={cn(stats.netBurn > 0 ? "text-rose-600" : "text-emerald-600")} size={20} />
                </div>
                <div className="flex items-baseline gap-2">
                  <span className="text-3xl font-light">${Math.abs(stats.netBurn).toLocaleString()}</span>
                  <span className="text-xs text-slate-400">/mo</span>
                </div>
                <div className="mt-4 flex items-center gap-2 text-xs">
                  <span className="text-slate-500">Revenue:</span>
                  <input 
                    type="number" 
                    value={monthlyRevenue}
                    onChange={(e) => updateProfile({ monthlyRevenue: Number(e.target.value) })}
                    className="w-24 bg-slate-50 border-none rounded px-2 py-1 focus:ring-1 focus:ring-emerald-500 outline-none"
                  />
                </div>
              </div>

              <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
                <div className="flex items-center justify-between mb-4">
                  <span className="text-sm font-medium text-slate-500 uppercase tracking-wider">Runway</span>
                  <Calendar className="text-blue-600" size={20} />
                </div>
                <div className="flex items-baseline gap-2">
                  <span className="text-3xl font-light">
                    {stats.runway === Infinity ? '∞' : stats.runway.toFixed(1)}
                  </span>
                  <span className="text-xs text-slate-400">months</span>
                </div>
                <div className="mt-4 w-full bg-slate-100 h-1.5 rounded-full overflow-hidden">
                  <div 
                    className={cn(
                      "h-full transition-all duration-500",
                      stats.runway < 3 ? "bg-rose-500" : stats.runway < 6 ? "bg-amber-500" : "bg-emerald-500"
                    )}
                    style={{ width: `${Math.min((stats.runway / 24) * 100, 100)}%` }}
                  />
                </div>
              </div>
            </div>

            {/* Charts Section */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
                <h3 className="text-sm font-semibold mb-6 flex items-center gap-2">
                  <PieChartIcon size={16} className="text-slate-400" />
                  Burn by Category
                </h3>
                <div className="h-[250px]">
                  {expenses.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={stats.categoryData}
                          cx="50%"
                          cy="50%"
                          innerRadius={60}
                          outerRadius={80}
                          paddingAngle={5}
                          dataKey="value"
                        >
                          {stats.categoryData.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip 
                          contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="h-full flex items-center justify-center text-slate-300 text-sm italic">No data to display</div>
                  )}
                </div>
              </div>

              <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
                <h3 className="text-sm font-semibold mb-6 flex items-center gap-2">
                  <TrendingUp size={16} className="text-slate-400" />
                  Burn vs Revenue
                </h3>
                <div className="h-[250px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={[
                      { name: 'Monthly', Revenue: monthlyRevenue, Expenses: stats.totalExpenses }
                    ]}>
                      <XAxis dataKey="name" hide />
                      <YAxis hide />
                      <Tooltip 
                        cursor={{fill: 'transparent'}}
                        contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
                      />
                      <Legend verticalAlign="top" align="right" iconType="circle" />
                      <Bar dataKey="Revenue" fill="#10b981" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="Expenses" fill="#f43f5e" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>

            {/* Expenses List */}
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
              <div className="p-6 border-b border-slate-100 flex items-center justify-between">
                <h3 className="font-semibold">Expenses Breakdown</h3>
                <button 
                  onClick={() => setShowAddExpense(!showAddExpense)}
                  className="text-emerald-600 hover:text-emerald-700 p-1 rounded-full hover:bg-emerald-50 transition-colors"
                >
                  <Plus size={20} />
                </button>
              </div>

              {showAddExpense && (
                <div className="p-6 bg-slate-50 border-b border-slate-100 animate-in fade-in slide-in-from-top-2 duration-200">
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <input 
                      placeholder="Description"
                      className="bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                      value={newExpense.description}
                      onChange={e => setNewExpense({...newExpense, description: e.target.value})}
                    />
                    <select 
                      className="bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                      value={newExpense.category}
                      onChange={e => setNewExpense({...newExpense, category: e.target.value})}
                    >
                      <option>SaaS</option>
                      <option>Marketing</option>
                      <option>Rent</option>
                      <option>Salaries</option>
                      <option>Other</option>
                    </select>
                    <div className="relative">
                      <DollarSign size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input 
                        type="number"
                        placeholder="Amount"
                        className="w-full bg-white border border-slate-200 rounded-lg pl-8 pr-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                        value={newExpense.amount || ''}
                        onChange={e => setNewExpense({...newExpense, amount: Number(e.target.value)})}
                      />
                    </div>
                    <button 
                      onClick={addExpense}
                      className="bg-emerald-600 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-emerald-700 transition-colors"
                    >
                      Add
                    </button>
                  </div>
                </div>
              )}

              <div className="divide-y divide-slate-100">
                {expenses.length > 0 ? expenses.map((expense) => (
                  <div key={expense.id} className="p-4 flex items-center justify-between hover:bg-slate-50 transition-colors group">
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center text-slate-500">
                        {expense.category === 'SaaS' ? <Sparkles size={18} /> : <PieChartIcon size={18} />}
                      </div>
                      <div>
                        <p className="text-sm font-medium">{expense.description}</p>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-slate-400">{expense.category}</span>
                          {expense.isSubscription && (
                            <span className="text-[10px] bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded uppercase font-bold tracking-wider">Sub</span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <span className="font-mono text-sm font-medium">${expense.amount.toLocaleString()}</span>
                      <button 
                        onClick={() => removeExpense(expense.id)}
                        className="text-slate-300 hover:text-rose-500 transition-colors opacity-0 group-hover:opacity-100"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                )) : (
                  <div className="p-12 text-center text-slate-400 text-sm italic">
                    No expenses added yet. Click the plus icon to start.
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Right Column: AI Agent */}
          <div className="lg:col-span-4 space-y-6">
            <div className="bg-slate-900 text-white rounded-3xl p-8 shadow-xl relative overflow-hidden">
              <div className="absolute top-0 right-0 p-4 opacity-10">
                <Sparkles size={120} />
              </div>
              
              <div className="relative z-10">
                <div className="flex items-center gap-3 mb-6">
                  <div className="w-10 h-10 bg-emerald-500 rounded-2xl flex items-center justify-center">
                    <MessageSquare size={20} />
                  </div>
                  <div>
                    <h2 className="font-semibold">BurnWise Agent</h2>
                    <p className="text-xs text-slate-400">AI Financial Advisor</p>
                  </div>
                </div>

                {isAnalyzing ? (
                  <div className="space-y-4 animate-pulse">
                    <div className="h-4 bg-slate-800 rounded w-3/4"></div>
                    <div className="h-4 bg-slate-800 rounded w-1/2"></div>
                    <div className="h-20 bg-slate-800 rounded w-full"></div>
                  </div>
                ) : analysis ? (
                  <div className="space-y-6 animate-in fade-in duration-700">
                    <div>
                      <p className="text-sm text-slate-300 leading-relaxed italic">
                        "{analysis.insights}"
                      </p>
                    </div>

                    <div className="space-y-3">
                      <h4 className="text-xs font-bold uppercase tracking-widest text-emerald-500">Recommendations</h4>
                      {analysis.suggestions.map((s, i) => (
                        <div key={i} className="flex gap-3 items-start group cursor-pointer">
                          <div className="mt-1 text-emerald-500">
                            <ChevronRight size={14} />
                          </div>
                          <p className="text-sm text-slate-200 group-hover:text-white transition-colors">{s}</p>
                        </div>
                      ))}
                    </div>

                    {stats.runway < 6 && (
                      <div className="bg-rose-500/10 border border-rose-500/20 p-4 rounded-xl flex gap-3">
                        <AlertCircle className="text-rose-500 shrink-0" size={18} />
                        <div>
                          <p className="text-xs font-bold text-rose-500 uppercase mb-1">Runway Alert</p>
                          <p className="text-xs text-rose-200">Your current burn rate puts you at risk in under 6 months. Consider immediate optimization.</p>
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-center py-12">
                    <p className="text-slate-400 text-sm">
                      {expenses.length > 0 
                        ? "Click 'Analyze' to get AI insights on your burn rate."
                        : "Add some expenses to start the analysis."}
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* Quick Tips */}
            <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm">
              <h4 className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-4">Burn Reduction Tips</h4>
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-emerald-50 flex items-center justify-center text-emerald-600">
                    <TrendingDown size={16} />
                  </div>
                  <p className="text-xs text-slate-600">Audit SaaS subscriptions monthly</p>
                </div>
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center text-blue-600">
                    <TrendingUp size={16} />
                  </div>
                  <p className="text-xs text-slate-600">Focus on high-margin revenue streams</p>
                </div>
              </div>
            </div>
          </div>

        </div>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <BurnWiseApp />
    </ErrorBoundary>
  );
}
