import React, { useId, useMemo, useState } from 'react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Icon, IconName } from '../ui/Icon';

type ClaimRowDb = {
  id: string;
  claim_id: string | null;
  grant_id: string | null;
  enrollment_id: string | null;
  trainee_name: string | null;
  course_reference: string | null;
  course_name?: string | null;
  course_start_date?: string | null;
  disbursement_date?: string | null;
  ready_for_payout_date?: string | null;
  payout_request_id?: string | null;
  paynow_account?: string | null;
  individual_nric?: string | null;
  sctp_declaration?: string | null;
  lapsed_date?: string | null;
  training_partner_code: string | null;
  claim_status: string | null;
  claim_amount: string | null;
  created_date: string;
  imported_at: string;
  raw_data: any;
};

type UploadResponse = {
  summary: {
    total: number;
    existing: number;
    inserted: number;
    failed: number;
  };
  results: Array<
    | {
        claim_id: string;
        result: 'exists' | 'inserted';
        message: string;
        data: ClaimRowDb;
      }
    | {
        claim_id: null;
        result: 'failed';
        message: string;
        data: null;
      }
  >;
};

function formatMoney(v: string | null | undefined) {
  if (!v) return '-';
  const n = Number(v);
  if (!isFinite(n)) return String(v);
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDate(v: string | null | undefined) {
  if (!v) return '-';
  const d = new Date(v);
  if (isNaN(d.getTime())) return String(v);
  return d.toLocaleDateString();
}

const ClaimCheckView: React.FC = () => {
  const fileInputId = useId();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  const [file, setFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadResponse, setUploadResponse] = useState<UploadResponse | null>(null);

  const fileValidationError = useMemo(() => {
    if (!file) return null;
    const name = file.name.toLowerCase();
    if (name.endsWith('.xlsx') || name.endsWith('.xls')) return null;
    return 'Invalid file type. Please upload an Excel file (.xlsx or .xls).';
  }, [file]);

  const handleDragEvents = (e: React.DragEvent<HTMLDivElement>, isOver: boolean) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(isOver);
  };

  const applySelectedFile = (selected: File | null) => {
    setFile(selected);
    setError(null);
    setSuccess(null);
    setUploadResponse(null);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    const droppedFile = e.dataTransfer.files?.[0] || null;
    applySelectedFile(droppedFile);
  };

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setUploadResponse(null);
    if (!file) {
      setError('Please choose a claim PDF or .xlsx file to upload.');
      return;
    }
    if (fileValidationError) {
      setError(fileValidationError);
      return;
    }
    setIsUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch('/api/training-provider/claim-check-upload', {
        method: 'POST',
        body: form,
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Upload failed');
      setUploadResponse(json as UploadResponse);
      setSuccess('Upload processed successfully.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-on-surface">Check / Add Claim</h2>
      </div>

      <Card className="p-4 space-y-4">
        <form onSubmit={handleUpload} className="space-y-4">
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
            <h4 className="font-semibold text-amber-800 mb-2">⚠️ Important: For Claim Report Excel File</h4>
            <p className="text-sm text-amber-700">
              If you just downloaded this Excel file, please do the following before uploading:
            </p>
            <ul className="text-sm text-amber-700 mt-2 list-disc list-inside space-y-1">
              <li><strong>Windows:</strong> Open the file in Excel → Click "Enable Editing" → Save the file</li>
              <li><strong>Mac:</strong> Open the file in Excel → Save the file (⌘+S)</li>
            </ul>
            <p className="text-sm text-amber-700 mt-2">
              <strong>Reason:</strong> Some downloads open in Protected View, which prevents the data from being read programmatically.
            </p>
          </div>

          <div className="text-center">
            <h3 className="text-xl font-bold dark:text-white">Upload Claim File</h3>
            <p className="text-gray-500 dark:text-gray-400 mt-1">Upload an Excel file to check existing claims and insert missing ones.</p>
          </div>

          <div
            onDragOver={(e) => handleDragEvents(e, true)}
            onDragLeave={(e) => handleDragEvents(e, false)}
            onDrop={handleDrop}
            className={`p-10 border-2 border-dashed rounded-lg text-center cursor-pointer transition-colors ${
              isDragOver
                ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                : 'border-gray-300 dark:border-gray-600 hover:border-blue-500'
            }`}
          >
            <input
              id={fileInputId}
              type="file"
              className="hidden"
              accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
              onChange={(e) => applySelectedFile(e.target.files?.[0] || null)}
            />
            <label htmlFor={fileInputId} className="cursor-pointer">
              <Icon name={IconName.Upload} className="w-12 h-12 mx-auto text-gray-400" />
              <p className="mt-2 font-semibold text-gray-900 dark:text-white">
                {file ? file.name : 'Drag & drop your file here, or click to browse'}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">XLSX or XLS file format</p>
              {file && (
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  {(file.size / 1024 / 1024).toFixed(2)} MB
                </p>
              )}
            </label>
          </div>

        {fileValidationError && !error && (
          <div className="p-3 bg-amber-50 dark:bg-amber-900/20 text-amber-800 dark:text-amber-200 rounded-lg text-sm">
            {fileValidationError}
          </div>
        )}

        {error && (
          <div className="mt-4 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg p-4 flex items-start gap-3">
            <div className="flex-shrink-0 w-10 h-10 bg-white dark:bg-red-900/50 border border-red-200 dark:border-red-700 rounded-full flex items-center justify-center">
              <Icon name={IconName.Close} className="w-5 h-5 text-red-500 dark:text-red-400" />
            </div>
            <div className="flex-1 min-w-0">
              <h4 className="font-semibold text-gray-900 dark:text-gray-100">Something went wrong!</h4>
              <p className="text-sm text-gray-600 dark:text-gray-300 mt-1 whitespace-pre-line">{error}</p>
            </div>
            <button
              type="button"
              onClick={() => setError(null)}
              className="flex-shrink-0 text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300"
            >
              <Icon name={IconName.Close} className="w-5 h-5" />
            </button>
          </div>
        )}

        {success && (
          <div className="p-3 bg-green-50 dark:bg-green-900/20 text-green-800 dark:text-green-200 rounded-lg text-sm">
            {success}
          </div>
        )}

        <div className="flex justify-end items-center">
          <Button type="submit" disabled={!file || isUploading || !!fileValidationError}>
            {isUploading ? (
              <div className="flex items-center">
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                Processing...
              </div>
            ) : 'Upload & Process'}
          </Button>
        </div>
        </form>

        {uploadResponse && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
              <div className="rounded-xl border border-default bg-surface p-3">
                <div className="text-xs text-on-surface-secondary">Total processed</div>
                <div className="text-2xl font-bold">{uploadResponse.summary.total}</div>
              </div>
              <div className="rounded-xl border border-default bg-surface p-3">
                <div className="text-xs text-on-surface-secondary">Already exists</div>
                <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">{uploadResponse.summary.existing}</div>
              </div>
              <div className="rounded-xl border border-default bg-surface p-3">
                <div className="text-xs text-on-surface-secondary">Newly inserted</div>
                <div className="text-2xl font-bold text-green-600 dark:text-green-400">{uploadResponse.summary.inserted}</div>
              </div>
              <div className="rounded-xl border border-default bg-surface p-3">
                <div className="text-xs text-on-surface-secondary">Failed</div>
                <div className="text-2xl font-bold text-red-600 dark:text-red-400">{uploadResponse.summary.failed}</div>
              </div>
            </div>

            <div className="overflow-x-auto rounded-xl border border-default bg-surface">
              <table className="min-w-full text-sm">
                <thead className="bg-surface-elevated text-on-surface-secondary">
                  <tr>
                    <th className="text-left px-3 py-2 font-semibold">Claim ID</th>
                    <th className="text-left px-3 py-2 font-semibold">Result</th>
                    <th className="text-left px-3 py-2 font-semibold">Claim Status</th>
                    <th className="text-left px-3 py-2 font-semibold">Course Reference</th>
                    <th className="text-left px-3 py-2 font-semibold">Course Name</th>
                    <th className="text-left px-3 py-2 font-semibold">Course Start Date</th>
                    <th className="text-left px-3 py-2 font-semibold">Claim Amount</th>
                    <th className="text-left px-3 py-2 font-semibold">Disbursement Date</th>
                    <th className="text-left px-3 py-2 font-semibold">Ready For Payout Date</th>
                    <th className="text-left px-3 py-2 font-semibold">Message</th>
                  </tr>
                </thead>
                <tbody>
                  {uploadResponse.results.map((r, idx) => {
                    const data = r.result === 'failed' ? null : r.data;
                    const badge =
                      r.result === 'inserted'
                        ? 'bg-green-500/15 text-green-700 dark:text-green-200'
                        : r.result === 'exists'
                          ? 'bg-blue-500/15 text-blue-700 dark:text-blue-200'
                          : 'bg-red-500/15 text-red-700 dark:text-red-200';

                    return (
                      <tr key={`${r.claim_id ?? 'failed'}-${idx}`} className="border-t border-default">
                        <td className="px-3 py-2 font-mono text-xs text-on-surface-secondary">
                          {r.claim_id ?? '-'}
                        </td>
                        <td className="px-3 py-2">
                          <span className={`inline-flex items-center px-2 py-1 rounded-md text-xs font-semibold ${badge}`}>
                            {r.result}
                          </span>
                        </td>
                        <td className="px-3 py-2">{data?.claim_status ?? '-'}</td>
                        <td className="px-3 py-2">{data?.course_reference ?? '-'}</td>
                        <td className="px-3 py-2">{data?.course_name ?? '-'}</td>
                        <td className="px-3 py-2">{formatDate(data?.course_start_date)}</td>
                        <td className="px-3 py-2">{formatMoney(data?.claim_amount)}</td>
                        <td className="px-3 py-2">{formatDate(data?.disbursement_date)}</td>
                        <td className="px-3 py-2">{formatDate(data?.ready_for_payout_date)}</td>
                        <td className="px-3 py-2 text-on-surface-secondary">{r.message}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
};

export default ClaimCheckView;

