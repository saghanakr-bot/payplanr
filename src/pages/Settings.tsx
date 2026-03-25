import { User } from 'firebase/auth';
import { Settings as SettingsIcon, User as UserIcon, Bell, Shield, Wallet } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

export default function Settings({ user }: { user: User }) {
  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900">Settings</h1>
          <p className="text-slate-500">Manage your account preferences and security.</p>
        </div>
        <div className="h-12 w-12 rounded-2xl bg-primary/10 flex items-center justify-center">
          <SettingsIcon className="h-6 w-6 text-primary" />
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card className="border-slate-200 shadow-sm">
          <CardHeader className="pb-3 border-b border-slate-50">
            <CardTitle className="text-sm font-bold flex items-center gap-2">
              <UserIcon className="h-4 w-4 text-primary" />
              Profile Settings
            </CardTitle>
          </CardHeader>
          <CardContent className="p-6 space-y-4">
            <div className="flex items-center gap-4">
              <div className="h-16 w-16 rounded-full bg-slate-100 overflow-hidden border-2 border-white shadow-sm">
                {user.photoURL ? (
                  <img src={user.photoURL} alt={user.displayName || 'User'} className="h-full w-full object-cover" />
                ) : (
                  <div className="h-full w-full flex items-center justify-center text-slate-400">
                    <UserIcon className="h-8 w-8" />
                  </div>
                )}
              </div>
              <div>
                <p className="text-sm font-bold text-slate-900">{user.displayName || 'User'}</p>
                <p className="text-xs text-slate-500">{user.email}</p>
              </div>
            </div>
            <Button variant="outline" className="w-full text-xs h-9">Edit Profile</Button>
          </CardContent>
        </Card>

        <Card className="border-slate-200 shadow-sm">
          <CardHeader className="pb-3 border-b border-slate-50">
            <CardTitle className="text-sm font-bold flex items-center gap-2">
              <Bell className="h-4 w-4 text-primary" />
              Notifications
            </CardTitle>
          </CardHeader>
          <CardContent className="p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-bold text-slate-900">Push Notifications</p>
                <p className="text-[10px] text-slate-500">Receive alerts for new payments.</p>
              </div>
              <div className="h-5 w-10 rounded-full bg-primary/20 relative cursor-pointer">
                <div className="h-4 w-4 rounded-full bg-primary absolute top-0.5 right-0.5 shadow-sm" />
              </div>
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-bold text-slate-900">Email Alerts</p>
                <p className="text-[10px] text-slate-500">Weekly summary and reports.</p>
              </div>
              <div className="h-5 w-10 rounded-full bg-slate-200 relative cursor-pointer">
                <div className="h-4 w-4 rounded-full bg-white absolute top-0.5 left-0.5 shadow-sm" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-slate-200 shadow-sm">
          <CardHeader className="pb-3 border-b border-slate-50">
            <CardTitle className="text-sm font-bold flex items-center gap-2">
              <Shield className="h-4 w-4 text-primary" />
              Security
            </CardTitle>
          </CardHeader>
          <CardContent className="p-6 space-y-4">
            <div className="space-y-1">
              <p className="text-sm font-bold text-slate-900">Two-Factor Authentication</p>
              <p className="text-[10px] text-slate-500">Add an extra layer of security to your account.</p>
            </div>
            <Button variant="outline" className="w-full text-xs h-9">Enable 2FA</Button>
          </CardContent>
        </Card>

        <Card className="border-slate-200 shadow-sm">
          <CardHeader className="pb-3 border-b border-slate-50">
            <CardTitle className="text-sm font-bold flex items-center gap-2">
              <Wallet className="h-4 w-4 text-primary" />
              Subscription
            </CardTitle>
          </CardHeader>
          <CardContent className="p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-bold text-slate-900">Current Plan</p>
                <p className="text-[10px] text-slate-500">Free Tier</p>
              </div>
              <span className="text-[10px] font-bold px-2 py-1 bg-emerald-50 text-emerald-600 rounded uppercase tracking-wider">Active</span>
            </div>
            <Button className="w-full text-xs h-9 bg-slate-900 hover:bg-slate-800 text-white border-none">Upgrade to Pro</Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
