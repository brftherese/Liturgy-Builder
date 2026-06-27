import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';

// Load environment variables from .env.local if present
dotenv.config({ path: '.env.local' });
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

const allowedOrigins = [
    'https://liturgy.saintignatius.us',
    'http://localhost:3000',
    'http://localhost:5173',
    'http://localhost:13745' // The port used by this PM2 process
];

app.use(cors({
    origin: function(origin, callback) {
        // Allow requests with no origin (like mobile apps, curl requests, or same-origin)
        if (!origin || allowedOrigins.indexOf(origin) !== -1) {
            callback(null, true);
        } else {
            callback(new Error('Not allowed by CORS'));
        }
    }
}));
// Increase JSON payload limit to handle base64 PDFs
app.use(express.json({ limit: '50mb' }));

// Initialize Gemini
const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY || process.env.VITE_GEMINI_API_KEY || '';
if (!apiKey) {
    console.warn('WARNING: API_KEY is not set in the environment variables. Ensure it is set before using the proxy.');
}
const ai = new GoogleGenAI({ apiKey: apiKey || 'dummy-key' });

// API Route for Gemini Proxy
app.post('/api/gemini', async (req, res) => {
    try {
        const requestPayload = req.body;
        
        // Ensure the model is provided
        if (!requestPayload.model) {
            return res.status(400).json({ error: 'Model is required' });
        }

        console.log(`[Proxy] Routing request to Gemini model: ${requestPayload.model}`);
        
        // Use a user-provided key from the frontend if present (for future-proofing), otherwise use the server key
        let aiClient = ai;
        if (req.headers['x-api-key']) {
             console.log(`[Proxy] Using user-provided API key from headers.`);
             aiClient = new GoogleGenAI({ apiKey: req.headers['x-api-key'] });
        }

        // Pass the request directly to the GenAI SDK
        const response = await aiClient.models.generateContent(requestPayload);
        
        res.json(response);
    } catch (error) {
        console.error(`[Proxy] Gemini Error:`, error.message || error);
        
        // Forward the specific status code if we got one from the Google SDK, otherwise 500
        const status = error?.status || 500;
        res.status(status).json({
            error: error.message || 'Internal Server Error',
            details: error
        });
    }
});

// Serve static assets in production
// Only serve dist if it exists (meaning we're not running in pure dev mode with Vite handling the frontend)
app.use(express.static(path.join(__dirname, 'dist')));

// Fallback to index.html for React Router (SPA routing)
app.use((req, res, next) => {
    if (req.path.startsWith('/api/')) {
        return next();
    }
    res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    console.log(`🔒 API Proxy ready at /api/gemini`);
});
