import React, { useState, useEffect, useRef } from 'react';
import { LiturgyItem, MassMetadata } from '../types';
import { Wand2, BrainCircuit, FileUp, Key, ChevronLeft, ChevronRight, Loader2, Search, Github, X } from 'lucide-react';
import { COMMON_ORDINARIES } from '../constants';
import { fetchDailyPropers, resolveLiturgicalDay, importLiturgyFromPdf, enrichLiturgyItems } from '../services/geminiService';

interface DetailsPanelProps {
  items: LiturgyItem[];
  setItems: React.Dispatch<React.SetStateAction<LiturgyItem[]>>;
  metadata: MassMetadata;
  setMetadata: React.Dispatch<React.SetStateAction<MassMetadata>>;
  saveHistory: () => void;
}

export const DetailsPanel: React.FC<DetailsPanelProps> = ({ 
    items,
    setItems,
    metadata, 
    setMetadata,
    saveHistory
}) => {
  const [apiKey, setApiKey] = useState('');
  const [isSaved, setIsSaved] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importStatus, setImportStatus] = useState<string>(""); 
  const [isLookingUp, setIsLookingUp] = useState<'date' | 'feast' | null>(null);
  const [feastOptions, setFeastOptions] = useState<{title: string, date?: string}[]>([]);
  const [showFeastModal, setShowFeastModal] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const savedKey = localStorage.getItem('custom_gemini_api_key');
    if (savedKey) {
        setApiKey(savedKey);
        setIsSaved(true);
    }
  }, []);

  const handleSaveKey = () => {
      if (apiKey.trim()) {
          localStorage.setItem('custom_gemini_api_key', apiKey.trim());
          setIsSaved(true);
      } else {
          localStorage.removeItem('custom_gemini_api_key');
          setIsSaved(false);
      }
  };

  const handleOrdinarySettingChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newSetting = e.target.value;
    setMetadata(prev => ({ ...prev, ordinarySetting: newSetting }));
    
    setItems(prevItems => prevItems.map(item => {
        const isOrdinary = item.type === 'ordinary';
        const isCredo = item.title.toLowerCase().includes('credo') || item.title.toLowerCase().includes('creed');
        if (isOrdinary && !isCredo) {
            return { ...item, metadata: { ...item.metadata, setting: newSetting } };
        }
        return item;
    }));
  };

  const generatePropers = async (date: string, occasion: string, settingOverride?: string) => {
    saveHistory();
    setIsGenerating(true);
    try {
      const propers = await fetchDailyPropers(date, occasion);
      const currentSetting = settingOverride || metadata.ordinarySetting;

      const newItems: LiturgyItem[] = propers.map(p => {
        const isCredo = p.title.toLowerCase().includes('creed') || p.title.toLowerCase().includes('credo');
        let setting = undefined;
        if (p.type === 'ordinary') {
            setting = isCredo ? 'Credo III' : currentSetting;
        }

        return {
          id: Math.random().toString(36).substr(2, 9),
          type: p.type,
          title: p.title,
          content: p.text,
          metadata: { 
            reference: p.reference,
            latinContent: p.latinText,
            setting: setting
          }
        };
      });
      setItems(newItems);
    } catch (e) {
      console.error(e);
      alert("Failed to generate propers. Please check API key configuration.");
    } finally {
      setIsGenerating(false);
    }
  };

  const handleAutoPopulate = () => {
    if (!metadata.date) return;
    generatePropers(metadata.date, metadata.occasion);
  };

  const handleDateLookup = async () => {
    if (!metadata.date) return;
    setIsLookingUp('feast');
    try {
      const result = await resolveLiturgicalDay('date_to_feast', metadata.date);
      if (result.suggestedMassSetting) {
        setMetadata(prev => ({ ...prev, ordinarySetting: result.suggestedMassSetting! }));
      }
      const suggestedSetting = result.suggestedMassSetting;
      if (result.feasts && result.feasts.length > 0) {
        if (result.feasts.length === 1) {
            const feast = result.feasts[0];
            setMetadata(prev => ({ ...prev, occasion: feast }));
            await generatePropers(metadata.date, feast, suggestedSetting);
        } else {
            setFeastOptions(result.feasts.map(f => ({ title: f })));
            setShowFeastModal(true);
        }
      } else {
        alert("No liturgical feasts found for this date.");
      }
    } catch (e) {
      alert("Failed to lookup date.");
    } finally {
      setIsLookingUp(null);
    }
  };

  const handleFeastLookup = async () => {
    if (!metadata.occasion) return;
    setIsLookingUp('date');
    try {
      const result = await resolveLiturgicalDay('feast_to_date', metadata.occasion);
      if (result.matches && result.matches.length > 0) {
        if (result.matches.length === 1) {
            const match = result.matches[0];
            setMetadata(prev => ({ ...prev, occasion: match.feast, date: match.date }));
        } else {
            setFeastOptions(result.matches.map(m => ({ title: m.feast, date: m.date })));
            setShowFeastModal(true);
        }
      } else if (result.date) {
        setMetadata(prev => ({ ...prev, date: result.date! }));
      } else {
        alert("Could not find any matching feasts in the current year.");
      }
    } catch (e) {
      alert("Failed to lookup feast.");
    } finally {
      setIsLookingUp(null);
    }
  };

  const handleSelectFeast = async (feastOption: {title: string, date?: string}) => {
    const targetDate = feastOption.date || metadata.date;
    setMetadata(prev => ({ ...prev, occasion: feastOption.title, date: targetDate }));
    setShowFeastModal(false);
    if (targetDate) {
        await generatePropers(targetDate, feastOption.title);
    }
  };

  const handlePdfUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.type !== 'application/pdf') {
      alert("Please upload a valid PDF file.");
      return;
    }
    setIsImporting(true);
    setImportStatus("Uploading & Analyzing structure...");
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const base64String = (e.target?.result as string).split(',')[1];
        const timeoutPromise = new Promise<never>((_, reject) => 
            setTimeout(() => reject(new Error("Request timed out.")), 120000)
        );
        const result = await Promise.race([
            importLiturgyFromPdf(base64String),
            timeoutPromise
        ]);
        saveHistory();
        setItems([...items, ...result.items]);
        setImportStatus("Import complete!");
        await new Promise(r => setTimeout(r, 1500));
      } catch (err: any) {
        console.error(err);
        alert(err.message || "Failed to process PDF.");
      } finally {
        setIsImporting(false);
        setImportStatus("");
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    };
    reader.readAsDataURL(file);
  };

  const triggerFileUpload = () => {
    fileInputRef.current?.click();
  };

  return (
    <div className={`relative h-full z-20 flex-shrink-0 no-print flex flex-col bg-white/95 backdrop-blur-xl border-r border-stone-200/50 shadow-2xl transition-all duration-300 ${isCollapsed ? 'w-12' : 'w-[320px]'}`}>
      <div className="h-14 border-b border-stone-200/50 flex items-center bg-stone-50/80 px-2 shrink-0">
         {!isCollapsed && (
             <div className="flex items-center gap-3 flex-1 overflow-hidden ml-1">
                 <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-church-500 to-church-700 flex items-center justify-center shadow-md shrink-0">
                    <Wand2 size={16} className="text-white" />
                 </div>
                 <div className="truncate">
                    <h1 className="text-base font-bold text-stone-800 leading-tight">Details</h1>
                 </div>
             </div>
         )}
         <button onClick={() => setIsCollapsed(!isCollapsed)} className={`flex items-center justify-center w-8 h-8 rounded-md text-stone-500 hover:text-stone-800 hover:bg-stone-200 transition-colors ${isCollapsed ? 'mx-auto' : ''}`} title={isCollapsed ? "Expand Details" : "Collapse Details"}>
             {isCollapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
         </button>
      </div>

      <div className={`flex-1 overflow-hidden relative transition-opacity duration-200 ${isCollapsed ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}>
        <div className="w-[320px] h-full flex flex-col absolute inset-0">
          <input type="file" ref={fileInputRef} onChange={handlePdfUpload} accept="application/pdf" className="hidden" />
          {showFeastModal && (
        <div className="absolute inset-0 z-50 bg-black/10 backdrop-blur-[1px] flex items-center justify-center p-4 animate-in fade-in duration-200">
            <div className="bg-white rounded-lg shadow-xl border border-stone-200 w-full max-w-sm overflow-hidden">
                <div className="bg-church-50 p-3 border-b border-stone-100 flex items-center justify-between">
                    <h3 className="text-sm font-bold text-church-800">Select Liturgy</h3>
                    <button onClick={() => setShowFeastModal(false)} className="text-stone-400 hover:text-stone-600"><X size={16} /></button>
                </div>
                <div className="p-2 max-h-64 overflow-y-auto">
                    <div className="space-y-1">
                        {feastOptions.map((feast, i) => (
                            <button key={i} onClick={() => handleSelectFeast(feast)} className="w-full text-left px-3 py-2 text-sm rounded hover:bg-church-50 text-stone-700 hover:text-church-800 transition-colors flex items-center justify-between group">
                                <div>
                                    <span className="block font-medium">{feast.title}</span>
                                    {feast.date && <span className="block text-[10px] text-stone-400 mt-0.5">{feast.date}</span>}
                                </div>
                                <Wand2 size={12} className="opacity-0 group-hover:opacity-100 text-church-500" />
                            </button>
                        ))}
                    </div>
                </div>
            </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-3 space-y-4">
          <div className="space-y-3">
              <div>
                <label className="block text-[10px] uppercase tracking-wide font-bold text-stone-500 mb-0.5">Church Name</label>
                <input type="text" value={metadata.churchName} onChange={(e) => setMetadata({...metadata, churchName: e.target.value})} className="w-full bg-stone-50 border border-stone-200/80 rounded px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-church-500/20 focus:border-church-500 transition-all shadow-inner" />
              </div>
              <div className="space-y-3">
                 <div>
                  <label className="block text-[10px] uppercase tracking-wide font-bold text-stone-500 mb-0.5">Date</label>
                  <div className="relative flex items-center">
                    <input type="date" value={metadata.date} onChange={(e) => setMetadata({...metadata, date: e.target.value})} className="w-full border border-stone-300 rounded-l px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-church-500" />
                    <button onClick={handleDateLookup} disabled={isLookingUp === 'feast'} className="bg-church-100 border border-l-0 border-church-200 text-church-700 px-2 py-1.5 rounded-r hover:bg-church-200 transition-colors flex items-center justify-center">
                        {isLookingUp === 'feast' ? <Loader2 size={14} className="animate-spin"/> : <Wand2 size={14} />}
                    </button>
                  </div>
                </div>
                <div>
                  <label className="block text-[10px] uppercase tracking-wide font-bold text-stone-500 mb-0.5">Time</label>
                  <input type="text" value={metadata.time} onChange={(e) => setMetadata({...metadata, time: e.target.value})} className="w-full bg-stone-50 border border-stone-200/80 rounded px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-church-500/20 focus:border-church-500 transition-all shadow-inner" />
                </div>
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-wide font-bold text-stone-500 mb-0.5">Occasion / Feast</label>
                <div className="relative flex items-center">
                    <input type="text" placeholder="e.g. 3rd Sunday of Advent" value={metadata.occasion} onChange={(e) => setMetadata({...metadata, occasion: e.target.value})} className="w-full border border-stone-300 rounded-l px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-church-500" />
                     <button onClick={handleFeastLookup} disabled={isLookingUp === 'date'} className="bg-stone-100 border border-l-0 border-stone-300 text-stone-600 px-2 py-1.5 rounded-r hover:bg-stone-200 transition-colors flex items-center justify-center">
                        {isLookingUp === 'date' ? <Loader2 size={14} className="animate-spin"/> : <Search size={14} />}
                    </button>
                </div>
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-wide font-bold text-stone-500 mb-0.5">Mass Ordinary Setting</label>
                <div className="relative">
                    <input list="ordinary-settings" type="text" value={metadata.ordinarySetting} onChange={handleOrdinarySettingChange} className="w-full bg-stone-50 border border-stone-200/80 rounded px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-church-500/20 focus:border-church-500 transition-all shadow-inner" placeholder="Select or type a setting..." />
                    <datalist id="ordinary-settings">{COMMON_ORDINARIES.map(o => <option key={o} value={o} />)}</datalist>
                </div>
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-wide font-bold text-stone-500 mb-0.5">Celebrant</label>
                <input type="text" value={metadata.celebrant} onChange={(e) => setMetadata({...metadata, celebrant: e.target.value})} className="w-full bg-stone-50 border border-stone-200/80 rounded px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-church-500/20 focus:border-church-500 transition-all shadow-inner" />
              </div>
          </div>
          
          
          <div className="pt-3 border-t border-stone-100 space-y-2">
             <button onClick={handleAutoPopulate} disabled={isGenerating || isImporting} className="w-full flex items-center justify-center gap-1.5 bg-gradient-to-r from-church-600 to-church-800 text-white rounded py-2 shadow-sm hover:shadow hover:-translate-y-px text-xs font-medium transition-all active:scale-95 disabled:opacity-50 disabled:transform-none">
               {isGenerating ? <Loader2 size={14} className="animate-spin" /> : <><Wand2 size={14} /> Auto-Populate Propers</>}
             </button>
             
             <button onClick={triggerFileUpload} disabled={isImporting || isGenerating} className="w-full flex items-center justify-center gap-1.5 bg-stone-800 text-white rounded py-2 shadow-sm hover:shadow hover:-translate-y-px text-xs font-medium transition-all active:scale-95 disabled:opacity-70 disabled:transform-none">
               {isImporting ? <Loader2 size={12} className="animate-spin"/> : <FileUp size={12} />} {isImporting ? "Processing PDF..." : "Import from PDF"}
             </button>
             
             {isImporting && importStatus && (
                <div className="bg-church-50 rounded-md p-3 border border-church-100 shadow-sm animate-in fade-in slide-in-from-top-1">
                    <div className="flex items-center gap-2 text-xs font-medium text-church-800"><BrainCircuit size={14} className="text-church-600 animate-pulse" /><span>{importStatus}</span></div>
                </div>
             )}
          </div>

          <div className="pt-4 mt-4 border-t border-stone-100">
             <h3 className="text-xs font-bold text-stone-900 uppercase tracking-wide flex items-center gap-1.5 mb-2">
                 <Key size={12} className="text-stone-400" /> API Settings
             </h3>
             <p className="text-[10px] text-stone-500 mb-2 leading-relaxed">
                 To bypass the server's free-tier limits, you can provide your own paid <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener noreferrer" className="text-church-600 hover:underline">Gemini API key</a>. This key never leaves your browser except when sending requests to the proxy.
             </p>
             <div className="space-y-1.5">
                 <input 
                    type="password" 
                    placeholder="AIzaSy..." 
                    value={apiKey} 
                    onChange={(e) => setApiKey(e.target.value)} 
                    className="w-full bg-stone-50 border border-stone-200/80 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-church-500/20 focus:border-church-500 transition-all shadow-inner font-mono text-xs" 
                 />
                 <p className="text-[9px] text-stone-400">Leave blank to use the server's default key.</p>
                 <button 
                    onClick={handleSaveKey} 
                    className="w-full bg-stone-800 text-white rounded-md py-2 text-xs font-semibold uppercase tracking-wide hover:bg-stone-700 transition-colors shadow-sm"
                 >
                     {isSaved ? "Saved Locally (Update)" : "Save Key Locally"}
                 </button>
             </div>
          </div>
          
          <div className="mt-6 mb-2 text-center">
             <a href="https://github.com/brftherese/Liturgy-Builder" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-stone-400 hover:text-stone-600 transition-colors text-xs font-medium">
                 <Github size={14} />
                 View Source Code
             </a>
          </div>
      </div>
        </div>
      </div>
    </div>
  );
};
