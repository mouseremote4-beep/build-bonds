import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Shield, Eye, TrendingUp, Users, UserPlus, DollarSign } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

const Admin = () => {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [isAdmin, setIsAdmin] = useState(false);
  const [checkingRole, setCheckingRole] = useState(true);
  const [currentCrashPoint, setCurrentCrashPoint] = useState<number | null>(null);
  const [crashHistory, setCrashHistory] = useState<number[]>([]);
  const [nextCrashPoints, setNextCrashPoints] = useState<number[]>([]);
  const [recentBets, setRecentBets] = useState<{ bet_amount: number; cashout_multiplier: number | null; crashed: boolean; profit: number; created_at: string }[]>([]);
  const [stats, setStats] = useState({ totalBets: 0, totalWagered: 0, totalProfit: 0, activeUsers: 0 });
  const [allUsers, setAllUsers] = useState<{ user_id: string; username: string; amount: number }[]>([]);
  const [creditUserId, setCreditUserId] = useState("");
  const [creditAmount, setCreditAmount] = useState("");
  const [predictionValue, setPredictionValue] = useState("");
  const [activePrediction, setActivePrediction] = useState<number | null>(null);

  useEffect(() => {
    if (!user) {
      setCheckingRole(false);
      return;
    }
    const checkAdmin = async () => {
      try {
        const { data, error } = await (supabase as any)
          .from("user_roles")
          .select("role")
          .eq("user_id", user.id)
          .eq("role", "admin")
          .single();
        setIsAdmin(!!data && !error);
        if (!data || error) {
          toast.error("Access denied. Admin role required.");
        }
      } catch {
        setIsAdmin(false);
        toast.error("Could not verify admin role.");
      }
      setCheckingRole(false);
    };
    checkAdmin();
  }, [user]);

  useEffect(() => {
    if (!loading && !checkingRole && (!user || !isAdmin)) {
      if (!checkingRole) navigate("/");
    }
  }, [loading, checkingRole, user, isAdmin, navigate]);

  useEffect(() => {
    const handler = (e: Event) => {
      const { current, upcoming } = (e as CustomEvent).detail;
      setCurrentCrashPoint(prev => {
        if (prev !== null) {
          setCrashHistory(h => [Math.round(prev * 100) / 100, ...h].slice(0, 50));
        }
        return current;
      });
      setNextCrashPoints(upcoming.map((v: number) => Math.round(v * 100) / 100));
    };
    window.addEventListener("admin-crash-point", handler);
    return () => window.removeEventListener("admin-crash-point", handler);
  }, []);

  // Clear active prediction when game consumes it
  useEffect(() => {
    const handler = () => setActivePrediction(null);
    window.addEventListener("admin-prediction-consumed", handler);
    return () => window.removeEventListener("admin-prediction-consumed", handler);
  }, []);

  useEffect(() => {
    if (!isAdmin) return;
    const fetchData = async () => {
      const { data: bets } = await supabase
        .from("bet_history")
        .select("bet_amount, cashout_multiplier, crashed, profit, created_at")
        .order("created_at", { ascending: false })
        .limit(50);
      if (bets) setRecentBets(bets);

      const { count: betCount } = await supabase
        .from("bet_history")
        .select("*", { count: "exact", head: true });

      if (bets) {
        const totalWagered = bets.reduce((s, b) => s + Number(b.bet_amount), 0);
        const totalProfit = bets.reduce((s, b) => s + Number(b.profit), 0);
        setStats(prev => ({ ...prev, totalBets: betCount || 0, totalWagered, totalProfit }));
      }

      const { count: userCount } = await supabase
        .from("profiles")
        .select("*", { count: "exact", head: true });
      setStats(prev => ({ ...prev, activeUsers: userCount || 0 }));

      const { data: profiles } = await supabase
        .from("profiles")
        .select("user_id, username");
      const { data: balances } = await supabase
        .from("balances")
        .select("user_id, amount");

      if (profiles) {
        const balanceMap = new Map((balances || []).map(b => [b.user_id, Number(b.amount)]));
        setAllUsers(profiles.map(p => ({
          user_id: p.user_id,
          username: p.username || "Unknown",
          amount: balanceMap.get(p.user_id) || 0,
        })));
      }
    };
    fetchData();
    const interval = setInterval(fetchData, 10000);
    return () => clearInterval(interval);
  }, [isAdmin]);

  const handleSetPrediction = () => {
    const val = parseFloat(predictionValue);
    if (isNaN(val) || val < 1.0) {
      toast.error("Crash point must be at least 1.00");
      return;
    }
    const rounded = Math.round(val * 100) / 100;
    setActivePrediction(rounded);
    window.dispatchEvent(new CustomEvent("admin-set-crash-point", { detail: { crashPoint: rounded } }));
    toast.success(`Next round will crash at ${rounded.toFixed(2)}x`);
    setPredictionValue("");
  };

  const handleClearPrediction = () => {
    setActivePrediction(null);
    window.dispatchEvent(new CustomEvent("admin-clear-crash-points"));
    toast.success("Prediction cleared — next round will be random");
  };

  const handleCreditUser = async () => {
    if (!creditUserId || !creditAmount) {
      toast.error("Enter user ID and amount");
      return;
    }
    const amount = Number(creditAmount);
    if (isNaN(amount) || amount <= 0) {
      toast.error("Invalid amount");
      return;
    }

    try {
      const { data, error } = await supabase.functions.invoke("admin-credit-user", {
        body: { target_user_id: creditUserId, amount },
      });

      if (error) throw new Error(error.message || "Failed to credit user");
      if (data?.error) throw new Error(data.error);

      toast.success(`Credited KES ${amount} to user`);
      setCreditUserId("");
      setCreditAmount("");

      // Refresh user list to show updated balance
      const { data: profiles } = await supabase.from("profiles").select("user_id, username");
      const { data: balances } = await supabase.from("balances").select("user_id, amount");
      if (profiles) {
        const balanceMap = new Map((balances || []).map(b => [b.user_id, Number(b.amount)]));
        setAllUsers(profiles.map(p => ({
          user_id: p.user_id,
          username: p.username || "Unknown",
          amount: balanceMap.get(p.user_id) || 0,
        })));
      }
    } catch (err: any) {
      toast.error(`Failed to credit: ${err.message}`);
    }
  };

  if (loading || checkingRole) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 border-4 border-primary border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-muted-foreground">Verifying admin access...</p>
        </div>
      </div>
    );
  }

  if (!user || !isAdmin) return null;

  const getColor = (val: number) => {
    if (val >= 10) return "text-gaming-gold";
    if (val >= 2) return "text-gaming-green";
    return "text-destructive";
  };

  const getBg = (val: number) => {
    if (val >= 10) return "bg-gaming-gold/10 border-gaming-gold/30";
    if (val >= 2) return "bg-gaming-green/10 border-gaming-green/30";
    return "bg-destructive/10 border-destructive/30";
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="flex items-center gap-3 px-4 py-3 border-b border-border bg-card/80">
        <button onClick={() => navigate("/")} className="w-8 h-8 rounded-full bg-secondary border border-border flex items-center justify-center hover:bg-secondary/80 transition-colors">
          <ArrowLeft className="w-4 h-4 text-foreground" />
        </button>
        <Shield className="w-5 h-5 text-gaming-gold" />
        <h1 className="text-sm font-bold text-foreground">Admin Panel</h1>
      </header>

      <div className="max-w-5xl mx-auto p-4 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Current Round */}
          <div className="bg-card border border-border rounded-xl p-5">
            <div className="flex items-center gap-2 mb-3">
              <Eye className="w-4 h-4 text-primary" />
              <h2 className="text-sm font-bold text-foreground uppercase tracking-wider">Current Crash Point</h2>
            </div>
            {currentCrashPoint ? (
              <p className={`font-mono text-4xl font-bold ${getColor(currentCrashPoint)}`}>
                {currentCrashPoint.toFixed(2)}x
              </p>
            ) : (
              <p className="text-muted-foreground text-sm">Navigate to the game page to see live crash points</p>
            )}
          </div>

          {/* Next 5 Crash Points */}
          <div className="bg-card border border-gaming-gold/30 rounded-xl p-5">
            <div className="flex items-center gap-2 mb-3">
              <TrendingUp className="w-4 h-4 text-gaming-gold" />
              <h2 className="text-sm font-bold text-foreground uppercase tracking-wider">Next 5 Crash Points</h2>
            </div>
            {nextCrashPoints.length > 0 ? (
              <div className="flex gap-2 flex-wrap">
                {nextCrashPoints.map((val, i) => (
                  <div key={i} className={`rounded-lg border px-3 py-2 text-center ${getBg(val)}`}>
                    <p className="text-[10px] text-muted-foreground mb-0.5">#{i + 1}</p>
                    <p className={`font-mono text-lg font-bold ${getColor(val)}`}>{val.toFixed(2)}x</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-muted-foreground text-sm">Will appear after first round</p>
            )}
          </div>
        </div>

        {/* Set Next Crash Point */}
        <div className="bg-card border border-primary/30 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-3">
            <TrendingUp className="w-4 h-4 text-primary" />
            <h2 className="text-sm font-bold text-foreground uppercase tracking-wider">Set Next Crash Point</h2>
          </div>
          {activePrediction !== null && (
            <div className="mb-3 p-3 rounded-lg bg-primary/10 border border-primary/30">
              <p className="text-[10px] text-muted-foreground uppercase mb-1">Next round will crash at:</p>
              <p className={`font-mono text-2xl font-bold ${getColor(activePrediction)}`}>{activePrediction.toFixed(2)}x</p>
            </div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <input
              type="number"
              step="0.01"
              min="1"
              placeholder="e.g. 1.50"
              value={predictionValue}
              onChange={(e) => setPredictionValue(e.target.value)}
              className="bg-secondary border border-border rounded-lg px-3 py-2 text-foreground text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
            <Button onClick={handleSetPrediction} className="font-semibold">
              Set Crash Point
            </Button>
            <Button onClick={handleClearPrediction} variant="outline" className="font-semibold" disabled={activePrediction === null}>
              Clear
            </Button>
          </div>
        </div>

        {/* Crash History */}
        <div className="bg-card border border-border rounded-xl p-5">
          <div className="flex items-center gap-2 mb-3">
            <Eye className="w-4 h-4 text-primary" />
            <h2 className="text-sm font-bold text-foreground uppercase tracking-wider">Crash History</h2>
            <span className="text-[10px] text-muted-foreground ml-auto">{crashHistory.length} rounds</span>
          </div>
          {crashHistory.length === 0 ? (
            <p className="text-muted-foreground text-sm">No crash history yet. Play rounds to see history.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {crashHistory.map((val, i) => (
                <span key={i} className={`px-3 py-1.5 rounded-lg border font-mono text-sm font-bold ${getColor(val)} ${getBg(val)}`}>
                  {val.toFixed(2)}x
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Credit User */}
        <div className="bg-card border border-border rounded-xl p-5">
          <div className="flex items-center gap-2 mb-3">
            <DollarSign className="w-4 h-4 text-gaming-green" />
            <h2 className="text-sm font-bold text-foreground uppercase tracking-wider">Credit User Balance</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <select
              value={creditUserId}
              onChange={(e) => setCreditUserId(e.target.value)}
              className="bg-secondary border border-border rounded-lg px-3 py-2 text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            >
              <option value="">Select user...</option>
              {allUsers.map(u => (
                <option key={u.user_id} value={u.user_id}>
                  {u.username} (KES {u.amount.toLocaleString()})
                </option>
              ))}
            </select>
            <input
              type="number"
              placeholder="Amount (KES)"
              value={creditAmount}
              onChange={(e) => setCreditAmount(e.target.value)}
              className="bg-secondary border border-border rounded-lg px-3 py-2 text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
            <Button onClick={handleCreditUser} className="font-semibold">
              Credit Balance
            </Button>
          </div>
        </div>

        {/* Platform Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="bg-card border border-border rounded-xl p-4">
            <p className="text-[10px] text-muted-foreground uppercase">Total Bets</p>
            <p className="font-mono text-xl font-bold text-foreground">{stats.totalBets.toLocaleString()}</p>
          </div>
          <div className="bg-card border border-border rounded-xl p-4">
            <p className="text-[10px] text-muted-foreground uppercase">Total Wagered</p>
            <p className="font-mono text-xl font-bold text-foreground">KES {stats.totalWagered.toLocaleString()}</p>
          </div>
          <div className="bg-card border border-border rounded-xl p-4">
            <p className="text-[10px] text-muted-foreground uppercase">House Profit</p>
            <p className={`font-mono text-xl font-bold ${-stats.totalProfit >= 0 ? "text-gaming-green" : "text-destructive"}`}>
              KES {(-stats.totalProfit).toLocaleString()}
            </p>
          </div>
          <div className="bg-card border border-border rounded-xl p-4">
            <div className="flex items-center gap-1 mb-1">
              <Users className="w-3 h-3 text-gaming-blue" />
              <p className="text-[10px] text-muted-foreground uppercase">Users</p>
            </div>
            <p className="font-mono text-xl font-bold text-foreground">{stats.activeUsers}</p>
          </div>
        </div>

        {/* All Users */}
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-border flex items-center gap-2">
            <UserPlus className="w-4 h-4 text-gaming-blue" />
            <h3 className="text-sm font-semibold text-foreground uppercase tracking-wider">All Users</h3>
          </div>
          <div className="divide-y divide-border/30 max-h-[300px] overflow-y-auto">
            {allUsers.map((u) => (
              <div key={u.user_id} className="px-4 py-3 flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-foreground">{u.username}</p>
                  <p className="text-[10px] text-muted-foreground font-mono">{u.user_id.slice(0, 8)}...</p>
                </div>
                <p className="font-mono text-sm font-bold text-foreground">KES {u.amount.toLocaleString()}</p>
              </div>
            ))}
            {allUsers.length === 0 && (
              <div className="p-8 text-center text-sm text-muted-foreground">No users yet</div>
            )}
          </div>
        </div>

        {/* Recent Bets */}
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-border">
            <h3 className="text-sm font-semibold text-foreground uppercase tracking-wider">Recent Bets (All Users)</h3>
          </div>
          {recentBets.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">No bets recorded yet</div>
          ) : (
            <div className="divide-y divide-border/30 max-h-[400px] overflow-y-auto">
              {recentBets.map((bet, i) => (
                <div key={i} className={`px-4 py-3 flex items-center justify-between ${bet.crashed ? "bg-destructive/5" : "bg-gaming-green/5"}`}>
                  <div>
                    <p className="font-mono text-sm font-semibold text-foreground">KES {Number(bet.bet_amount).toLocaleString()}</p>
                    <p className="text-[10px] text-muted-foreground">{new Date(bet.created_at).toLocaleString()}</p>
                  </div>
                  <div className="text-right">
                    {bet.crashed ? (
                      <span className="text-destructive font-mono text-sm font-semibold">Crashed</span>
                    ) : (
                      <span className="text-gaming-green font-mono text-sm font-semibold">{bet.cashout_multiplier ? Number(bet.cashout_multiplier).toFixed(2) : "—"}x</span>
                    )}
                    <p className={`text-[10px] font-mono ${Number(bet.profit) >= 0 ? "text-gaming-green" : "text-destructive"}`}>
                      {Number(bet.profit) >= 0 ? "+" : ""}KES {Number(bet.profit).toLocaleString()}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Admin;
