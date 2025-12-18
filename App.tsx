
import React, { useState, useCallback } from 'react';
import { EditorPanel } from './components/EditorPanel';
import { PreviewPanel } from './components/PreviewPanel';
import { LiturgyItem, MassMetadata, PageSettings } from './types';
import { DEFAULT_METADATA, DEFAULT_PAGE_SETTINGS, INITIAL_ITEMS } from './constants';

const App: React.FC = () => {
  // Initialize with deep clones of constants to ensure the "factory" version is never mutated by reference
  const [items, setItems] = useState<LiturgyItem[]>(() => JSON.parse(JSON.stringify(INITIAL_ITEMS)));
  const [metadata, setMetadata] = useState<MassMetadata>(() => JSON.parse(JSON.stringify(DEFAULT_METADATA)));
  const [pageSettings, setPageSettings] = useState<PageSettings>(() => JSON.parse(JSON.stringify(DEFAULT_PAGE_SETTINGS)));

  // History State
  const [history, setHistory] = useState<{items: LiturgyItem[], metadata: MassMetadata}[]>([]);

  const saveHistory = useCallback(() => {
    setHistory(prev => {
        const newHistory = [...prev, { items: JSON.parse(JSON.stringify(items)), metadata: JSON.parse(JSON.stringify(metadata)) }];
        // Limit history to last 20 states to prevent memory issues
        if (newHistory.length > 20) return newHistory.slice(newHistory.length - 20);
        return newHistory;
    });
  }, [items, metadata]);

  const undo = useCallback(() => {
    setHistory(prev => {
        if (prev.length === 0) return prev;
        const lastState = prev[prev.length - 1];
        setItems(lastState.items);
        setMetadata(lastState.metadata);
        return prev.slice(0, -1);
    });
  }, []);

  const resetApp = useCallback(() => {
    if (window.confirm("Are you sure you want to reset everything? All current changes, layout settings, and content will be lost.")) {
        saveHistory();
        setItems(JSON.parse(JSON.stringify(INITIAL_ITEMS)));
        setMetadata(JSON.parse(JSON.stringify(DEFAULT_METADATA)));
        setPageSettings(JSON.parse(JSON.stringify(DEFAULT_PAGE_SETTINGS)));
    }
  }, [saveHistory]);

  return (
    <div id="app-container" className="flex h-screen w-screen overflow-hidden bg-gray-100">
      <div className="flex h-full w-full">
        <EditorPanel 
          items={items} 
          setItems={setItems} 
          metadata={metadata}
          setMetadata={setMetadata}
          saveHistory={saveHistory}
          undo={undo}
          canUndo={history.length > 0}
          resetApp={resetApp}
        />
        <PreviewPanel 
          items={items} 
          setItems={setItems}
          metadata={metadata}
          pageSettings={pageSettings}
          setPageSettings={setPageSettings}
        />
      </div>
    </div>
  );
};

export default App;
