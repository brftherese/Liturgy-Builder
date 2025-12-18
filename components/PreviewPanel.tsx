
import React, { useRef, useEffect, useState } from 'react';
import { LiturgyItem, MassMetadata, PageSettings } from '../types';
import { PAGE_DIMENSIONS } from '../constants';
import { Printer, ZoomIn, ZoomOut, Maximize2, Minimize2, RefreshCw, ScanLine, FileText, Settings2, ChevronDown, Columns } from 'lucide-react';

interface PreviewPanelProps {
  items: LiturgyItem[];
  setItems: React.Dispatch<React.SetStateAction<LiturgyItem[]>>;
  metadata: MassMetadata;
  pageSettings: PageSettings;
  setPageSettings: React.Dispatch<React.SetStateAction<PageSettings>>;
}

export const PreviewPanel: React.FC<PreviewPanelProps> = ({ items, setItems, metadata, pageSettings, setPageSettings }) => {
  const [zoom, setZoom] = React.useState(0.55);
  const contentRef = useRef<HTMLDivElement>(null);
  const hiddenMeasureRef = useRef<HTMLDivElement>(null);
  const [totalPages, setTotalPages] = useState(1);
  const [showGuides, setShowGuides] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [showPrintMenu, setShowPrintMenu] = useState(false);
  const [showFitMenu, setShowFitMenu] = useState(false);
  const [forceBlackText, setForceBlackText] = useState(false);

  const dim = PAGE_DIMENSIONS[pageSettings.size];
  const PPI = 96; // Standard CSS Inch
  
  // Dimensional Calculations
  const pageHeightPx = parseFloat(dim.height.replace('in', '')) * PPI;
  const pageWidthPx = parseFloat(dim.width.replace('in', '')) * PPI;
  const marginPx = pageSettings.margins * PPI;
  
  // Printable area (strictly used for page count calculation)
  const printableHeightPx = pageHeightPx - (marginPx * 2);
  const printableWidthPx = pageWidthPx - (marginPx * 2);
  
  const gapPx = 48; // 0.5 inch visual gap between pages in spread view

  // BASE FONT SIZE CALCULATION
  const baseFontSizePt = 11 * pageSettings.fontScale;

  // Calculate page count based on actual content height from the hidden measure div
  useEffect(() => {
    if (!hiddenMeasureRef.current) return;

    const measure = () => {
        const contentHeight = hiddenMeasureRef.current?.scrollHeight || 0;
        if (contentHeight === 0) {
            setTotalPages(1);
            return;
        }
        // Calculate raw pages needed
        const pages = Math.ceil(contentHeight / printableHeightPx);
        setTotalPages(Math.max(1, pages));
    };

    // Initial measure
    measure();

    // Observe changes to the content size
    const observer = new ResizeObserver(measure);
    observer.observe(hiddenMeasureRef.current);

    return () => observer.disconnect();
  }, [printableHeightPx, items, pageSettings, baseFontSizePt]);


  const totalLayoutWidth = totalPages * pageWidthPx + Math.max(0, totalPages - 1) * gapPx;
  const scaledWidth = totalLayoutWidth * zoom;
  const scaledHeight = pageHeightPx * zoom;

  const handlePrint = (mode: 'standard' | '2up' = 'standard') => {
    if (!contentRef.current) return;
    setShowPrintMenu(false);

    const is2Up = mode === '2up';
    const marginValue = pageSettings.margins;
    
    // STRICT PRINT CSS GENERATION
    // 1. @page: Defines physical margins.
    // For 2-Up, we apply vertical margins to the page itself so they repeat on every sheet.
    // We set horizontal margins to 0 because the split columns handle the side spacing.
    const pageRule = is2Up 
        ? `@page { size: letter landscape; margin: ${marginValue}in 0; }`
        : `@page { margin: ${marginValue}in; size: ${pageSettings.size} ${pageSettings.orientation}; }`;

    const colorOverride = forceBlackText ? `
        *, .text-church-900, .text-church-800, .text-church-700, .text-gray-500, .text-gray-400, .text-red-700, .text-blue-600, .text-gray-600, .text-gray-900 {
            color: #000000 !important;
        }
        .border-church-100, .border-church-200, .border-gray-100, .border-gray-200 {
            border-color: #000000 !important;
            border-style: solid !important;
        }
    ` : '';

    const innerHtml = contentRef.current.innerHTML;

    // For standard print, we DO NOT wrap in a constrained container. We let it flow naturally.
    const contentHtml = is2Up 
        ? `
            <div class="split-layout">
                <div class="split-col left-col">
                    <div class="content-wrapper">${innerHtml}</div>
                </div>
                <div class="split-col right-col">
                    <div class="content-wrapper">${innerHtml}</div>
                </div>
            </div>
          `
        : `<div class="standard-flow">${innerHtml}</div>`;

    const htmlContent = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <title>${metadata.churchName} - Liturgy</title>
        <script src="https://cdn.tailwindcss.com"></script>
        <script>
          tailwind.config = {
            theme: {
              extend: {
                fontFamily: {
                  sans: ['Inter', 'sans-serif'],
                  serif: ['Merriweather', 'serif'],
                  display: ['Cinzel', 'serif'],
                },
                colors: {
                  church: {
                    50: '#fcfbf9',
                    100: '#f6f3ef',
                    200: '#ede6dd',
                    300: '#e0d1c1',
                    400: '#d1bda3',
                    500: '#ac8e68',
                    600: '#9d7d59',
                    700: '#836649',
                    800: '#6d5540',
                    900: '#594636',
                  }
                }
              }
            }
          }
        </script>
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Merriweather:ital,wght@0,300;0,400;0,700;1,300;1,400&family=Cinzel:wght@400;600&display=swap" rel="stylesheet">
        <style>
           ${pageRule}
           
           html {
             -webkit-print-color-adjust: exact;
             print-color-adjust: exact;
             height: auto;
           }
           
           body {
             margin: 0;
             padding: 0;
             background: white;
             font-size: ${baseFontSizePt}pt; 
             line-height: ${pageSettings.lineHeight};
             font-family: 'Inter', sans-serif;
             -webkit-font-smoothing: antialiased;
             height: auto;
             overflow: visible;
             display: block;
           }

           /* Helper: Ensure elements don't get stuck at the bottom */
           p, h1, h2, h3, .group {
             orphans: 3;
             widows: 3;
           }
           
           .font-serif { font-family: 'Merriweather', serif; }
           .font-display { font-family: 'Cinzel', serif; }
           .font-sans { font-family: 'Inter', sans-serif; }

           /* Layout Containers */
           .standard-flow {
             width: 100%;
             margin: 0;
             padding: 0;
             /* We do NOT add padding here. @page handles margins on all pages. */
           }

           /* 2-Up Split Layout */
           .split-layout {
             display: flex;
             width: 100%;
             overflow: visible; 
             /* We allow the flex container to grow indefinitely so content flows to next pages */
           }
           .split-col {
             width: 50%;
             box-sizing: border-box;
             /* Only apply horizontal padding. Vertical is handled by @page to ensure it repeats on page 2+ */
             padding: 0 ${pageSettings.margins}in; 
             position: relative;
           }
           .left-col::after {
             content: "";
             position: absolute;
             top: 0; bottom: 0; right: 0;
             border-right: 1px dashed #000;
             opacity: 0.2;
           }

           /* Typography Utilities */
           .text-center { text-align: center; }
           .text-right { text-align: right; }
           .text-justify { text-align: justify; }
           .font-bold { font-weight: 700; }
           .italic { font-style: italic; }
           .uppercase { text-transform: uppercase; }
           .flex { display: flex; }
           .grid { display: grid; }
           .grid-cols-2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
           .gap-4 { gap: 1rem; }
           .items-center { align-items: center; }
           .justify-between { justify-content: space-between; }
           .justify-center { justify-content: center; }
           .border-b { border-bottom-width: 1px; border-style: solid; border-color: #e5e7eb; }
           .border-t { border-top-width: 1px; border-style: solid; border-color: #e5e7eb; }
           .border-r { border-right-width: 1px; border-style: solid; border-color: #e5e7eb; }
           .border-l-2 { border-left-width: 2px; border-style: solid; border-color: #e5e7eb; }
           .border-double { border-style: double; }
           .text-sm { font-size: 0.875em; }
           .text-xs { font-size: 0.75em; }

           /* Color Override */
           ${colorOverride}
        </style>
      </head>
      <body>
        ${contentHtml}
        <script>
            window.onload = () => { setTimeout(() => window.print(), 500); };
        </script>
      </body>
      </html>
    `;

    const blob = new Blob([htmlContent], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const newWindow = window.open(url, '_blank');
    if (!newWindow) {
        alert("Pop-up blocked. Please allow pop-ups to print.");
    }
  };

  const renderContent = (text: string) => {
    return text.split('\n').map((line, i) => (
      <React.Fragment key={i}>
        {line}
        <br />
      </React.Fragment>
    ));
  };

  const formatDate = (dateStr: string) => {
    if (!dateStr) return "";
    try {
        const dateObj = new Date(dateStr + 'T12:00:00');
        if (isNaN(dateObj.getTime())) return dateStr;
        return dateObj.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    } catch {
        return dateStr;
    }
  };

  const formatPageNumber = (val: string) => {
    // Standardize page number display to "p. [number]"
    // Remove existing 'p.', 'pg', 'no', '#' prefixes to avoid duplication
    const clean = val.replace(/^(p\.?|pg\.?|no\.?|#)\s*/i, '').trim();
    return `p. ${clean}`;
  };

  const handleSmartFit = (targetPages: number) => {
    if (!hiddenMeasureRef.current) return;
    const currentHeight = hiddenMeasureRef.current.scrollHeight;
    const availableHeight = printableHeightPx * targetPages;
    const targetFillHeight = availableHeight * 0.95; 
    let ratio = targetFillHeight / currentHeight;

    setPageSettings(prev => {
        const safeRatio = Math.pow(ratio, 0.9);
        const newFont = Math.min(2.5, Math.max(0.6, prev.fontScale * safeRatio));
        const newGap = Math.min(2.5, Math.max(0.2, prev.verticalGapScale * safeRatio));
        const newHeader = Math.min(1.8, Math.max(0.6, prev.headerScale * safeRatio));
        const newLineHeight = Math.min(2.0, Math.max(1.0, prev.lineHeight * Math.pow(safeRatio, 0.3)));

        return {
            ...prev,
            fontScale: parseFloat(newFont.toFixed(2)),
            verticalGapScale: parseFloat(newGap.toFixed(2)),
            headerScale: parseFloat(newHeader.toFixed(2)),
            lineHeight: parseFloat(newLineHeight.toFixed(2))
        };
    });
  };

  const ContentInner = () => {
    const baseGap = `${0.5 * pageSettings.verticalGapScale}rem`;
    const sectionGap = `${1.25 * pageSettings.verticalGapScale}rem`;
    const headerSize = `${1.5 * pageSettings.headerScale}em`;
    const subHeaderSize = `${1.0 * pageSettings.headerScale}em`;
    const titleSize = `${2.0 * pageSettings.headerScale}em`;

    return (
      <>
        <header style={{ marginBottom: sectionGap, paddingBottom: baseGap }} className="text-center border-b-2 border-double border-church-200">
            <h1 style={{ fontSize: titleSize, marginBottom: '0.2em' }} className="font-display font-bold text-church-900 uppercase tracking-widest leading-tight">
                {metadata.churchName}
            </h1>
            <div style={{ marginBottom: baseGap }} className="text-church-700 font-serif italic text-sm">
                {metadata.occasion}
            </div>
            <div className="flex items-center justify-center gap-4 text-[0.8em] font-sans text-gray-500 uppercase tracking-wider">
                <span>{formatDate(metadata.date)}</span>
                <span>•</span>
                <span>{metadata.time}</span>
            </div>
            {metadata.celebrant && (
                <div className="mt-1 text-[0.8em] font-serif text-gray-400">Celebrant: {metadata.celebrant}</div>
            )}
        </header>

        <div className="font-serif text-gray-900">
            {items.map((item, index) => {
                const isLast = index === items.length - 1;
                const isShort = item.content.length < 500 && !item.metadata?.latinContent;
                
                // Logic to show side-by-side translation
                const showSideBySide = ((item.type === 'proper' || item.type === 'ordinary' || item.type === 'hymn') && item.metadata?.latinContent);
                
                return (
                    <div 
                        key={item.id} 
                        className="w-full group" 
                        style={{ 
                            marginBottom: isLast ? 0 : sectionGap,
                            breakInside: isShort ? 'avoid' : 'auto',
                            pageBreakInside: isShort ? 'avoid' : 'auto'
                        }}
                    >
                        {/* Heading Area */}
                        <div style={{ marginBottom: baseGap, breakAfter: 'avoid', pageBreakAfter: 'avoid' }}>
                            {item.type === 'section-title' || item.type === 'header' ? (
                                <h2 style={{ fontSize: headerSize, paddingBottom: '0.2em', marginTop: baseGap }} className="text-center font-display font-bold text-church-800 border-b border-church-100">
                                    {item.title}
                                </h2>
                            ) : (
                                <div className="flex items-baseline justify-between relative" style={{ marginBottom: '0.2em' }}>
                                    <h3 style={{ fontSize: subHeaderSize }} className="font-bold text-church-900 uppercase tracking-wide">
                                        {item.title}
                                    </h3>
                                    <div className="flex items-center gap-2">
                                        {item.metadata?.setting && <span className="text-[0.85em] italic text-gray-600 font-serif mr-2">{item.metadata.setting}</span>}
                                        {(item.metadata?.tune || item.metadata?.reference) && <span className="text-[0.85em] italic text-gray-500 font-sans">{item.metadata.tune || item.metadata.reference}</span>}
                                        {item.metadata?.pageNumber && <span className="text-[0.8em] font-bold text-church-800 font-sans border border-church-200 px-1 rounded ml-2">{formatPageNumber(item.metadata.pageNumber)}</span>}
                                    </div>
                                </div>
                            )}
                            {item.subtitle && <div style={{ marginTop: '-0.2em', marginBottom: baseGap, fontSize: '0.85em' }} className="text-center italic text-gray-600">{item.subtitle}</div>}
                        </div>

                        {/* Content */}
                        {item.type === 'reading' && (
                            <div className="px-4 text-center">
                                <div className="text-[0.95em] font-serif italic text-gray-800 leading-relaxed">{item.content}</div>
                            </div>
                        )}

                        {showSideBySide && item.metadata?.latinContent ? (
                            <div className="grid grid-cols-2 gap-4" style={{ fontSize: '0.95em' }}>
                                <div className="text-right italic text-gray-600 font-serif border-r border-church-100 pr-4">{renderContent(item.metadata.latinContent)}</div>
                                <div className="text-left text-gray-900 font-serif">{renderContent(item.content)}</div>
                            </div>
                        ) : (
                        (item.type !== 'reading' && item.type !== 'header' && item.type !== 'section-title' && item.content.trim() !== '') && (
                            <div className={`${item.type === 'rubric' ? 'text-red-700 italic text-center px-8' : ''} ${item.type === 'hymn' ? 'whitespace-pre-wrap pl-4 border-l-2 border-church-100' : ''} ${item.type === 'prayer' ? 'text-justify' : ''}`} style={{ fontSize: item.type === 'rubric' ? '0.9em' : '1em' }}>
                                {renderContent(item.content)}
                            </div>
                        )
                        )}
                    </div>
                );
            })}
        </div>
        <div style={{ marginTop: sectionGap, paddingTop: baseGap }} className="border-t border-gray-100 text-center">
            <p className="text-[0.7em] text-gray-400 font-sans">Created with Sanctus • {metadata.churchName}</p>
        </div>
      </>
    );
  };

  return (
    <div className="flex-1 bg-gray-100/50 h-full flex flex-col relative overflow-hidden font-sans">
      
      {/* Inject Dynamic Print Styles for Main Window Printing (Ctrl+P) */}
      <style>{`
        @media print {
            @page {
                margin: ${pageSettings.margins}in !important;
                size: ${pageSettings.size} ${pageSettings.orientation} !important;
            }
            /* Override the global index.html reset to allow @page margins to work */
            .printable-content {
                margin: 0 !important;
                padding: 0 !important;
                position: static !important;
                width: 100% !important;
                height: auto !important;
                overflow: visible !important;
                display: block !important;
                /* Reset Preview Columns/Height so content flows naturally across pages */
                column-count: auto !important;
                column-width: auto !important;
                transform: none !important;
            }
            /* Hide the visual 'paper' background divs */
            .print-scaling-container > div:first-child {
                display: none !important;
            }
        }
      `}</style>

      {/* Hidden Measure Ref */}
      <div 
        className="absolute top-0 left-0 -z-50 opacity-0 pointer-events-none" 
        style={{ 
            width: `${printableWidthPx}px`, 
            fontSize: `${baseFontSizePt}pt`, 
            lineHeight: pageSettings.lineHeight 
        }}
      >
         <div ref={hiddenMeasureRef}><ContentInner /></div>
      </div>

      <div className="bg-white border-b border-gray-200 px-4 py-2 flex items-center justify-between gap-4 z-20 shadow-sm shrink-0 no-print">
            <div className="flex items-center gap-3">
                <div className="relative group">
                     <select 
                        value={pageSettings.size}
                        onChange={(e) => setPageSettings({...pageSettings, size: e.target.value as any})}
                        className="appearance-none pl-8 pr-8 py-1.5 bg-gray-50 border border-gray-200 rounded-md text-xs font-medium text-gray-700 hover:border-gray-300 focus:outline-none focus:ring-2 focus:ring-church-500 transition-all cursor-pointer"
                     >
                        <option value="statement">Statement (5.5" x 8.5")</option>
                        <option value="letter">Letter (8.5" x 11")</option>
                        <option value="legal">Legal (8.5" x 14")</option>
                    </select>
                    <FileText className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" size={14} />
                    <div className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none border-l border-gray-200 pl-1">
                        <ChevronDown className="w-3 h-3 text-gray-400" />
                    </div>
                </div>
                <div className="h-4 w-px bg-gray-200 mx-1"></div>
                <div className="flex items-center bg-gray-50 rounded-md border border-gray-200 p-0.5">
                    <button onClick={() => setZoom(z => Math.max(0.3, z - 0.1))} className="p-1 hover:bg-white hover:shadow-sm rounded-sm text-gray-500 transition-all"><ZoomOut size={14} /></button>
                    <span className="text-[10px] font-mono font-medium text-gray-600 w-10 text-center">{Math.round(zoom * 100)}%</span>
                    <button onClick={() => setZoom(z => Math.min(1.5, z + 0.1))} className="p-1 hover:bg-white hover:shadow-sm rounded-sm text-gray-500 transition-all"><ZoomIn size={14} /></button>
                </div>
            </div>
            <div className="flex items-center gap-2">
                 <div className="relative">
                    <button 
                        onClick={() => setShowFitMenu(!showFitMenu)} 
                        className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-gray-700 bg-white border border-gray-200 rounded-md hover:bg-gray-50 transition-colors shadow-sm"
                    >
                        <ScanLine size={14} />
                        <span className="hidden sm:inline">Smart Fit</span>
                        <ChevronDown size={12} className={`transition-transform duration-200 ${showFitMenu ? 'rotate-180' : ''}`} />
                    </button>
                    {showFitMenu && (
                        <>
                            <div className="fixed inset-0 z-10" onClick={() => setShowFitMenu(false)}></div>
                            <div className="absolute top-full left-0 mt-1 w-40 bg-white rounded-md shadow-lg border border-gray-200 z-20 py-1 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-100">
                                 <button 
                                    onClick={() => { handleSmartFit(1); setShowFitMenu(false); }}
                                    className="w-full text-left px-4 py-2 text-xs text-gray-700 hover:bg-church-50 hover:text-church-700 flex items-center gap-2"
                                >
                                    <Minimize2 size={14} className="text-gray-400" /> Fit to 1 Page
                                </button>
                                <button 
                                    onClick={() => { handleSmartFit(2); setShowFitMenu(false); }}
                                    className="w-full text-left px-4 py-2 text-xs text-gray-700 hover:bg-church-50 hover:text-church-700 flex items-center gap-2"
                                >
                                    <Maximize2 size={14} className="text-gray-400" /> Fit to 2 Pages
                                </button>
                            </div>
                        </>
                    )}
                 </div>
            </div>
            <div className="flex items-center gap-3">
                 <button onClick={() => setShowSettings(!showSettings)} className={`flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-md transition-all border ${showSettings ? 'bg-church-50 text-church-800 border-church-200' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}><Settings2 size={14} /><span>Layout</span></button>
                 
                 <div className="relative">
                    <button 
                        onClick={() => setShowPrintMenu(!showPrintMenu)} 
                        className="flex items-center gap-2 px-4 py-1.5 text-xs font-bold text-white bg-church-800 rounded-md hover:bg-church-900 shadow-sm transition-transform active:scale-95"
                    >
                        <Printer size={14} />
                        <span>Print</span>
                        <ChevronDown size={12} className={`transition-transform duration-200 ${showPrintMenu ? 'rotate-180' : ''}`} />
                    </button>
                    {showPrintMenu && (
                        <>
                            <div className="fixed inset-0 z-10" onClick={() => setShowPrintMenu(false)}></div>
                            <div className="absolute right-0 mt-2 w-64 bg-white rounded-md shadow-lg border border-gray-200 z-20 py-1 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-100">
                                <button 
                                    onClick={() => handlePrint('standard')}
                                    className="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-church-50 hover:text-church-700 flex items-center gap-2"
                                >
                                    <FileText size={14} className="text-gray-400" /> Standard Print
                                </button>
                                {pageSettings.size === 'statement' && (
                                    <button 
                                        onClick={() => handlePrint('2up')}
                                        className="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-church-50 hover:text-church-700 flex items-center gap-2 border-t border-gray-100"
                                    >
                                        <Columns size={14} className="text-gray-400" /> 2-Up on Letter (Landscape)
                                    </button>
                                )}
                                <div className="px-4 py-2 border-t border-gray-100 bg-gray-50/50">
                                    <label className="flex items-center gap-2 text-xs font-medium text-gray-700 cursor-pointer select-none">
                                        <input 
                                            type="checkbox" 
                                            checked={forceBlackText} 
                                            onChange={(e) => setForceBlackText(e.target.checked)} 
                                            className="rounded border-gray-300 text-church-600 focus:ring-church-500 w-3.5 h-3.5" 
                                        />
                                        Force Black Text (No Gray)
                                    </label>
                                </div>
                            </div>
                        </>
                    )}
                 </div>
            </div>
      </div>

      {showSettings && (
            <div className="bg-white border-b border-gray-200 px-6 py-4 shadow-sm z-10 animate-in slide-in-from-top-2 duration-200 no-print">
                <div className="max-w-4xl mx-auto">
                    <div className="flex items-center justify-between mb-4">
                        <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider flex items-center gap-2"><Settings2 size={12}/> Manual Adjustments</h3>
                        <button onClick={() => setPageSettings(prev => ({...prev, fontScale: 1.0, lineHeight: 1.3, margins: 0.5, verticalGapScale: 1.0, headerScale: 1.0}))} className="text-[10px] text-gray-400 hover:text-church-600 flex items-center gap-1 px-2 py-1 rounded hover:bg-gray-50 transition-colors">
                            <RefreshCw size={10} /> Reset Defaults
                        </button>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-6">
                        <div className="space-y-2">
                            <div className="flex justify-between items-center text-xs">
                                <span className="font-medium text-gray-700">Font Scale</span>
                                <input type="number" min="0.5" max="3.0" step="0.05" value={pageSettings.fontScale} onChange={(e) => setPageSettings({...pageSettings, fontScale: parseFloat(e.target.value) || 0})} className="w-12 text-right bg-gray-50 border border-gray-200 rounded px-1 py-0.5 text-[10px] font-mono focus:outline-none focus:ring-1 focus:ring-church-500" />
                            </div>
                            <input type="range" min="0.5" max="3.0" step="0.05" value={pageSettings.fontScale} onChange={(e) => setPageSettings({...pageSettings, fontScale: parseFloat(e.target.value)})} className="w-full h-1.5 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-church-600" />
                        </div>
                        <div className="space-y-2">
                            <div className="flex justify-between items-center text-xs">
                                <span className="font-medium text-gray-700">Line Height</span>
                                <input type="number" min="0.8" max="2.5" step="0.05" value={pageSettings.lineHeight} onChange={(e) => setPageSettings({...pageSettings, lineHeight: parseFloat(e.target.value) || 0})} className="w-12 text-right bg-gray-50 border border-gray-200 rounded px-1 py-0.5 text-[10px] font-mono focus:outline-none focus:ring-1 focus:ring-church-500" />
                            </div>
                             <input type="range" min="0.8" max="2.5" step="0.05" value={pageSettings.lineHeight} onChange={(e) => setPageSettings({...pageSettings, lineHeight: parseFloat(e.target.value)})} className="w-full h-1.5 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-church-600" />
                        </div>
                        <div className="space-y-2">
                             <div className="flex justify-between items-center text-xs">
                                <span className="font-medium text-gray-700">Spacing</span>
                                <input type="number" min="0.0" max="3.0" step="0.1" value={pageSettings.verticalGapScale} onChange={(e) => setPageSettings({...pageSettings, verticalGapScale: parseFloat(e.target.value) || 0})} className="w-12 text-right bg-gray-50 border border-gray-200 rounded px-1 py-0.5 text-[10px] font-mono focus:outline-none focus:ring-1 focus:ring-church-500" />
                            </div>
                            <input type="range" min="0.0" max="3.0" step="0.1" value={pageSettings.verticalGapScale} onChange={(e) => setPageSettings({...pageSettings, verticalGapScale: parseFloat(e.target.value)})} className="w-full h-1.5 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-church-600" />
                        </div>
                        <div className="space-y-2">
                            <div className="flex justify-between items-center text-xs">
                                <span className="font-medium text-gray-700">Headers</span>
                                <input type="number" min="0.5" max="2.0" step="0.1" value={pageSettings.headerScale} onChange={(e) => setPageSettings({...pageSettings, headerScale: parseFloat(e.target.value) || 0})} className="w-12 text-right bg-gray-50 border border-gray-200 rounded px-1 py-0.5 text-[10px] font-mono focus:outline-none focus:ring-1 focus:ring-church-500" />
                            </div>
                            <input type="range" min="0.5" max="2.0" step="0.1" value={pageSettings.headerScale} onChange={(e) => setPageSettings({...pageSettings, headerScale: parseFloat(e.target.value)})} className="w-full h-1.5 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-church-600" />
                        </div>
                        <div className="space-y-2">
                             <div className="flex justify-between items-center text-xs">
                                <span className="font-medium text-gray-700">Margins</span>
                                <input type="number" min="0.1" max="1.5" step="0.05" value={pageSettings.margins} onChange={(e) => setPageSettings({...pageSettings, margins: parseFloat(e.target.value) || 0})} className="w-12 text-right bg-gray-50 border border-gray-200 rounded px-1 py-0.5 text-[10px] font-mono focus:outline-none focus:ring-1 focus:ring-church-500" />
                            </div>
                            <input type="range" min="0.1" max="1.5" step="0.05" value={pageSettings.margins} onChange={(e) => setPageSettings({...pageSettings, margins: parseFloat(e.target.value)})} className="w-full h-1.5 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-church-600" />
                        </div>
                    </div>
                </div>
            </div>
      )}

      <div className="flex-1 overflow-auto bg-gray-100/50 relative print-reset-height p-8 md:p-12 print:p-0">
        <div 
          className="relative mx-auto transition-all duration-200 ease-in-out origin-top-left"
          style={{ 
            width: `${scaledWidth}px`,
            height: `${scaledHeight}px`,
          }}
        >
          <div 
            className="print-scaling-container"
            style={{ 
                transform: `scale(${zoom})`,
                transformOrigin: 'top left',
                width: `${totalLayoutWidth}px`,
                height: `${pageHeightPx}px`,
            }}
          >
            <div className="absolute top-0 left-0 flex no-print pointer-events-none" style={{ gap: gapPx }}>
                {Array.from({ length: totalPages }).map((_, i) => (
                <div 
                    key={i} 
                    className="bg-white shadow-xl border border-gray-200/50 relative"
                    style={{ width: `${pageWidthPx}px`, height: `${pageHeightPx}px` }}
                >
                    <span className="absolute bottom-2 right-4 text-[10px] text-gray-300 font-mono">Page {i + 1}</span>
                    {showGuides && (
                        <div 
                        className="absolute border border-dashed border-cyan-100 pointer-events-none"
                        style={{ 
                            top: `${marginPx}px`, left: `${marginPx}px`, 
                            right: `${marginPx}px`, bottom: `${marginPx}px` 
                        }}
                        />
                    )}
                </div>
                ))}
            </div>

            <div className="relative z-10 print-force-block">
                <div 
                ref={contentRef}
                className="print-reset-columns printable-content"
                style={{
                    height: `${pageHeightPx}px`, // Use full page height so content fills to bottom padding
                    columnCount: 'auto',
                    columnFill: 'auto', 
                    WebkitColumnFill: 'auto', // Vendor prefix for Safari/Chrome legacy
                    columnWidth: `${printableWidthPx}px`,
                    columnGap: `${gapPx + (marginPx * 2)}px`,
                    /* PREVIEW TYPOGRAPHY: STRICTLY USE POINTS */
                    fontSize: `${baseFontSizePt}pt`,
                    lineHeight: pageSettings.lineHeight,
                    paddingLeft: `${marginPx}px`,
                    paddingRight: `${marginPx}px`,
                    paddingTop: `${marginPx}px`,
                    paddingBottom: `${marginPx}px`,
                    width: '100%', 
                    minWidth: '100%',
                    boxSizing: 'border-box'
                }}
                >
                    <ContentInner />
                </div>
            </div>
          </div>

        </div>
      </div>
      
      <style>{`
        @media print {
          @page {
             margin: ${pageSettings.margins}in;
             size: ${pageSettings.size} ${pageSettings.orientation};
          }
        }
      `}</style>
    </div>
  );
};
