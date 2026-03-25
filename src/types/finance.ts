export interface Transaction {
  id: string;
  uid: string;
  amount: number;
  category: string;
  description: string;
  date: string;
  type: 'income' | 'expense' | 'credit' | 'debit';
  status: 'pending' | 'cleared' | 'paid' | 'partially paid';
  documentType?: 'generic' | 'bank_statement' | 'customer_invoice' | 'supplier_invoice';
  relationshipType?: 'Strict' | 'Moderate' | 'Flexible' | 'Friendly';
  uniqueKey?: string;
  invoiceId?: string;
  transactionId?: string;
  isDuplicate?: boolean;
  matchedAt?: string;
  createdAt?: any;
}

export interface FileMetadata {
  id: string;
  uid: string;
  fileName: string;
  fileUrl: string;
  fileType: string;
  fileSize: number;
  uploadedAt: string;
  storagePath: string;
  documentType?: 'generic' | 'bank_statement' | 'customer_invoice' | 'supplier_invoice';
}
