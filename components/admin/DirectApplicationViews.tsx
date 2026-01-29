import React, { useState } from 'react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Icon, IconName } from '../ui/Icon';

const inputClasses = "block w-full px-3 py-2 text-on-surface bg-white border border-gray-300 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:border-gray-600 dark:text-white dark:placeholder-gray-500";

// Helper function for status colors
const getStatusColor = (status: string) => {
    switch (status?.toLowerCase()) {
        case 'approved':
        case 'success':
        case 'successful':
        case 'confirmed':
            return 'bg-green-100 text-green-800 border-green-200';
        case 'processing':
        case 'pending':
        case 'in progress':
            return 'bg-yellow-100 text-yellow-800 border-yellow-200';
        case 'rejected':
        case 'failed':
        case 'cancelled':
            return 'bg-red-100 text-red-800 border-red-200';
        default:
            return 'bg-gray-100 text-gray-800 border-gray-200';
    }
};

export const UploadDirectApplicationView: React.FC = () => {
    const [file, setFile] = useState<File | null>(null);
    const [isUploading, setIsUploading] = useState(false);
    const [uploadResult, setUploadResult] = useState<any>(null);
    const [error, setError] = useState<string | null>(null);
    const [isDragOver, setIsDragOver] = useState(false);
    const [showTraineeId, setShowTraineeId] = useState(false);
    const [newRecordsPage, setNewRecordsPage] = useState(1);
    const [updatedRecordsPage, setUpdatedRecordsPage] = useState(1);
    const resultsPerPage = 10;

    const maskTraineeId = (id: string | null) => {
        if (!id) return 'N/A';
        if (showTraineeId) return id;
        if (id.length <= 4) return id;
        return '****' + id.slice(-4);
    };

    const handleFileChange = (selectedFile: File | undefined | null) => {
        if (selectedFile) {
            if (selectedFile.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
                selectedFile.type === 'application/vnd.ms-excel' ||
                selectedFile.name.endsWith('.xlsx') ||
                selectedFile.name.endsWith('.xls')) {
                setFile(selectedFile);
                setError(null);
            } else {
                setError('Invalid file type. Please upload an Excel file (.xlsx, .xls).');
                setFile(null);
            }
        }
    };

    const handleDragEvents = (e: React.DragEvent<HTMLDivElement>, isOver: boolean) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragOver(isOver);
    };

    const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragOver(false);
        const droppedFile = e.dataTransfer.files?.[0];
        handleFileChange(droppedFile);
    };

    const parseExcelFile = async (file: File): Promise<any[]> => {
        const XLSX = await import('xlsx');

        // Check file size first - very small files are likely problematic
        if (file.size < 100) {
            throw new Error(
                `File appears to be empty or corrupted (size: ${file.size} bytes).\n\n` +
                'If you just downloaded this file, please:\n' +
                '1. Open the file in Excel\n' +
                '2. Click "Enable Editing" if prompted\n' +
                '3. Save the file (Ctrl+S)\n' +
                '4. Upload the saved file'
            );
        }

        console.log('📁 File info:', { name: file.name, size: file.size, type: file.type });

        return new Promise((resolve, reject) => {
            const reader = new FileReader();

            reader.onload = (e) => {
                try {
                    const data = new Uint8Array(e.target?.result as ArrayBuffer);
                    console.log('📦 Read buffer size:', data.length);

                    // Check if the data starts with HTML (common error when downloading fails)
                    const firstBytes = new TextDecoder().decode(data.slice(0, 100));
                    if (firstBytes.includes('<!DOCTYPE') || firstBytes.includes('<html')) {
                        throw new Error(
                            'The uploaded file appears to be an HTML page, not an Excel file.\n\n' +
                            'This usually happens when the download requires authentication.\n' +
                            'Please download the file properly and try again.'
                        );
                    }

                    const workbook = XLSX.read(data, { type: 'array' });

                    console.log('📚 Workbook sheets:', workbook.SheetNames);

                    if (!workbook.SheetNames.length) {
                        throw new Error('Excel file has no sheets.');
                    }

                    const sheetName = workbook.SheetNames[0];
                    const worksheet = workbook.Sheets[sheetName];

                    // 🔍 DEBUG: read raw rows (including headers)
                    const rawRows: any[][] = XLSX.utils.sheet_to_json(worksheet, {
                        header: 1,
                        blankrows: false,
                    });

                    console.log('🧪 Raw Excel rows count:', rawRows.length);
                    console.log('🧪 First 3 rows:', rawRows.slice(0, 3));

                    // ❌ No rows at all
                    if (!rawRows.length) {
                        throw new Error(
                            'Excel file is empty.\n\n' +
                            'The first sheet contains no data. Please check if the correct sheet is selected.'
                        );
                    }

                    // ❌ Header only - could be Protected View or incomplete download
                    if (rawRows.length === 1) {
                        throw new Error(
                            'Only headers found, no data rows.\n\n' +
                            'This can happen if:\n' +
                            '• The file is a template with no data\n' +
                            '• The download was incomplete\n' +
                            '• Excel Protected View blocked the data (unlikely but possible)\n\n' +
                            'Solution: Open the file in Excel, ensure data is visible, save it, and upload again.'
                        );
                    }

                    // ✅ Convert to JSON using headers
                    const jsonData = XLSX.utils.sheet_to_json(worksheet, {
                        defval: '',
                        raw: false,
                    });

                    console.log('✅ Parsed', jsonData.length, 'data rows');
                    if (jsonData.length > 0) {
                        console.log('🔑 Column headers:', Object.keys(jsonData[0] as object));
                    }

                    resolve(jsonData);
                } catch (err) {
                    console.error('❌ Parse error:', err);
                    reject(err);
                }
            };

            reader.onerror = (err) => {
                console.error('❌ FileReader error:', err);
                reject(new Error('Failed to read the file. Please try again.'));
            };

            // ✅ IMPORTANT: safer than readAsBinaryString
            reader.readAsArrayBuffer(file);
        });
    };


    const handleUpload = async () => {
        if (!file) return;

        setIsUploading(true);
        setUploadResult(null);
        setError(null);

        try {
            // Parse Excel file
            console.log('📊 Parsing Excel file:', file.name);
            const excelData = await parseExcelFile(file);
            console.log('✅ Parsed Excel data:', excelData.length, 'rows');

            // Send data to database API
            console.log('🔄 Sending data to database API...');
            const response = await fetch('/api/admin/upload-da-applications', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    data: excelData
                })
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
            }

            const result = await response.json();
            console.log('✅ Upload result:', result);
            setUploadResult(result);

        } catch (err) {
            console.error('❌ Upload error:', err);
            setError(err instanceof Error ? err.message : 'Failed to upload file');
        } finally {
            setIsUploading(false);
        }
    };

    const resetView = () => {
        setFile(null);
        setUploadResult(null);
        setError(null);
        setShowTraineeId(false);
        setNewRecordsPage(1);
        setUpdatedRecordsPage(1);
    };

    const UploadStep = () => (
        <Card className="p-6">
            {/* Protected View Note - at top for visibility */}
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-4">
                <h4 className="font-semibold text-amber-800 mb-2">⚠️ Important: For Direct Application File</h4>
                <p className="text-sm text-amber-700">
                    If you just downloaded this Excel file, please do the following before uploading:
                </p>
                <ul className="text-sm text-amber-700 mt-2 list-disc list-inside space-y-1">
                    <li><strong>Windows:</strong> Open the file in Excel → Click "Enable Editing" → Save the file</li>
                    <li><strong>Mac:</strong> Open the file in Excel → Save the file (⌘+S)</li>
                </ul>
                <p className="text-sm text-amber-700 mt-2">
                    <strong>Reason:</strong> The Excel file downloaded from TPG opens in Protected View, which prevents the data from being read programmatically.
                </p>
            </div>

            <div className="text-center mb-4">
                <h3 className="text-xl font-bold">Upload Direct Application</h3>
                <p className="text-gray-500 mt-1">Submit DA application data in bulk by uploading an Excel file.</p>
            </div>

            <div
                onDragOver={(e) => handleDragEvents(e, true)}
                onDragLeave={(e) => handleDragEvents(e, false)}
                onDrop={handleDrop}
                className={`p-10 border-2 border-dashed rounded-lg text-center cursor-pointer transition-colors ${isDragOver ? 'border-blue-500 bg-blue-50' : 'border-gray-300 hover:border-blue-500'}`}
            >
                <input
                    type="file"
                    id="file-upload-da"
                    className="hidden"
                    accept=".xlsx, .xls"
                    onChange={(e) => handleFileChange(e.target.files?.[0])}
                />
                <label htmlFor="file-upload-da" className="cursor-pointer">
                    <Icon name={IconName.Upload} className="w-12 h-12 mx-auto text-gray-400" />
                    <p className="mt-2 font-semibold text-gray-900">
                        {file ? file.name : 'Drag & drop your file here, or click to browse'}
                    </p>
                    <p className="text-xs text-gray-500 mt-1">
                        XLSX or XLS file format
                    </p>
                </label>
            </div>
            {error && <p className="text-red-500 text-sm mt-2 text-center">{error}</p>}

            <div className="flex justify-end items-center mt-6">
                <Button onClick={handleUpload} disabled={!file || isUploading}>
                    {isUploading ? (
                        <div className="flex items-center">
                            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                            Processing...
                        </div>
                    ) : 'Upload & Process'}
                </Button>
            </div>
        </Card>
    );

    const ResultsStep = () => (
        <Card>
            <div className="p-6 border-b">
                <h3 className="text-xl font-bold">Upload Results</h3>
                <p className="text-gray-500 mt-1">The following results were returned from processing.</p>
            </div>
            <div className="p-6">
                {uploadResult?.success && (uploadResult?.inserted > 0 || uploadResult?.updated > 0) ? (
                    <div className="space-y-4">
                        <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                            <h4 className="font-bold text-green-800">
                                {uploadResult.inserted} New Record(s) Inserted
                                {uploadResult.updated > 0 && `, ${uploadResult.updated} Record(s) Updated`}
                            </h4>
                            <p className="text-sm text-green-700">
                                {uploadResult.duplicates || 0} duplicate(s) were skipped
                            </p>
                            {uploadResult.errors?.length > 0 && (
                                <p className="text-sm text-amber-700 mt-1">
                                    {uploadResult.errors.length} row(s) had errors
                                </p>
                            )}
                        </div>

                        {uploadResult.newRecords && uploadResult.newRecords.length > 0 && (
                            <div className="overflow-x-auto">
                                <h4 className="font-semibold text-gray-800 mb-2">New Records</h4>
                                <table className="min-w-full divide-y divide-gray-200">
                                    <thead className="bg-gray-50">
                                        <tr>
                                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Application ID</th>
                                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Trainee ID Type</th>
                                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Trainee ID</th>
                                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Trainee Name</th>
                                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Email</th>
                                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Phone</th>
                                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">DOB</th>
                                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Course Title</th>
                                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Course Ref No.</th>
                                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Course Run ID</th>
                                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Sponsorship</th>
                                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Payable Fee</th>
                                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                                        </tr>
                                    </thead>
                                    <tbody className="bg-white divide-y divide-gray-200">
                                        {uploadResult.newRecords
                                            .slice((newRecordsPage - 1) * resultsPerPage, newRecordsPage * resultsPerPage)
                                            .map((record: any, index: number) => (
                                                <tr key={index} className="hover:bg-gray-50">
                                                    <td className="px-4 py-3 whitespace-nowrap text-sm font-medium text-gray-900">
                                                        {record.application_id || 'N/A'}
                                                    </td>
                                                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                                                        {record.trainee_id_type || 'N/A'}
                                                    </td>
                                                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                                                        <div className="flex items-center gap-1.5">
                                                            <span className="font-mono">{maskTraineeId(record.trainee_id)}</span>
                                                            <button
                                                                onClick={() => setShowTraineeId(!showTraineeId)}
                                                                className="p-0.5 text-gray-400 hover:text-blue-600 rounded transition-colors"
                                                                title={showTraineeId ? 'Hide Trainee ID' : 'Show Trainee ID'}
                                                            >
                                                                <Icon name={showTraineeId ? IconName.EyeOff : IconName.Eye} className="w-4 h-4" />
                                                            </button>
                                                        </div>
                                                    </td>
                                                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                                                        {record.trainee_name || 'N/A'}
                                                    </td>
                                                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                                                        {record.trainee_email || 'N/A'}
                                                    </td>
                                                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                                                        {record.trainee_phone_country_code && record.trainee_phone
                                                            ? `+${record.trainee_phone_country_code} ${record.trainee_phone}`
                                                            : record.trainee_phone || 'N/A'}
                                                    </td>
                                                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                                                        {record.date_of_birth ? new Date(record.date_of_birth).toLocaleDateString('en-GB') : 'N/A'}
                                                    </td>
                                                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                                                        {record.course_title || 'N/A'}
                                                    </td>
                                                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                                                        {record.course_reference_number || 'N/A'}
                                                    </td>
                                                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                                                        {record.course_run_id || 'N/A'}
                                                    </td>
                                                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                                                        {record.sponsorship_type || 'N/A'}
                                                    </td>
                                                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                                                        ${parseFloat(record.payable_fee || 0).toFixed(2)}
                                                    </td>
                                                    <td className="px-4 py-3 whitespace-nowrap">
                                                        <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full border ${getStatusColor(record.application_status || 'Inserted')}`}>
                                                            {record.application_status || 'Inserted'}
                                                        </span>
                                                    </td>
                                                </tr>
                                            ))}
                                    </tbody>
                                </table>
                                {uploadResult.newRecords.length > resultsPerPage && (
                                    <div className="flex items-center justify-between mt-3 px-1">
                                        <p className="text-sm text-gray-500">
                                            Showing {(newRecordsPage - 1) * resultsPerPage + 1}-{Math.min(newRecordsPage * resultsPerPage, uploadResult.newRecords.length)} of {uploadResult.newRecords.length}
                                        </p>
                                        <div className="flex items-center gap-1">
                                            <button
                                                onClick={() => setNewRecordsPage(p => Math.max(1, p - 1))}
                                                disabled={newRecordsPage === 1}
                                                className="px-3 py-1 text-sm border rounded hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
                                            >
                                                Previous
                                            </button>
                                            {Array.from({ length: Math.ceil(uploadResult.newRecords.length / resultsPerPage) }, (_, i) => i + 1).map(page => (
                                                <button
                                                    key={page}
                                                    onClick={() => setNewRecordsPage(page)}
                                                    className={`px-3 py-1 text-sm border rounded ${newRecordsPage === page ? 'bg-blue-500 text-white border-blue-500' : 'hover:bg-gray-100'}`}
                                                >
                                                    {page}
                                                </button>
                                            ))}
                                            <button
                                                onClick={() => setNewRecordsPage(p => Math.min(Math.ceil(uploadResult.newRecords.length / resultsPerPage), p + 1))}
                                                disabled={newRecordsPage === Math.ceil(uploadResult.newRecords.length / resultsPerPage)}
                                                className="px-3 py-1 text-sm border rounded hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
                                            >
                                                Next
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}

                        {uploadResult.updatedRecords && uploadResult.updatedRecords.length > 0 && (
                            <div className="overflow-x-auto">
                                <h4 className="font-semibold text-gray-800 mb-2">Updated Records (Confirmed → Cancelled)</h4>
                                <table className="min-w-full divide-y divide-gray-200">
                                    <thead className="bg-gray-50">
                                        <tr>
                                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Application ID</th>
                                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Trainee ID Type</th>
                                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Trainee ID</th>
                                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Trainee Name</th>
                                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Email</th>
                                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Phone</th>
                                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">DOB</th>
                                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Course Title</th>
                                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Course Ref No.</th>
                                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Course Run ID</th>
                                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Sponsorship</th>
                                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Payable Fee</th>
                                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Old Status</th>
                                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">New Status</th>
                                        </tr>
                                    </thead>
                                    <tbody className="bg-white divide-y divide-gray-200">
                                        {uploadResult.updatedRecords
                                            .slice((updatedRecordsPage - 1) * resultsPerPage, updatedRecordsPage * resultsPerPage)
                                            .map((record: any, index: number) => (
                                                <tr key={index} className="hover:bg-gray-50">
                                                    <td className="px-4 py-3 whitespace-nowrap text-sm font-medium text-gray-900">
                                                        {record.application_id || 'N/A'}
                                                    </td>
                                                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                                                        {record.trainee_id_type || 'N/A'}
                                                    </td>
                                                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                                                        <div className="flex items-center gap-1.5">
                                                            <span className="font-mono">{maskTraineeId(record.trainee_id)}</span>
                                                            <button
                                                                onClick={() => setShowTraineeId(!showTraineeId)}
                                                                className="p-0.5 text-gray-400 hover:text-blue-600 rounded transition-colors"
                                                                title={showTraineeId ? 'Hide Trainee ID' : 'Show Trainee ID'}
                                                            >
                                                                <Icon name={showTraineeId ? IconName.EyeOff : IconName.Eye} className="w-4 h-4" />
                                                            </button>
                                                        </div>
                                                    </td>
                                                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                                                        {record.trainee_name || 'N/A'}
                                                    </td>
                                                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                                                        {record.trainee_email || 'N/A'}
                                                    </td>
                                                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                                                        {record.trainee_phone_country_code && record.trainee_phone
                                                            ? `+${record.trainee_phone_country_code} ${record.trainee_phone}`
                                                            : record.trainee_phone || 'N/A'}
                                                    </td>
                                                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                                                        {record.date_of_birth ? new Date(record.date_of_birth).toLocaleDateString('en-GB') : 'N/A'}
                                                    </td>
                                                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                                                        {record.course_title || 'N/A'}
                                                    </td>
                                                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                                                        {record.course_reference_number || 'N/A'}
                                                    </td>
                                                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                                                        {record.course_run_id || 'N/A'}
                                                    </td>
                                                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                                                        {record.sponsorship_type || 'N/A'}
                                                    </td>
                                                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                                                        ${parseFloat(record.payable_fee || 0).toFixed(2)}
                                                    </td>
                                                    <td className="px-4 py-3 whitespace-nowrap">
                                                        <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full border ${getStatusColor(record.old_status || '')}`}>
                                                            {record.old_status || 'N/A'}
                                                        </span>
                                                    </td>
                                                    <td className="px-4 py-3 whitespace-nowrap">
                                                        <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full border ${getStatusColor(record.application_status || '')}`}>
                                                            {record.application_status || 'N/A'}
                                                        </span>
                                                    </td>
                                                </tr>
                                            ))}
                                    </tbody>
                                </table>
                                {uploadResult.updatedRecords.length > resultsPerPage && (
                                    <div className="flex items-center justify-between mt-3 px-1">
                                        <p className="text-sm text-gray-500">
                                            Showing {(updatedRecordsPage - 1) * resultsPerPage + 1}-{Math.min(updatedRecordsPage * resultsPerPage, uploadResult.updatedRecords.length)} of {uploadResult.updatedRecords.length}
                                        </p>
                                        <div className="flex items-center gap-1">
                                            <button
                                                onClick={() => setUpdatedRecordsPage(p => Math.max(1, p - 1))}
                                                disabled={updatedRecordsPage === 1}
                                                className="px-3 py-1 text-sm border rounded hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
                                            >
                                                Previous
                                            </button>
                                            {Array.from({ length: Math.ceil(uploadResult.updatedRecords.length / resultsPerPage) }, (_, i) => i + 1).map(page => (
                                                <button
                                                    key={page}
                                                    onClick={() => setUpdatedRecordsPage(page)}
                                                    className={`px-3 py-1 text-sm border rounded ${updatedRecordsPage === page ? 'bg-blue-500 text-white border-blue-500' : 'hover:bg-gray-100'}`}
                                                >
                                                    {page}
                                                </button>
                                            ))}
                                            <button
                                                onClick={() => setUpdatedRecordsPage(p => Math.min(Math.ceil(uploadResult.updatedRecords.length / resultsPerPage), p + 1))}
                                                disabled={updatedRecordsPage === Math.ceil(uploadResult.updatedRecords.length / resultsPerPage)}
                                                className="px-3 py-1 text-sm border rounded hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
                                            >
                                                Next
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                ) : (
                    <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-8 text-center">
                        <Icon name={IconName.InfoCircle} className="w-12 h-12 mx-auto text-yellow-500 mb-3" />
                        <h4 className="text-lg font-bold text-yellow-800 mb-2">No New Records</h4>
                        <p className="text-yellow-700">
                            All {uploadResult?.duplicates || 0} record(s) in the uploaded file already exist in the database.
                        </p>
                    </div>
                )}

                <details className="mt-6 bg-gray-50 border border-gray-200 rounded-lg p-4">
                    <summary className="font-semibold text-gray-800 cursor-pointer hover:text-gray-600">
                        View Raw JSON Response
                    </summary>
                    <pre className="mt-3 text-sm text-gray-700 whitespace-pre-wrap overflow-x-auto max-h-96 bg-white p-3 rounded border">
                        {JSON.stringify(uploadResult, null, 2)}
                    </pre>
                </details>
            </div>
            <div className="p-4 border-t text-right">
                <Button onClick={resetView}>Start a New Upload</Button>
            </div>
        </Card>
    );

    return (
        <div>
            <h2 className="text-3xl font-bold mb-6">Upload And Check Duplicate Direct Application</h2>
            {isUploading ? (
                <div className="flex justify-center py-20">
                    <div className="text-center">
                        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto"></div>
                        <p className="mt-4 text-gray-600">Uploading to database...</p>
                    </div>
                </div>
            ) : uploadResult ? (
                <ResultsStep />
            ) : (
                <UploadStep />
            )}
        </div>
    );
};

export const ViewDirectApplicationView: React.FC = () => {
    const [isLoading, setIsLoading] = useState(false);
    const [applications, setApplications] = useState<any[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [currentPage, setCurrentPage] = useState(1);
    const itemsPerPage = 10;

    // Fetch applications from database API
    const fetchApplications = async () => {
        setIsLoading(true);
        setError(null);

        try {
            console.log('🔍 Fetching DA applications from database...');
            const response = await fetch('/api/admin/fetch-all-da-applications');

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const result = await response.json();
            console.log('✅ Fetched applications:', result);

            if (result.success && result.data) {
                setApplications(result.data);
            } else {
                throw new Error(result.error || 'Failed to fetch applications');
            }

        } catch (err) {
            console.error('❌ Fetch error:', err);
            setError(err instanceof Error ? err.message : 'Failed to fetch applications');
        } finally {
            setIsLoading(false);
        }
    };

    // Auto-fetch on component mount
    React.useEffect(() => {
        fetchApplications();
    }, []);

    // Filter applications based on search query
    const filteredApplications = applications.filter(app => {
        if (!searchQuery.trim()) return true;
        const query = searchQuery.toLowerCase();
        return (
            (app.trainee_name || '').toLowerCase().includes(query) ||
            (app.application_id || '').toLowerCase().includes(query) ||
            (app.course_title || '').toLowerCase().includes(query) ||
            (app.trainee_email || '').toLowerCase().includes(query) ||
            (app.trainee_id || '').toLowerCase().includes(query) ||
            (app.course_run_id || '').toLowerCase().includes(query)
        );
    });

    // Pagination calculations
    const totalPages = Math.ceil(filteredApplications.length / itemsPerPage);
    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;
    const paginatedApplications = filteredApplications.slice(startIndex, endIndex);

    // Reset to page 1 when search changes
    React.useEffect(() => {
        setCurrentPage(1);
    }, [searchQuery]);

    // Pagination controls
    const goToPage = (page: number) => {
        if (page >= 1 && page <= totalPages) {
            setCurrentPage(page);
        }
    };

    // Generate page numbers to display
    const getPageNumbers = () => {
        const pages: (number | string)[] = [];
        const maxVisible = 5;

        if (totalPages <= maxVisible) {
            for (let i = 1; i <= totalPages; i++) {
                pages.push(i);
            }
        } else {
            if (currentPage <= 3) {
                for (let i = 1; i <= 4; i++) pages.push(i);
                pages.push('...');
                pages.push(totalPages);
            } else if (currentPage >= totalPages - 2) {
                pages.push(1);
                pages.push('...');
                for (let i = totalPages - 3; i <= totalPages; i++) pages.push(i);
            } else {
                pages.push(1);
                pages.push('...');
                pages.push(currentPage - 1);
                pages.push(currentPage);
                pages.push(currentPage + 1);
                pages.push('...');
                pages.push(totalPages);
            }
        }
        return pages;
    };

    return (
        <div>
            <h2 className="text-3xl font-bold mb-6">View Direct Applications</h2>

            {/* Search and Refresh Controls */}
            <Card className="p-6 mb-6">
                <div className="flex flex-col md:flex-row gap-4 items-end">
                    <div className="flex-1">
                        <label htmlFor="search-da" className="block text-sm font-bold text-gray-700 mb-1">
                            Search Applications
                        </label>
                        <input
                            id="search-da"
                            type="text"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            placeholder="Search by name, application ID, course, or email..."
                            className={inputClasses}
                        />
                    </div>
                    <Button onClick={fetchApplications} disabled={isLoading}>
                        {isLoading ? (
                            <div className="flex items-center">
                                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                                Loading...
                            </div>
                        ) : (
                            <>
                                <Icon name={IconName.Download} className="w-4 h-4 mr-2" />
                                Refresh
                            </>
                        )}
                    </Button>
                </div>
                {error && <p className="text-red-500 text-sm mt-3">{error}</p>}
            </Card>

            {/* Loading State */}
            {isLoading && (
                <div className="flex justify-center py-10">
                    <div className="text-center">
                        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto"></div>
                        <p className="mt-4 text-gray-600">Fetching DA applications from database...</p>
                    </div>
                </div>
            )}

            {/* Results Table */}
            {!isLoading && (
                <Card className="p-0">
                    <div className="p-6 border-b">
                        <h3 className="text-xl font-bold">DA Applications</h3>
                        <p className="text-gray-500 mt-1">
                            Showing {startIndex + 1}-{Math.min(endIndex, filteredApplications.length)} of {filteredApplications.length} applications
                            {searchQuery && ` (filtered from ${applications.length} total)`}
                        </p>
                    </div>
                    {paginatedApplications.length > 0 ? (
                        <>
                            <div className="overflow-x-auto">
                                <table className="min-w-full divide-y divide-gray-200">
                                    <thead className="bg-gray-50">
                                        <tr>
                                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Application ID</th>
                                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Trainee Name</th>
                                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Trainee ID</th>
                                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Course Title</th>
                                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Course Run ID</th>
                                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Payable Fee</th>
                                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Sponsorship</th>
                                        </tr>
                                    </thead>
                                    <tbody className="bg-white divide-y divide-gray-200">
                                        {paginatedApplications.map((app, index) => (
                                            <tr key={app.id || index} className="hover:bg-gray-50">
                                                <td className="px-4 py-3 whitespace-nowrap text-sm font-medium text-gray-900">
                                                    {app.application_id || 'N/A'}
                                                </td>
                                                <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                                                    {app.trainee_name || 'N/A'}
                                                </td>
                                                <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                                                    {app.trainee_id || 'N/A'}
                                                </td>
                                                <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                                                    {app.course_title || 'N/A'}
                                                </td>
                                                <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                                                    {app.course_run_id || 'N/A'}
                                                </td>
                                                <td className="px-4 py-3 whitespace-nowrap">
                                                    <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full border ${getStatusColor(app.application_status || 'Pending')}`}>
                                                        {app.application_status || 'Pending'}
                                                    </span>
                                                </td>
                                                <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                                                    ${parseFloat(app.payable_fee || 0).toFixed(2)}
                                                </td>
                                                <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                                                    {app.sponsorship_type || 'N/A'}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>

                            {/* Pagination Controls */}
                            {totalPages > 1 && (
                                <div className="p-4 border-t flex items-center justify-between">
                                    <div className="text-sm text-gray-500">
                                        Page {currentPage} of {totalPages}
                                    </div>
                                    <div className="flex items-center gap-1">
                                        <button
                                            onClick={() => goToPage(currentPage - 1)}
                                            disabled={currentPage === 1}
                                            className="px-3 py-1 text-sm border rounded hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
                                        >
                                            Previous
                                        </button>
                                        {getPageNumbers().map((page, idx) => (
                                            typeof page === 'number' ? (
                                                <button
                                                    key={idx}
                                                    onClick={() => goToPage(page)}
                                                    className={`px-3 py-1 text-sm border rounded ${currentPage === page
                                                        ? 'bg-blue-500 text-white border-blue-500'
                                                        : 'hover:bg-gray-100'
                                                        }`}
                                                >
                                                    {page}
                                                </button>
                                            ) : (
                                                <span key={idx} className="px-2 text-gray-400">...</span>
                                            )
                                        ))}
                                        <button
                                            onClick={() => goToPage(currentPage + 1)}
                                            disabled={currentPage === totalPages}
                                            className="px-3 py-1 text-sm border rounded hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
                                        >
                                            Next
                                        </button>
                                    </div>
                                </div>
                            )}
                        </>
                    ) : (
                        <div className="p-12 text-center text-gray-500">
                            <Icon name={IconName.FileText} className="w-16 h-16 mx-auto mb-4 text-gray-400" />
                            <p className="text-lg font-medium">No applications found</p>
                            <p className="text-sm mt-2">
                                {searchQuery ? 'Try adjusting your search query' : 'No DA applications in the database yet'}
                            </p>
                        </div>
                    )}
                </Card>
            )}
        </div>
    );
};
