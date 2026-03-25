import { useState, useEffect } from 'react';
import { User } from 'firebase/auth';
import { collection, query, where, orderBy, onSnapshot, doc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import CashFlowForecast from '../components/CashFlowForecast';
import { Loader2, TrendingUp } from 'lucide-react';

interface Transaction {
  id: string;
  amount: number;
  category: string;
  description: string;
  date: string;
  type: 'income' | 'expense' | 'credit' | 'debit';
  status: 'pending' | 'cleared';
  documentType?: string;
  relationshipType?: 'Strict' | 'Moderate' | 'Flexible' | 'Friendly';
}

export default function Investments({ user }: { user: User }) {
  const [allTransactions, setAllTransactions] = useState<Transaction[]>([]);
  const [totalBalance, setTotalBalance] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

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
      unsubscribeAll();
      unsubscribeUser();
    };
  }, [user.uid]);

  if (loading) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900">Investment Strategy</h1>
          <p className="text-slate-500">AI-powered forecasting and investment planning based on your cash flow.</p>
        </div>
        <div className="h-12 w-12 rounded-2xl bg-primary/10 flex items-center justify-center">
          <TrendingUp className="h-6 w-6 text-primary" />
        </div>
      </div>

      <CashFlowForecast transactions={allTransactions} currentBalance={totalBalance || 0} />
    </div>
  );
}
