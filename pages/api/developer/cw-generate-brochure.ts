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
  return name.replace(/[^a-zA-Z0-9_\-. ]/g, '').substring(0, 80).trim();
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { courseUrl } = req.body || {};
  if (!courseUrl || !/^https?:\/\//i.test(courseUrl)) {
    return res.status(400).json({ error: 'A valid http(s) course URL is required.' });
  }

  const scriptPath = path.join(process.cwd(), 'scripts', 'generate-brochure.py');
  const templateDir = path.join(process.cwd(), 'public', 'templates', 'brochure');
  const outputPath = path.join(os.tmpdir(), `brochure_${Date.now()}.pdf`);

  try {
    // Use `python3` explicitly — the Debian-slim production image has
    // `python3` on PATH but not always `python`. The Dockerfile symlinks
    // `/usr/bin/python3` → `/usr/bin/python`, but when the Python venv at
    // `/opt/venv/bin` is first on PATH (it ships python3 but not python)
    // the symlink is shadowed and the call fails with "python: not found".
    const pythonBin = process.env.PYTHON_BIN || 'python3';
    const result = execSync(
      `${pythonBin} "${scriptPath}" "${courseUrl}" "${templateDir}" "${outputPath}"`,
      { encoding: 'utf-8', timeout: 120000, maxBuffer: 20 * 1024 * 1024 }
    );

    const parsed = JSON.parse(result.trim());
    if (parsed.error) {
      return res.status(500).json({ error: parsed.error, trace: parsed.trace });
    }

    if (!fs.existsSync(outputPath)) {
      return res.status(500).json({ error: 'PDF was not created.' });
    }

    const pdfBuffer = fs.readFileSync(outputPath);
    const title = sanitizeFileName(parsed.course_title || 'Brochure');
    const fileName = `Brochure_${parsed.tgs_ref || 'course'}_${title}.pdf`;

    return res.status(200).json({
      success: true,
      courseTitle: parsed.course_title,
      tgsRef: parsed.tgs_ref,
      courseData: parsed.course_data,
      document: {
        name: fileName,
        data: pdfBuffer.toString('base64'),
      },
    });
  } catch (error: any) {
    console.error('Brochure generation error:', error);
    return res.status(500).json({ error: error.message || 'Failed to generate brochure' });
  } finally {
    try { fs.unlinkSync(outputPath); } catch {}
  }
}
