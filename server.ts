import express from "express";
import { createServer as createViteServer } from "vite";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { google } from "googleapis";
import Papa from "papaparse"; // Ensure this is explicitly imported to resolve the dependency error

// Helper for ESM __dirname equivalent
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT || 3000);

app.use(express.json());

/* =============================================================================
   Local Overrides Storage (overrides.json)
============================================================================= */
// We use /tmp or the current work dir. On Render, files aren't persistent unless 
// you use a Disk, but this prevents crashes.
const OVERRIDES_FILE = path.join(process.cwd(), "overrides.json");

function readJsonFileSafe(filePath: string, fallback: any) {
  if (!fs.existsSync(filePath)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return fallback;
  }
}

function writeJsonFileSafe(filePath: string, data: any) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error("Failed to write overrides:", err);
  }
}

const getOverrides = () => readJsonFileSafe(OVERRIDES_FILE, {});
const saveOverrides = (data: any) => writeJsonFileSafe(OVERRIDES_FILE, data);

/* =============================================================================
   Google Sheets Configuration
============================================================================= */
const SHEET_ID = process.env.SHEET_ID || "1lo4Kt_x-CIRun4O9J5ivFJmiAATwfgbs0Fx043BYiOs";
const TAB_ROSTER = process.env.TAB_ROSTER || "Student Id#";
const TAB_COURSE_MAP = process.env.TAB_COURSE_MAP || "March Course Map Checkoffs";
const ATTENDANCE_PREFIX = process.env.ATTENDANCE_PREFIX || "Current Week";
const ACTIVE_ATTENDANCE_TAB = process.env.ACTIVE_ATTENDANCE_TAB || "";

let googleSheetsClient: any = null;

async function getSheetsClient() {
  if (googleSheetsClient) return googleSheetsClient;
  const serviceAccountVar = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!serviceAccountVar) return null;

  try {
    const credentials = JSON.parse(serviceAccountVar);
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
    });
    const client = await auth.getClient();
    google.options({ retry: false });
    googleSheetsClient = google.sheets({ version: "v4", auth: client as any });
    return googleSheetsClient;
  } catch (e) {
    console.error("[Google API] Failed to initialize client:", e);
    return null;
  }
}

// ... (Keep your cleanTabName, convertSheetsTime, normalizeDate, compareDates functions exactly as they were) ...
function cleanTabName(name: string) { return (name || "").trim().replace(/^['"]+|['"]+$/g, ""); }
function convertSheetsTime(value: any) {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value === "string" && value.trim().match(/^\d{1,2}:\d{2}\s?(AM|PM)$/i)) return value.trim();
  const num = typeof value === "number" ? value : parseFloat(String(value));
  if (!Number.isFinite(num)) return "";
  const totalMinutes = Math.round(num * 24 * 60);
  const hours24 = Math.floor(totalMinutes / 60) % 24;
  const minutes = totalMinutes % 60;
  const ampm = hours24 >= 12 ? "PM" : "AM";
  const hours12 = hours24 % 12 || 12;
  return `${hours12}:${String(minutes).padStart(2, "0")} ${ampm}`;
}
function normalizeDate(d: string) { if (!d) return ""; return d.replace(/-/g, "/").split("/").map((p) => parseInt(p as any, 10)).join("/"); }
function compareDates(d1: string, d2: string) {
  const p1 = d1.split("/").map((p) => parseInt(p as any, 10));
  const p2 = d2.split("/").map((p) => parseInt(p as any, 10));
  if (p1[0] !== p2[0]) return p1[0] - p2[0];
  return p1[1] - p2[1];
}

/* =============================================================================
   Google Sheets Read Helpers & Cache (Keep your existing logic here)
============================================================================= */
// ... (Include fetchSheetRange, batchGetRanges, listTabs, cached, etc. from your original script) ...

// 


/* =============================================================================
   API Endpoints (Keep your existing /api/ routes)
============================================================================= */
app.get("/api/health", (req, res) => res.json({ status: "ok" }));
// ... (Include your /api/events, /api/base, /api/attendance, /api/data, and POST routes) ...

/* =============================================================================
   Production Build & Static Files Handling (THE FIX)
============================================================================= */
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    // DEVELOPMENT MODE: Vite Middleware
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
    console.log("Starting in DEVELOPMENT mode...");
  } else {
    // PRODUCTION MODE: Serve built assets
    const distPath = path.resolve(process.cwd(), "dist");
    
    // 1. Serve static files from the dist directory
    app.use(express.static(distPath));
    
    console.log(`Production assets serving from: ${distPath}`);

    // 2. CATCH-ALL: For any request that doesn't match an API route, serve index.html
    // This solves the "Blank Screen" on refresh or deep-linking
    app.get("*", (req, res) => {
      const indexPath = path.join(distPath, "index.html");
      if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
      } else {
        res.status(404).send("Build artifacts not found. Please run 'npm run build' first.");
      }
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server successfully listening on port ${PORT}`);
  });
}

startServer().catch((err) => {
  console.error("Failed to start server:", err);
});