
export type ItemType = 'header' | 'hymn' | 'reading' | 'prayer' | 'rubric' | 'ordinary' | 'section-title' | 'proper';

export interface LiturgyItem {
  id: string;
  type: ItemType;
  title: string;
  subtitle?: string;
  content: string; // English text or Summary for readings
  metadata?: {
    tune?: string;
    reference?: string; // Citation
    speaker?: string; // e.g., "Celebrant", "All"
    response?: string;
    latinContent?: string; // For side-by-side Latin
    pageNumber?: string;
    setting?: string; // For Creed/Ordinary
  };
}

export interface PageSettings {
  size: 'letter' | 'statement' | 'legal';
  orientation: 'portrait' | 'landscape';
  margins: number; // in inches
  fontSize: number; // base font size in pt (deprecated in favor of scale, but kept for type safety if needed)
  fontScale: number; // 0.5 to 3.0
  lineHeight: number; // 1.0 to 2.5
  verticalGapScale: number; // 0.0 to 3.0 - Controls spacing between items
  headerScale: number; // 0.5 to 2.0 - Controls size of titles relative to body
  colorMode: 'color' | 'bw'; // New: Controls text color rendering
}

export interface MassMetadata {
  churchName: string;
  date: string; // ISO string YYYY-MM-DD
  time: string;
  celebrant: string;
  occasion: string; // e.g. "3rd Sunday of Ordinary Time"
  ordinarySetting: string; // e.g. "Missa de Angelis"
}

export interface GeneratedProper {
  title: string;
  reference: string;
  text: string;
  latinText?: string;
  type: ItemType;
}
