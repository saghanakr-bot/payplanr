import { useState, useEffect } from 'react';
import { User } from 'firebase/auth';
import { collection, query, where, orderBy, limit, onSnapshot, doc, updateDoc, getDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Transaction } from '../types/finance';
import { 
  TrendingUp, 
  TrendingDown, 
  ArrowUpRight,
  ArrowDownRight,
  Plus,
  Wallet,
  BellOff,
  LineChart,
  Check,
  Loader2,
  ChevronLeft,
  ChevronRight,
  Calendar as CalendarIcon,
  Activity,
  ShieldCheck,
  AlertTriangle,
  Clock,
  Sparkles,
  X,
  Coins,
  Link as LinkIcon
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from '@/components/ui/select';
import { 
  Tabs, 
  TabsContent, 
  TabsList, 
  TabsTrigger 
} from '@/components/ui/tabs';
import { cn } from '../lib/utils';
import FinancialEntryDialog from '../components/FinancialEntryDialog';
import { toast } from 'sonner';
import { generateNegotiationMessage } from '../services/geminiService';
import { 
  format, 
  startOfMonth, 
  endOfMonth, 
  startOfWeek, 
  endOfWeek, 
  eachDayOfInterval, 
  isSameMonth, 
  isSameDay, 
  addMonths, 
  subMonths,
  isToday,
  differenceInDays
} from 'date-fns';

// Transaction interface moved to src/types/finance.ts


export default function Dashboard({ user }: { user: User }) {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [allTransactions, setAllTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [totalBalance, setTotalBalance] = useState<number | null>(null);
  const [clearingId, setClearingId] = useState<string | null>(null);
  const [currentDate, setCurrentDate] = useState(new Date());
  
  // Negotiation state
  const [negotiatingTx, setNegotiatingTx] = useState<Transaction | null>(null);
  const [negotiationMsg, setNegotiationMsg] = useState('');
  const [negotiationLang, setNegotiationLang] = useState<'English' | 'Tamil' | 'Hindi'>('English');
  const [negotiationTone, setNegotiationTone] = useState<'Informal' | 'Formal'>('Formal');
  const [generatingMsg, setGeneratingMsg] = useState(false);

  useEffect(() => {
    // Listen to user profile for balance
    const userRef = doc(db, 'users', user.uid);
    const unsubscribeUser = onSnapshot(userRef, (doc) => {
      if (doc.exists()) {
        setTotalBalance(doc.data().totalBalance ?? 0);
      } else {
        setTotalBalance(0);
      }
    });

    // Recent transactions for the list
    const qRecent = query(
      collection(db, 'transactions'),
      where('uid', '==', user.uid),
      orderBy('date', 'desc'),
      limit(5)
    );

    const unsubscribeRecent = onSnapshot(qRecent, (snapshot) => {
      const docs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Transaction));
      setTransactions(docs);
    });

    // All transactions for calculations
    const qAll = query(
      collection(db, 'transactions'),
      where('uid', '==', user.uid),
      orderBy('date', 'desc')
    );

    const unsubscribeAll = onSnapshot(qAll, (snapshot) => {
      const docs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Transaction));
      setAllTransactions(docs);
      setLoading(false);
    }, (error) => {
      console.error("Firestore Error:", error);
      setLoading(false);
    });

    return () => {
      unsubscribeRecent();
      unsubscribeAll();
      unsubscribeUser();
    };
  }, [user.uid]);

  // Monthly calculations (current month) - ONLY CLEARED
  const now = new Date();
  const currentMonth = now.getMonth();
  const currentYear = now.getFullYear();

  const clearedTransactions = allTransactions.filter(tx => tx.status === 'cleared');

  const monthlyIncome = clearedTransactions
    .filter(tx => {
      const d = new Date(tx.date);
      return (tx.type === 'income' || tx.type === 'credit') && d.getMonth() === currentMonth && d.getFullYear() === currentYear;
    })
    .reduce((sum, tx) => sum + tx.amount, 0);

  const monthlyExpenses = clearedTransactions
    .filter(tx => {
      const d = new Date(tx.date);
      return (tx.type === 'expense' || tx.type === 'debit') && d.getMonth() === currentMonth && d.getFullYear() === currentYear;
    })
    .reduce((sum, tx) => sum + tx.amount, 0);

  const netChange = monthlyIncome - monthlyExpenses;

  const pendingTransactions = allTransactions.filter(tx => tx.status === 'pending');

  // --- Smart Prioritization ---
  const getPriorityScore = (tx: Transaction) => {
    let score = 0;
    const daysUntilDue = differenceInDays(new Date(tx.date), new Date());
    
    if (daysUntilDue <= 0) score += 100;
    else if (daysUntilDue <= 3) score += 70;
    else if (daysUntilDue <= 7) score += 40;
    
    if (['Rent', 'Electricity', 'Utilities', 'Tax'].includes(tx.category)) score += 50;
    
    const relScores = { 'Strict': 60, 'Moderate': 40, 'Flexible': 20, 'Friendly': 0 };
    score += relScores[tx.relationshipType as keyof typeof relScores] || 0;
    
    return score;
  };

  const prioritizedPayments = pendingTransactions
    .filter(tx => tx.type === 'expense' || tx.type === 'debit')
    .map(tx => ({
      ...tx,
      priorityScore: getPriorityScore(tx),
      isFeasible: (totalBalance || 0) >= tx.amount
    }))
    .sort((a, b) => b.priorityScore - a.priorityScore);

  const handleGenerateNegotiation = async (tx: Transaction, lang: 'English' | 'Tamil' | 'Hindi', tone: 'Informal' | 'Formal' = 'Formal') => {
    setGeneratingMsg(true);
    setNegotiationLang(lang);
    setNegotiationTone(tone);
    try {
      const msg = await generateNegotiationMessage(
        tx.description || tx.category,
        tx.amount,
        new Date(tx.date).toLocaleDateString(),
        tx.relationshipType || 'Moderate',
        lang,
        tone
      );
      setNegotiationMsg(msg);
      setNegotiatingTx(tx);
    } catch (error: any) {
      toast.error('Failed to generate message: ' + error.message);
    } finally {
      setGeneratingMsg(false);
    }
  };

  const openWhatsApp = (msg: string) => {
    const encoded = encodeURIComponent(msg);
    window.open(`https://wa.me/?text=${encoded}`, '_blank');
  };

  const openEmail = (tx: Transaction, msg: string) => {
    const subject = encodeURIComponent(`Payment Request: ${tx.description}`);
    const body = encodeURIComponent(msg);
    window.open(`mailto:?subject=${subject}&body=${body}`, '_blank');
  };

  // --- Financial Analytics ---
  
  // 1. Health Score Components
  const totalUpcomingObligations = pendingTransactions
    .filter(tx => tx.type === 'expense' || tx.type === 'debit')
    .reduce((sum, tx) => sum + tx.amount, 0);
  
  const liquidityRatio = totalUpcomingObligations > 0 ? (totalBalance || 0) / totalUpcomingObligations : 10;
  
  // Liquidity Score (50%)
  let liquidityScore = 20;
  if (liquidityRatio >= 1) liquidityScore = 100;
  else if (liquidityRatio >= 0.5) liquidityScore = 50;
  else if (liquidityRatio >= 0.2) liquidityScore = 35;

  // Obligation Score (30%)
  const obligationRatio = totalUpcomingObligations / ((totalBalance || 0) + monthlyIncome + 1);
  let obligationScore = 10;
  if (obligationRatio < 0.1) obligationScore = 100;
  else if (obligationRatio < 0.3) obligationScore = 70;
  else if (obligationRatio < 0.5) obligationScore = 40;

  // Risk Score (20%)
  const overdueCount = pendingTransactions.filter(tx => new Date(tx.date) < now).length;
  let riskScore = 20;
  if (overdueCount === 0) riskScore = 100;
  else if (overdueCount <= 2) riskScore = 60;

  const healthScore = Math.round(
    (0.5 * liquidityScore) + 
    (0.3 * obligationScore) + 
    (0.2 * riskScore)
  );

  const getHealthLabel = (score: number) => {
    if (score >= 80) return { label: 'Healthy', color: 'text-emerald-500', bg: 'bg-emerald-50' };
    if (score >= 50) return { label: 'Moderate', color: 'text-amber-500', bg: 'bg-amber-50' };
    return { label: 'Risky', color: 'text-rose-500', bg: 'bg-rose-50' };
  };

  const healthInfo = getHealthLabel(healthScore);

  const hasData = clearedTransactions.length > 0;

  const handleClear = async (tx: Transaction) => {
    setClearingId(tx.id);
    try {
      const txRef = doc(db, 'transactions', tx.id);
      await updateDoc(txRef, { status: 'cleared' });

      // Update balance
      const userRef = doc(db, 'users', user.uid);
      const userDoc = await getDoc(userRef);
      const currentBalance = userDoc.data()?.totalBalance || 0;
      
      let newBalance = currentBalance;
      if (tx.type === 'income' || tx.type === 'credit') newBalance += tx.amount;
      else newBalance -= tx.amount;

      await updateDoc(userRef, { totalBalance: newBalance });
      
      toast.success('Transaction cleared and balance updated');
    } catch (error: any) {
      toast.error('Failed to clear: ' + error.message);
    } finally {
      setClearingId(null);
    }
  };

  return (
    <div className="space-y-8 pb-12">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-4xl font-bold tracking-tight text-[#00A86B]">Cash Flow Dashboard</h1>
          <p className="text-slate-500 mt-1">Monitor your business liquidity and upcoming commitments.</p>
        </div>
        <div className="flex items-center gap-3">
          <FinancialEntryDialog user={user} />
        </div>
      </div>

      {/* Top Cards */}
      <div className="grid gap-6 md:grid-cols-2">
        {/* Current Balance */}
        <Card className="bg-[#00A86B] text-white border-none shadow-xl relative overflow-hidden">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold opacity-90">Current Balance</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-4xl font-bold">
              ₹{totalBalance === null ? '0.00' : totalBalance.toLocaleString(undefined, { minimumFractionDigits: 2 })}
            </div>
            <p className="text-xs mt-2 opacity-80">
              {totalBalance === 0 ? 'No data synced' : 'Live balance from accounts'}
            </p>
            <Wallet className="absolute right-[-10px] bottom-[-10px] h-24 w-24 opacity-10 rotate-12" />
          </CardContent>
        </Card>

        {/* Health Score */}
        <Card className="bg-[#F0F4F8] border-none shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-semibold text-slate-500">Health Score</CardTitle>
            <ShieldCheck className={cn("h-4 w-4", healthInfo.color)} />
          </CardHeader>
          <CardContent>
            <div className="flex items-baseline gap-2">
              <div className={cn("text-3xl font-bold", healthInfo.color)}>
                {healthScore}/100
              </div>
              <div className={cn("text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider", healthInfo.bg, healthInfo.color)}>
                {healthInfo.label}
              </div>
            </div>
            <div className="w-full bg-slate-200 h-1.5 rounded-full mt-3 overflow-hidden">
              <div 
                className={cn("h-full transition-all duration-1000", 
                  healthScore >= 80 ? "bg-emerald-500" : healthScore >= 50 ? "bg-amber-500" : "bg-rose-500"
                )}
                style={{ width: `${healthScore}%` }}
              />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Main Content */}
      <div className="grid gap-8 md:grid-cols-12">
        {/* Calendar Section */}
        <div className="md:col-span-8 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-bold text-slate-900">Payment Calendar</h2>
              <p className="text-sm text-slate-500">Track upcoming bills and expected incomes.</p>
            </div>
            <div className="flex items-center gap-2 bg-white p-1 rounded-lg border border-slate-200">
              <Button 
                variant="ghost" 
                size="icon" 
                className="h-8 w-8" 
                onClick={() => setCurrentDate(subMonths(currentDate, 1))}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="text-sm font-bold px-2 min-w-[120px] text-center">
                {format(currentDate, 'MMMM yyyy')}
              </span>
              <Button 
                variant="ghost" 
                size="icon" 
                className="h-8 w-8" 
                onClick={() => setCurrentDate(addMonths(currentDate, 1))}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
          
          <Card className="border-slate-200 shadow-sm overflow-hidden">
            <div className="grid grid-cols-7 border-b border-slate-100 bg-slate-50/50">
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
                <div key={day} className="py-3 text-center text-[10px] font-bold uppercase tracking-widest text-slate-400">
                  {day}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7">
              {(() => {
                const monthStart = startOfMonth(currentDate);
                const monthEnd = endOfMonth(monthStart);
                const startDate = startOfWeek(monthStart);
                const endDate = endOfWeek(monthEnd);
                const calendarDays = eachDayOfInterval({ start: startDate, end: endDate });

                return calendarDays.map((day, i) => {
                  const dayTransactions = pendingTransactions.filter(tx => isSameDay(new Date(tx.date), day));
                  const hasIncome = dayTransactions.some(tx => tx.type === 'income');
                  const hasExpense = dayTransactions.some(tx => tx.type === 'expense');
                  const isCurrentMonth = isSameMonth(day, monthStart);

                  return (
                    <div 
                      key={day.toString()} 
                      className={cn(
                        "min-h-[80px] p-2 border-r border-b border-slate-100 transition-colors relative",
                        !isCurrentMonth && "bg-slate-50/30 text-slate-300",
                        isToday(day) && "bg-blue-50/30"
                      )}
                    >
                      <span className={cn(
                        "text-xs font-bold",
                        isToday(day) && "bg-blue-600 text-white h-6 w-6 rounded-full flex items-center justify-center -mt-1 -ml-1"
                      )}>
                        {format(day, 'd')}
                      </span>
                      
                      <div className="mt-2 space-y-1">
                        {dayTransactions.slice(0, 2).map((tx) => (
                          <div 
                            key={tx.id} 
                            className={cn(
                              "text-[9px] px-1.5 py-0.5 rounded-sm truncate font-medium",
                              tx.type === 'income' 
                                ? "bg-emerald-50 text-emerald-700 border border-emerald-100" 
                                : "bg-rose-50 text-rose-700 border border-rose-100"
                            )}
                          >
                            ₹{tx.amount.toLocaleString()}
                          </div>
                        ))}
                        {dayTransactions.length > 2 && (
                          <div className="text-[8px] text-slate-400 font-bold pl-1">
                            +{dayTransactions.length - 2} more
                          </div>
                        )}
                      </div>

                      {(hasIncome || hasExpense) && (
                        <div className="absolute bottom-1.5 right-1.5 flex gap-0.5">
                          {hasIncome && <div className="h-1 w-1 rounded-full bg-emerald-500" />}
                          {hasExpense && <div className="h-1 w-1 rounded-full bg-rose-500" />}
                        </div>
                      )}
                    </div>
                  );
                });
              })()}
            </div>
          </Card>
        </div>

        {/* Smart Prioritization & Negotiation */}
        <div className="md:col-span-4 space-y-6">
          <div className="space-y-1">
            <h2 className="text-2xl font-bold text-slate-900">Smart Prioritization</h2>
            <p className="text-sm text-slate-500">AI-driven payment strategy based on cash flow.</p>
          </div>

          <div className="space-y-4">
            {prioritizedPayments.length === 0 ? (
              <div className="flex flex-col items-center justify-center min-h-[200px] text-center p-8 space-y-4 bg-slate-50 rounded-xl border border-dashed border-slate-200">
                <div className="h-12 w-12 bg-white rounded-full flex items-center justify-center shadow-sm">
                  <BellOff className="h-6 w-6 text-slate-300" />
                </div>
                <p className="text-sm text-slate-400 font-medium">No pending payments to prioritize.</p>
              </div>
            ) : (
              prioritizedPayments.map((tx) => (
                <Card key={tx.id} className={cn(
                  "border-slate-100 shadow-sm overflow-hidden transition-all",
                  negotiatingTx?.id === tx.id && "ring-2 ring-primary border-transparent"
                )}>
                  <div className={cn(
                    "h-1.5 w-full",
                    tx.priorityScore >= 150 ? "bg-rose-500" : tx.priorityScore >= 100 ? "bg-amber-500" : "bg-blue-500"
                  )} />
                  <CardContent className="p-4 space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-bold text-slate-900 truncate max-w-[140px]">{tx.description}</p>
                          <span className={cn(
                            "text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider",
                            tx.priorityScore >= 150 ? "bg-rose-50 text-rose-600" : tx.priorityScore >= 100 ? "bg-amber-50 text-amber-600" : "bg-blue-50 text-blue-600"
                          )}>
                            {tx.priorityScore >= 150 ? 'Critical' : tx.priorityScore >= 100 ? 'High' : 'Normal'}
                          </span>
                        </div>
                        <p className="text-xs text-slate-500 flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          Due: {new Date(tx.date).toLocaleDateString()}
                        </p>
                        {tx.status === 'paid' && (
                          <div className="flex items-center gap-1 text-[9px] text-emerald-600 font-bold mt-1">
                            <Check className="h-2 w-2" />
                            MATCHED WITH BANK
                          </div>
                        )}
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-bold text-rose-600">₹{tx.amount.toLocaleString()}</p>
                        <p className="text-[10px] text-slate-400 font-bold uppercase">{tx.relationshipType || 'Moderate'}</p>
                      </div>
                    </div>

                    {!tx.isFeasible && (
                      <div className="p-3 bg-rose-50 rounded-lg border border-rose-100 space-y-2">
                        <div className="flex items-center gap-2 text-rose-700">
                          <AlertTriangle className="h-4 w-4" />
                          <span className="text-xs font-bold">Insufficient Funds</span>
                        </div>
                        <p className="text-[10px] text-rose-600">This payment will cause a cash shortage. Negotiation recommended.</p>
                        <div className="flex gap-2">
                          <Button 
                            size="sm" 
                            variant="outline" 
                            className="h-7 text-[10px] bg-white border-rose-200 text-rose-700 hover:bg-rose-100"
                            onClick={() => handleGenerateNegotiation(tx, 'English', 'Formal')}
                            disabled={generatingMsg && negotiatingTx?.id === tx.id}
                          >
                            {generatingMsg && negotiatingTx?.id === tx.id ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Sparkles className="h-3 w-3 mr-1" />}
                            Negotiate
                          </Button>
                        </div>
                      </div>
                    )}

                    <div className="flex items-center justify-between pt-2 border-t border-slate-50">
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                        Action: <span className={cn(tx.isFeasible ? "text-emerald-600" : "text-amber-600")}>
                          {tx.isFeasible ? 'Pay Now' : 'Negotiate Delay'}
                        </span>
                      </p>
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        className="h-8 w-8 rounded-full hover:bg-emerald-50 hover:text-emerald-600"
                        onClick={() => handleClear(tx)}
                        disabled={clearingId === tx.id}
                      >
                        {clearingId === tx.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </div>

          {/* Negotiation Card */}
          {negotiatingTx && (
            <Card className="border-primary/20 bg-primary/5 shadow-lg animate-in fade-in slide-in-from-bottom-4 duration-300">
              <CardHeader className="pb-2 flex flex-row items-center justify-between">
                <CardTitle className="text-sm font-bold flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-primary" />
                  Negotiation Assistant
                </CardTitle>
                <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setNegotiatingTx(null)}>
                  <X className="h-4 w-4" />
                </Button>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <p className="text-[10px] font-bold text-slate-500 uppercase">Language</p>
                    <Select 
                      value={negotiationLang} 
                      onValueChange={(v: any) => handleGenerateNegotiation(negotiatingTx, v, negotiationTone)}
                    >
                      <SelectTrigger className="h-7 w-full text-[10px] bg-white">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="English">English</SelectItem>
                        <SelectItem value="Tamil">Tamil</SelectItem>
                        <SelectItem value="Hindi">Hindi</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <p className="text-[10px] font-bold text-slate-500 uppercase">Tone</p>
                    <Select 
                      value={negotiationTone} 
                      onValueChange={(v: any) => handleGenerateNegotiation(negotiatingTx, negotiationLang, v)}
                    >
                      <SelectTrigger className="h-7 w-full text-[10px] bg-white">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Formal">Formal (Strict)</SelectItem>
                        <SelectItem value="Informal">Informal (Friend)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="p-3 bg-white rounded-lg border border-primary/10 text-xs text-slate-700 leading-relaxed italic relative">
                  {generatingMsg ? (
                    <div className="flex items-center justify-center py-4">
                      <Loader2 className="h-5 w-5 animate-spin text-primary" />
                    </div>
                  ) : (
                    negotiationMsg
                  )}
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <Button 
                    className="h-8 text-[10px] bg-[#25D366] hover:bg-[#128C7E] text-white border-none"
                    onClick={() => openWhatsApp(negotiationMsg)}
                  >
                    WhatsApp
                  </Button>
                  <Button 
                    className="h-8 text-[10px] bg-slate-800 hover:bg-slate-900 text-white border-none"
                    onClick={() => openEmail(negotiatingTx, negotiationMsg)}
                  >
                    Email
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
