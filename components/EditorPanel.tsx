import React, { useState, useRef, useEffect } from 'react';
import { LiturgyItem, ItemType, MassMetadata, PageSettings } from '../types';
import { Trash2, ArrowUp, ArrowDown, Wand2, Calendar, GripVertical, Settings, Type as TypeIcon, Languages, BookOpen, Music, Search, Loader2, X, FileUp, Scroll, BrainCircuit, MessageSquare, Send, RotateCcw, Undo2, ChevronRight, ChevronDown, PlusCircle } from 'lucide-react';
import { fetchDailyPropers, translateText, resolveLiturgicalDay, importLiturgyFromPdf, enrichLiturgyItems, processLiturgyEdit } from '../services/geminiService';
import { COMMON_ORDINARIES } from '../constants';

interface EditorPanelProps {
  items: LiturgyItem[];
  setItems: React.Dispatch<React.SetStateAction<LiturgyItem[]>>;
  metadata: MassMetadata;
  setMetadata: React.Dispatch<React.SetStateAction<MassMetadata>>;
  saveHistory: () => void;
  undo: () => void;
  canUndo: boolean;
  resetApp: () => void;
}

interface ChatMessage {
    role: 'user' | 'ai';
    content: string;
}

export const EditorPanel: React.FC<EditorPanelProps> = ({ items, setItems, metadata, setMetadata, saveHistory, undo, canUndo, resetApp }) => {
  const [isGenerating, setIsGenerating] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importStatus, setImportStatus] = useState<string>(""); 
  const [isLookingUp, setIsLookingUp] = useState<'date' | 'feast' | null>(null);
  const [translatingId, setTranslatingId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'build' | 'settings' | 'chat'>('build');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // Chat State
  const [chatInput, setChatInput] = useState("");
  const [isChatProcessing, setIsChatProcessing] = useState(false);
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([
      { role: 'ai', content: "Hi! I can help edit your liturgy. Try 'Add Credo III' or 'Change the opening hymn to Immaculate Mary'." }
  ]);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Smart Populate State
  const [feastOptions, setFeastOptions] = useState<string[]>([]);
  const [showFeastModal, setShowFeastModal] = useState(false);

  useEffect(() => {
    if (activeTab === 'chat' && chatEndRef.current) {
        chatEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [chatHistory, activeTab]);

  const createItem = (type: ItemType): LiturgyItem => {
    return {
      id: Math.random().toString(36).substr(2, 9),
      type,
      title: type === 'hymn' ? 'New Hymn' : type === 'reading' ? 'New Reading' : type === 'proper' ? 'New Proper' : type === 'ordinary' ? 'Ordinary' : 'New Item',
      content: '',
      metadata: { tune: '', reference: '' }
    };
  };

  const handleAddItem = (type: ItemType) => {
    saveHistory();
    const newItem = createItem(type);
    setItems([...items, newItem]);
    setExpandedId(newItem.id);
  };

  const handleDragStart = (e: React.DragEvent, type: ItemType) => {
    e.dataTransfer.setData('itemType', type);
    e.dataTransfer.effectAllowed = 'copy';
    setExpandedId(null);
    setIsDragging(true);
  };

  const handleDragEnd = () => {
    setIsDragging(false);
    setDragOverIndex(null);
  };

  const handleDrop = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    setDragOverIndex(null);
    setIsDragging(false);
    const type = e.dataTransfer.getData('itemType') as ItemType;
    if (!type) return;

    saveHistory();
    const newItem = createItem(type);
    const newItems = [...items];
    newItems.splice(index, 0, newItem);
    setItems(newItems);
    setExpandedId(newItem.id);
  };

  const handleUpdateItem = (id: string, updates: Partial<LiturgyItem>) => {
    setItems(items.map(item => item.id === id ? { ...item, ...updates } : item));
  };

  const handleDeleteItem = (id: string) => {
    saveHistory();
    setItems(items.filter(item => item.id !== id));
    if (expandedId === id) setExpandedId(null);
  };

  const handleMoveItem = (index: number, direction: 'up' | 'down') => {
    saveHistory();
    const newItems = [...items];
    if (direction === 'up' && index > 0) {
      [newItems[index], newItems[index - 1]] = [newItems[index - 1], newItems[index]];
    } else if (direction === 'down' && index < newItems.length - 1) {
      [newItems[index], newItems[index + 1]] = [newItems[index + 1], newItems[index]];
    }
    setItems(newItems);
  };

  const handleTranslate = async (item: LiturgyItem) => {
    if (!item.metadata?.latinContent) return;
    saveHistory();
    setTranslatingId(item.id);
    try {
      const translation = await translateText(item.metadata.latinContent);
      handleUpdateItem(item.id, { content: translation });
    } catch (e) {
      alert("Translation failed");
    } finally {
      setTranslatingId(null);
    }
  };

  const generatePropers = async (date: string, occasion: string, settingOverride?: string) => {
    saveHistory();
    setIsGenerating(true);
    setExpandedId(null);
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
            setFeastOptions(result.feasts);
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
      if (result.date) {
        setMetadata(prev => ({ ...prev, date: result.date! }));
      } else {
        alert("Could not find a date for this feast in the current year.");
      }
    } catch (e) {
      alert("Failed to lookup feast.");
    } finally {
      setIsLookingUp(null);
    }
  };

  const handleSelectFeast = async (feast: string) => {
    setMetadata(prev => ({ ...prev, occasion: feast }));
    setShowFeastModal(false);
    await generatePropers(metadata.date, feast);
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
    setExpandedId(null);
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
        const newMetadata = { ...metadata, ...result.metadata };
        setMetadata(newMetadata);
        setItems(result.items);
        if (result.metadata.date) {
            setImportStatus(`Found date (${result.metadata.date}). Fetching proper texts...`);
            try {
                const enrichedItems = await enrichLiturgyItems(
                    result.items, 
                    result.metadata.date, 
                    result.metadata.occasion || 'Mass'
                );
                setItems(enrichedItems);
            } catch (enrichError) {
                console.warn("Auto-enrich failed", enrichError);
            }
        }
        setImportStatus("Import Complete!");
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

  const handleSendChat = async () => {
    if (!chatInput.trim() || isChatProcessing) return;
    const userMsg = chatInput;
    setChatInput("");
    setChatHistory(prev => [...prev, { role: 'user', content: userMsg }]);
    setIsChatProcessing(true);
    setExpandedId(null);
    saveHistory();
    try {
        const result = await processLiturgyEdit(items, userMsg);
        setItems(result.items);
        setChatHistory(prev => [...prev, { role: 'ai', content: result.reply }]);
    } catch (e: any) {
        setChatHistory(prev => [...prev, { role: 'ai', content: "Sorry, I encountered an error." }]);
    } finally {
        setIsChatProcessing(false);
    }
  };

  const handleOrdinarySettingChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const newSetting = e.target.value;
      setMetadata(prev => ({ ...prev, ordinarySetting: newSetting }));
      
      setItems(prevItems => prevItems.map(item => {
          // Propagate setting to all Ordinaries except Credo (which usually stays Credo III)
          const isOrdinary = item.type === 'ordinary';
          const isCredo = item.title.toLowerCase().includes('credo') || item.title.toLowerCase().includes('creed');
          
          if (isOrdinary && !isCredo) {
              return {
                  ...item,
                  metadata: {
                      ...item.metadata,
                      setting: newSetting
                  }
              };
          }
          return item;
      }));
  };

  return (
    <div className="no-print flex flex-col h-full bg-white/95 backdrop-blur-xl border-r border-gray-200/50 shadow-2xl z-10 w-[420px] flex-shrink-0 relative">
      <input type="file" ref={fileInputRef} onChange={handlePdfUpload} accept="application/pdf" className="hidden" />
      {showFeastModal && (
        <div className="absolute inset-0 z-50 bg-black/10 backdrop-blur-[1px] flex items-center justify-center p-4 animate-in fade-in duration-200">
            <div className="bg-white rounded-lg shadow-xl border border-gray-200 w-full max-w-sm overflow-hidden">
                <div className="bg-church-50 p-3 border-b border-gray-100 flex items-center justify-between">
                    <h3 className="text-sm font-bold text-church-800">Select Liturgy</h3>
                    <button onClick={() => setShowFeastModal(false)} className="text-gray-400 hover:text-gray-600"><X size={16} /></button>
                </div>
                <div className="p-2 max-h-64 overflow-y-auto">
                    <div className="space-y-1">
                        {feastOptions.map((feast, i) => (
                            <button key={i} onClick={() => handleSelectFeast(feast)} className="w-full text-left px-3 py-2 text-sm rounded hover:bg-church-50 text-gray-700 hover:text-church-800 transition-colors flex items-center justify-between group">
                                <span>{feast}</span>
                                <Wand2 size={12} className="opacity-0 group-hover:opacity-100 text-church-500" />
                            </button>
                        ))}
                    </div>
                </div>
            </div>
        </div>
      )}
      <div className="flex bg-gray-50/80 p-1.5 gap-1 border-b border-gray-200/50">
        <button onClick={() => setActiveTab('build')} className={`flex-1 py-2.5 rounded-md text-sm font-medium flex items-center justify-center gap-2 transition-all duration-200 ${activeTab === 'build' ? 'text-church-800 bg-white shadow-sm ring-1 ring-black/5' : 'text-gray-500 hover:text-church-600 hover:bg-gray-200/50'}`}><GripVertical size={16} /> Builder</button>
        <button onClick={() => setActiveTab('chat')} className={`flex-1 py-2.5 rounded-md text-sm font-medium flex items-center justify-center gap-2 transition-all duration-200 ${activeTab === 'chat' ? 'text-church-800 bg-white shadow-sm ring-1 ring-black/5' : 'text-gray-500 hover:text-church-600 hover:bg-gray-200/50'}`}><MessageSquare size={16} /> Chat</button>
        <button onClick={() => setActiveTab('settings')} className={`flex-1 py-2.5 rounded-md text-sm font-medium flex items-center justify-center gap-2 transition-all duration-200 ${activeTab === 'settings' ? 'text-church-800 bg-white shadow-sm ring-1 ring-black/5' : 'text-gray-500 hover:text-church-600 hover:bg-gray-200/50'}`}><Settings size={16} /> Details</button>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-6 flex flex-col">
        {activeTab === 'settings' && (
          <div className="space-y-4 animate-in fade-in slide-in-from-left-4 duration-300">
             <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-gray-900 uppercase tracking-wide">Mass Details</h3>
                <div className="flex gap-1">
                    <button onClick={undo} disabled={!canUndo} className="p-1.5 border border-gray-200 bg-white rounded-md shadow-sm text-gray-600 hover:text-church-700 hover:shadow disabled:opacity-30 transition-all" title="Undo"><Undo2 size={14}/></button>
                    <button onClick={resetApp} className="p-1.5 border border-gray-200 bg-white rounded-md shadow-sm text-gray-600 hover:text-red-600 hover:shadow transition-all" title="Reset All Content & Layout"><RotateCcw size={14}/></button>
                </div>
             </div>
             <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">Church Name</label>
                <input type="text" value={metadata.churchName} onChange={(e) => setMetadata({...metadata, churchName: e.target.value})} className="w-full bg-gray-50 border border-gray-200/80 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-church-500/20 focus:border-church-500 transition-all shadow-inner" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                 <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1">Date</label>
                  <div className="relative flex items-center">
                    <input type="date" value={metadata.date} onChange={(e) => setMetadata({...metadata, date: e.target.value})} className="w-full border border-gray-300 rounded-l px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-church-500" />
                    <button onClick={handleDateLookup} disabled={isLookingUp === 'feast'} className="bg-church-100 border border-l-0 border-church-200 text-church-700 p-2 rounded-r hover:bg-church-200 transition-colors">
                        {isLookingUp === 'feast' ? <Loader2 size={16} className="animate-spin"/> : <Wand2 size={16} />}
                    </button>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1">Time</label>
                  <input type="text" value={metadata.time} onChange={(e) => setMetadata({...metadata, time: e.target.value})} className="w-full bg-gray-50 border border-gray-200/80 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-church-500/20 focus:border-church-500 transition-all shadow-inner" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">Occasion / Feast</label>
                <div className="relative flex items-center">
                    <input type="text" placeholder="e.g. 3rd Sunday of Advent" value={metadata.occasion} onChange={(e) => setMetadata({...metadata, occasion: e.target.value})} className="w-full border border-gray-300 rounded-l px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-church-500" />
                     <button onClick={handleFeastLookup} disabled={isLookingUp === 'date'} className="bg-gray-100 border border-l-0 border-gray-300 text-gray-600 p-2 rounded-r hover:bg-gray-200 transition-colors">
                        {isLookingUp === 'date' ? <Loader2 size={16} className="animate-spin"/> : <Search size={16} />}
                    </button>
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">Mass Ordinary Setting</label>
                <div className="relative">
                    <input list="ordinary-settings" type="text" value={metadata.ordinarySetting} onChange={handleOrdinarySettingChange} className="w-full bg-gray-50 border border-gray-200/80 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-church-500/20 focus:border-church-500 transition-all shadow-inner" placeholder="Select or type a setting..." />
                    <datalist id="ordinary-settings">{COMMON_ORDINARIES.map(o => <option key={o} value={o} />)}</datalist>
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">Celebrant</label>
                <input type="text" value={metadata.celebrant} onChange={(e) => setMetadata({...metadata, celebrant: e.target.value})} className="w-full bg-gray-50 border border-gray-200/80 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-church-500/20 focus:border-church-500 transition-all shadow-inner" />
              </div>
             </div>
             <div className="pt-4 border-t border-gray-100">
                <button onClick={handleAutoPopulate} disabled={isGenerating} className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-church-600 to-church-800 text-white rounded-lg py-3 shadow-md hover:shadow-lg hover:-translate-y-0.5 text-sm font-medium transition-all active:scale-95 disabled:opacity-50 disabled:transform-none">
                  {isGenerating ? <Loader2 size={16} className="animate-spin" /> : <><Wand2 size={16} /> Auto-Populate Propers</>}
                </button>
             </div>
          </div>
        )}
        {activeTab === 'chat' && (
            <div className="flex flex-col h-full animate-in fade-in slide-in-from-right-4 duration-300">
                <div className="flex items-center justify-between pb-2 border-b border-gray-100 mb-2">
                     <span className="text-xs font-bold text-gray-400 uppercase tracking-wide">Assistant</span>
                     <div className="flex gap-1">
                         <button onClick={undo} disabled={!canUndo} className="p-1.5 border border-gray-200 bg-white rounded-md shadow-sm text-gray-600 hover:text-church-700 hover:shadow disabled:opacity-30 transition-all" title="Undo"><Undo2 size={14}/></button>
                         <button onClick={resetApp} className="p-1.5 border border-gray-200 bg-white rounded-md shadow-sm text-gray-600 hover:text-red-600 hover:shadow transition-all" title="Reset All Content & Layout"><RotateCcw size={14}/></button>
                     </div>
                </div>
                <div className="flex-1 overflow-y-auto space-y-4 p-1">
                    {chatHistory.map((msg, i) => (
                        <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                            <div className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${msg.role === 'user' ? 'bg-church-600 text-white rounded-br-none' : 'bg-gray-100 text-gray-800 rounded-bl-none'}`}>{msg.content}</div>
                        </div>
                    ))}
                    {isChatProcessing && (
                        <div className="flex justify-start">
                            <div className="bg-gray-100 rounded-lg rounded-bl-none px-3 py-2 text-sm text-gray-500 flex items-center gap-2"><BrainCircuit size={14} className="animate-pulse" /> Thinking...</div>
                        </div>
                    )}
                    <div ref={chatEndRef} />
                </div>
                <div className="pt-4 mt-2 border-t border-gray-100">
                     <div className="relative">
                        <textarea value={chatInput} onChange={(e) => setChatInput(e.target.value)} onKeyDown={(e) => { if(e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendChat(); } }} placeholder="Describe changes..." className="w-full bg-gray-50 border border-gray-200 rounded-md pl-3 pr-10 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-church-500 resize-none" rows={2} />
                        <button onClick={handleSendChat} disabled={isChatProcessing || !chatInput.trim()} className="absolute right-2 bottom-2 p-1.5 bg-church-600 text-white rounded hover:bg-church-700 disabled:opacity-50 transition-colors"><Send size={14} /></button>
                     </div>
                </div>
            </div>
        )}
        {activeTab === 'build' && (
          <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
             <div className="flex gap-2 mb-3">
                 <button onClick={triggerFileUpload} disabled={isImporting} className="flex-1 flex items-center justify-center gap-2 bg-stone-800 text-white p-2.5 rounded-lg shadow-md hover:shadow-lg hover:-translate-y-0.5 transition-all text-xs font-bold uppercase tracking-wide disabled:opacity-70 disabled:transform-none active:scale-95">
                   {isImporting ? <Loader2 size={14} className="animate-spin"/> : <FileUp size={14} />} {isImporting ? "Processing..." : "Import PDF"}
                 </button>
                 <button onClick={undo} disabled={!canUndo} className="flex items-center justify-center gap-2 bg-white text-gray-600 border border-gray-200 p-2.5 rounded-lg shadow-sm hover:shadow hover:bg-gray-50 hover:text-church-700 transition-all text-xs font-bold uppercase tracking-wide disabled:opacity-40 active:scale-95"><Undo2 size={14} /></button>
                 <button onClick={resetApp} className="flex items-center justify-center gap-2 bg-white text-gray-600 border border-gray-200 p-2.5 rounded-lg shadow-sm hover:shadow hover:bg-gray-50 hover:text-red-600 transition-all text-xs font-bold uppercase tracking-wide active:scale-95" title="Reset All Content & Layout"><RotateCcw size={14} /></button>
            </div>
            {isImporting && importStatus && (
                <div className="bg-church-50 rounded-md p-3 border border-church-100 shadow-sm animate-in fade-in slide-in-from-top-1">
                    <div className="flex items-center gap-2 text-xs font-medium text-church-800"><BrainCircuit size={14} className="text-church-600 animate-pulse" /><span>{importStatus}</span></div>
                </div>
             )}
            <div className="grid grid-cols-5 gap-2">
              <div draggable onDragStart={(e) => handleDragStart(e, 'header')} onDragEnd={handleDragEnd} onClick={() => handleAddItem('header')} className="cursor-grab active:cursor-grabbing flex flex-col items-center justify-center p-2 rounded border border-gray-200 hover:bg-church-50 hover:border-church-300 transition-all gap-1 text-xs font-medium text-gray-600 select-none"><TypeIcon size={16} className="text-church-600 pointer-events-none"/> Title</div>
              <div draggable onDragStart={(e) => handleDragStart(e, 'hymn')} onDragEnd={handleDragEnd} onClick={() => handleAddItem('hymn')} className="cursor-grab active:cursor-grabbing flex flex-col items-center justify-center p-2 rounded border border-gray-200 hover:bg-church-50 hover:border-church-300 transition-all gap-1 text-xs font-medium text-gray-600 select-none"><Music size={16} className="text-church-600 pointer-events-none"/> Hymn</div>
              <div draggable onDragStart={(e) => handleDragStart(e, 'reading')} onDragEnd={handleDragEnd} onClick={() => handleAddItem('reading')} className="cursor-grab active:cursor-grabbing flex flex-col items-center justify-center p-2 rounded border border-gray-200 hover:bg-church-50 hover:border-church-300 transition-all gap-1 text-xs font-medium text-gray-600 select-none"><Calendar size={16} className="text-church-600 pointer-events-none"/> Reading</div>
               <div draggable onDragStart={(e) => handleDragStart(e, 'proper')} onDragEnd={handleDragEnd} onClick={() => handleAddItem('proper')} className="cursor-grab active:cursor-grabbing flex flex-col items-center justify-center p-2 rounded border border-gray-200 hover:bg-church-50 hover:border-church-300 transition-all gap-1 text-xs font-medium text-gray-600 select-none"><BookOpen size={16} className="text-church-600 pointer-events-none"/> Proper</div>
              <div draggable onDragStart={(e) => handleDragStart(e, 'ordinary')} onDragEnd={handleDragEnd} onClick={() => handleAddItem('ordinary')} className="cursor-grab active:cursor-grabbing flex flex-col items-center justify-center p-2 rounded border border-gray-200 hover:bg-church-50 hover:border-church-300 transition-all gap-1 text-xs font-medium text-gray-600 select-none"><Scroll size={16} className="text-church-600 pointer-events-none"/> Ordinary</div>
            </div>
            <div className="space-y-0.5 pb-20">
              {items.map((item, index) => {
                const isExpanded = expandedId === item.id;
                return (
                <React.Fragment key={item.id}>
                    <div onDragOver={(e) => { e.preventDefault(); setDragOverIndex(index); }} onDrop={(e) => handleDrop(e, index)} className={`transition-all duration-200 ${dragOverIndex === index ? 'h-8 bg-church-50 border-2 border-dashed border-church-400 rounded-md my-1 flex items-center justify-center text-xs text-church-600 font-medium' : isDragging ? 'h-2 my-0.5 rounded bg-gray-50 border border-dashed border-gray-300/50' : 'h-0 opacity-0 overflow-hidden'}`}>{dragOverIndex === index && <span className="flex items-center gap-1 pointer-events-none"><PlusCircle size={12}/> Drop to Insert</span>}</div>
                    <div className={`group bg-white border border-gray-200/70 rounded-xl shadow-sm hover:shadow transition-all duration-200 overflow-hidden ${isExpanded ? 'ring-2 ring-church-500/20 border-church-300 shadow-md my-3' : 'hover:border-church-300'}`}>
                      <div onClick={() => setExpandedId(isExpanded ? null : item.id)} className={`px-3 py-2 flex items-center justify-between cursor-pointer select-none transition-colors ${isExpanded ? 'bg-gray-50/80 border-b border-gray-200/60 py-2.5' : 'bg-white hover:bg-gray-50/50'}`}>
                        <div className="flex items-center gap-2 overflow-hidden w-full">
                          <span className="text-gray-400 shrink-0">{isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}</span>
                          <span className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded text-white shrink-0 w-16 text-center ${item.type === 'hymn' ? 'bg-blue-600' : item.type === 'reading' ? 'bg-red-700' : item.type === 'proper' ? 'bg-amber-600' : item.type === 'ordinary' ? 'bg-slate-600' : 'bg-gray-500'}`}>{item.type}</span>
                          <div className="flex flex-col truncate flex-1"><span className={`text-xs font-medium truncate ${item.title ? 'text-gray-700' : 'text-gray-400 italic'}`}>{item.title || "Untitled Item"}</span></div>
                          {!isExpanded && (
                             <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity" onClick={(e) => e.stopPropagation()}>
                                <button onClick={() => handleMoveItem(index, 'up')} disabled={index === 0} className="p-0.5 hover:bg-gray-100 rounded disabled:opacity-30 text-gray-500"><ArrowUp size={12} /></button>
                                <button onClick={() => handleMoveItem(index, 'down')} disabled={index === items.length - 1} className="p-0.5 hover:bg-gray-100 rounded disabled:opacity-30 text-gray-500"><ArrowDown size={12} /></button>
                                <button onClick={() => handleDeleteItem(item.id)} className="p-0.5 hover:bg-red-50 text-red-400 hover:text-red-600 rounded ml-1"><Trash2 size={12} /></button>
                             </div>
                          )}
                        </div>
                      </div>
                      {isExpanded && (
                      <div className="p-3 space-y-3 bg-white animate-in slide-in-from-top-1 duration-200">
                        <div className="flex justify-end mb-1"><div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}><button onClick={() => handleMoveItem(index, 'up')} disabled={index === 0} className="p-1 hover:bg-gray-100 rounded disabled:opacity-30 text-gray-500"><ArrowUp size={14} /></button><button onClick={() => handleMoveItem(index, 'down')} disabled={index === items.length - 1} className="p-1 hover:bg-gray-100 rounded disabled:opacity-30 text-gray-500"><ArrowDown size={14} /></button><button onClick={() => handleDeleteItem(item.id)} className="p-1 hover:bg-red-50 text-red-400 hover:text-red-600 rounded ml-1"><Trash2 size={14} /></button></div></div>
                        <input type="text" value={item.title} onChange={(e) => handleUpdateItem(item.id, { title: e.target.value })} placeholder="Title..." className="w-full text-sm font-semibold text-gray-800 border-none p-0 focus:ring-0 placeholder-gray-300" />
                        <input type="text" value={item.subtitle || ''} onChange={(e) => handleUpdateItem(item.id, { subtitle: e.target.value })} placeholder="Subtitle..." className="w-full text-xs text-gray-500 border-none p-0 focus:ring-0 placeholder-gray-300 italic" />
                        <div className="flex gap-2">
                            {['hymn', 'reading', 'proper'].includes(item.type) && <input type="text" value={item.metadata?.reference || item.metadata?.tune || ''} onChange={(e) => handleUpdateItem(item.id, { metadata: { ...item.metadata, [item.type === 'reading' ? 'reference' : 'tune']: e.target.value } })} placeholder="Ref/Tune" className="flex-1 text-xs bg-gray-50 border border-gray-200 rounded px-2 py-1 focus:outline-none focus:border-church-400" />}
                            {(item.type === 'hymn' || item.type === 'ordinary') && <input type="text" value={item.metadata?.pageNumber || ''} onChange={(e) => handleUpdateItem(item.id, { metadata: { ...item.metadata, pageNumber: e.target.value } })} placeholder="#" className="w-16 text-xs bg-gray-50 border border-gray-200 rounded px-2 py-1 focus:outline-none focus:border-church-400" />}
                            {(item.type === 'ordinary') && <input type="text" value={item.metadata?.setting || ''} onChange={(e) => handleUpdateItem(item.id, { metadata: { ...item.metadata, setting: e.target.value } })} placeholder="Setting" className="flex-1 text-xs bg-gray-50 border border-gray-200 rounded px-2 py-1 focus:outline-none focus:border-church-400" />}
                        </div>
                        {(item.type === 'proper' || item.type === 'hymn' || item.type === 'ordinary') && (
                            <div className="relative">
                                <textarea value={item.metadata?.latinContent || ''} onChange={(e) => handleUpdateItem(item.id, { metadata: { ...item.metadata, latinContent: e.target.value } })} placeholder="Latin..." rows={2} className="w-full text-sm text-gray-600 border border-gray-200 rounded p-2 focus:ring-1 focus:ring-church-500 focus:border-church-500 font-serif italic mb-2" />
                                {item.metadata?.latinContent && !item.content && <button onClick={() => handleTranslate(item)} disabled={translatingId === item.id} className="absolute bottom-4 right-2 text-xs bg-white border border-gray-200 px-2 py-1 rounded shadow-sm hover:bg-gray-50 flex items-center gap-1 text-church-600">{translatingId === item.id ? '...' : <><Languages size={12}/> Translate</>}</button>}
                            </div>
                        )}
                        <textarea value={item.content} onChange={(e) => handleUpdateItem(item.id, { content: e.target.value })} placeholder="Content..." rows={item.content.split('\n').length > 5 ? 8 : 3} className="w-full text-sm text-gray-600 border border-gray-200 rounded p-2 focus:ring-1 focus:ring-church-500 focus:border-church-500 font-serif" />
                      </div>
                      )}
                    </div>
                </React.Fragment>
              )})}
              <div onDragOver={(e) => { e.preventDefault(); setDragOverIndex(items.length); }} onDrop={(e) => handleDrop(e, items.length)} className={`transition-all duration-200 ${dragOverIndex === items.length ? 'h-12 bg-church-50 border-2 border-dashed border-church-400 rounded-md my-1 flex items-center justify-center text-xs text-church-600 font-medium' : isDragging ? 'h-12 border-2 border-dashed border-gray-100 rounded-lg flex items-center justify-center text-xs text-gray-300 my-2' : 'h-0 opacity-0 overflow-hidden'}`}>{dragOverIndex === items.length && <span className="flex items-center gap-1 pointer-events-none"><PlusCircle size={12}/> Drop to Append</span>}</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};