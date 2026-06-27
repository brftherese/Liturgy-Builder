<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Sanctus Liturgy Builder

A tool to auto-generate, edit, and layout Roman Catholic Liturgical propers using Gemini AI.

## Run Locally

**Prerequisites:** Node.js (v18+)

1. **Install dependencies:**
   `npm install`

2. **Configure API Keys:**
   Copy the example environment file and add your Gemini API key:
   `cp .env.example .env.local`
   Open `.env.local` and set:
   `GEMINI_API_KEY=your_key_here`

3. **Build the frontend:**
   `npm run build`

4. **Start the backend server:**
   `npm start` 
   *(Alternatively, run `node server.js` directly)*

5. **Open in browser:**
   Navigate to `http://localhost:3000` (or whatever port the server prints).
