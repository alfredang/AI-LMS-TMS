import React, { useState, useRef } from 'react';

const APP_OPTIONS = [
  { value: 'app1', label: 'App 1 (Skilleto)' },
  { value: 'app2', label: 'App 2' },
  { value: 'app3', label: 'App 3' },
  { value: 'app4', label: 'App 4 (OAuth)' },
];

interface FileAttachment {
  fileName: string;
  fileSize: string;
  fileType: string;
  attachmentId: string;
  attachmentByte: string;
}

export default function UploadDocumentView() {
  const [selectedApp, setSelectedApp] = useState('app1');
  const [claimId, setClaimId] = useState('');
  const [nric, setNric] = useState('');
  const [files, setFiles] = useState<FileAttachment[]>([]);
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showJson, setShowJson] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = e.target.files;
    if (!selectedFiles) return;

    const newAttachments: FileAttachment[] = [];

    for (let i = 0; i < selectedFiles.length; i++) {
      const file = selectedFiles[i];
      const base64 = await fileToBase64(file);
      newAttachments.push({
        fileName: file.name,
        fileSize: String(file.size),
        fileType: file.type || 'application/octet-stream',
        attachmentId: `att-${Date.now()}-${i}`,
        attachmentByte: base64,
      });
    }

    setFiles((prev) => [...prev, ...newAttachments]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        // Remove the data:...;base64, prefix
        resolve(result.split(',')[1] || result);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const formatFileSize = (bytes: string) => {
    const num = parseInt(bytes, 10);
    if (num < 1024) return `${num} B`;
    if (num < 1024 * 1024) return `${(num / 1024).toFixed(1)} KB`;
    return `${(num / (1024 * 1024)).toFixed(1)} MB`;
  };

  const handleSubmit = async () => {
    setError('');
    setResult(null);

    if (!claimId || !nric) {
      setError('Claim ID and NRIC are required.');
      return;
    }
    if (files.length === 0) {
      setError('Please add at least one file.');
      return;
    }

    setLoading(true);
    try {
      const resp = await fetch('/api/sf-credits/claims/upload-document', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ claimId, nric, attachments: files, app: selectedApp }),
      });
      const json = await resp.json();
      if (!resp.ok || !json.success) {
        setError(json.error || `Error ${resp.status}`);
      } else {
        setResult(json.data);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-on-surface">Upload Supporting Document</h1>
        <p className="mt-1 text-sm text-muted">
          POST /skillsFutureCredits/claims/&#123;claimId&#125;/supportingdocuments (v2)
        </p>
      </div>

      <div>
        <label className="block text-xs font-semibold uppercase text-muted tracking-wider mb-2">
          Certificate / OAuth
        </label>
        <select
          value={selectedApp}
          onChange={(e) => setSelectedApp(e.target.value)}
          className="w-full max-w-xs rounded-lg border border-strong bg-surface text-on-surface px-3 py-2 text-sm font-medium focus:ring-2 focus:ring-primary focus:border-primary"
        >
          {APP_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-xl">
        <div>
          <label className="block text-sm font-medium text-on-surface-secondary mb-1">Claim ID</label>
          <input
            value={claimId}
            onChange={(e) => setClaimId(e.target.value)}
            placeholder="e.g. 200123456789"
            className="w-full rounded-lg border border-strong bg-surface text-on-surface px-3 py-2 text-sm focus:ring-2 focus:ring-primary focus:border-primary"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-on-surface-secondary mb-1">NRIC</label>
          <input
            value={nric}
            onChange={(e) => setNric(e.target.value)}
            placeholder="e.g. S1234567A"
            className="w-full rounded-lg border border-strong bg-surface text-on-surface px-3 py-2 text-sm focus:ring-2 focus:ring-primary focus:border-primary"
          />
        </div>
      </div>

      {/* File picker */}
      <div>
        <label className="block text-sm font-medium text-on-surface-secondary mb-2">Attachments</label>
        <div
          onClick={() => fileInputRef.current?.click()}
          className="max-w-xl border-2 border-dashed border-strong rounded-lg p-6 text-center cursor-pointer hover:border-primary hover:bg-surface-hover transition-colors"
        >
          <p className="text-sm text-muted">Click to select files or drag and drop</p>
          <p className="text-xs text-muted mt-1">PDF, JPG, PNG supported</p>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".pdf,.jpg,.jpeg,.png"
          onChange={handleFileSelect}
          className="hidden"
        />

        {files.length > 0 && (
          <div className="mt-3 space-y-2 max-w-xl">
            {files.map((f, i) => (
              <div key={i} className="flex items-center justify-between bg-surface-elevated rounded-lg px-3 py-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-on-surface truncate">{f.fileName}</p>
                  <p className="text-xs text-muted">{formatFileSize(f.fileSize)} · {f.fileType}</p>
                </div>
                <button onClick={() => removeFile(i)} className="ml-3 text-red-500 hover:text-red-700 text-sm font-medium flex-shrink-0">
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <button
        onClick={handleSubmit}
        disabled={loading}
        className="px-6 py-2.5 rounded-lg bg-primary text-white font-medium text-sm hover:bg-primary/90 disabled:opacity-50 transition-colors"
      >
        {loading ? 'Uploading…' : 'Upload Documents'}
      </button>

      {error && (
        <div className="p-3 rounded-lg bg-danger-bg border border-red-200 dark:border-red-800 text-danger text-sm">
          {error}
        </div>
      )}

      {result && (
        <div className="space-y-4">
          <div className="p-3 rounded-lg bg-success-bg border border-green-200 dark:border-green-800 text-success text-sm font-medium">
            Documents uploaded successfully.
          </div>

          <div className="border border-default rounded-lg overflow-hidden">
            <button
              onClick={() => setShowJson(!showJson)}
              className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-on-surface-secondary hover:bg-surface-hover transition-colors"
            >
              <span>▶ JSON Response</span>
              <span className="text-xs text-gray-400">{showJson ? 'collapse' : 'expand'}</span>
            </button>
            {showJson && (
              <pre className="px-4 py-3 bg-surface-elevated text-xs font-mono text-on-surface overflow-x-auto max-h-96 border-t border-default">
                {JSON.stringify(result, null, 2)}
              </pre>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
