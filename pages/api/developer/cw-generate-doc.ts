import type { NextApiRequest, NextApiResponse } from 'next';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

export const config = {
  api: {
    bodyParser: { sizeLimit: '10mb' },
    responseLimit: '50mb',
  },
};

function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_\-. ]/g, '').substring(0, 50).trim();
}

function generateDoc(docType: string, courseData: any): { name: string; data: string } {
  const tmpDir = os.tmpdir();
  const contextPath = path.join(tmpDir, `cw_context_${Date.now()}.json`);
  const outputPath = path.join(tmpDir, `cw_output_${Date.now()}_${docType}.docx`);
  const scriptPath = path.join(process.cwd(), 'scripts', 'fill-template.py');

  try {
    // Write context to temp JSON file
    console.log(`[CW-DOC] Generating ${docType}, courseData keys:`, courseData ? Object.keys(courseData) : 'NULL');
    console.log(`[CW-DOC] Course Title:`, courseData?.Course_Title || courseData?.courseTitle || 'MISSING');
    console.log(`[CW-DOC] TGS Ref:`, courseData?.TGS_Ref_No || courseData?.tgsRefNo || 'MISSING');
    console.log(`[CW-DOC] Learning Units:`, courseData?.Learning_Units?.length || courseData?.learningUnits?.length || 0);
    fs.writeFileSync(contextPath, JSON.stringify(courseData || {}, null, 2), 'utf-8');

    // Call Python script to fill template
    const result = execSync(
      `python "${scriptPath}" ${docType} "${contextPath}" "${outputPath}"`,
      { encoding: 'utf-8', timeout: 30000 }
    );

    const parsed = JSON.parse(result.trim());
    if (parsed.error) throw new Error(parsed.error);

    // Read generated DOCX
    if (!fs.existsSync(outputPath)) {
      throw new Error('Output file was not created');
    }

    const docBuffer = fs.readFileSync(outputPath);
    const tgsRef = courseData?.tgsRefNo || courseData?.TGS_Ref_No || 'doc';
    const courseTitle = sanitizeFileName(courseData?.courseTitle || courseData?.Course_Title || 'Course');
    const fileName = `${docType.toUpperCase()}_${tgsRef}_${courseTitle}_v1.docx`;

    return { name: fileName, data: docBuffer.toString('base64') };
  } finally {
    // Cleanup temp files
    try { fs.unlinkSync(contextPath); } catch {}
    try { fs.unlinkSync(outputPath); } catch {}
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { docType, courseData, extractedResult, cpFileBase64, cpFileName } = req.body;

    if (!docType) {
      return res.status(400).json({ error: 'Missing docType' });
    }

    // If raw CP file is provided, parse it to get exact text
    let rawCpText = extractedResult || '';
    if (cpFileBase64 && cpFileName) {
      try {
        const parseScript = path.join(process.cwd(), 'scripts', 'parse-cp.py');
        const b64TmpPath = path.join(os.tmpdir(), `cp_raw_${Date.now()}.txt`);
        fs.writeFileSync(b64TmpPath, cpFileBase64, 'utf-8');
        const parseResult = execSync(
          `python "${parseScript}" "${b64TmpPath}" base64 "${cpFileName}"`,
          { encoding: 'utf-8', timeout: 30000 }
        );
        const parsed = JSON.parse(parseResult.trim().split('\n').pop() || '{}');
        if (parsed.text) rawCpText = parsed.text;
        try { fs.unlinkSync(b64TmpPath); } catch {}
      } catch (e: any) {
        console.error('CP parse for LP error:', e.message);
      }
    }

    // Merge courseData with extractedResult as fallback
    const contextData = {
      ...(courseData || {}),
      extractedText: rawCpText,
    };

    const documents: { name: string; data: string }[] = [];

    if (docType === 'ap_asr') {
      documents.push(generateDoc('ap', contextData));
      documents.push(generateDoc('asr', contextData));
    } else if (docType === 'all') {
      documents.push(generateDoc('lg', contextData));
      documents.push(generateDoc('ap', contextData));
      documents.push(generateDoc('asr', contextData));
      documents.push(generateDoc('fg', contextData));
    } else if (docType === 'lp') {
      // Lesson Plan uses separate Python script with barrier algorithm
      const lpScriptPath = path.join(process.cwd(), 'scripts', 'generate-lp.py');
      const lpContextPath = path.join(os.tmpdir(), `lp_context_${Date.now()}.json`);
      const lpOutputPath = path.join(os.tmpdir(), `lp_output_${Date.now()}.docx`);

      try {
        fs.writeFileSync(lpContextPath, JSON.stringify(contextData || {}, null, 2), 'utf-8');
        const lpResult = execSync(
          `python "${lpScriptPath}" "${lpContextPath}" "${lpOutputPath}"`,
          { encoding: 'utf-8', timeout: 30000 }
        );
        const lpParsed = JSON.parse(lpResult.trim());
        if (lpParsed.error) throw new Error(lpParsed.error);

        const lpBuffer = fs.readFileSync(lpOutputPath);
        const tgsRef = contextData?.TGS_Ref_No || contextData?.tgsRefNo || 'doc';
        const title = sanitizeFileName(contextData?.Course_Title || contextData?.courseTitle || 'Course');
        const lpParsedData = JSON.parse(lpResult.trim());
        documents.push({ name: `LP_${tgsRef}_${title}_v1.docx`, data: lpBuffer.toString('base64') });

        // Also return schedule data for UI display
        return res.status(200).json({ success: true, documents, schedule: lpParsedData });
      } finally {
        try { fs.unlinkSync(lpContextPath); } catch {}
        try { fs.unlinkSync(lpOutputPath); } catch {}
      }
    } else if (docType === 'assessment') {
      // Auto-detect types from Assessment_Methods_Details and call Claude for each
      const amDetails = contextData.Assessment_Methods_Details || contextData.assessmentMethodsDetails || [];
      console.log('[Assessment] Detected methods count:', amDetails.length);
      console.log('[Assessment] contextData keys:', Object.keys(contextData));
      if (amDetails.length === 0) {
        return res.status(400).json({ error: `No assessment methods found in CP. courseData keys: ${Object.keys(contextData).join(', ')}` });
      }

      // Call the AI generation endpoint to get questions for all types
      const protocol = req.headers['x-forwarded-proto'] || 'http';
      const host = req.headers.host;
      const aiRes = await fetch(`${protocol}://${host}/api/developer/cw-generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          section: 'generate_assessment_all',
          cpText: extractedResult,
          courseData: contextData,
        }),
      });
      const aiData = await aiRes.json();
      if (!aiRes.ok) throw new Error(aiData.error || 'Failed to generate assessment questions');
      console.log('[Assessment] AI returned', aiData.assessments?.length || 0, 'assessment types');

      // Write context for Python DOCX generator
      const assessmentContextPath = path.join(os.tmpdir(), `assess_ctx_${Date.now()}.json`);
      const assessmentOutDir = path.join(os.tmpdir(), `assess_out_${Date.now()}`);
      const assessScriptPath = path.join(process.cwd(), 'scripts', 'generate-assessment.py');

      try {
        fs.writeFileSync(assessmentContextPath, JSON.stringify({
          course_title: contextData.Course_Title || contextData.courseTitle || 'Course',
          company_name: contextData.Name_of_Organisation || contextData.organisationName || 'Tertiary Infotech Academy Pte Ltd',
          company_uen: contextData.UEN || '201200696W',
          assessments: aiData.assessments || [],
        }, null, 2), 'utf-8');

        const result = execSync(
          `python "${assessScriptPath}" "${assessmentContextPath}" "${assessmentOutDir}"`,
          { encoding: 'utf-8', timeout: 60000 }
        );
        const parsed = JSON.parse(result.trim());
        if (parsed.error) throw new Error(parsed.error);

        // Read all generated DOCX files
        for (const gen of parsed.generated) {
          if (fs.existsSync(gen.question_path)) {
            const buf = fs.readFileSync(gen.question_path);
            documents.push({ name: path.basename(gen.question_path), data: buf.toString('base64') });
            try { fs.unlinkSync(gen.question_path); } catch {}
          }
          if (fs.existsSync(gen.answer_path)) {
            const buf = fs.readFileSync(gen.answer_path);
            documents.push({ name: path.basename(gen.answer_path), data: buf.toString('base64') });
            try { fs.unlinkSync(gen.answer_path); } catch {}
          }
        }
      } finally {
        try { fs.unlinkSync(assessmentContextPath); } catch {}
        try { fs.rmdirSync(assessmentOutDir); } catch {}
      }
    } else {
      documents.push(generateDoc(docType, contextData));
    }

    return res.status(200).json({ success: true, documents });
  } catch (error: any) {
    console.error('Document generation error:', error);
    return res.status(500).json({ error: error.message || 'Failed to generate document' });
  }
}
