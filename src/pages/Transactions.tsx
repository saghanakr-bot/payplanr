import { useState, useEffect } from 'react';
import { User } from 'firebase/auth';
import { collection, query, where, orderBy, onSnapshot, deleteDoc, doc, getDoc, updateDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Transaction } from '../types/finance';
import { Trash2, ArrowUpRight, ArrowDownRight, Filter, Wallet, Landmark, Check, Loader2, Link as LinkIcon } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '../lib/utils';
import FinancialEntryDialog from '../components/FinancialEntryDialog';

// Transaction interface moved to src/types/finance.ts


export default function Transactions({ user }: { user: User }) {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [totalBalance, setTotalBalance] = useState<number | null>(null);
  const [clearingId, setClearingId] = useState<string | null>(null);

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

    const q = query(
      collection(db, 'transactions'),
      where('uid', '==', user.uid),
      orderBy('date', 'desc')
    );

    const unsubscribeTransactions = onSnapshot(q, (snapshot) => {
      const docs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Transaction));
      setTransactions(docs);
      setLoading(false);
    });

    return () => {
      unsubscribeUser();
      unsubscribeTransactions();
    };
  }, [user.uid]);

  const handleDelete = async (tx: Transaction) => {
    try {
      await deleteDoc(doc(db, 'transactions', tx.id));
      
      // Only update balance if the transaction was cleared
      if (tx.status === 'cleared') {
        const userRef = doc(db, 'users', user.uid);
        const userDoc = await getDoc(userRef);
        const currentBalance = userDoc.data()?.totalBalance || 0;
        
        let newBalance = currentBalance;
        if (tx.type === 'income' || tx.type === 'credit') newBalance -= tx.amount;
        else newBalance += tx.amount;

        await updateDoc(userRef, { totalBalance: newBalance });
        toast.success('Transaction deleted and balance adjusted');
      } else {
        toast.success('Pending transaction deleted');
      }
    } catch (error: any) {
      toast.error('Failed to delete: ' + error.message);
    }
  };

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
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Financial Overview</h1>
          <p className="text-muted-foreground">Manage your cash flow and track your bank balance.</p>
        </div>
        
        <FinancialEntryDialog user={user} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="bg-primary text-primary-foreground border-none shadow-lg">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium opacity-80">Total Bank Balance</CardTitle>
            <Landmark className="h-4 w-4 opacity-80" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">
              {totalBalance === null ? '...' : `₹${totalBalance.toLocaleString()}`}
            </div>
            <p className="text-xs mt-1 opacity-70">Updated from latest statement/entry</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Monthly Income</CardTitle>
            <ArrowUpRight className="h-4 w-4 text-emerald-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-emerald-600">
              ₹{transactions
                .filter(tx => (tx.type === 'income' || tx.type === 'credit') && new Date(tx.date).getMonth() === new Date().getMonth())
                .reduce((acc, tx) => acc + tx.amount, 0)
                .toLocaleString()}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Monthly Expenses</CardTitle>
            <ArrowDownRight className="h-4 w-4 text-rose-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-rose-600">
              ₹{transactions
                .filter(tx => (tx.type === 'expense' || tx.type === 'debit') && new Date(tx.date).getMonth() === new Date().getMonth())
                .reduce((acc, tx) => acc + tx.amount, 0)
                .toLocaleString()}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Recent Activity</CardTitle>
          <Button variant="outline" size="sm" className="gap-2">
            <Filter className="h-4 w-4" />
            Filter
          </Button>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Doc Type</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead className="w-[100px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-8">
                    <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent mx-auto"></div>
                  </TableCell>
                </TableRow>
              ) : transactions.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                    No transactions found.
                  </TableCell>
                </TableRow>
              ) : (
                transactions.map((tx) => (
                  <TableRow key={tx.id}>
                    <TableCell className="text-sm">
                      {new Date(tx.date).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="font-medium">{tx.category}</TableCell>
                    <TableCell className="text-xs">
                      <span className="bg-muted px-2 py-1 rounded capitalize">
                        {tx.documentType?.replace('_', ' ') || 'generic'}
                      </span>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{tx.description || '-'}</TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-1">
                        <span className={cn(
                          "px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider w-fit",
                          tx.status === 'cleared' || tx.status === 'paid' ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"
                        )}>
                          {tx.status}
                        </span>
                        {tx.invoiceId && (
                          <div className="flex items-center gap-1 text-[9px] text-blue-600 font-bold">
                            <LinkIcon className="h-2 w-2" />
                            MATCHED
                          </div>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className={cn(
                        "inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium",
                        (tx.type === 'income' || tx.type === 'credit') ? "bg-emerald-500/10 text-emerald-500" : "bg-destructive/10 text-destructive"
                      )}>
                        {(tx.type === 'income' || tx.type === 'credit') ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                        {tx.type.charAt(0).toUpperCase() + tx.type.slice(1)}
                      </span>
                    </TableCell>
                    <TableCell className={cn(
                      "text-right font-semibold",
                      (tx.type === 'income' || tx.type === 'credit') ? "text-emerald-500" : "text-destructive"
                    )}>
                      {(tx.type === 'income' || tx.type === 'credit') ? '+' : '-'}₹{tx.amount.toFixed(2)}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {tx.status === 'pending' && (
                          <Button 
                            variant="outline" 
                            size="sm" 
                            className="h-8 px-2 text-[10px] font-bold uppercase text-emerald-600 border-emerald-200 hover:bg-emerald-50 gap-1"
                            onClick={() => handleClear(tx)}
                            disabled={clearingId === tx.id}
                          >
                            {clearingId === tx.id ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <Check className="h-3 w-3" />
                            )}
                            Clear
                          </Button>
                        )}
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          className="h-8 w-8 text-muted-foreground hover:text-destructive"
                          onClick={() => handleDelete(tx)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
