import express from "express";
import { createServer as createViteServer } from "vite";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { google } from "googleapis";
import Papa from "papaparse";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT || 3000);

app.use(express.json());

// --- [INSERT YOUR HELPER FUNCTIONS HERE: cleanTabName, convertSheetsTime, etc.] ---

async function startServer() {
  // Check if we are in production
  const isProd = process.env.NODE_ENV === "production";
  
  if (!isProd) {
    console.log("🛠️ Starting in DEVELOPMENT mode...");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    console.log("🚀 Starting in PRODUCTION mode...");
    // Use an absolute path that works on both Render and GitHub
    const distPath = path.resolve(process.cwd(), "dist");
    
    if (fs.existsSync(distPath)) {
      console.log(`✅ Dist folder found at: ${distPath}`);
      app.use(express.static(distPath));
    } else {
      console.error(`❌ CRITICAL: Dist folder NOT found at: ${distPath}`);
    }

    // API Routes must come BEFORE the catch-all
    app.get("/api/health", (req, res) => res.json({ status: "ok", mode: "production" }));

    // THE FIX: Catch-all route to serve index.html
    app.get("*", (req, res) => {
      const indexPath = path.join(distPath, "index.html");
      if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
      } else {
        res.status(404).send("<h1>Dashboard Building...</h1><p>Please refresh in 30 seconds. The build artifacts are missing.</p>");
      }
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`🌐 Server active at http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error("💥 Server failed to start:", err);
});