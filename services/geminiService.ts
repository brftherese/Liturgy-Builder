import { GoogleGenAI, Type, Schema, GenerateContentResponse } from "@google/genai";
import { GeneratedProper, LiturgyItem, MassMetadata } from '../types';

let aiInstance: GoogleGenAI | null = null;
const getAI = (): GoogleGenAI => {
  if (!process.env.API_KEY && !process.env.VITE_GEMINI_API_KEY) {
    throw new Error("API Key is missing. Please configure the environment.");
  }
  if (!aiInstance) {
    aiInstance = new GoogleGenAI({ apiKey: process.env.API_KEY || process.env.VITE_GEMINI_API_KEY || "" });
  }
  return aiInstance;
};
async function fetchOllama(prompt: string, model: string, requireJson: boolean): Promise<string> {
    const payload = {
        model: model,
        prompt: prompt,
        stream: false,
        ...(requireJson ? { format: "json" } : {})
    };
    const response = await fetch("https://ollama.csjohn.org/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
    });
    if (!response.ok) {
        throw new Error(`Ollama API error: ${response.status}`);
    }
    const data = await response.json();
    return data.response;
}

// Timeout wrapper to prevent hanging promises if the SDK throws uncatchable errors
const withTimeout = <T>(promise: Promise<T>, ms: number = 60000): Promise<T> => {
    return Promise.race([
        promise,
        new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms))
    ]);
};

export async function generateContentWithFallback(request: any): Promise<GenerateContentResponse> {
    const ai = getAI();
    let isRateLimit = false;
    let isServerBusy = false;
    const failureReasons: string[] = [];
    
    const getFriendlyErrorMessage = (err: any): string => {
        const errString = JSON.stringify(err, Object.getOwnPropertyNames(err));
        const msg = (err.message || '') + errString;
        if (msg.includes('PerDay')) return "Exhausted DAILY quota (resets at midnight PT)";
        if (msg.includes('PerMinute')) return "Exhausted Per-Minute quota";
        if (msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED') || msg.includes('quota')) return "Quota limit reached";
        if (msg.includes('503') || msg.includes('Overloaded')) return "Google servers are overloaded";
        if (msg.includes('Timeout') || msg.includes('timed out')) return "Request timed out";
        return err.message ? err.message.substring(0, 50) : "Unknown error";
    };

    try {
        return await withTimeout(ai.models.generateContent(request) as Promise<GenerateContentResponse>, 60000);
    } catch (error: any) {
        failureReasons.push(`[${request.model}] ${getFriendlyErrorMessage(error)}`);
        
        const errString = JSON.stringify(error, Object.getOwnPropertyNames(error));
        const msg = (error.message || '') + errString;
        isRateLimit = msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED') || msg.includes('quota') || (error?.status === 429);
        isServerBusy = msg.includes('503') || msg.includes('Overloaded') || msg.includes('timed out') || msg.includes('Timeout after') || msg.includes('timeout') || (error?.status === 503);
        
        if (!isRateLimit && !isServerBusy) {
            console.error("Gemini failed with non-retryable error:", error);
            throw new Error(`Google AI Error: ${getFriendlyErrorMessage(error)}`);
        }
        
        // Smart Retry Logic: If it's a short RPM quota hit, wait and retry the original model.
        // SKIP if daily quota is exhausted — waiting 65s won't help at all.
        if (isRateLimit && !msg.includes('PerDay')) {
            const retryMatch = msg.match(/Please retry in ([\d\.]+)s/i);
            if (retryMatch && retryMatch[1]) {
                const delaySecs = parseFloat(retryMatch[1]);
                if (delaySecs > 0 && delaySecs <= 65) {
                    console.warn(`Smart Retry: Waiting ${delaySecs}s for ${request.model} to cool down (Per-Minute limit)...`);
                    await new Promise(resolve => setTimeout(resolve, delaySecs * 1000 + 1000));
                    try {
                        console.warn(`Retrying ${request.model} after cooldown...`);
                        return await withTimeout(ai.models.generateContent(request) as Promise<GenerateContentResponse>, 60000);
                    } catch (retryErr: any) {
                        console.warn(`${request.model} failed again on retry. Moving to fallback chain...`);
                        failureReasons.push(`[${request.model} Retry] ${getFriendlyErrorMessage(retryErr)}`);
                    }
                }
            }
        }
        
        const isTranslation = request.model === 'gemini-3.1-flash-lite' || (typeof request.contents === 'string' && request.contents.includes('Translate the following Latin'));
        
        // Fallback chain: gemini-3.1-pro-preview is NOT available on the free tier (limit: 0).
        // Available models: gemini-3.5-flash, gemini-2.5-flash, gemini-3.1-flash-lite
        const fallbacks = ['gemini-2.5-flash', 'gemini-3.5-flash']
            .filter(m => m !== request.model);
        
        for (const fallbackModel of fallbacks) {
            console.warn(`Gemini API Busy on previous model. Falling back to ${fallbackModel}...`);
            try {
                const fallbackRequest = { ...request, model: fallbackModel };
                return await withTimeout(ai.models.generateContent(fallbackRequest) as Promise<GenerateContentResponse>, 60000);
            } catch (fallbackError: any) {
                console.warn(`${fallbackModel} ALSO Busy/Failed (${fallbackError?.message}).`);
                failureReasons.push(`[${fallbackModel}] ${getFriendlyErrorMessage(fallbackError)}`);
            }
        }
        
        // If we reach here, all Gemini models failed.
        if (!isTranslation) {
            throw new Error("All models failed.\n" + failureReasons.join(" | "));
        }
        
        console.warn(`Falling back to Ollama (translategemma) for translation task...`);
        try {
            const ollamaModel = 'translategemma:latest';
            const requireJson = request.config?.responseMimeType === 'application/json';
            
            let promptString = "";
            if (typeof request.contents === 'string') {
                promptString = request.contents;
            } else if (Array.isArray(request.contents)) {
                promptString = request.contents.map((p: any) => p.text || '').join('\n');
            }
            
            const ollamaText = await fetchOllama(promptString, ollamaModel, requireJson);
            return { text: ollamaText } as GenerateContentResponse;
        } catch (error3: any) {
             console.error("Ollama fallback ALSO failed:", error3);
             throw new Error("All AI models (Gemini & local Ollama) failed to respond. Please try again later.");
        }
    }
}

// Helper to handle API Rate Limiting (Exponential Backoff)
const retryOperation = async <T>(operation: () => Promise<T>, maxRetries = 5, initialDelay = 4000): Promise<T> => {
    let lastError: any;
    for (let i = 0; i < maxRetries; i++) {
        try {
            return await operation();
        } catch (error: any) {
            lastError = error;
            // Robust error checking: Look at message, status, and stringified error object
            const errString = JSON.stringify(error, Object.getOwnPropertyNames(error));
            const msg = (error.message || '') + errString;
            
            const isRateLimit = msg.includes('429') || 
                                msg.includes('RESOURCE_EXHAUSTED') || 
                                msg.includes('quota') ||
                                (error.status === 429);
            
            const isServerBusy = msg.includes('503') || 
                                 msg.includes('Overloaded') ||
                                 (error.status === 503);
            
            if (isRateLimit || isServerBusy) {
                // Exponential backoff with jitter
                const jitter = Math.random() * 1000;
                // Use 1.5 multiplier to cover a wider range without waiting too long initially
                const waitTime = (initialDelay * Math.pow(1.5, i)) + jitter;
                
                console.warn(`Gemini API Busy/Rate Limited (Attempt ${i + 1}/${maxRetries}). Retrying in ${Math.round(waitTime)}ms...`);
                await new Promise(resolve => setTimeout(resolve, waitTime));
                continue;
            }
            throw error; // Throw other errors immediately
        }
    }
    throw lastError;
};

// Helper to standardise titles to user preference
const standardizeProperTitle = (title: string, type: string): string => {
    const t = title.toLowerCase();
    // Only standardize if it looks like a Proper Antiphon
    const isAntiphon = t.includes('antiphon') || t.includes('chant');
    
    if (t.includes('introit') || (t.includes('entrance') && isAntiphon)) return "Introit";
    if (t.includes('offertorio') || (t.includes('offertory') && isAntiphon)) return "Offertorio";
    if (t.includes('communio') || (t.includes('communion') && isAntiphon)) return "Communio";
    
    return title;
};

// Helper to clean common OCR/Chant artifacts
// Updated to handle different rules for Graduals/Alleluias vs Introits
const cleanLiturgicalText = (text: string, title: string = ''): string => {
  if (!text) return "";
  let cleaned = text;

  // 1. Remove chant hyphens (e.g., "Do-mi-nus" -> "Dominus")
  cleaned = cleaned.replace(/(\w)-\s*(\w)/g, '$1$2');
  cleaned = cleaned.replace(/(\w)-(\w)/g, '$1$2');

  // 2. Fix potential double spacing or weird OCR artifacts
  cleaned = cleaned.replace(/\s+/g, ' ').trim();

  // 3. Conditional Cutoffs based on Item Type
  const lowerTitle = title.toLowerCase();
  // We include Motets/Anthems here to ensure we don't cut off their text if they happen to contain "Psalm" etc.
  const isExtendedProper = lowerTitle.includes('gradual') || lowerTitle.includes('alleluia') || lowerTitle.includes('tract') || lowerTitle.includes('sequence') || lowerTitle.includes('motet') || lowerTitle.includes('anthem') || lowerTitle.includes('choir') || lowerTitle.includes('psalm');

  if (!isExtendedProper) {
      // For Introit, Communion, Offertory: We generally want just the Antiphon.
      // We cut off extra Psalm verses (Ps.) and Doxology (Glory be).
      const cutOffs = ["Psalm", "Ps\\.", "Glory be", "Gloria Patri", "Doxology"];
      const regex = new RegExp(`\\s*\\(*\\b(${cutOffs.join('|')})\\b.*`, 'i');
      
      // Only apply cutoff if the text is long enough to likely be a proper with verses
      if (cleaned.length > 30) {
          cleaned = cleaned.split(regex)[0].trim();
      }
  } 
  // For Gradual/Alleluia/Motets: We explicitly WANT the full text/Verse, so we do not cut it off.

  return cleaned;
};

// Helper to detect if text is predominantly Latin
const isLatinText = (text: string): boolean => {
    if (!text || text.length < 5) return false;
    const lower = text.toLowerCase();
    
    // Common Latin liturgical words
    const latinWords = [
        'deus', 'dominus', 'domine', 'et', 'in', 'cum', 'spiritu', 'sancto', 'gloria', 
        'mysterium', 'fidei', 'mortem', 'tuam', 'resurrectionem', 'ave', 'maria', 
        'gratia', 'plena', 'benedicta', 'corpus', 'sanguis', 'agni', 'mundi', 
        'miserere', 'nobis', 'pacem', 'dixit', 'verbum', 'caro', 'factum', 'est',
        'ecce', 'virgo', 'concipiet', 'pariet', 'filium', 'nomen', 'eius', 'emmanuel',
        'puer', 'natus', 'omnes', 'gentes', 'populus', 'alleluia', 'hosanna', 'excelsis',
        'kyrie', 'eleison', 'christe', 'pater', 'noster', 'caelis', 'adveniat', 'regnum'
    ];
    
    // Common English liturgical words
    const englishWords = [
        'the', 'and', 'of', 'lord', 'god', 'glory', 'mystery', 'faith', 'death', 
        'resurrection', 'hail', 'mary', 'full', 'grace', 'blessed', 'body', 'blood', 
        'lamb', 'world', 'mercy', 'us', 'peace', 'said', 'word', 'made', 'flesh',
        'behold', 'virgin', 'conceive', 'bear', 'son', 'name', 'his', 'shall', 'be'
    ];

    // Use regex word boundaries for accurate counting
    const countOccurrences = (wordList: string[], target: string) => {
        return wordList.reduce((count, word) => {
            const regex = new RegExp(`\\b${word}\\b`, 'g');
            const matches = target.match(regex);
            return count + (matches ? matches.length : 0);
        }, 0);
    };

    const latinCount = countOccurrences(latinWords, lower);
    const englishCount = countOccurrences(englishWords, lower);

    // Strong signal: If Latin count is significantly higher or if english count is 0 while latin is > 0
    return latinCount > englishCount || (latinCount > 0 && englishCount === 0);
};

export const fetchDailyPropers = async (date: string, occasion?: string): Promise<GeneratedProper[]> => {
  if (!process.env.API_KEY) {
    throw new Error("API Key is missing. Please configure the environment.");
  }

  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

  const prompt = `
    You are a liturgical assistant.
    Target Date: ${date}. 
    User Specified Occasion: "${occasion || 'auto-detect'}".
    
    TASK: Provide Mass Propers and Readings for the Catholic Mass.

    CRITICAL STEP: CALCULATE LITURGICAL YEAR (Cycle A, B, or C).
    The Liturgical Year does NOT match the Calendar Year perfectly.
    1. A new Liturgical Year begins on the **First Sunday of Advent** (late November).
    2. Dates in Advent belong to the *upcoming* calendar year's cycle.
    3. **Math**: Let Y = Liturgical Year (If Advent/Dec, use Year+1. Else use Year).
       - If Y % 3 == 1 -> **Year A** (e.g. Liturgical Year 2026, starting Advent 2025).
       - If Y % 3 == 2 -> **Year B** (e.g. Liturgical Year 2027, starting Advent 2026).
       - If Y % 3 == 0 -> **Year C** (e.g. Liturgical Year 2025, starting Advent 2024).

    **EXAMPLE Check**: 
    - Date: 2025-12-21 (Advent). 
    - This is Liturgical Year 2026.
    - 2026 % 3 = 1. 
    - Result: **Year A**. (Do NOT use Year C readings).

    STEPS:
    1. Identify the Liturgical Day and correct Year (A/B/C) using the logic above.
    2. **Source the Readings**: Use the **USCCB Lectionary** for the calculated cycle.
    3. **Source the Propers**: Use the **Graduale Romanum** (Roman Gradual).
       - Do NOT use the Roman Missal antiphons unless Gradual is unavailable.
       - Do NOT provide a Responsorial Psalm. Provide the **GRADUAL**.
    
    STRUCTURE:
    1. Introit: Text + English Translation (Roman Missal).
    2. Kyrie: Title only.
    3. Gloria: Title only (if required).
    4. First Reading: Citation + Summary (USCCB). **SUMMARY MUST BE ONE SHORT SENTENCE (MAX 15 WORDS).**
    5. Gradual: Text + English Translation (Graduale Romanum).
    6. Second Reading: Citation + Summary (if applicable, USCCB). **SUMMARY MUST BE ONE SHORT SENTENCE (MAX 15 WORDS).**
    7. Alleluia/Gospel Acclamation: Text + Verse (Graduale Romanum).
    8. Gospel: Citation + Summary (USCCB). **SUMMARY MUST BE ONE SHORT SENTENCE (MAX 15 WORDS).**
    9. Creed: Title only (if required).
    10. Offertorio: Text + English Translation. (User prefers 'Offertorio' over 'Offertory Antiphon').
    11. Sanctus: Title only.
    12. Agnus Dei: Title only.
    13. Communio: Text + English Translation. (User prefers 'Communio' over 'Communion Antiphon').
    14. Communion Motet/Hymn (if standard for the day, otherwise omit).

    Return a clean JSON array.
  `;

  const properSchema: Schema = {
    type: Type.ARRAY,
    items: {
      type: Type.OBJECT,
      properties: {
        type: { type: Type.STRING, enum: ['reading', 'prayer', 'ordinary', 'hymn', 'proper'] },
        title: { type: Type.STRING },
        reference: { type: Type.STRING, description: "Scripture citation e.g., Is 55:10-11" },
        text: { type: Type.STRING, description: "English text OR Reading Summary (MAX 15 WORDS). Empty for ordinaries." },
        latinText: { type: Type.STRING, description: "Latin text for antiphons/graduals" },
      },
      required: ['type', 'title', 'text'],
    }
  };

  try {
    // Switch to flash-preview to avoid 429 errors on Pro, while still capable of this task.
    const response = await generateContentWithFallback({
      model: 'gemini-3.5-flash', 
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: properSchema,
      }
    });

    const text = response.text;
    if (!text) return [];

    let propers = JSON.parse(text) as GeneratedProper[];
    
    // Force standard titles
    propers = propers.map(p => {
        let cleanTitle = p.title;
        // Map common AI outputs to standard
        if (cleanTitle.toLowerCase().includes('offertory antiphon')) cleanTitle = 'Offertorio';
        else if (cleanTitle.toLowerCase().includes('communion antiphon')) cleanTitle = 'Communio';
        else if (cleanTitle.toLowerCase().includes('entrance antiphon')) cleanTitle = 'Introit';
        
        return { ...p, title: cleanTitle };
    });

    return propers;
  } catch (error) {
    console.error("Error fetching propers:", error);
    throw error;
  }
};

export const translateText = async (text: string): Promise<string> => {
  if (!process.env.API_KEY) return "Error: No API Key";
  if (!text) return "";
  
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  try {
    const response = await generateContentWithFallback({
      model: 'gemini-3.1-flash-lite',
      contents: `Translate the following Latin liturgical text into beautiful, traditional English (Roman Missal style). 
      
      STRICT RULES:
      1. Return **ONLY** the translated text string. 
      2. Do **NOT** add "Here is the translation" or quotes. 
      3. Do **NOT** add explanations.
      4. If the input is chant with hyphens (Do-mi-nus), remove them in the output (Lord).
      
      Latin: "${text}"`,
    });
    return response.text?.trim() || "";
  } catch (e) {
    console.error(e);
    return "Translation failed.";
  }
};

export const translateTexts = async (texts: string[]): Promise<string[]> => {
  if (!process.env.API_KEY) return [];
  if (!texts || texts.length === 0) return [];
  
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const schema: Schema = {
    type: Type.ARRAY,
    items: { type: Type.STRING }
  };

  const prompt = `
    Translate the following list of Latin liturgical texts into beautiful, traditional English (Roman Missal style).
    
    STRICT RULES:
    1. Translate each item in the list.
    2. Maintain the exact same order as the input list.
    3. If any item is chant with hyphens (e.g. Do-mi-nus), remove them in the translation (Lord).
    
    Input List:
    ${JSON.stringify(texts)}
  `;

  try {
    const response = await generateContentWithFallback({
      model: 'gemini-3.1-flash-lite',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: schema
      }
    });
    
    return JSON.parse(response.text || '[]');
  } catch (e) {
    console.error("Batch translation failed completely (all fallback models exhausted).", e);
    // DO NOT loop and spam individual requests here! If the API is exhausted, individual requests will also fail.
    return texts.map(() => "Translation failed.");
  }
};

export const resolveLiturgicalDay = async (
  type: 'date_to_feast' | 'feast_to_date',
  value: string
): Promise<{ date?: string, feasts?: string[], suggestedMassSetting?: string }> => {
  if (!process.env.API_KEY) throw new Error("API Key missing");

  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const currentYear = new Date().getFullYear();

  let prompt = "";
  if (type === 'date_to_feast') {
    prompt = `List all possible liturgical observances for Roman Catholic Church (USA) on ${value}. Return list of names. Suggest Gregorian Mass Ordinary (e.g. Mass VIII).`;
  } else {
    prompt = `What is the date of "${value}" in ${currentYear}? Return YYYY-MM-DD.`;
  }

  const schema: Schema = {
    type: Type.OBJECT,
    properties: {
      date: { type: Type.STRING },
      feasts: { type: Type.ARRAY, items: { type: Type.STRING } },
      suggestedMassSetting: { type: Type.STRING }
    }
  };

  try {
    const response = await generateContentWithFallback({
      model: 'gemini-3.5-flash',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: schema
      }
    });

    return JSON.parse(response.text || '{}');
  } catch (e) {
    console.error("Error resolving liturgical day:", e);
    return {};
  }
};

export const summarizeReadings = async (items: LiturgyItem[]): Promise<LiturgyItem[]> => {
  if (!process.env.API_KEY) throw new Error("API Key missing");
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

  const readingItems = items.filter(i => i.type === 'reading' && i.content.length > 100);
  if (readingItems.length === 0) return items;

  const prompt = `
    Summarize these liturgical readings into single, beautiful, italicized sentences.
    **CRITICAL**: Each summary must be VERY SHORT (max 15 words) to fit on one line.
    Items: ${JSON.stringify(readingItems.map(i => ({ id: i.id, title: i.title, content: i.content })))}
    Return JSON array: [{id, newContent}]
  `;

  const schema: Schema = {
    type: Type.ARRAY,
    items: {
      type: Type.OBJECT,
      properties: {
        id: { type: Type.STRING },
        newContent: { type: Type.STRING }
      },
      required: ['id', 'newContent']
    }
  };

  try {
    const response = await generateContentWithFallback({
      model: 'gemini-3.5-flash',
      contents: prompt,
      config: { responseMimeType: 'application/json', responseSchema: schema }
    });

    const updates = JSON.parse(response.text || '[]') as {id: string, newContent: string}[];
    return items.map(item => {
      const update = updates.find(u => u.id === item.id);
      return update ? { ...item, content: update.newContent } : item;
    });

  } catch (e) {
    return items;
  }
}

export const importLiturgyFromPdf = async (base64Pdf: string): Promise<{ items: LiturgyItem[], metadata: MassMetadata }> => {
  if (!process.env.API_KEY) throw new Error("API Key missing");
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

  const prompt = `
    Analyze the uploaded PDF (Liturgy Order of Worship).
    
    TASK: Extract structured content.
    
    RULES FOR EXTRACTION:
    1. **HYMNS & SONGS** (Congregational): 
       - If a liturgical action is listed (e.g. "Entrance Hymn", "Recessional"), use that as the **TITLE** and the song name as the **SUBTITLE**.
       - If only the song name is present, use it as the Title.
       - **Extract ONLY Title, Subtitle, Tune, and Page Number.** 
       - **Content MUST be empty string**. DO NOT extract lyrics.
    2. **MOTETS & ANTHEMS** (Choral):
       - If the title contains "Motet", "Anthem", "Choir", or "Meditation", **EXTRACT THE TEXT**.
       - Put Latin text in 'latinContent' (if present) and English in 'content'.
    3. **ORDINARIES** (Kyrie, Sanctus, Agnus Dei, Gloria, Creed):
       - Extract Title and Setting (in metadata). 
       - **EXCEPTION**: For "**Mystery of Faith**" (or *Mysterium Fidei*), **EXTRACT THE TEXT**.
       - For ALL OTHER Ordinaries, **Content MUST be empty string**.
    4. **PROPERS**:
       - **Introit / Communion**: Extract Antiphon ONLY. Stop before Psalm Verse ("Ps.") or Doxology ("Glory be").
       - **Gradual / Alleluia / Tract**: Extract FULL TEXT including the Verse (V.).
       - **REMOVE HYPHENS** inside words (e.g. "Do-mi-nus" -> "Dominus").
       - **RESTORE MISSING DROP CAPS**.
    5. **READINGS**: Extract Title (e.g. "First Reading") and Reference (e.g. "Is 45:8") only. Content should be empty.
    6. **METADATA**: 
       - Date: Format strictly as **YYYY-MM-DD**. If year is missing, assume upcoming occurence.
       - Church, Occasion, Celebrant.
    
    Return JSON.
  `;

  const schema: Schema = {
    type: Type.OBJECT,
    properties: {
      metadata: {
        type: Type.OBJECT,
        properties: {
          churchName: { type: Type.STRING, nullable: true },
          date: { type: Type.STRING, nullable: true, description: "YYYY-MM-DD" },
          time: { type: Type.STRING, nullable: true },
          celebrant: { type: Type.STRING, nullable: true },
          occasion: { type: Type.STRING, nullable: true },
          ordinarySetting: { type: Type.STRING, nullable: true },
        },
        required: [] 
      },
      items: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            type: { type: Type.STRING, enum: ['header', 'hymn', 'reading', 'prayer', 'rubric', 'ordinary', 'section-title', 'proper'] },
            title: { type: Type.STRING },
            subtitle: { type: Type.STRING },
            content: { type: Type.STRING, description: "Hymn lyrics MUST be empty." },
            metadata: {
              type: Type.OBJECT,
              properties: {
                tune: { type: Type.STRING },
                reference: { type: Type.STRING },
                pageNumber: { type: Type.STRING },
                setting: { type: Type.STRING },
                latinContent: { type: Type.STRING },
              }
            }
          },
          required: ['type', 'title', 'content']
        }
      }
    },
    required: ['metadata', 'items']
  };

  try {
    const response = await generateContentWithFallback({
      model: 'gemini-2.5-flash',
      contents: [
        { inlineData: { mimeType: 'application/pdf', data: base64Pdf } },
        { text: prompt }
      ],
      config: {
        responseMimeType: 'application/json',
        responseSchema: schema,
      }
    });

    const result = JSON.parse(response.text || '{}');
    
    // Post-process to clean items
    if (result.items) {
      result.items = result.items.map((item: any) => {
        const type = item.type as string;
        let content = item.content || '';
        let latinContent = item.metadata?.latinContent || '';
        const titleLower = item.title.toLowerCase();
        
        const isMysteryOfFaith = titleLower.includes('mystery') || titleLower.includes('mysterium');
        const hasPageNumber = !!item.metadata?.pageNumber;
        const isMotet = titleLower.includes('motet') || titleLower.includes('anthem') || titleLower.includes('choir');

        // RULE: If page number exists, clear all text content.
        if (hasPageNumber) {
            content = ''; 
            latinContent = '';
        } else {
             // RULE: FORCE EMPTY CONTENT for Hymns (non-motets) and Ordinaries (non-Mystery)
            if ((type === 'hymn' && !isMotet) || (type === 'ordinary' && !isMysteryOfFaith)) {
                content = ''; 
                latinContent = '';
            }
        }

        // CLEAN PROPERS & MOTETS
        if (content.length > 0 && type !== 'reading') {
            content = cleanLiturgicalText(content, item.title);
        }
        if (latinContent) {
            latinContent = cleanLiturgicalText(latinContent, item.title);
        }
        
        // STANDARDIZE TITLES (Introit, Offertorio, Communio)
        let cleanTitle = item.title;
        if (type === 'proper' || type === 'section-title' || type === 'header') {
            cleanTitle = standardizeProperTitle(cleanTitle, type);
        }

        // CLEAN PAGE NUMBER for consistency (remove "p.", "No.", "SSM #", etc.)
        let cleanPageNumber = item.metadata?.pageNumber;
        if (cleanPageNumber) {
            // Remove common prefixes: p., pg., no., #, SSM #, Hymn #, etc.
            cleanPageNumber = cleanPageNumber.replace(/^(?:ssm|cp|w|rs|g|hymn|song|p|pg|no|#|num|number)[\.\s#]*/i, '').trim();
        }

        return {
          ...item,
          title: cleanTitle,
          id: Math.random().toString(36).substr(2, 9),
          content: content,
          metadata: {
              ...item.metadata,
              latinContent: latinContent,
              pageNumber: cleanPageNumber
          }
        };
      });
    }

    const cleanMetadata: any = {};
    if (result.metadata) {
        Object.entries(result.metadata).forEach(([key, value]) => {
            if (value && typeof value === 'string' && value.trim().length > 0 && value.toLowerCase() !== 'null') {
                cleanMetadata[key] = value;
            }
        });
    }

    return { items: result.items || [], metadata: cleanMetadata as MassMetadata };
  } catch (e) {
    console.error("Error processing PDF:", e);
    throw e;
  }
};

export const enrichLiturgyItems = async (items: LiturgyItem[], date: string, occasion: string): Promise<LiturgyItem[]> => {
    // 1. Fetch Standard Propers (Readings source)
    let standardPropers: GeneratedProper[] = [];
    try {
        standardPropers = await fetchDailyPropers(date, occasion);
    } catch(e) {
        console.warn("Could not fetch standard propers", e);
    }

    // 2. First Pass: Match and identify what needs translation
    const itemsToTranslate: { index: number, latin: string }[] = [];
    const preEnrichedItems = items.map((item, idx) => {
        // Skip hymnal items
        if (item.metadata?.pageNumber) {
             return item;
        }

        const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
        const itemTitleNorm = normalize(item.title);
        
        // Initial detection
        let hasEnglish = item.content.length > 5 && !isLatinText(item.content);
        let hasLatin = !!(item.metadata?.latinContent && item.metadata.latinContent.length > 5);

        let newContent = item.content;
        let newMetadata = { ...item.metadata };

        // Logic to move Latin content from main slot to latin slot if needed
        if (!hasEnglish && isLatinText(item.content)) {
            if (!hasLatin || item.metadata?.latinContent === item.content) {
                newMetadata.latinContent = item.content;
                hasLatin = true;
                newContent = ""; 
                hasEnglish = false;
            }
        }

        // MATCHING
        let match: GeneratedProper | undefined;
        // Refined matching: Don't match Motets/Anthems with Standard Propers (Chants)
        const isChoralPiece = itemTitleNorm.includes('motet') || itemTitleNorm.includes('anthem') || itemTitleNorm.includes('choir') || itemTitleNorm.includes('meditation');

        if (standardPropers.length > 0 && !isChoralPiece) {
            match = standardPropers.find(p => {
                const pTitleNorm = normalize(p.title);
                
                // Helper checks
                const isCommunion = (t: string) => t.includes('communion') || t.includes('communio');
                const isOffertory = (t: string) => t.includes('offertory') || t.includes('offertorio');
                const isIntroit = (t: string) => t.includes('introit') || t.includes('entrance') || t.includes('introitus');

                const typeMatch = (isCommunion(pTitleNorm) && isCommunion(itemTitleNorm)) ||
                                  (isOffertory(pTitleNorm) && isOffertory(itemTitleNorm)) ||
                                  (isIntroit(pTitleNorm) && isIntroit(itemTitleNorm));
                                  
                return pTitleNorm === itemTitleNorm || pTitleNorm.includes(itemTitleNorm) || itemTitleNorm.includes(pTitleNorm) || typeMatch;
            });
            
            // Try fuzzy ordinal matching for readings
            if (!match && item.type === 'reading') {
                if (itemTitleNorm.includes('1st') || itemTitleNorm.includes('first')) {
                    match = standardPropers.find(p => normalize(p.title).includes('first'));
                } else if (itemTitleNorm.includes('2nd') || itemTitleNorm.includes('second')) {
                    match = standardPropers.find(p => normalize(p.title).includes('second'));
                } else if (itemTitleNorm.includes('gospel')) {
                    match = standardPropers.find(p => normalize(p.title).includes('gospel'));
                }
            }
        }

        if (match) {
             const isGradual = itemTitleNorm.includes('gradual');
             // If it's a Gradual and we already have Latin, prefer translating the specific PDF text 
             // rather than taking the generic daily text, unless we have nothing.
             const preferExistingLatin = isGradual && hasLatin;

             // CROSS-CHECK: If the current content matches the Latin from the standard proper, 
             // it IS Latin, even if isLatinText missed it.
             if (hasEnglish && match.latinText) {
                 const normContent = normalize(newContent);
                 const normMatchLatin = normalize(match.latinText);
                 // Check if sufficient overlap to consider it Latin
                 if (normMatchLatin.includes(normContent) || normContent.includes(normMatchLatin)) {
                      newMetadata.latinContent = newContent;
                      newContent = ""; // Clear to force fill/translate
                      hasEnglish = false;
                      hasLatin = true;
                 }
             }

             if (!hasEnglish && match.text && !preferExistingLatin) newContent = match.text;
             if (!hasLatin && match.latinText) newMetadata.latinContent = match.latinText;
             if (!item.metadata?.reference && match.reference) newMetadata.reference = match.reference;
             
             hasEnglish = newContent.length > 5 && !isLatinText(newContent);
             hasLatin = !!(newMetadata.latinContent && newMetadata.latinContent.length > 5);
        }

        // TRANSLATION LOGIC
        const isMystery = itemTitleNorm.includes('mystery') || itemTitleNorm.includes('mysterium');
        if (isMystery && isLatinText(newContent)) {
             newMetadata.latinContent = newContent;
             newContent = ""; // Clear to force translate
             hasEnglish = false;
             hasLatin = true;
        }

        if (hasLatin && !hasEnglish && newMetadata.latinContent) {
             itemsToTranslate.push({ index: idx, latin: newMetadata.latinContent });
        }

        return { ...item, content: newContent, metadata: newMetadata };
    });

    // Run Batched Translations
    if (itemsToTranslate.length > 0) {
        try {
            const translations = await translateTexts(itemsToTranslate.map(x => x.latin));
            translations.forEach((translation, index) => {
                const targetIdx = itemsToTranslate[index].index;
                preEnrichedItems[targetIdx].content = translation;
            });
        } catch (e) {
            console.error("Batch translation enrichment failed:", e);
        }
    }

    // Clean texts and assemble enriched list
    const enrichedItems = preEnrichedItems.map(item => {
        if (item.metadata?.pageNumber) return item;
        let newContent = item.content;
        let newMetadata = { ...item.metadata };
        if (newContent) newContent = cleanLiturgicalText(newContent, item.title);
        if (newMetadata.latinContent) newMetadata.latinContent = cleanLiturgicalText(newMetadata.latinContent, item.title);
        return { ...item, content: newContent, metadata: newMetadata };
    });

    // 3. INJECT MISSING READINGS
    // Identify landmarks to know where to insert
    const findIndexByKeyword = (keywords: string[]) => enrichedItems.findIndex(i => keywords.some(k => i.title.toLowerCase().includes(k)));

    const idxGradual = findIndexByKeyword(['gradual', 'psalm', 'responsorial']);
    const idxAlleluia = findIndexByKeyword(['alleluia', 'tract', 'gospel acclamation']);
    const idxOffertory = findIndexByKeyword(['offertory', 'offertorio']);

    // Helpers
    const hasReading = (key: string) => enrichedItems.some(i => i.type === 'reading' && i.title.toLowerCase().includes(key));
    const readings = standardPropers.filter(p => p.type === 'reading');
    const firstReading = readings.find(r => r.title.toLowerCase().includes('first'));
    const secondReading = readings.find(r => r.title.toLowerCase().includes('second'));
    const gospel = readings.find(r => r.title.toLowerCase().includes('gospel'));

    let insertionOffset = 0; // Tracks shifts as we add items

    // Inject First Reading (Target: Before Gradual/Psalm)
    if (firstReading && !hasReading('first')) {
        let insertAt = idxGradual;
        if (insertAt === -1) insertAt = idxAlleluia;
        if (insertAt === -1) insertAt = idxOffertory;
        if (insertAt === -1) insertAt = 2; // Default fallback

        // If we found a valid index, adjust for previous insertions (none yet)
        enrichedItems.splice(Math.max(0, insertAt), 0, {
            id: 'auto-r1', type: 'reading', title: firstReading.title, content: firstReading.text, 
            metadata: { reference: firstReading.reference }
        });
        insertionOffset++; 
    }

    // Refresh landmarks logic for next insertions
    const refreshIdxAlleluia = () => {
        const idx = findIndexByKeyword(['alleluia', 'tract', 'gospel acclamation']);
        return idx !== -1 ? idx : (findIndexByKeyword(['offertory', 'offertorio']) !== -1 ? findIndexByKeyword(['offertory', 'offertorio']) : enrichedItems.length - 1);
    }

    // Inject Second Reading (Target: Before Alleluia)
    if (secondReading && !hasReading('second')) {
        let insertAt = refreshIdxAlleluia();
        enrichedItems.splice(Math.max(0, insertAt), 0, {
            id: 'auto-r2', type: 'reading', title: secondReading.title, content: secondReading.text, 
            metadata: { reference: secondReading.reference }
        });
        insertionOffset++;
    }

    // Inject Gospel (Target: After Alleluia)
    if (gospel && !hasReading('gospel')) {
        let insertAt = refreshIdxAlleluia(); // This now points to Alleluia (or Offertory if missing)
        // If it points to Alleluia, we want to go AFTER it.
        if (enrichedItems[insertAt] && ['alleluia','tract'].some(k => enrichedItems[insertAt].title.toLowerCase().includes(k))) {
            insertAt++; 
        }
        
        enrichedItems.splice(Math.max(0, insertAt), 0, {
            id: 'auto-g', type: 'reading', title: gospel.title, content: gospel.text, 
            metadata: { reference: gospel.reference }
        });
    }

    return enrichedItems;
};

export const processLiturgyEdit = async (currentItems: LiturgyItem[], userInstruction: string): Promise<{ items: LiturgyItem[], reply: string }> => {
  if (!process.env.API_KEY) throw new Error("API Key missing");
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

  const prompt = `
    You are an expert Catholic Liturgy Editor.
    
    Current Liturgy Order (JSON):
    ${JSON.stringify(currentItems)}

    USER REQUEST: "${userInstruction}"

    TASK:
    1. Modify the list of LiturgyItems based on the User Request.
    2. Maintain the correct liturgical order of the Mass (e.g. Kyrie -> Gloria -> Readings -> Creed -> Offertory -> Sanctus -> Agnus Dei).
    3. If adding an item (like "Credo III"), insert it in the textually correct position and formatting.
    4. **CRITICAL**: Return the FULL updated JSON list.
       - Preserve existing IDs for unchanged items.
       - Generate new random IDs for new items.
       - Preserve all existing content/metadata unless asked to change.

    Return a valid JSON object with:
    - "items": The new array of LiturgyItems.
    - "reply": A very short, friendly confirmation message of what you did (e.g. "Added Credo III after the Gospel.").
  `;

  const schema: Schema = {
    type: Type.OBJECT,
    properties: {
      items: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            id: { type: Type.STRING },
            type: { type: Type.STRING, enum: ['header', 'hymn', 'reading', 'prayer', 'rubric', 'ordinary', 'section-title', 'proper'] },
            title: { type: Type.STRING },
            subtitle: { type: Type.STRING, nullable: true },
            content: { type: Type.STRING, nullable: true },
            metadata: {
              type: Type.OBJECT,
              nullable: true,
              properties: {
                tune: { type: Type.STRING, nullable: true },
                reference: { type: Type.STRING, nullable: true },
                pageNumber: { type: Type.STRING, nullable: true },
                setting: { type: Type.STRING, nullable: true },
                latinContent: { type: Type.STRING, nullable: true },
              }
            }
          },
          required: ['id', 'type', 'title', 'content']
        }
      },
      reply: { type: Type.STRING }
    },
    required: ['items', 'reply']
  };

  try {
    const response = await generateContentWithFallback({
      model: 'gemini-3.5-flash',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: schema,
      }
    });

    const result = JSON.parse(response.text || '{}');
    return { 
        items: result.items || currentItems, 
        reply: result.reply || "Updated the liturgy." 
    };
  } catch (e) {
    console.error("Edit failed:", e);
    throw new Error("I couldn't process that edit. Please try again.");
  }
};