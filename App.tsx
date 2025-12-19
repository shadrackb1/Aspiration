import React, { useState, useEffect, useMemo } from 'react';
import { Dream, Goal, ActionLog, Category, TimeHorizon, GoalStatus } from './types';
import { CATEGORIES, TIME_HORIZONS, GOAL_STATUSES, Icons } from './constants';
import { getReviewInsight } from './geminiService';

// --- Local Storage Hooks ---
const useLocalStorage = <T,>(key: string, initialValue: T): [T, (val: T) => void] => {
  const [storedValue, setStoredValue] = useState<T>(() => {
    try {
      const item = window.localStorage.getItem(key);
      return item ? JSON.parse(item) : initialValue;
    } catch (error) {
      return initialValue;
    }
  });

  const setValue = (value: T) => {
    try {
      setStoredValue(value);
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
      console.error(error);
    }
  };

  return [storedValue, setValue];
};

// --- Sub-components ---

// Use React.FC to properly handle children and key props in various environments
const Badge: React.FC<{ children?: React.ReactNode; className?: string }> = ({ children, className = "" }) => (
  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${className}`}>
    {children}
  </span>
);

// Use React.FC and optional children to fix "Property 'children' is missing" errors and handle 'key' prop
const Card: React.FC<{ children?: React.ReactNode; className?: string }> = ({ children, className = "" }) => (
  <div className={`bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden transition-all duration-300 hover:shadow-md ${className}`}>
    {children}
  </div>
);

const ProgressRing = ({ progress, size = 40 }: { progress: number, size?: number }) => {
  const stroke = 3;
  const radius = (size - stroke * 2) / 2;
  const circumference = radius * 2 * Math.PI;
  const offset = circumference - (progress / 100) * circumference;

  return (
    <svg width={size} height={size} className="transform -rotate-90">
      <circle
        className="text-slate-200 dark:text-slate-700"
        strokeWidth={stroke}
        stroke="currentColor"
        fill="transparent"
        r={radius}
        cx={size / 2}
        cy={size / 2}
      />
      <circle
        className="text-indigo-500 transition-all duration-500"
        strokeWidth={stroke}
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        strokeLinecap="round"
        stroke="currentColor"
        fill="transparent"
        r={radius}
        cx={size / 2}
        cy={size / 2}
      />
    </svg>
  );
};

// --- Main App ---

export default function App() {
  // State
  const [dreams, setDreams] = useLocalStorage<Dream[]>('dreams', []);
  const [goals, setGoals] = useLocalStorage<Goal[]>('goals', []);
  const [logs, setLogs] = useLocalStorage<ActionLog[]>('logs', []);
  const [view, setView] = useState<'dashboard' | 'dreams' | 'review'>('dashboard');
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [isAuth, setIsAuth] = useState(false);
  
  // Modals/Forms state
  const [showDreamModal, setShowDreamModal] = useState(false);
  const [editingDream, setEditingDream] = useState<Dream | null>(null);
  const [showGoalModal, setShowGoalModal] = useState<string | null>(null); // dreamId
  const [logInput, setLogInput] = useState("");
  const [reviewInsight, setReviewInsight] = useState<{ summary: string, questions: string[] } | null>(null);
  const [loadingInsight, setLoadingInsight] = useState(false);

  // Computed values
  const activeDreams = dreams.length;
  const completedGoals = goals.filter(g => g.status === GoalStatus.Completed).length;
  
  const getDreamProgress = (dreamId: string) => {
    const dreamGoals = goals.filter(g => g.dreamId === dreamId);
    if (dreamGoals.length === 0) return 0;
    const total = dreamGoals.reduce((acc, g) => acc + g.progress, 0);
    return Math.round(total / dreamGoals.length);
  };

  useEffect(() => {
    if (isDarkMode) document.documentElement.classList.add('dark');
    else document.documentElement.classList.remove('dark');
  }, [isDarkMode]);

  // Actions
  const handleAddDream = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const newDream: Dream = {
      id: editingDream?.id || crypto.randomUUID(),
      title: formData.get('title') as string,
      description: formData.get('description') as string,
      category: formData.get('category') as Category,
      timeHorizon: formData.get('timeHorizon') as TimeHorizon,
      createdAt: editingDream?.createdAt || new Date().toISOString(),
    };

    if (editingDream) {
      setDreams(dreams.map(d => d.id === editingDream.id ? newDream : d));
    } else {
      setDreams([...dreams, newDream]);
    }
    setShowDreamModal(false);
    setEditingDream(null);
  };

  const handleDeleteDream = (id: string) => {
    if (confirm('Are you sure? All goals linked to this dream will be removed.')) {
      setDreams(dreams.filter(d => d.id !== id));
      setGoals(goals.filter(g => g.dreamId !== id));
    }
  };

  const handleAddGoal = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!showGoalModal) return;
    const formData = new FormData(e.currentTarget);
    const newGoal: Goal = {
      id: crypto.randomUUID(),
      dreamId: showGoalModal,
      title: formData.get('title') as string,
      deadline: formData.get('deadline') as string,
      status: GoalStatus.NotStarted,
      progress: 0,
    };
    setGoals([...goals, newGoal]);
    setShowGoalModal(null);
  };

  const updateGoalProgress = (goalId: string, progress: number) => {
    setGoals(goals.map(g => {
      if (g.id === goalId) {
        const newStatus = progress === 100 ? GoalStatus.Completed : progress > 0 ? GoalStatus.InProgress : GoalStatus.NotStarted;
        return { ...g, progress, status: newStatus };
      }
      return g;
    }));
  };

  const submitLog = () => {
    if (!logInput.trim()) return;
    const newLog: ActionLog = {
      id: crypto.randomUUID(),
      content: logInput,
      date: new Date().toISOString(),
    };
    setLogs([newLog, ...logs]);
    setLogInput("");
  };

  const generateReview = async () => {
    setLoadingInsight(true);
    const recentLogs = logs.slice(0, 5).map(l => l.content);
    const dreamTitles = dreams.map(d => d.title);
    const result = await getReviewInsight(recentLogs, dreamTitles);
    if (result) setReviewInsight(result);
    setLoadingInsight(false);
  };

  // Auth placeholder
  if (!isAuth) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-900 p-4 transition-colors">
        <div className="max-w-md w-full bg-white dark:bg-slate-800 p-8 rounded-2xl shadow-xl border border-slate-200 dark:border-slate-700">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-light tracking-tight text-indigo-600 dark:text-indigo-400">ASPIRATION</h1>
            <p className="text-slate-500 dark:text-slate-400 mt-2">Track life dreams with clarity.</p>
          </div>
          <div className="space-y-4">
            <button 
              onClick={() => setIsAuth(true)}
              className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-medium py-3 rounded-xl transition-all"
            >
              Sign In
            </button>
            <button 
              onClick={() => setIsAuth(true)}
              className="w-full border border-slate-300 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-medium py-3 rounded-xl transition-all"
            >
              Continue as Guest
            </button>
          </div>
          <p className="text-xs text-center text-slate-400 mt-6">Secure data stored locally on your device.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 transition-colors text-slate-900 dark:text-slate-100 flex flex-col md:flex-row">
      
      {/* Sidebar Navigation */}
      <nav className="w-full md:w-64 bg-white dark:bg-slate-800 border-r border-slate-200 dark:border-slate-700 p-6 flex flex-col justify-between sticky top-0 h-auto md:h-screen z-10">
        <div>
          <h2 className="text-xl font-light tracking-wider text-indigo-500 mb-10 px-2">ASPIRATION</h2>
          <div className="space-y-2">
            {[
              { id: 'dashboard', label: 'Dashboard', icon: (props: any) => <svg {...props} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" /></svg> },
              { id: 'dreams', label: 'My Dreams', icon: (props: any) => <svg {...props} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" /></svg> },
              { id: 'review', label: 'Review Mode', icon: (props: any) => <svg {...props} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" /></svg> },
            ].map(item => (
              <button
                key={item.id}
                onClick={() => setView(item.id as any)}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${view === item.id ? 'bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 font-medium' : 'text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-700/50'}`}
              >
                <item.icon className="w-5 h-5" />
                {item.label}
              </button>
            ))}
          </div>
        </div>
        <div className="pt-6 border-t border-slate-200 dark:border-slate-700">
          <button 
            onClick={() => setIsDarkMode(!isDarkMode)}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-all"
          >
            {isDarkMode ? (
              <><svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 9H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" /></svg> Light Mode</>
            ) : (
              <><svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" /></svg> Dark Mode</>
            )}
          </button>
        </div>
      </nav>

      {/* Main Content Area */}
      <main className="flex-1 p-6 md:p-10 lg:p-12 overflow-y-auto max-w-7xl mx-auto w-full">
        
        {/* Dashboard View */}
        {view === 'dashboard' && (
          <div className="animate-in fade-in duration-500">
            <header className="mb-10">
              <h1 className="text-3xl font-light text-slate-800 dark:text-slate-100">Welcome back.</h1>
              <p className="text-slate-500 mt-2">Here is where your aspirations stand today.</p>
            </header>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-12">
              <Card className="p-6">
                <span className="text-slate-400 text-sm font-medium">Active Dreams</span>
                <div className="text-3xl font-light mt-1">{activeDreams}</div>
              </Card>
              <Card className="p-6">
                <span className="text-slate-400 text-sm font-medium">Goals Completed</span>
                <div className="text-3xl font-light mt-1 text-emerald-500">{completedGoals}</div>
              </Card>
              <Card className="p-6">
                <span className="text-slate-400 text-sm font-medium">Action Logs</span>
                <div className="text-3xl font-light mt-1 text-indigo-500">{logs.length}</div>
              </Card>
              <Card className="p-6">
                <span className="text-slate-400 text-sm font-medium">System Health</span>
                <div className="text-lg font-light mt-1 text-slate-600 dark:text-slate-300">Calm</div>
              </Card>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              <div className="lg:col-span-2 space-y-6">
                <h3 className="text-xl font-light">Recent Progress</h3>
                <div className="space-y-4">
                  {dreams.length === 0 ? (
                    <Card className="p-12 text-center text-slate-400 bg-slate-50/50 dark:bg-slate-800/50 border-dashed border-2">
                      No dreams defined yet. Start by creating your first life vision.
                    </Card>
                  ) : (
                    dreams.slice(0, 3).map(dream => (
                      <Card key={dream.id} className="p-5 flex items-center justify-between">
                        <div className="flex items-center gap-4">
                          <div className="p-3 bg-slate-100 dark:bg-slate-700 rounded-lg text-slate-500">
                             {Icons[dream.category]()}
                          </div>
                          <div>
                            <h4 className="font-medium text-slate-800 dark:text-slate-200">{dream.title}</h4>
                            <p className="text-xs text-slate-400">{dream.timeHorizon} Horizon</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-4">
                          <div className="text-right mr-2">
                            <div className="text-xs text-slate-400 mb-1">Progress</div>
                            <div className="text-sm font-medium">{getDreamProgress(dream.id)}%</div>
                          </div>
                          <ProgressRing progress={getDreamProgress(dream.id)} size={48} />
                        </div>
                      </Card>
                    ))
                  )}
                </div>
              </div>

              <div className="space-y-6">
                <h3 className="text-xl font-light">Action Log</h3>
                <Card className="p-6">
                  <div className="space-y-4">
                    <textarea 
                      value={logInput}
                      onChange={(e) => setLogInput(e.target.value)}
                      placeholder="What did you do today toward any dream?"
                      className="w-full min-h-[100px] p-3 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm focus:ring-1 focus:ring-indigo-500 outline-none resize-none"
                    />
                    <button 
                      onClick={submitLog}
                      className="w-full bg-slate-800 dark:bg-slate-700 hover:bg-slate-900 dark:hover:bg-slate-600 text-white text-sm py-2.5 rounded-lg transition-all"
                    >
                      Log Action
                    </button>
                  </div>
                  <div className="mt-8 space-y-4">
                    <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Recent Entries</h4>
                    {logs.slice(0, 3).map(log => (
                      <div key={log.id} className="border-l-2 border-indigo-500 pl-4 py-1">
                        <p className="text-sm text-slate-600 dark:text-slate-300">{log.content}</p>
                        <span className="text-[10px] text-slate-400">{new Date(log.date).toLocaleDateString()}</span>
                      </div>
                    ))}
                  </div>
                </Card>
              </div>
            </div>
          </div>
        )}

        {/* My Dreams View */}
        {view === 'dreams' && (
          <div className="animate-in slide-in-from-bottom-4 duration-500">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-10">
              <div>
                <h1 className="text-3xl font-light">My Dreams</h1>
                <p className="text-slate-500 mt-2">The architecture of your life visions.</p>
              </div>
              <button 
                onClick={() => setShowDreamModal(true)}
                className="bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2.5 rounded-xl flex items-center gap-2 transition-all shadow-lg shadow-indigo-200 dark:shadow-none"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                New Dream
              </button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-8">
              {dreams.map(dream => (
                <Card key={dream.id} className="flex flex-col h-full group">
                  <div className="p-6 flex-1">
                    <div className="flex justify-between items-start mb-4">
                      <div className="p-2.5 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 rounded-lg">
                        {Icons[dream.category]()}
                      </div>
                      <div className="flex gap-2">
                        <button onClick={() => { setEditingDream(dream); setShowDreamModal(true); }} className="text-slate-400 hover:text-indigo-500 transition-colors">
                          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-5M16.5 3.5a2.121 2.121 0 113 3L11 17l-4 1 1-4 9.5-9.5z" /></svg>
                        </button>
                        <button onClick={() => handleDeleteDream(dream.id)} className="text-slate-400 hover:text-red-500 transition-colors">
                          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                        </button>
                      </div>
                    </div>
                    <h3 className="text-xl font-medium mb-2">{dream.title}</h3>
                    <p className="text-sm text-slate-500 mb-6 line-clamp-3">{dream.description}</p>
                    
                    <div className="flex items-center gap-3 mb-8">
                      <Badge className="bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300">{dream.category}</Badge>
                      <Badge className="bg-indigo-50 dark:bg-indigo-900/40 text-indigo-600 dark:text-indigo-400">{dream.timeHorizon}</Badge>
                    </div>

                    <div className="space-y-4">
                      <div className="flex justify-between items-center text-xs font-semibold text-slate-400 uppercase tracking-wider">
                        <span>Goals</span>
                        <span>{goals.filter(g => g.dreamId === dream.id).length} Active</span>
                      </div>
                      <div className="space-y-2">
                        {goals.filter(g => g.dreamId === dream.id).map(goal => (
                          <div key={goal.id} className="flex items-center gap-3 group/item">
                            <input 
                              type="checkbox" 
                              checked={goal.status === GoalStatus.Completed}
                              onChange={(e) => updateGoalProgress(goal.id, e.target.checked ? 100 : 0)}
                              className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                            />
                            <span className={`text-sm flex-1 truncate ${goal.status === GoalStatus.Completed ? 'line-through text-slate-400' : 'text-slate-600 dark:text-slate-300'}`}>
                              {goal.title}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div className="p-4 bg-slate-50 dark:bg-slate-900/50 border-t border-slate-200 dark:border-slate-700 flex justify-between items-center">
                    <button 
                      onClick={() => setShowGoalModal(dream.id)}
                      className="text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 transition-colors flex items-center gap-1"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" /></svg>
                      Add Goal
                    </button>
                    <div className="text-[10px] text-slate-400">Created {new Date(dream.createdAt).toLocaleDateString()}</div>
                  </div>
                </Card>
              ))}
            </div>
          </div>
        )}

        {/* Review Mode View */}
        {view === 'review' && (
          <div className="max-w-3xl mx-auto animate-in fade-in duration-700">
            <header className="text-center mb-12">
              <h1 className="text-3xl font-light">Reflective Review</h1>
              <p className="text-slate-500 mt-2">Step back and see the bigger picture of your efforts.</p>
            </header>

            <div className="space-y-8">
              <Card className="p-8">
                <h3 className="text-xl mb-4 font-light">The Narrative of Your Actions</h3>
                <p className="text-slate-600 dark:text-slate-400 text-sm leading-relaxed mb-8">
                  Analyzing your last {logs.length < 5 ? logs.length : 5} action logs to provide a perspective on your current direction.
                </p>

                {loadingInsight ? (
                   <div className="flex flex-col items-center justify-center py-10 gap-4">
                     <div className="w-10 h-10 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
                     <p className="text-slate-400 text-sm animate-pulse">Analyzing patterns...</p>
                   </div>
                ) : reviewInsight ? (
                  <div className="space-y-8">
                    <div className="bg-indigo-50 dark:bg-indigo-900/20 p-6 rounded-xl border border-indigo-100 dark:border-indigo-900/30">
                      <h4 className="text-xs font-bold text-indigo-600 dark:text-indigo-400 uppercase tracking-widest mb-3">Synthesis</h4>
                      <p className="text-slate-700 dark:text-slate-200 italic">"{reviewInsight.summary}"</p>
                    </div>

                    <div>
                      <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4">Reflection Questions</h4>
                      <div className="space-y-4">
                        {reviewInsight.questions.map((q, idx) => (
                          <div key={idx} className="p-4 bg-slate-50 dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 text-sm">
                            {q}
                          </div>
                        ))}
                      </div>
                    </div>

                    <button 
                      onClick={generateReview}
                      className="text-xs font-medium text-slate-400 hover:text-indigo-500 transition-colors uppercase tracking-widest"
                    >
                      Regenerate Perspective
                    </button>
                  </div>
                ) : (
                  <div className="text-center py-12">
                    <button 
                      onClick={generateReview}
                      disabled={logs.length === 0}
                      className={`px-8 py-3 rounded-xl transition-all ${logs.length === 0 ? 'bg-slate-200 text-slate-400 cursor-not-allowed' : 'bg-slate-800 dark:bg-slate-700 text-white hover:bg-slate-900'}`}
                    >
                      {logs.length === 0 ? "Log some actions first" : "Generate Review Insights"}
                    </button>
                    <p className="text-xs text-slate-400 mt-4">Insights use Gemini to summarize your logged behavior neutrally.</p>
                  </div>
                )}
              </Card>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <Card className="p-6">
                  <h4 className="text-sm font-semibold mb-4 text-slate-500">Stalled Dreams</h4>
                  <div className="space-y-3">
                    {dreams.filter(d => getDreamProgress(d.id) < 10).length > 0 ? (
                      dreams.filter(d => getDreamProgress(d.id) < 10).map(d => (
                        <div key={d.id} className="text-sm p-3 bg-red-50 dark:bg-red-900/10 text-red-600 dark:text-red-400 rounded-lg">
                          {d.title}
                        </div>
                      ))
                    ) : (
                      <p className="text-xs text-slate-400 italic">No dreams are stalled. Good momentum.</p>
                    )}
                  </div>
                </Card>
                <Card className="p-6">
                   <h4 className="text-sm font-semibold mb-4 text-slate-500">Fastest Moving</h4>
                   <div className="space-y-3">
                    {dreams.sort((a,b) => getDreamProgress(b.id) - getDreamProgress(a.id)).slice(0, 2).map(d => (
                        <div key={d.id} className="text-sm p-3 bg-emerald-50 dark:bg-emerald-900/10 text-emerald-600 dark:text-emerald-400 rounded-lg flex justify-between">
                          <span>{d.title}</span>
                          <span className="font-bold">{getDreamProgress(d.id)}%</span>
                        </div>
                    ))}
                  </div>
                </Card>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Dream Modal */}
      {showDreamModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white dark:bg-slate-800 w-full max-w-lg rounded-2xl shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="p-6 border-b border-slate-100 dark:border-slate-700 flex justify-between items-center">
              <h2 className="text-xl font-light">{editingDream ? 'Edit Life Vision' : 'New Life Vision'}</h2>
              <button onClick={() => { setShowDreamModal(false); setEditingDream(null); }} className="text-slate-400 hover:text-slate-600">
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <form onSubmit={handleAddDream} className="p-6 space-y-5">
              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Dream Title</label>
                <input 
                  required
                  name="title"
                  defaultValue={editingDream?.title || ""}
                  placeholder="e.g. Architect of sustainable living"
                  className="w-full p-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 focus:ring-1 focus:ring-indigo-500 outline-none"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">The "Why" (Description)</label>
                <textarea 
                  required
                  name="description"
                  defaultValue={editingDream?.description || ""}
                  placeholder="Short summary of why this matters for your long-term fulfillment."
                  className="w-full p-3 h-24 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 focus:ring-1 focus:ring-indigo-500 outline-none resize-none"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Category</label>
                  <select 
                    name="category"
                    defaultValue={editingDream?.category || Category.Personal}
                    className="w-full p-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 focus:ring-1 focus:ring-indigo-500 outline-none"
                  >
                    {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Time Horizon</label>
                  <select 
                    name="timeHorizon"
                    defaultValue={editingDream?.timeHorizon || TimeHorizon.FiveYears}
                    className="w-full p-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 focus:ring-1 focus:ring-indigo-500 outline-none"
                  >
                    {TIME_HORIZONS.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
              </div>
              <button 
                type="submit"
                className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-medium py-3 rounded-xl transition-all shadow-lg shadow-indigo-200 dark:shadow-none mt-4"
              >
                {editingDream ? 'Update Dream' : 'Begin This Vision'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Goal Modal */}
      {showGoalModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white dark:bg-slate-800 w-full max-w-md rounded-2xl shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="p-6 border-b border-slate-100 dark:border-slate-700 flex justify-between items-center">
              <h2 className="text-xl font-light">Add Actionable Goal</h2>
              <button onClick={() => setShowGoalModal(null)} className="text-slate-400 hover:text-slate-600">
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <form onSubmit={handleAddGoal} className="p-6 space-y-5">
              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">What's the next step?</label>
                <input 
                  required
                  name="title"
                  placeholder="e.g. Enroll in specialized certification"
                  className="w-full p-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 focus:ring-1 focus:ring-indigo-500 outline-none"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Target Date (Optional)</label>
                <input 
                  type="date"
                  name="deadline"
                  className="w-full p-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 focus:ring-1 focus:ring-indigo-500 outline-none"
                />
              </div>
              <button 
                type="submit"
                className="w-full bg-slate-800 dark:bg-slate-700 hover:bg-slate-900 dark:hover:bg-slate-600 text-white font-medium py-3 rounded-xl transition-all"
              >
                Create Goal
              </button>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}
