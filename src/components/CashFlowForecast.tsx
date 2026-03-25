import React, { useState, useMemo } from 'react';
import { format } from 'date-fns';
import { 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer, 
  Area, 
  AreaChart,
  ReferenceLine,
  Legend
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { 
  TrendingUp, 
  AlertTriangle, 
  ShieldCheck, 
  Info, 
  Calendar, 
  ArrowRight,
  Loader2,
  Coins
} from 'lucide-react';
import { generateCashFlowForecast, ForecastResult } from '../services/forecastingService';
import { cn } from '../lib/utils';

interface Transaction {
  id: string;
  amount: number;
  category: string;
  description: string;
  date: string;
  type: 'income' | 'expense' | 'credit' | 'debit';
  status: 'pending' | 'cleared';
}

interface CashFlowForecastProps {
  transactions: Transaction[];
  currentBalance: number;
}

export default function CashFlowForecast({ transactions, currentBalance }: CashFlowForecastProps) {
  const [investmentAmount, setInvestmentAmount] = useState<number>(10000);
  const [safetyThreshold, setSafetyThreshold] = useState<number>(5000);

  const forecastResult = useMemo(() => {
    return generateCashFlowForecast(transactions, currentBalance, investmentAmount, safetyThreshold);
  }, [transactions, currentBalance, investmentAmount, safetyThreshold]);

  if (forecastResult.insufficientData) {
    return (
      <Card className="border-slate-200 shadow-sm">
        <CardContent className="flex flex-col items-center justify-center py-12 text-center space-y-4">
          <div className="h-12 w-12 bg-slate-50 rounded-full flex items-center justify-center">
            <Info className="h-6 w-6 text-slate-400" />
          </div>
          <div className="space-y-1">
            <h3 className="text-lg font-bold text-slate-900">Insufficient Data for Prediction</h3>
            <p className="text-sm text-slate-500 max-w-xs">
              We need at least 10 cleared transactions to generate an accurate cash flow forecast.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      return (
        <div className="bg-white p-3 border border-slate-200 shadow-lg rounded-lg">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">{label}</p>
          <p className="text-sm font-bold text-slate-900">₹{payload[0].value.toLocaleString()}</p>
          {data.isPredicted && (
            <p className="text-[10px] text-blue-500 font-bold uppercase mt-1">Predicted</p>
          )}
        </div>
      );
    }
    return null;
  };

  return (
    <div className="space-y-6">
      <div className="grid gap-6 md:grid-cols-12">
        {/* Controls Card */}
        <Card className="md:col-span-4 border-slate-200 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-bold flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-emerald-500" />
              Investment Planner
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="investmentAmount" className="text-xs font-bold text-slate-500 uppercase">Investment Amount</Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">₹</span>
                <Input 
                  id="investmentAmount"
                  type="number"
                  value={investmentAmount}
                  onChange={(e) => setInvestmentAmount(Number(e.target.value))}
                  className="pl-7 h-9 text-sm"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="safetyThreshold" className="text-xs font-bold text-slate-500 uppercase">Safety Threshold</Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">₹</span>
                <Input 
                  id="safetyThreshold"
                  type="number"
                  value={safetyThreshold}
                  onChange={(e) => setSafetyThreshold(Number(e.target.value))}
                  className="pl-7 h-9 text-sm"
                />
              </div>
              <p className="text-[10px] text-slate-400">Minimum balance to maintain after investment.</p>
            </div>

            <div className="pt-4 border-t border-slate-100">
              <div className="flex items-center justify-between mb-2">
                <p className="text-[10px] font-bold text-slate-500 uppercase">Risk Level</p>
                <span className={cn(
                  "text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider",
                  forecastResult.riskLevel === 'Low' ? "bg-emerald-50 text-emerald-600" :
                  forecastResult.riskLevel === 'Moderate' ? "bg-amber-50 text-amber-600" :
                  "bg-rose-50 text-rose-600"
                )}>
                  {forecastResult.riskLevel}
                </span>
              </div>
              
              {forecastResult.safeInvestmentDate ? (
                <div className="p-3 bg-emerald-50 rounded-lg border border-emerald-100 space-y-2">
                  <div className="flex items-center gap-2 text-emerald-700">
                    <ShieldCheck className="h-4 w-4" />
                    <span className="text-xs font-bold">Safe to Invest</span>
                  </div>
                  <p className="text-[11px] text-emerald-600 leading-relaxed">
                    Based on your cash flow forecast, you can safely invest after 
                    <span className="font-bold ml-1">{new Date(forecastResult.safeInvestmentDate).toLocaleDateString()}</span>.
                  </p>
                </div>
              ) : (
                <div className="p-3 bg-rose-50 rounded-lg border border-rose-100 space-y-2">
                  <div className="flex items-center gap-2 text-rose-700">
                    <AlertTriangle className="h-4 w-4" />
                    <span className="text-xs font-bold">Not Recommended</span>
                  </div>
                  <p className="text-[11px] text-rose-600 leading-relaxed">
                    Your projected balance does not stay above the safety threshold for the next 30 days if you invest now.
                  </p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Chart Card */}
        <Card className="md:col-span-8 border-slate-200 shadow-sm overflow-hidden">
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-bold">30-Day Balance Forecast</CardTitle>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-1.5">
                <div className="h-2 w-2 rounded-full bg-slate-300" />
                <span className="text-[10px] font-bold text-slate-400 uppercase">Historical</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="h-2 w-2 rounded-full bg-blue-500" />
                <span className="text-[10px] font-bold text-slate-400 uppercase">Predicted</span>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="h-[300px] w-full pt-4">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={forecastResult.forecast}>
                  <defs>
                    <linearGradient id="colorBalance" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.1}/>
                      <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis 
                    dataKey="date" 
                    axisLine={false}
                    tickLine={false}
                    tick={{ fontSize: 10, fill: '#94a3b8', fontWeight: 600 }}
                    tickFormatter={(str) => format(new Date(str), 'MMM d')}
                    minTickGap={30}
                  />
                  <YAxis 
                    axisLine={false}
                    tickLine={false}
                    tick={{ fontSize: 10, fill: '#94a3b8', fontWeight: 600 }}
                    tickFormatter={(val) => `₹${val >= 1000 ? (val/1000).toFixed(0) + 'k' : val}`}
                  />
                  <Tooltip content={<CustomTooltip />} />
                  <Area 
                    type="monotone" 
                    dataKey="balance" 
                    stroke="#3b82f6" 
                    strokeWidth={2}
                    fillOpacity={1} 
                    fill="url(#colorBalance)" 
                    animationDuration={1500}
                  />
                  {forecastResult.safeInvestmentDate && (
                    <ReferenceLine 
                      x={forecastResult.safeInvestmentDate} 
                      stroke="#10b981" 
                      strokeDasharray="3 3" 
                      label={{ 
                        position: 'top', 
                        value: 'Safe Zone', 
                        fill: '#10b981', 
                        fontSize: 10, 
                        fontWeight: 'bold' 
                      }} 
                    />
                  )}
                  <ReferenceLine 
                    y={safetyThreshold} 
                    stroke="#f43f5e" 
                    strokeDasharray="3 3" 
                    label={{ 
                      position: 'right', 
                      value: 'Safety', 
                      fill: '#f43f5e', 
                      fontSize: 10, 
                      fontWeight: 'bold' 
                    }} 
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Recommendation Card */}
      <Card className="border-none bg-slate-900 text-white shadow-xl overflow-hidden relative">
        <CardContent className="p-6">
          <div className="flex flex-col md:flex-row items-center justify-between gap-6">
            <div className="flex items-center gap-4">
              <div className="h-12 w-12 rounded-xl bg-white/10 flex items-center justify-center">
                <Coins className="h-6 w-6 text-amber-400" />
              </div>
              <div>
                <h3 className="text-lg font-bold">Investment Strategy</h3>
                <p className="text-sm text-slate-400">AI-powered recommendation for your idle cash.</p>
              </div>
            </div>
            
            <div className="flex flex-col items-center md:items-end text-center md:text-right">
              {forecastResult.safeInvestmentDate ? (
                <>
                  <p className="text-[10px] font-bold text-emerald-400 uppercase tracking-widest mb-1">Recommendation</p>
                  <p className="text-xl font-bold">Invest ₹{investmentAmount.toLocaleString()} after {new Date(forecastResult.safeInvestmentDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'long' })}</p>
                </>
              ) : (
                <>
                  <p className="text-[10px] font-bold text-rose-400 uppercase tracking-widest mb-1">Recommendation</p>
                  <p className="text-xl font-bold">Hold cash for the next 30 days</p>
                </>
              )}
            </div>
          </div>
          <div className="absolute right-[-20px] top-[-20px] h-32 w-32 bg-white/5 rounded-full blur-3xl" />
        </CardContent>
      </Card>
    </div>
  );
}
