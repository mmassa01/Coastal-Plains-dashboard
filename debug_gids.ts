import axios from "axios";
import Papa from "papaparse";

const SHEET_ID = "1lo4Kt_x-CIRun4O9J5ivFJmiAATwfgbs0Fx043BYiOs";

async function checkGid(gid: string) {
  let url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${gid}`;
  try {
    const response = await axios.get(url);
    console.log(`GID ${gid}: SUCCESS (${response.data.length} bytes)`);
    return true;
  } catch (error: any) {
    console.log(`GID ${gid}: FAILED - ${error.message}`);
    return false;
  }
}

async function run() {
    const baseGids = [194970608, 647697214, 1389983501, 865017288];
    const testGids: string[] = ["0"];
    
    for (const base of baseGids) {
        for (let i = -10; i <= 10; i++) {
            testGids.push((base + i).toString());
        }
    }
    
    const allGids = [...new Set(testGids)];
    
    for (const gid of allGids) {
        await checkGid(gid);
    }
}

run();
