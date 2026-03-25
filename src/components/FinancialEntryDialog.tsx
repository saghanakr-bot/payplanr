import React, { useState, useRef } from 'react';
import { User } from 'firebase/auth';
import { collection, addDoc, serverTimestamp, doc, updateDoc, getDoc, query, where, getDocs } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { db, storage } from '../lib/firebase';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Plus, FileText, TrendingUp, TrendingDown, Keyboard, Landmark, Loader2, Sparkles, Check, X, AlertCircle, Info, Link as LinkIcon } from 'lucide-react';
import { toast } from 'sonner';
import { scanInvoice, scanBankStatement, ScannedInvoice, ScannedBankStatement } from '../services/geminiService';
import { generateTransactionKey, isPotentialMatch } from '../lib/finance-utils';
import { Transaction } from '../types/finance';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { cn } from '../lib/utils';

interface FinancialEntryDialogProps {
  user: User;
  onSuccess?: () => void;
}

export default function FinancialEntryDialog({ user, onSuccess }: FinancialEntryDialogProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [scanMode, setScanMode] = useState<'income' | 'bill' | 'statement' | null>(null);

  // Scan review state
  const [scannedInvoice, setScannedInvoice] = useState<ScannedInvoice | null>(null);
  const [scannedStatement, setScannedStatement] = useState<ScannedBankStatement | null>(null);
  const [isReviewOpen, setIsReviewOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  // Manual entry state
  const [manualMode, setManualMode] = useState<'transaction' | 'balance' | null>(null);
  const [manualAmount, setManualAmount] = useState('');
  const [manualCategory, setManualCategory] = useState('');
  const [manualDesc, setManualDesc] = useState('');
  const [manualType, setManualType] = useState<'income' | 'expense'>('expense');
  const [manualDate, setManualDate] = useState(new Date().toISOString().split('T')[0]);
  const [manualRelationship, setManualRelationship] = useState<'Strict' | 'Moderate' | 'Flexible' | 'Friendly'>('Moderate');

  // Duplicate warning state
  const [duplicateWarning, setDuplicateWarning] = useState<{
    type: 'exact' | 'potential';
    existingTx: Transaction;
    onConfirm: () => void;
  } | null>(null);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !scanMode) return;

    setLoading(true);
    try {
      // 1. Upload to Storage as requested
      const storageRef = ref(storage, `users/${user.uid}/documents/${Date.now()}_${file.name}`);
      await uploadBytes(storageRef, file);
      const downloadUrl = await getDownloadURL(storageRef);

      // Save metadata to Firestore
      await addDoc(collection(db, 'files'), {
        uid: user.uid,
        fileName: file.name,
        fileUrl: downloadUrl,
        fileType: file.type,
        fileSize: file.size,
        documentType: scanMode === 'statement' ? 'bank_statement' : (scanMode === 'income' ? 'customer_invoice' : 'supplier_invoice'),
        uploadedAt: serverTimestamp()
      });

      const reader = new FileReader();
      const base64Promise = new Promise<string>((resolve) => {
        reader.onloadend = () => {
          const base64 = (reader.result as string).split(',')[1];
          resolve(base64);
        };
      });
      reader.readAsDataURL(file);
      const base64 = await base64Promise;

      if (scanMode === 'statement') {
        const result = await scanBankStatement(base64, file.type);
        setScannedStatement(result);
      } else {
        const result = await scanInvoice(base64, file.type, scanMode === 'income' ? 'income' : 'expense');
        setScannedInvoice(result);
      }
      setIsReviewOpen(true);
      setIsOpen(false);
    } catch (error: any) {
      toast.error('Processing failed: ' + error.message);
    } finally {
      setLoading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const updateBalance = async (amount: number, type: 'income' | 'expense' | 'credit' | 'debit' | 'set') => {
    const userRef = doc(db, 'users', user.uid);
    const userDoc = await getDoc(userRef);
    const currentBalance = userDoc.data()?.totalBalance || 0;
    
    let newBalance = currentBalance;
    if (type === 'income' || type === 'credit') newBalance += amount;
    else if (type === 'expense' || type === 'debit') newBalance -= amount;
    else if (type === 'set') newBalance = amount;

    await updateDoc(userRef, { totalBalance: newBalance });
  };

  const saveInvoice = async (force = false) => {
    if (!scannedInvoice) return;
    setSaving(true);
    try {
      const uniqueKey = generateTransactionKey(scannedInvoice.date, scannedInvoice.amount, scannedInvoice.description);
      
      if (!force) {
        // Check for exact duplicate
        const dupQuery = query(
          collection(db, 'transactions'),
          where('uid', '==', user.uid),
          where('uniqueKey', '==', uniqueKey)
        );
        const dupSnap = await getDocs(dupQuery);
        
        if (!dupSnap.empty) {
          setDuplicateWarning({
            type: 'exact',
            existingTx: { id: dupSnap.docs[0].id, ...dupSnap.docs[0].data() } as Transaction,
            onConfirm: () => saveInvoice(true)
          });
          setSaving(false);
          return;
        }

        // Check for potential match
        const allQuery = query(collection(db, 'transactions'), where('uid', '==', user.uid));
        const allSnap = await getDocs(allQuery);
        const potential = allSnap.docs.find(d => isPotentialMatch(scannedInvoice, d.data() as Transaction));
        
        if (potential) {
          setDuplicateWarning({
            type: 'potential',
            existingTx: { id: potential.id, ...potential.data() } as Transaction,
            onConfirm: () => saveInvoice(true)
          });
          setSaving(false);
          return;
        }
      }

      await addDoc(collection(db, 'transactions'), {
        uid: user.uid,
        ...scannedInvoice,
        uniqueKey,
        status: 'pending',
        createdAt: serverTimestamp()
      });
      toast.success('Transaction saved as pending.');
      setIsReviewOpen(false);
      setScannedInvoice(null);
      setDuplicateWarning(null);
      onSuccess?.();
    } catch (error: any) {
      toast.error('Save failed: ' + error.message);
    } finally {
      setSaving(false);
    }
  };

  const saveStatement = async () => {
    if (!scannedStatement) return;
    setSaving(true);
    let duplicates = 0;
    let matches = 0;

    try {
      // 1. Update balance
      await updateBalance(scannedStatement.lastBalance, 'set');

      // 2. Process transactions
      for (const tx of scannedStatement.transactions) {
        const uniqueKey = generateTransactionKey(tx.date, tx.amount, tx.description);
        
        // Exact duplicate check
        const dupQuery = query(
          collection(db, 'transactions'),
          where('uid', '==', user.uid),
          where('uniqueKey', '==', uniqueKey)
        );
        const dupSnap = await getDocs(dupQuery);
        if (!dupSnap.empty) {
          duplicates++;
          continue;
        }

        // Match with pending invoices
        const pendingQuery = query(
          collection(db, 'transactions'),
          where('uid', '==', user.uid),
          where('status', '==', 'pending')
        );
        const pendingSnap = await getDocs(pendingQuery);
        let matchedId = null;
        
        for (const d of pendingSnap.docs) {
          if (isPotentialMatch(tx, d.data() as Transaction)) {
            matchedId = d.id;
            await updateDoc(d.ref, {
              status: 'paid',
              transactionId: 'auto-' + Date.now(),
              matchedAt: new Date().toISOString()
            });
            matches++;
            break;
          }
        }

        await addDoc(collection(db, 'transactions'), {
          uid: user.uid,
          amount: tx.amount,
          date: tx.date,
          description: tx.description,
          type: tx.type,
          category: tx.category,
          status: 'cleared',
          documentType: 'bank_statement',
          uniqueKey,
          invoiceId: matchedId,
          createdAt: serverTimestamp()
        });
      }

      toast.success(`Statement synced! ${matches} matched, ${duplicates} duplicates skipped.`);
      setIsReviewOpen(false);
      setScannedStatement(null);
      onSuccess?.();
    } catch (error: any) {
      toast.error('Sync failed: ' + error.message);
    } finally {
      setSaving(false);
    }
  };

  const saveManual = async (force = false) => {
    setSaving(true);
    try {
      if (manualMode === 'transaction') {
        const amount = parseFloat(manualAmount);
        const date = new Date(manualDate).toISOString();
        const uniqueKey = generateTransactionKey(date, amount, manualDesc);

        if (!force) {
          // Check for exact duplicate
          const dupQuery = query(
            collection(db, 'transactions'),
            where('uid', '==', user.uid),
            where('uniqueKey', '==', uniqueKey)
          );
          const dupSnap = await getDocs(dupQuery);
          
          if (!dupSnap.empty) {
            setDuplicateWarning({
              type: 'exact',
              existingTx: { id: dupSnap.docs[0].id, ...dupSnap.docs[0].data() } as Transaction,
              onConfirm: () => saveManual(true)
            });
            setSaving(false);
            return;
          }

          // Check for potential match
          const allQuery = query(collection(db, 'transactions'), where('uid', '==', user.uid));
          const allSnap = await getDocs(allQuery);
          const potential = allSnap.docs.find(d => isPotentialMatch({ amount, date, description: manualDesc }, d.data() as Transaction));
          
          if (potential) {
            setDuplicateWarning({
              type: 'potential',
              existingTx: { id: potential.id, ...potential.data() } as Transaction,
              onConfirm: () => saveManual(true)
            });
            setSaving(false);
            return;
          }
        }

        await addDoc(collection(db, 'transactions'), {
          uid: user.uid,
          amount,
          category: manualCategory,
          description: manualDesc,
          type: manualType,
          date,
          relationshipType: manualType === 'expense' ? manualRelationship : null,
          documentType: 'generic',
          status: 'pending',
          uniqueKey,
          createdAt: serverTimestamp()
        });
        toast.success('Transaction saved as pending');
      } else {
        const amount = parseFloat(manualAmount);
        await updateBalance(amount, 'set');
        toast.success('Balance updated manually');
      }
      setManualMode(null);
      setManualAmount('');
      setManualCategory('');
      setManualDesc('');
      setDuplicateWarning(null);
      onSuccess?.();
    } catch (error: any) {
      toast.error('Save failed: ' + error.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogTrigger asChild>
          <Button className="gap-2 bg-primary hover:bg-primary/90">
            <Plus className="h-4 w-4" />
            New Transaction
          </Button>
        </DialogTrigger>
        <DialogContent className="sm:max-w-[500px] p-0 overflow-hidden border-none bg-slate-50">
          <div className="p-8 space-y-6">
            <div className="space-y-1">
              <DialogTitle className="text-2xl font-bold text-slate-900">New Financial Entry</DialogTitle>
              <p className="text-slate-500">Scan documents or enter details manually to track your cash flow.</p>
            </div>

            <div className="space-y-4">
              {/* Sync Bank Statement */}
              <button 
                onClick={() => { setScanMode('statement'); fileInputRef.current?.click(); }}
                disabled={loading}
                className="w-full flex items-center gap-4 p-4 bg-white rounded-2xl border border-slate-200 hover:border-blue-500 hover:shadow-md transition-all group text-left"
              >
                <div className="h-12 w-12 rounded-xl bg-blue-50 flex items-center justify-center group-hover:bg-blue-100 transition-colors">
                  <FileText className="h-6 w-6 text-blue-600" />
                </div>
                <div className="flex-1">
                  <h3 className="font-bold text-blue-900">Upload Bank Statement</h3>
                  <p className="text-xs font-semibold text-blue-500 uppercase tracking-wider">PDF or CSV • Auto-extract expenses</p>
                </div>
              </button>

              <div className="grid grid-cols-2 gap-4">
                {/* Scan Income */}
                <button 
                  onClick={() => { setScanMode('income'); fileInputRef.current?.click(); }}
                  disabled={loading}
                  className="flex flex-col gap-3 p-4 bg-white rounded-2xl border border-slate-200 hover:border-emerald-500 hover:shadow-md transition-all group text-left"
                >
                  <div className="h-10 w-10 rounded-xl bg-emerald-50 flex items-center justify-center group-hover:bg-emerald-100 transition-colors">
                    <TrendingUp className="h-5 w-5 text-emerald-600" />
                  </div>
                  <div>
                    <h3 className="font-bold text-emerald-900">Scan Income</h3>
                    <p className="text-xs font-semibold text-emerald-500 uppercase tracking-wider">Customer Invoice</p>
                  </div>
                </button>

                {/* Scan Bill */}
                <button 
                  onClick={() => { setScanMode('bill'); fileInputRef.current?.click(); }}
                  disabled={loading}
                  className="flex flex-col gap-3 p-4 bg-white rounded-2xl border border-slate-200 hover:border-rose-500 hover:shadow-md transition-all group text-left"
                >
                  <div className="h-10 w-10 rounded-xl bg-rose-50 flex items-center justify-center group-hover:bg-rose-100 transition-colors">
                    <TrendingDown className="h-5 w-5 text-rose-600" />
                  </div>
                  <div>
                    <h3 className="font-bold text-rose-900">Scan Bill</h3>
                    <p className="text-xs font-semibold text-rose-500 uppercase tracking-wider">Supplier Invoice</p>
                  </div>
                </button>
              </div>

              <div className="relative py-4">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t border-slate-200" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-slate-50 px-4 text-slate-400 font-bold tracking-widest">Or Manual</span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <button 
                  onClick={() => setManualMode('transaction')}
                  className="flex items-center justify-center gap-2 p-4 bg-white rounded-2xl border border-slate-200 hover:bg-slate-50 transition-colors text-slate-600 font-semibold"
                >
                  <Keyboard className="h-4 w-4" />
                  Transaction
                </button>
                <button 
                  onClick={() => setManualMode('balance')}
                  className="flex items-center justify-center gap-2 p-4 bg-white rounded-2xl border border-slate-200 hover:bg-slate-50 transition-colors text-slate-600 font-semibold"
                >
                  <Landmark className="h-4 w-4" />
                  Bank Balance
                </button>
              </div>
            </div>
          </div>
          {loading && (
            <div className="absolute inset-0 bg-white/80 backdrop-blur-sm flex flex-col items-center justify-center gap-4 z-50">
              <Loader2 className="h-8 w-8 text-primary animate-spin" />
              <p className="font-bold text-slate-900">Analyzing document...</p>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <input 
        type="file" 
        ref={fileInputRef} 
        onChange={handleFileSelect} 
        className="hidden" 
        accept="image/*,application/pdf"
      />

      {/* Review Dialogs */}
      <Dialog open={isReviewOpen} onOpenChange={setIsReviewOpen}>
        <DialogContent className="sm:max-w-[450px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" />
              {scannedStatement ? 'Sync Bank Statement' : 'Review Scanned Invoice'}
            </DialogTitle>
          </DialogHeader>
          
          {scannedInvoice && (
            <div className="space-y-4 py-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Amount</Label>
                  <Input 
                    type="number" 
                    value={scannedInvoice.amount} 
                    onChange={(e) => setScannedInvoice({...scannedInvoice, amount: parseFloat(e.target.value)})}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Date</Label>
                  <Input 
                    type="date" 
                    value={scannedInvoice.date} 
                    onChange={(e) => setScannedInvoice({...scannedInvoice, date: e.target.value})}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Category</Label>
                <Input 
                  value={scannedInvoice.category} 
                  onChange={(e) => setScannedInvoice({...scannedInvoice, category: e.target.value})}
                />
              </div>
              <div className="space-y-2">
                <Label>Description</Label>
                <Input 
                  value={scannedInvoice.description} 
                  onChange={(e) => setScannedInvoice({...scannedInvoice, description: e.target.value})}
                />
              </div>
              {scannedInvoice.type === 'expense' && (
                <div className="space-y-2">
                  <Label>Relationship Type</Label>
                  <Select 
                    value={scannedInvoice.relationshipType || 'Moderate'} 
                    onValueChange={(v: any) => setScannedInvoice({...scannedInvoice, relationshipType: v})}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Strict">Strict (No delay)</SelectItem>
                      <SelectItem value="Moderate">Moderate (Slight delay)</SelectItem>
                      <SelectItem value="Flexible">Flexible (Can negotiate)</SelectItem>
                      <SelectItem value="Friendly">Friendly (Partial allowed)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Type</Label>
                  <Select 
                    value={scannedInvoice.type} 
                    onValueChange={(v: any) => setScannedInvoice({...scannedInvoice, type: v})}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="income">Income</SelectItem>
                      <SelectItem value="expense">Expense</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Doc Type</Label>
                  <Select 
                    value={scannedInvoice.documentType} 
                    onValueChange={(v: any) => setScannedInvoice({...scannedInvoice, documentType: v})}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="customer_invoice">Customer Invoice</SelectItem>
                      <SelectItem value="supplier_invoice">Supplier Invoice</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <Button onClick={saveInvoice} className="w-full" disabled={saving}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Check className="h-4 w-4 mr-2" />}
                Confirm & Save
              </Button>
            </div>
          )}

          {scannedStatement && (
            <div className="space-y-4 py-4">
              <div className="p-4 bg-blue-50 rounded-xl border border-blue-100">
                <Label className="text-blue-900">Extracted Final Balance</Label>
                <div className="text-3xl font-bold text-blue-600">₹{scannedStatement.lastBalance.toLocaleString()}</div>
                <p className="text-xs text-blue-500 mt-1">This will update your total bank balance.</p>
              </div>

              {/* Calculated Insights */}
              <div className="grid grid-cols-1 gap-4">
                <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                  <Label className="text-slate-500 text-[10px] uppercase font-bold">Monthly Expenses (Extracted)</Label>
                  <div className="text-lg font-bold text-rose-600">
                    ₹{scannedStatement.transactions
                      .filter(tx => tx.type === 'debit')
                      .reduce((sum, tx) => sum + tx.amount, 0)
                      .toLocaleString()}
                  </div>
                </div>
              </div>

              {scannedStatement.transactions.filter(tx => tx.type === 'debit').length === 0 && (
                <p className="text-xs text-amber-600 font-medium text-center">No expense data available</p>
              )}

              <div className="space-y-2">
                <Label>Transactions Found ({scannedStatement.transactions.length})</Label>
                <div className="max-h-[200px] overflow-y-auto space-y-2 pr-2">
                  {scannedStatement.transactions.map((tx, i) => (
                    <div key={i} className="text-xs p-2 bg-slate-50 rounded border border-slate-100 flex justify-between items-center">
                      <div className="truncate flex-1 mr-2">
                        <div className="font-bold truncate">{tx.description}</div>
                        <div className="text-slate-400">{tx.date}</div>
                      </div>
                      <div className={tx.type === 'credit' ? 'text-emerald-600 font-bold' : 'text-rose-600 font-bold'}>
                        {tx.type === 'credit' ? '+' : '-'}₹{tx.amount.toLocaleString()}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <Button onClick={saveStatement} className="w-full" disabled={saving}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Check className="h-4 w-4 mr-2" />}
                Sync Statement & Update Balance
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Manual Entry Dialog */}
      <Dialog open={!!manualMode} onOpenChange={(open) => !open && setManualMode(null)}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>
              {manualMode === 'transaction' ? 'Manual Transaction' : 'Update Bank Balance'}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Amount</Label>
              <Input 
                type="number" 
                placeholder="0.00" 
                value={manualAmount}
                onChange={(e) => setManualAmount(e.target.value)}
              />
            </div>
            
            {manualMode === 'transaction' && (
              <>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Type</Label>
                    <Select value={manualType} onValueChange={(v: any) => setManualType(v)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="income">Income</SelectItem>
                        <SelectItem value="expense">Expense</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Date</Label>
                    <Input type="date" value={manualDate} onChange={(e) => setManualDate(e.target.value)} />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Category</Label>
                  <Input placeholder="e.g. Rent, Salary" value={manualCategory} onChange={(e) => setManualCategory(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Description</Label>
                  <Input placeholder="Optional details" value={manualDesc} onChange={(e) => setManualDesc(e.target.value)} />
                </div>
                {manualType === 'expense' && (
                  <div className="space-y-2">
                    <Label>Relationship Type</Label>
                    <Select value={manualRelationship} onValueChange={(v: any) => setManualRelationship(v)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Strict">Strict (No delay)</SelectItem>
                        <SelectItem value="Moderate">Moderate (Slight delay)</SelectItem>
                        <SelectItem value="Flexible">Flexible (Can negotiate)</SelectItem>
                        <SelectItem value="Friendly">Friendly (Partial allowed)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </>
            )}

            <Button onClick={saveManual} className="w-full" disabled={saving || !manualAmount}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Check className="h-4 w-4 mr-2" />}
              {manualMode === 'transaction' ? 'Save Transaction' : 'Update Balance'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      {/* Duplicate Warning Dialog */}
      <Dialog open={!!duplicateWarning} onOpenChange={(open) => !open && setDuplicateWarning(null)}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-amber-600">
              <AlertCircle className="h-5 w-5" />
              {duplicateWarning?.type === 'exact' ? 'Duplicate Detected' : 'Potential Match Found'}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <Alert variant={duplicateWarning?.type === 'exact' ? 'destructive' : 'default'}>
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>{duplicateWarning?.type === 'exact' ? 'Exact Duplicate' : 'Similar Record'}</AlertTitle>
              <AlertDescription>
                {duplicateWarning?.type === 'exact' 
                  ? 'A transaction with the same date, amount, and description already exists.'
                  : 'A similar transaction was found in your records. It might be already paid or recorded.'}
              </AlertDescription>
            </Alert>

            {duplicateWarning?.existingTx && (
              <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 text-sm space-y-1">
                <div className="flex justify-between">
                  <span className="text-slate-500">Existing Record:</span>
                  <span className="font-bold">₹{duplicateWarning.existingTx.amount.toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Date:</span>
                  <span>{new Date(duplicateWarning.existingTx.date).toLocaleDateString()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Status:</span>
                  <Badge variant="outline" className="text-[10px] uppercase">{duplicateWarning.existingTx.status}</Badge>
                </div>
                <div className="text-slate-400 text-[10px] truncate mt-2">
                  {duplicateWarning.existingTx.description}
                </div>
              </div>
            )}

            <div className="flex flex-col gap-2">
              <Button variant="outline" onClick={() => setDuplicateWarning(null)}>
                Cancel & Review
              </Button>
              <Button 
                variant={duplicateWarning?.type === 'exact' ? 'destructive' : 'default'}
                onClick={() => duplicateWarning?.onConfirm()}
              >
                Save Anyway
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
