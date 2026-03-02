import express from "express";
import { createServer as createViteServer } from "vite";
import axios from "axios";
import Papa from "papaparse";
import fs from "fs";
import path from "path";

import { google } from "googleapis";

const app = express();
const PORT = 3000;

app.use(express.json());

const OVERRIDES_FILE = path.join(process.cwd(), "overrides.json");

// Helper to read overrides
function getOverrides() {
  if (fs.existsSync(OVERRIDES_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(OVERRIDES_FILE, "utf-8"));
    } catch (e) {
      return {};
    }
  }
  return {};
}

// Helper to save overrides
function saveOverrides(overrides: any) {
  fs.writeFileSync(OVERRIDES_FILE, JSON.stringify(overrides, null, 2));
}

// Google API Setup
const SHEET_ID = process.env.SHEET_ID || "1lo4Kt_x-CIRun4O9J5ivFJmiAATwfgbs0Fx043BYiOs";
const GID_ROSTER = "1389983501";
const GID_COURSE_MAP = "865017288";

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
    googleSheetsClient = google.sheets({ version: "v4", auth: client as any });
    return googleSheetsClient;
  } catch (e) {
    console.error("[Google API] Failed to initialize client:", e);
    return null;
  }
}

async function discoverAttendanceGids() {
  const client = await getSheetsClient();
  if (!client) {
    return { gids: ["0", "194970608", "647697214", "1922142629"], status: "NOT_CONFIGURED" };
  }

  try {
    const spreadsheet = await client.spreadsheets.get({
      spreadsheetId: SHEET_ID,
    });
    
    const sheets = spreadsheet.data.sheets || [];
    const attendanceGids = sheets
      .filter((s: any) => {
        const title = s.properties.title;
        return title.includes("/") || title.toLowerCase().includes("attendance");
      })
      .map((s: any) => s.properties.sheetId.toString());
      
    return { gids: attendanceGids, status: "CONNECTED" };
  } catch (e: any) {
    console.error("[Google API] Failed to discover sheets:", e);
    const errorMsg = e.message || "";
    let status = "ERROR";
    if (errorMsg.includes("disabled") || errorMsg.includes("not been used")) status = "API_DISABLED";
    else if (errorMsg.includes("permission") || errorMsg.includes("403")) status = "PERMISSION_DENIED";
    
    return { gids: ["0", "194970608", "647697214", "1922142629"], status };
  }
}

async function fetchSheetCSV(gid: string) {
  // Add cache-busting timestamp to prevent stale data
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${gid}&t=${Date.now()}`;
  const response = await axios.get(url);
  return Papa.parse(response.data, { header: false, skipEmptyLines: true }).data;
}

app.post("/api/course-map/complete", (req, res) => {
  const { studentId } = req.body;
  if (!studentId) return res.status(400).json({ error: "Student ID required" });

  const overrides = getOverrides();
  if (!overrides[studentId]) overrides[studentId] = {};
  overrides[studentId].courseMapCompleted = true;
  overrides[studentId].courseMapTimestamp = new Date().toISOString();
  saveOverrides(overrides);

  res.json({ success: true });
});

app.post("/api/notes/add", (req, res) => {
  const { studentId, note, author } = req.body;
  if (!studentId || !note) return res.status(400).json({ error: "Student ID and note required" });

  const overrides = getOverrides();
  if (!overrides[studentId]) overrides[studentId] = {};
  if (!overrides[studentId].notes) overrides[studentId].notes = [];
  
  overrides[studentId].notes.push({
    text: note,
    author: author || "Staff",
    timestamp: new Date().toISOString()
  });
  
  saveOverrides(overrides);
  res.json({ success: true });
});

app.get("/api/data", async (req, res) => {
  try {
    const [rosterRaw, courseMapRaw] = await Promise.all([
      fetchSheetCSV(GID_ROSTER),
      fetchSheetCSV(GID_COURSE_MAP)
    ]);

    const overrides = getOverrides();

    // Process Attendance
    const requestedDate = req.query.date as string; // Expected format "M/D" or "M-D"
    const normalizeDate = (d: string) => {
      if (!d) return "";
      return d.replace(/-/g, "/").split("/").map(p => parseInt(p)).join("/");
    };

    const compareDates = (d1: string, d2: string) => {
      const p1 = d1.split("/").map(p => parseInt(p));
      const p2 = d2.split("/").map(p => parseInt(p));
      if (p1[0] !== p2[0]) return p1[0] - p2[0];
      return p1[1] - p2[1];
    };

    const normalizedRequestedDate = requestedDate ? normalizeDate(requestedDate) : null;

    const { gids: ATTENDANCE_GIDS, status: googleApiStatus } = await discoverAttendanceGids();
    
    let attendanceRaw: any[] = [];
    let activeDate = "";
    let activeGid = "";
    let latestDateColIndex = -1;
    let attendanceDataStartRow = 3;

    // Fetch attendance sheets resiliently
    const attendanceResults = await Promise.all(
      ATTENDANCE_GIDS.map(async (gid) => {
        try {
          return await fetchSheetCSV(gid);
        } catch (e) {
          console.error(`[Attendance] Failed to fetch GID ${gid}:`, e);
          return null;
        }
      })
    );
    
    let latestDateFound = "";
    let latestColIndex = -1;
    let latestRaw: any[] = [];
    let latestStartRow = 3;
    let latestGid = "";

    let requestedDateFound = false;
    let reqColIndex = -1;
    let reqRaw: any[] = [];
    let reqStartRow = 3;
    let reqGid = "";

    attendanceResults.forEach((data, idx) => {
      if (!data) return;

      const gid = ATTENDANCE_GIDS[idx];
      
      // Find header row (contains "Student's Name")
      let headerRowIndex = -1;
      for (let i = 0; i < Math.min(25, data.length); i++) {
        const row = data[i] as string[];
        if (row && row[0]?.toLowerCase().includes("student's name")) {
          headerRowIndex = i;
          break;
        }
      }

      if (headerRowIndex === -1) return;

      // Check header row and row above for dates
      const rowsToCheck = [data[headerRowIndex]];
      if (headerRowIndex > 0) rowsToCheck.push(data[headerRowIndex - 1]);
      if (headerRowIndex + 1 < data.length) rowsToCheck.push(data[headerRowIndex + 1]);

      rowsToCheck.forEach((row: string[]) => {
        if (!row) return;

        for (let i = 1; i < row.length; i++) {
          const d = row[i]?.trim();
          if (d && (d.includes("/") || d.match(/^\d{1,2}\/\d{1,2}$/))) {
            const normalizedD = normalizeDate(d);
            
            // Check if this is the requested date
            if (normalizedRequestedDate && normalizedD === normalizedRequestedDate) {
              reqGid = gid;
              reqRaw = data;
              reqColIndex = i;
              reqStartRow = headerRowIndex + 1;
              requestedDateFound = true;
            }

            // Track latest date globally
            if (!latestDateFound || compareDates(normalizedD, normalizeDate(latestDateFound)) > 0) {
              latestDateFound = d;
              latestColIndex = i;
              latestGid = gid;
              latestRaw = data;
              latestStartRow = headerRowIndex + 1;
            }
          }
        }
      });
    });

    console.log(`[Attendance] Requested: ${requestedDate}, Found: ${requestedDateFound}, Active: ${activeDate} (GID: ${activeGid}), Latest: ${latestDateFound}`);

    // Final decision on which data to use
    let bestSheet: { raw: any[], colIndex: number, startRow: number, dateCount: number } | null = null;
    
    attendanceResults.forEach((data, idx) => {
      if (!data) return;
      const gid = ATTENDANCE_GIDS[idx];
      
      let headerRowIndex = -1;
      for (let i = 0; i < Math.min(25, data.length); i++) {
        const row = data[i] as string[];
        if (row && row[0]?.toLowerCase().includes("student's name")) {
          headerRowIndex = i;
          break;
        }
      }
      if (headerRowIndex === -1) return;

      const rowsToCheck = [data[headerRowIndex]];
      if (headerRowIndex > 0) rowsToCheck.push(data[headerRowIndex - 1]);
      if (headerRowIndex + 1 < data.length) rowsToCheck.push(data[headerRowIndex + 1]);

      // Count dates in this sheet to use as a heuristic for "primary" tab
      let dateCount = 0;
      rowsToCheck.forEach(row => {
        if (!row) return;
        for (let i = 1; i < row.length; i++) {
          const d = row[i]?.trim();
          if (d && (d.includes("/") || d.match(/^\d{1,2}\/\d{1,2}$/))) dateCount++;
        }
      });

      rowsToCheck.forEach((row: string[]) => {
        if (!row) return;
        for (let i = 1; i < row.length; i++) {
          const d = row[i]?.trim();
          if (d && normalizeDate(d) === (requestedDate ? normalizedRequestedDate : normalizeDate(latestDateFound))) {
            if (requestedDate) requestedDateFound = true;
            
            // Heuristic: pick the sheet with the most dates (likely the primary weekly tab)
            if (!bestSheet || dateCount > bestSheet.dateCount) {
              bestSheet = { raw: data, colIndex: i, startRow: headerRowIndex + 1, dateCount };
              activeGid = gid;
              if (!requestedDate) activeDate = d;
            }
          }
        }
      });
    });

    if (requestedDate) activeDate = requestedDate;

    const attendanceMap: Record<string, { present: boolean, timeIn?: string, timeOut?: string }> = {};
    const staffAttendance: any[] = [];
    
    if (bestSheet) {
      const { raw, colIndex, startRow } = bestSheet;
      let isStaffSection = false;
      let isCentralOfficeSection = false;

      for (let i = startRow; i < raw.length; i++) {
        const row = raw[i] as string[];
        const name = row[0]?.trim();
        if (!name) continue;

        const nameLower = name.toLowerCase();
        
        if (nameLower.includes("staff attendance")) {
          isStaffSection = true;
          isCentralOfficeSection = false;
          continue;
        }
        
        if (nameLower.includes("central office")) {
          isStaffSection = false;
          isCentralOfficeSection = true;
          continue;
        }

        if (nameLower.includes("total students")) continue;
        if (nameLower.includes("time in") || nameLower.includes("time out")) continue;

        const attendanceInfo = {
          name,
          present: row[colIndex]?.toUpperCase() === "TRUE",
          timeIn: row[colIndex + 1],
          timeOut: row[colIndex + 2]
        };

        if (isStaffSection || isCentralOfficeSection) {
          if (attendanceInfo.present || attendanceInfo.timeIn) {
            staffAttendance.push(attendanceInfo);
          }
        } else {
          // Store with normalized name key for better matching
          const normalizedName = name.toLowerCase().replace(/\s+/g, ' ').trim();
          attendanceMap[normalizedName] = attendanceInfo;
        }
      }
    }

    console.log(`[Attendance] Requested: ${requestedDate}, Found: ${requestedDateFound}, Active: ${activeDate}, GID: ${activeGid}, Map Size: ${Object.keys(attendanceMap).length}`);

    // Process Roster (GID 1389983501)
    const rosterHeaders = rosterRaw[0] as string[];
    const rosterData: any[] = [];
    // American Lit is NOT an EOC course per user request
    const EOC_COURSES = ["algebra", "geometry", "biology", "us history", "physical sci"];
    
    console.log(`[Roster] Headers: ${JSON.stringify(rosterHeaders)}`);

    for (let i = 1; i < rosterRaw.length; i++) {
      const row = rosterRaw[i] as string[];
      const studentName = row[0]?.trim();
      
      if (studentName && (
          studentName.toLowerCase().includes("drop students") || 
          studentName.toLowerCase().includes("dropped students") ||
          studentName.toLowerCase() === "dropped"
      )) {
        break;
      }
      
      if (!studentName) continue;

      const obj: any = { classes: [], studentNotes: [] };
      
      // Basic Info
      rosterHeaders.forEach((header, index) => {
        const val = row[index];
        const h = (header || "").toString().trim().toLowerCase();
        
        if (index === 0) obj.name = studentName;
        else if (h === "grade" || h === " grade ") {
          // Only take the first "Grade" column (which is the student's grade)
          if (obj.grade === undefined) obj.grade = val;
        }
        else if (h.includes("attendance code")) obj.attendanceCode = val;
        else if (h.includes("student #") || h === "id") obj.id = val;
        else if (h.includes("cb")) obj.cb = val;
        else if (h === "age") obj.age = val;
        else if (h.includes("date")) obj.lastSeenDate = val;
        else if (h.includes("notes") || h.includes("status")) {
          const note = val?.toString().trim();
          if (note) obj.notes = (obj.notes || "") + " " + note;
        }
      });

      const normalizedName = studentName.toLowerCase().replace(/\s+/g, ' ').trim();
      const att = attendanceMap[normalizedName];
      
      // Explicitly set attendance values to ensure they clear on refresh if removed from sheet
      obj.isPresent = att ? att.present : false;
      obj.timeIn = att ? att.timeIn : undefined;
      obj.timeOut = att ? att.timeOut : undefined;

      // Explicit Class Parsing (Indices 7, 10, 13, 16)
      const classIndices = [7, 10, 13, 16];
      classIndices.forEach(idx => {
        const className = row[idx]?.trim();
        if (className) {
          const percentageVal = row[idx + 1];
          const gradeVal = row[idx + 2];
          
          const cleanPercent = percentageVal?.toString().replace('%', '').trim();
          const progress = parseFloat(cleanPercent || "0");
          const finalProgress = isNaN(progress) ? 0 : progress;

          obj.classes.push({
            name: className,
            progress: finalProgress,
            grade: gradeVal || ""
          });

          // EOC Detection
          if (EOC_COURSES.some(eoc => className.toLowerCase().includes(eoc))) {
            obj.studentNotes.push(`${className} is an EOC course.`);
          }

          // "Almost Completed" Detection (Green highlight in sheet)
          if (finalProgress >= 80 && finalProgress < 100) {
            obj.studentNotes.push(`${className} is almost complete (${finalProgress}%).`);
          }
        }
      });

      // Global Status Detection (Searching entire row for keywords)
      const rowString = row.join(" ").toLowerCase();
      if (rowString.includes("locked")) {
        obj.studentNotes.push("Course is currently LOCKED.");
      }
      if (rowString.includes("waiting on new course")) {
        obj.studentNotes.push("Waiting on new course to open.");
      }
      if (rowString.includes("waiting on ccf") || rowString.includes("pending ccf")) {
        obj.studentNotes.push("Completed; waiting on CCF paperwork.");
      }
      
      // Fallback for ID if not found via headers
      if (!obj.id && row[2]) obj.id = row[2];

      if (obj.name && obj.id) {
        rosterData.push(obj);
      }
    }

    // Process Course Map (Simplified: Use Overrides Only)
    const courseMapMap: Record<string, { status: string, missing: string[] }> = {};
    
    // Default all roster students to "Course Mapping Needed" unless overridden
    rosterData.forEach(student => {
      const studentId = student.id;
      const isCompleted = overrides[studentId]?.courseMapCompleted;
      
      courseMapMap[studentId] = {
        status: isCompleted ? "COMPLETE" : "Course Mapping Needed",
        missing: isCompleted ? [] : ["SS", "ELA"] // Placeholder for missing
      };
    });
    
    // Add overrides for students not in the roster yet (if any)
    Object.keys(overrides).forEach(studentId => {
      if (!courseMapMap[studentId] && overrides[studentId].courseMapCompleted) {
        courseMapMap[studentId] = { status: "COMPLETE", missing: [] };
      }
    });

    console.log(`[Attendance] Requested: ${requestedDate}, Found: ${requestedDateFound}, Active: ${activeDate} (GID: ${activeGid}), Map Size: ${Object.keys(attendanceMap).length}`);
    console.log(`[Roster] Parsed ${rosterData.length} students`);

    res.json({ 
      roster: rosterData, 
      attendance: attendanceMap, 
      staffAttendance: staffAttendance,
      activeDate: activeDate,
      activeGid: activeGid,
      requestedDateFound: requestedDate ? requestedDateFound : true,
      courseMap: courseMapMap,
      overrides: overrides,
      googleApiStatus: googleApiStatus
    });
  } catch (error: any) {
    console.error("[API Error]", error);
    res.status(500).json({ 
      error: "Failed to fetch data from Google Sheets",
      details: error.message,
      suggestion: "Check if the spreadsheet is public or if the SHEET_ID is correct."
    });
  }
});

async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static("dist"));
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
