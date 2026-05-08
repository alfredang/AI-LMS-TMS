require('dotenv').config({ path: '.env.local' });
const pool = new (require('pg').Pool)({ connectionString: process.env.DATABASE_URL });

const log = `
📌 1078855 | "Applications Integration with Power Apps and Power Automate"
   Trainer: "Sanjiv Venkatram" (Status: pending)
   ✅ DID: CLEAR legacy assigned_trainer (was "Sanjiv Venkatram")
   ✅ DID: CLEAR TPG assigned_trainer (was "Sanjiv Venkatram")

📌 1177070 | "Create Intelligent Power Apps and Power Automate Workflows with Copilot"
   Trainer: "Sanjiv Venkatram" (Status: pending)
   ✅ DID: CLEAR legacy assigned_trainer (was "Sanjiv Venkatram")
   ✅ DID: CLEAR TPG assigned_trainer (was "Sanjiv Venkatram")

📌 1171706 | "Building Your First Machine Learning Model with Python and Tensorflow"
   Trainer: "Dr Alvin Ang Wei Hern" (Status: pending)
   ✅ DID: CLEAR legacy assigned_trainer (was "Dr Alvin Ang Wei Hern")
   ✅ DID: CLEAR TPG assigned_trainer (was "Dr Alvin Ang Wei Hern")

📌 1171730 | "Vibe Coding for Multi-Agent AI Systems"
   Trainer: "Dr Alvin Ang Wei Hern" (Status: pending)
   ✅ DID: CLEAR legacy assigned_trainer (was "Dr Alvin Ang Wei Hern")
   ✅ DID: CLEAR TPG assigned_trainer (was "Dr Alvin Ang Wei Hern")

📌 1076667 | "Data Analytics and Visualization with R"
   Trainer: "Dwight Nuwan Fonseka" (Status: pending)
   ✅ DID: CLEAR legacy assigned_trainer (was "Dwight Nuwan Fonseka")
   ✅ DID: CLEAR TPG assigned_trainer (was "Dwight Nuwan Fonseka")

📌 1331125 | "Enhance Work Productivity with Microsoft 365 Copilot"
   Trainer: "Sanjiv Venkatram" (Status: pending)
   ✅ DID: CLEAR legacy assigned_trainer (was "Sanjiv Venkatram")
   ✅ DID: CLEAR TPG assigned_trainer (was "Sanjiv Venkatram")

📌 1076774 | "Quantum Computing for Beginners"
   Trainer: "Dr. Alfred Ang" (Status: pending)
   ✅ DID: CLEAR legacy assigned_trainer (was "Dr. Alfred Ang")
   ✅ DID: CLEAR TPG assigned_trainer (was "Dr. Alfred Ang")

📌 1309742 | "Tableau Certified Data Analyst Training"
   Trainer: "Dr Alvin Ang Wei Hern" (Status: pending)
   ✅ DID: CLEAR legacy assigned_trainer (was "Dr Alvin Ang Wei Hern")
   ✅ DID: CLEAR TPG assigned_trainer (was "Dr Alvin Ang Wei Hern")

📌 1310926 | "Building Agentic AI Workflows to Automate Business Processes"
   Trainer: "Tan Woei Ming" (Status: pending)
   ✅ DID: CLEAR legacy assigned_trainer (was "Tan Woei Ming")
   ✅ DID: CLEAR TPG assigned_trainer (was "Tan Woei Ming")

📌 1177069 | "Create Intelligent Power Apps and Power Automate Workflows with Copilot"
   Trainer: "Sanjiv Venkatram" (Status: pending)
   ✅ DID: CLEAR legacy assigned_trainer (was "Sanjiv Venkatram")

📌 1080949 | "Advanced Transactional Accounting with Quickbooks Online"
   Trainer: "Gary Chan Sim Kien" (Status: pending)
   ✅ DID: CLEAR legacy assigned_trainer (was "Gary Chan Sim Kien")

📌 1329859 | "Microsoft Power Platform Fundamentals (PL-900)"
   Trainer: "Sanjiv Venkatram" (Status: pending)
   ✅ DID: CLEAR legacy assigned_trainer (was "Sanjiv Venkatram")
   ✅ DID: CLEAR TPG assigned_trainer (was "Sanjiv Venkatram")

📌 1323875 | "Business Innovation with OpenClaw and Blockchain"
   Trainer: "Gan Sie Huai (Edric)" (Status: pending)
   ✅ DID: CLEAR legacy assigned_trainer (was "Gan Sie Huai (Edric)")
   ✅ DID: CLEAR TPG assigned_trainer (was "Gan Sie Huai (Edric)")

📌 1081265 | "CompTIA Certified Server+ Training"
   Trainer: "Agus Salim" (Status: pending)
   ✅ DID: CLEAR legacy assigned_trainer (was "Agus Salim")

📌 1089976 | "Tableau Certified Data Analyst Training"
   Trainer: "Dwight Nuwan Fonseka" (Status: pending)
   ✅ DID: DELETE course_run_trainer for "Dwight Nuwan Fonseka"
   ✅ DID: CLEAR legacy assigned_trainer (was "Dwight Nuwan Fonseka")
   ✅ DID: CLEAR TPG assigned_trainer (was "Dwight Nuwan Fonseka")

📌 1081226 | "Bioinformatics Data Analysis with R Bioconductor"
   Trainer: "Dwight Nuwan Fonseka" (Status: pending)
   ✅ DID: CLEAR legacy assigned_trainer (was "Dwight Nuwan Fonseka")
   ✅ DID: CLEAR TPG assigned_trainer (was "Dwight Nuwan Fonseka")

📌 1171732 | "Vibe Coding for Multi-Agent AI Systems"
   Trainer: "Dr Alvin Ang Wei Hern" (Status: pending)
   ✅ DID: CLEAR legacy assigned_trainer (was "Dr Alvin Ang Wei Hern")
   ✅ DID: CLEAR TPG assigned_trainer (was "Dr Alvin Ang Wei Hern")

📌 1310924 | "Building Agentic AI Workflows to Automate Business Processes"
   Trainer: "Tan Woei Ming" (Status: pending)
   ✅ DID: CLEAR legacy assigned_trainer (was "Tan Woei Ming")
   ✅ DID: CLEAR TPG assigned_trainer (was "Tan Woei Ming")

📌 1299326 | "Responsible Generative AI Basics"
   Trainer: "Dwight Nuwan Fonseka" (Status: pending)
   ✅ DID: CLEAR legacy assigned_trainer (was "Dwight Nuwan Fonseka")
   ✅ DID: CLEAR TPG assigned_trainer (was "Dwight Nuwan Fonseka")

📌 1310919 | "Building Agentic AI Workflows to Automate Business Processes"
   Trainer: "Tan Woei Ming" (Status: pending)
   ✅ DID: CLEAR legacy assigned_trainer (was "Tan Woei Ming")
   ✅ DID: CLEAR TPG assigned_trainer (was "Tan Woei Ming")

📌 1310892 | "Agentic AI Automation with n8n"
   Trainer: "Tan Woei Ming" (Status: pending)
   ✅ DID: CLEAR legacy assigned_trainer (was "Tan Woei Ming")
   ✅ DID: CLEAR TPG assigned_trainer (was "Tan Woei Ming")

📌 1075753 | "Agentic AI Applications with Claude Code"
   Trainer: "Amin Mahetar" (Status: pending)
   ✅ DID: CLEAR legacy assigned_trainer (was "Amin Mahetar")

📌 1077715 | "Automate Video and Voice AI Agents with n8n"
   Trainer: "Dwight Nuwan Fonseka" (Status: declined)
   ✅ DID: CLEAR legacy assigned_trainer (was "Dwight Nuwan Fonseka")
   ✅ DID: CLEAR TPG assigned_trainer (was "Dwight Nuwan Fonseka")

📌 1324586 | "Build Full Stack React Web App with Vibe Coding"
   Trainer: "Mohamed Afiq Bin Mohamed Ismail" (Status: declined)
   ✅ DID: CLEAR legacy assigned_trainer (was "Mohamed Afiq Bin Mohamed Ismail")
   ✅ DID: CLEAR TPG assigned_trainer (was "Mohamed Afiq Bin Mohamed Ismail")

📌 1074989 | "Business Innovation with Artificial Intelligence"
   Trainer: "Seow Wah Lee Michael" (Status: declined)
   ✅ DID: CLEAR legacy assigned_trainer (was "Seow Wah Lee Michael")

📌 1076830 | "Excel Power Query and Power Pivot"
   Trainer: "Hiong Kum Meng (Ken)" (Status: pending)
   ✅ DID: CLEAR legacy assigned_trainer (was "Hiong Kum Meng (Ken)")
   ✅ DID: CLEAR TPG assigned_trainer (was "Hiong Kum Meng (Ken)")

📌 1076668 | "Data Analytics and Visualization with R"
   Trainer: "Dwight Nuwan Fonseka" (Status: pending)
   ✅ DID: CLEAR legacy assigned_trainer (was "Dwight Nuwan Fonseka")
   ✅ DID: CLEAR TPG assigned_trainer (was "Dwight Nuwan Fonseka")

📌 1075031 | "Business Innovation with Internet-of-Things (IoT)"
   Trainer: "Shawn Koh Boon Hiap" (Status: pending)
   ✅ DID: CLEAR legacy assigned_trainer (was "Shawn Koh Boon Hiap")
   ✅ DID: CLEAR TPG assigned_trainer (was "Shawn Koh Boon Hiap")

📌 1076775 | "Quantum Computing for Beginners"
   Trainer: "Dr. Alfred Ang" (Status: pending)
   ✅ DID: CLEAR legacy assigned_trainer (was "Dr. Alfred Ang")
   ✅ DID: CLEAR TPG assigned_trainer (was "Dr. Alfred Ang")

📌 1171691 | "Basic Machine Learning with ScikitLearn Course"
   Trainer: "Yeo Hwee Theng" (Status: pending)
   ✅ DID: CLEAR legacy assigned_trainer (was "Yeo Hwee Theng")

📌 1303963 | "Architecture Drawing with Revit"
   Trainer: "Jyoti Chopra" (Status: pending)
   ✅ DID: CLEAR legacy assigned_trainer (was "Jyoti Chopra")
   ✅ DID: CLEAR TPG assigned_trainer (was "Jyoti Chopra")

📌 1076721 | "Mastering Facebook Social Media Marketing for High-Impact Lead Generation"
   Trainer: "Allen Wong Zhao Quan" (Status: pending)
   ✅ DID: CLEAR legacy assigned_trainer (was "Allen Wong Zhao Quan")
   ✅ DID: CLEAR TPG assigned_trainer (was "Allen Wong Zhao Quan")

📌 1316241 | "Building Agentic AI Workflows to Automate Business Processes"
   Trainer: "Tan Woei Ming" (Status: pending)
   ✅ DID: CLEAR legacy assigned_trainer (was "Tan Woei Ming")
   ✅ DID: CLEAR TPG assigned_trainer (was "Tan Woei Ming")
`;

async function main() {
  const lines = log.split('\n');
  let currentCourseRun = null;
  
  for (const line of lines) {
    const crMatch = line.match(/📌 (\d+) \|/);
    if (crMatch) {
      currentCourseRun = crMatch[1];
    }
    const tpgMatch = line.match(/✅ DID: CLEAR TPG assigned_trainer \(was "(.*)"\)/);
    if (tpgMatch && currentCourseRun) {
      const name = tpgMatch[1];
      console.log(`Restoring ${currentCourseRun} -> ${name}`);
      await pool.query(
        `UPDATE course_run SET tpg_assigned_trainer_name = $1 WHERE course_run_id = $2`,
        [name, currentCourseRun]
      );
    }
  }
  await pool.end();
}
main();
