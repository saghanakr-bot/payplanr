import { GoogleGenAI, Type } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

export interface ScannedInvoice {
  amount: number;
  date: string;
  category: string;
  description: string;
  type: 'income' | 'expense';
  documentType: 'customer_invoice' | 'supplier_invoice';
  relationshipType?: 'Strict' | 'Moderate' | 'Flexible' | 'Friendly';
}

export interface ScannedBankStatement {
  lastBalance: number;
  date: string;
  transactions: {
    amount: number;
    date: string;
    description: string;
    type: 'credit' | 'debit';
    category: string;
  }[];
}

export async function scanInvoice(base64Data: string, mimeType: string, forcedType?: 'income' | 'expense'): Promise<ScannedInvoice> {
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: [
      {
        inlineData: {
          data: base64Data,
          mimeType: mimeType,
        },
      },
      {
        text: `Extract financial information from this invoice or document. 
        Return a JSON object with the following fields:
        - amount (number)
        - date (string, ISO format YYYY-MM-DD)
        - category (string, e.g., Food, Rent, Utilities, Salary)
        - description (string, brief summary)
        - type (string, either 'income' or 'expense')
        - documentType (string, one of: 'customer_invoice', 'supplier_invoice')
        
        ${forcedType ? `NOTE: This is definitely an ${forcedType}.` : ""}
        If it's a bill or receipt you paid, it's an 'expense' and 'supplier_invoice'.
        If it's an invoice you sent to a customer, it's 'income' and 'customer_invoice'.
        
        Be as accurate as possible, especially with the amount and date.`,
      },
    ],
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          amount: { type: Type.NUMBER },
          date: { type: Type.STRING },
          category: { type: Type.STRING },
          description: { type: Type.STRING },
          type: { type: Type.STRING, enum: ['income', 'expense'] },
          documentType: { type: Type.STRING, enum: ['customer_invoice', 'supplier_invoice'] },
        },
        required: ["amount", "date", "category", "type", "documentType"],
      },
    },
  });

  const text = response.text;
  if (!text) throw new Error("No response from AI");
  return JSON.parse(text) as ScannedInvoice;
}

export async function scanBankStatement(base64Data: string, mimeType: string): Promise<ScannedBankStatement> {
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: [
      {
        inlineData: {
          data: base64Data,
          mimeType: mimeType,
        },
      },
      {
        text: `Extract the final balance (last balance) and transactions from this bank statement.
        Return a JSON object with:
        - lastBalance (number, the final balance shown on the statement)
        - date (string, the date of the statement)
        - transactions (array of objects with amount, date, description, type, category)
        
        The 'type' field MUST be either 'credit' or 'debit'.
        - 'debit' for money going OUT (expenses)
        - 'credit' for money coming IN (income)
        
        Ensure the lastBalance is the most recent balance value found in the document.`,
      },
    ],
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          lastBalance: { type: Type.NUMBER },
          date: { type: Type.STRING },
          transactions: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                amount: { type: Type.NUMBER },
                date: { type: Type.STRING },
                description: { type: Type.STRING },
                type: { type: Type.STRING, enum: ['credit', 'debit'] },
                category: { type: Type.STRING },
              },
              required: ["amount", "date", "description", "type", "category"],
            },
          },
        },
        required: ["lastBalance", "date", "transactions"],
      },
    },
  });

  const text = response.text;
  if (!text) throw new Error("No response from AI");
  return JSON.parse(text) as ScannedBankStatement;
}

export async function generateNegotiationMessage(
  supplierName: string,
  amount: number,
  dueDate: string,
  relationshipType: string,
  language: 'English' | 'Tamil' | 'Hindi',
  tone: 'Informal' | 'Formal' = 'Formal'
): Promise<string> {
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: [
      {
        text: `Generate a context-aware payment negotiation message for a supplier.
        
        Context:
        - Supplier Name: ${supplierName}
        - Amount Due: ₹${amount.toLocaleString()}
        - Original Due Date: ${dueDate}
        - Relationship Type: ${relationshipType}
        - Language: ${language}
        - Tone: ${tone}
        
        Guidelines:
        - Tone is ${tone}.
        - If tone is 'Informal' (friend/flexible), be casual, friendly, and use a personal touch.
        - If tone is 'Formal' (strict/professional), be very formal, professional, and apologetic.
        - If relationship is 'Strict', be very formal and apologetic, requesting a short extension.
        - If 'Moderate', be professional and explain the temporary constraint.
        - If 'Flexible', suggest a specific new date or a small delay.
        - If 'Friendly', suggest a partial payment now and the rest later.
        
        The message should be polite and aim to maintain the business relationship.
        Return ONLY the message text in ${language}.`,
      },
    ],
  });

  return response.text || "Failed to generate message.";
}
