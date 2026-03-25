import { useState, useEffect, ChangeEvent } from 'react';
import { User } from 'firebase/auth';
import { collection, query, where, orderBy, onSnapshot, addDoc, serverTimestamp, deleteDoc, doc, getDocs, updateDoc } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { db, storage } from '../lib/firebase';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { FileMetadata, Transaction } from '../types/finance';
import { scanInvoice, ScannedInvoice, scanBankStatement, ScannedBankStatement } from '../services/geminiService';
import { generateTransactionKey, isPotentialMatch } from '../lib/finance-utils';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Link as LinkIcon, AlertCircle, Info, Landmark, Loader2, Upload, File as FileIcon, Sparkles, ExternalLink, Trash2, Check, X } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '../lib/utils';

export default function Files({ user }: { user: User }) {
  const [files, setFiles] = useState<FileMetadata[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [scanningId, setScanningId] = useState<string | null>(null);
  const [selectedDocType, setSelectedDocType] = useState<'generic' | 'bank_statement' | 'customer_invoice' | 'supplier_invoice'>('generic');

  // Scan review state
  const [scannedData, setScannedData] = useState<ScannedInvoice | null>(null);
  const [isReviewOpen, setIsReviewOpen] = useState(false);
  const [savingScan, setSavingScan] = useState(false);

  // Bank statement review state
  const [bankData, setBankData] = useState<ScannedBankStatement | null>(null);
  const [isBankReviewOpen, setIsBankReviewOpen] = useState(false);

  useEffect(() => {
    const q = query(
      collection(db, 'files'),
      where('uid', '==', user.uid),
      orderBy('uploadedAt', 'desc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const docs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as FileMetadata));
      setFiles(docs);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [user.uid]);

  const handleUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    const storagePath = `users/${user.uid}/files/${Date.now()}_${file.name}`;
    const storageRef = ref(storage, storagePath);

    try {
      await uploadBytes(storageRef, file);
      const url = await getDownloadURL(storageRef);

      await addDoc(collection(db, 'files'), {
        uid: user.uid,
        fileName: file.name,
        fileUrl: url,
        fileType: file.type,
        fileSize: file.size,
        storagePath,
        documentType: selectedDocType,
        uploadedAt: new Date().toISOString(),
        createdAt: serverTimestamp()
      });

      toast.success('File uploaded successfully');
    } catch (error: any) {
      toast.error('Upload failed: ' + error.message);
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const handleScan = async (file: FileMetadata) => {
    setScanningId(file.id);
    try {
      // Fetch file as blob
      const response = await fetch(file.fileUrl);
      const blob = await response.blob();
      
      // Convert to base64
      const reader = new FileReader();
      const base64Promise = new Promise<string>((resolve) => {
        reader.onloadend = () => {
          const base64 = (reader.result as string).split(',')[1];
          resolve(base64);
        };
      });
      reader.readAsDataURL(blob);
      const base64 = await base64Promise;

      if (file.documentType === 'bank_statement') {
        const result = await scanBankStatement(base64, file.fileType);
        setBankData(result);
        setIsBankReviewOpen(true);
        toast.success('Bank statement scanned! Please review transactions.');
      } else {
        const result = await scanInvoice(base64, file.fileType);
        setScannedData(result);
        setIsReviewOpen(true);
        toast.success('Scan complete! Please review the details.');
      }
    } catch (error: any) {
      console.error("Scan error:", error);
      toast.error('Scan failed: ' + error.message);
    } finally {
      setScanningId(null);
    }
  };

  const handleSaveScannedTransaction = async () => {
    if (!scannedData) return;
    setSavingScan(true);
    try {
      const uniqueKey = generateTransactionKey(scannedData.date, scannedData.amount, scannedData.description);
      
      // Check for duplicates
      const q = query(
        collection(db, 'transactions'),
        where('uid', '==', user.uid),
        where('uniqueKey', '==', uniqueKey)
      );
      const existing = await getDocs(q);
      
      if (!existing.empty) {
        toast.error('This transaction already exists in your records.');
        setSavingScan(false);
        return;
      }

      await addDoc(collection(db, 'transactions'), {
        uid: user.uid,
        ...scannedData,
        uniqueKey,
        status: 'pending',
        createdAt: serverTimestamp()
      });
      toast.success('Transaction saved as pending.');
      setIsReviewOpen(false);
      setScannedData(null);
    } catch (error: any) {
      toast.error('Failed to save transaction: ' + error.message);
    } finally {
      setSavingScan(false);
    }
  };

  const handleSaveBankTransactions = async () => {
    if (!bankData) return;
    setSavingScan(true);
    let duplicates = 0;
    let matches = 0;

    try {
      // 1. Update user balance from statement
      const userRef = doc(db, 'users', user.uid);
      await updateDoc(userRef, { totalBalance: bankData.lastBalance });

      // 2. Process each transaction
      for (const tx of bankData.transactions) {
        const uniqueKey = generateTransactionKey(tx.date, tx.amount, tx.description);
        
        // Check for exact duplicate
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

        // Check for potential match with pending invoices
        const pendingQuery = query(
          collection(db, 'transactions'),
          where('uid', '==', user.uid),
          where('status', '==', 'pending')
        );
        const pendingSnap = await getDocs(pendingQuery);
        
        let matchedInvoiceId = null;
        for (const doc of pendingSnap.docs) {
          const invoice = doc.data() as Transaction;
          if (isPotentialMatch(tx, invoice)) {
            matchedInvoiceId = doc.id;
            // Update invoice status
            await updateDoc(doc.ref, {
              status: 'paid',
              transactionId: 'auto-linked-' + Date.now(), // Placeholder or real ID if we had it
              matchedAt: new Date().toISOString()
            });
            matches++;
            break;
          }
        }

        // Add the bank transaction
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
          invoiceId: matchedInvoiceId,
          createdAt: serverTimestamp()
        });
      }

      toast.success(`Processed ${bankData.transactions.length} transactions. ${matches} matched, ${duplicates} duplicates skipped.`);
      setIsBankReviewOpen(false);
      setBankData(null);
    } catch (error: any) {
      toast.error('Failed to process statement: ' + error.message);
    } finally {
      setSavingScan(false);
    }
  };

  const handleDelete = async (file: FileMetadata) => {
    try {
      // Delete from Storage
      const storageRef = ref(storage, file.storagePath);
      await deleteObject(storageRef);

      // Delete from Firestore
      await deleteDoc(doc(db, 'files', file.id));
      
      toast.success('File deleted');
    } catch (error: any) {
      toast.error('Failed to delete: ' + error.message);
    }
  };

  const formatSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Documents</h1>
          <p className="text-muted-foreground">Securely store and manage your financial documents.</p>
        </div>
        
        <div className="flex items-center gap-4">
          <div className="w-[200px]">
            <Select value={selectedDocType} onValueChange={(v: any) => setSelectedDocType(v)}>
              <SelectTrigger>
                <SelectValue placeholder="Document Type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="generic">Generic</SelectItem>
                <SelectItem value="bank_statement">Bank Statement</SelectItem>
                <SelectItem value="customer_invoice">Customer Invoice</SelectItem>
                <SelectItem value="supplier_invoice">Supplier Invoice</SelectItem>
              </SelectContent>
            </Select>
          </div>
          
          <div className="relative">
            <Input
              type="file"
              className="hidden"
              id="file-upload"
              onChange={handleUpload}
              disabled={uploading}
            />
            <Button asChild disabled={uploading}>
              <label htmlFor="file-upload" className="cursor-pointer gap-2">
                {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                {uploading ? 'Uploading...' : 'Upload Document'}
              </label>
            </Button>
          </div>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Your Files</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Doc Type</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Size</TableHead>
                <TableHead>Uploaded At</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8">
                    <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent mx-auto"></div>
                  </TableCell>
                </TableRow>
              ) : files.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                    No files uploaded yet.
                  </TableCell>
                </TableRow>
              ) : (
                files.map((file) => (
                  <TableRow key={file.id}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <div className="h-8 w-8 rounded bg-primary/10 flex items-center justify-center">
                          <FileIcon className="h-4 w-4 text-primary" />
                        </div>
                        <span className="font-medium max-w-[200px] truncate">{file.fileName}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-xs">
                      <span className="bg-muted px-2 py-1 rounded capitalize">
                        {file.documentType?.replace('_', ' ') || 'generic'}
                      </span>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground uppercase">
                      {file.fileType.split('/')[1] || 'unknown'}
                    </TableCell>
                    <TableCell className="text-sm">
                      {formatSize(file.fileSize)}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {new Date(file.uploadedAt).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          className="text-primary hover:bg-primary/10"
                          onClick={() => handleScan(file)}
                          disabled={!!scanningId}
                          title="Scan with AI"
                        >
                          {scanningId === file.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                        </Button>
                        <Button variant="ghost" size="icon" asChild>
                          <a href={file.fileUrl} target="_blank" rel="noreferrer">
                            <ExternalLink className="h-4 w-4" />
                          </a>
                        </Button>
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          className="text-muted-foreground hover:text-destructive"
                          onClick={() => handleDelete(file)}
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

      {/* Bank Review Dialog */}
      <Dialog open={isBankReviewOpen} onOpenChange={setIsBankReviewOpen}>
        <DialogContent className="sm:max-w-[600px] max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Landmark className="h-5 w-5 text-primary" />
              Bank Statement Summary
            </DialogTitle>
            <DialogDescription>
              We found {bankData?.transactions.length} transactions. Final balance: ₹{bankData?.lastBalance.toLocaleString()}
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            <Alert>
              <Info className="h-4 w-4" />
              <AlertTitle>Intelligent Matching</AlertTitle>
              <AlertDescription>
                We will automatically match these transactions with your pending invoices and skip any exact duplicates.
              </AlertDescription>
            </Alert>

            <div className="border rounded-md">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {bankData?.transactions.map((tx, i) => (
                    <TableRow key={i}>
                      <TableCell className="text-xs">{tx.date}</TableCell>
                      <TableCell className="text-xs truncate max-w-[200px]">{tx.description}</TableCell>
                      <TableCell className={cn(
                        "text-right text-xs font-medium",
                        tx.type === 'credit' ? "text-emerald-600" : "text-rose-600"
                      )}>
                        {tx.type === 'credit' ? '+' : '-'}₹{tx.amount.toLocaleString()}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsBankReviewOpen(false)} disabled={savingScan}>
              Cancel
            </Button>
            <Button onClick={handleSaveBankTransactions} disabled={savingScan}>
              {savingScan ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Check className="h-4 w-4 mr-2" />}
              Process & Match All
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Scan Review Dialog */}
      <Dialog open={isReviewOpen} onOpenChange={setIsReviewOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" />
              Review Scanned Data
            </DialogTitle>
          </DialogHeader>
          {scannedData && (
            <div className="space-y-4 py-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Amount</Label>
                  <Input 
                    type="number" 
                    value={scannedData.amount} 
                    onChange={(e) => setScannedData({...scannedData, amount: parseFloat(e.target.value)})}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Date</Label>
                  <Input 
                    type="date" 
                    value={scannedData.date} 
                    onChange={(e) => setScannedData({...scannedData, date: e.target.value})}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Category</Label>
                <Input 
                  value={scannedData.category} 
                  onChange={(e) => setScannedData({...scannedData, category: e.target.value})}
                />
              </div>
              <div className="space-y-2">
                <Label>Description</Label>
                <Input 
                  value={scannedData.description} 
                  onChange={(e) => setScannedData({...scannedData, description: e.target.value})}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Type</Label>
                  <Select 
                    value={scannedData.type} 
                    onValueChange={(v: any) => setScannedData({...scannedData, type: v})}
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
                    value={scannedData.documentType} 
                    onValueChange={(v: any) => setScannedData({...scannedData, documentType: v})}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="bank_statement">Bank Statement</SelectItem>
                      <SelectItem value="customer_invoice">Customer Invoice</SelectItem>
                      <SelectItem value="supplier_invoice">Supplier Invoice</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          )}
          <DialogFooter className="flex gap-2">
            <Button variant="outline" onClick={() => setIsReviewOpen(false)} disabled={savingScan}>
              <X className="h-4 w-4 mr-2" />
              Cancel
            </Button>
            <Button onClick={handleSaveScannedTransaction} disabled={savingScan}>
              {savingScan ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Check className="h-4 w-4 mr-2" />}
              Save Transaction
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
