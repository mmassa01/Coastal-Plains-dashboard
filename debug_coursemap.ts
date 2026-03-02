import axios from "axios";
import Papa from "papaparse";

const SHEET_ID = "1lo4Kt_x-CIRun4O9J5ivFJmiAATwfgbs0Fx043BYiOs";

async function checkGid(gid: string) {
  let url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${gid}`;
  try {
    const response = await axios.get(url);
    const results = Papa.parse(response.data, { header: false, skipEmptyLines: true });
    console.log(`--- GID: ${gid} ---`);
    results.data.slice(0, 10).forEach((row: any, i: number) => {
      console.log(`Row ${i}: ${JSON.stringify(row.slice(0, 30))}`);
    });
  } catch (error) {
    console.log(`--- GID: ${gid} FAILED ---`);
  }
}

const ATTENDANCE_GIDS = ["865017288"];

async function run() {
  for (const gid of ATTENDANCE_GIDS) {
    await checkGid(gid);
  }
}

run();
