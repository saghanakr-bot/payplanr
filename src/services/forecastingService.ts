import ARIMA from 'arima';
import { format, addDays, isSameDay, parseISO, startOfDay } from 'date-fns';

interface Transaction {
  id: string;
  amount: number;
  category: string;
  description: string;
  date: string;
  type: 'income' | 'expense' | 'credit' | 'debit';
  status: 'pending' | 'cleared';
}

export interface ForecastPoint {
  date: string;
  balance: number;
  isPredicted: boolean;
}

export interface ForecastResult {
  forecast: ForecastPoint[];
  safeInvestmentDate: string | null;
  riskLevel: 'Low' | 'Moderate' | 'High';
  insufficientData: boolean;
}

export function generateCashFlowForecast(
  transactions: Transaction[],
  currentBalance: number,
  investmentAmount: number,
  safetyThreshold: number = 5000,
  daysToPredict: number = 30
): ForecastResult {
  // 1. Preprocessing
  // Filter only cleared transactions for historical data
  const historicalTxs = transactions
    .filter(tx => tx.status === 'cleared')
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  if (historicalTxs.length < 10) {
    return {
      forecast: [],
      safeInvestmentDate: null,
      riskLevel: 'High',
      insufficientData: true
    };
  }

  // Group by day
  const dailyFlows: { [key: string]: number } = {};
  const firstDate = startOfDay(new Date(historicalTxs[0].date));
  const lastDate = startOfDay(new Date());

  // Initialize all days with 0
  let curr = firstDate;
  while (curr <= lastDate) {
    dailyFlows[format(curr, 'yyyy-MM-dd')] = 0;
    curr = addDays(curr, 1);
  }

  // Fill with actual data
  historicalTxs.forEach(tx => {
    const dateStr = format(new Date(tx.date), 'yyyy-MM-dd');
    const amount = (tx.type === 'income' || tx.type === 'credit') ? tx.amount : -tx.amount;
    if (dailyFlows[dateStr] !== undefined) {
      dailyFlows[dateStr] += amount;
    }
  });

  const flowValues = Object.values(dailyFlows);

  // 2. ARIMA Model
  let predictedFlows: number[] = [];
  try {
    const arima = new ARIMA({ p: 1, d: 1, q: 1, verbose: false }).train(flowValues);
    const [pred] = arima.predict(daysToPredict);
    predictedFlows = pred;
  } catch (error) {
    console.error("ARIMA training failed, falling back to simple average", error);
    const avgFlow = flowValues.reduce((a, b) => a + b, 0) / flowValues.length;
    predictedFlows = Array(daysToPredict).fill(avgFlow);
  }

  // 3. Balance Projection
  const forecast: ForecastPoint[] = [];
  
  // Past 7 days for context
  const past7Days = Array.from({ length: 7 }).map((_, i) => {
    const d = addDays(lastDate, -6 + i);
    const dateStr = format(d, 'yyyy-MM-dd');
    // This is a bit tricky since we don't have the exact balance for each day in history easily
    // We'll just show the predicted part mainly, but let's try to reconstruct
    return { date: dateStr, balance: 0, isPredicted: false };
  });

  // Reconstruct past balances (backwards from current)
  let tempBalance = currentBalance;
  for (let i = past7Days.length - 1; i >= 0; i--) {
    past7Days[i].balance = tempBalance;
    const dateStr = past7Days[i].date;
    tempBalance -= (dailyFlows[dateStr] || 0);
  }

  forecast.push(...past7Days);

  // Future projection
  let runningBalance = currentBalance;
  let safeInvestmentDate: string | null = null;

  for (let i = 0; i < daysToPredict; i++) {
    const date = addDays(lastDate, i + 1);
    runningBalance += predictedFlows[i];
    
    const dateStr = format(date, 'yyyy-MM-dd');
    forecast.push({
      date: dateStr,
      balance: runningBalance,
      isPredicted: true
    });

    // Investment Logic
    if (!safeInvestmentDate && runningBalance >= (investmentAmount + safetyThreshold)) {
      // Check if it stays above threshold for at least 3 days after
      let staysSafe = true;
      let checkBalance = runningBalance - investmentAmount;
      for (let j = i + 1; j < Math.min(i + 4, daysToPredict); j++) {
        checkBalance += predictedFlows[j];
        if (checkBalance < safetyThreshold) {
          staysSafe = false;
          break;
        }
      }
      if (staysSafe) {
        safeInvestmentDate = dateStr;
      }
    }
  }

  // Risk Level based on volatility
  const mean = flowValues.reduce((a, b) => a + b, 0) / flowValues.length;
  const variance = flowValues.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / flowValues.length;
  const stdDev = Math.sqrt(variance);
  const cv = stdDev / (Math.abs(mean) + 1); // Coefficient of variation

  let riskLevel: 'Low' | 'Moderate' | 'High' = 'Moderate';
  if (cv < 0.5) riskLevel = 'Low';
  else if (cv > 1.5) riskLevel = 'High';

  return {
    forecast,
    safeInvestmentDate,
    riskLevel,
    insufficientData: false
  };
}
