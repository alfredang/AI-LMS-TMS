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
                if (response.status === 500) {
                    throw new Error(errorData.error || 'Server error. The service may be temporarily unavailable. Please try again later.');
                }
                throw new Error(errorData.error || `Unable to process request (Error ${response.status}). Please try again.`);
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
                                <h4 className="font-semibold text-gray-800 mb-2">Updated Records</h4>
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

    // Selection state
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [isCancelling, setIsCancelling] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);
    const [isEnrolling, setIsEnrolling] = useState(false);

    // Page navigation modal state
    const [showPageModal, setShowPageModal] = useState(false);
    const [pendingPage, setPendingPage] = useState<number | null>(null);

    // Filter state
    const [showFilterDropdown, setShowFilterDropdown] = useState(false);
    const [filterColumn, setFilterColumn] = useState('');
    const [filterValue, setFilterValue] = useState('');
    const [activeFilter, setActiveFilter] = useState<{ column: string; value: string } | null>(null);

    // Sort state
    const [showSortDropdown, setShowSortDropdown] = useState(false);
    const [sortColumn, setSortColumn] = useState('');
    const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');

    // To Be Enrolled filter state
    const [toBeEnrolledFilter, setToBeEnrolledFilter] = useState(false);

    // Available columns for filter/sort
    const filterableColumns = [
        { value: 'application_id', label: 'Application ID' },
        { value: 'trainee_name', label: 'Trainee Name' },
        { value: 'trainee_id', label: 'Trainee ID' },
        { value: 'trainee_email', label: 'Email' },
        { value: 'course_title', label: 'Course Title' },
        { value: 'course_run_id', label: 'Course Run ID' },
        { value: 'application_status', label: 'Status' },
        { value: 'sponsorship_type', label: 'Sponsorship' },
    ];

    // Selection handlers
    const toggleSelect = (appId: string) => {
        setSelectedIds(prev => {
            const newSet = new Set(prev);
            if (newSet.has(appId)) {
                newSet.delete(appId);
            } else {
                newSet.add(appId);
            }
            return newSet;
        });
    };

    const toggleSelectAll = () => {
        const allSelected = paginatedApplications.length > 0 && paginatedApplications.every(app => selectedIds.has(app.application_id));
        if (allSelected) {
            // Uncheck all (including other pages)
            setSelectedIds(new Set());
        } else {
            // Select only current page rows (unchecks other pages)
            setSelectedIds(new Set(paginatedApplications.map(app => app.application_id)));
        }
    };

    // Cancel enrolment handler
    const handleCancelEnrolment = async () => {
        if (selectedIds.size === 0) return;

        const confirmCancel = window.confirm(
            `Are you sure you want to cancel ${selectedIds.size} application(s)? This will set their status to "Cancelled".`
        );
        if (!confirmCancel) return;

        setIsCancelling(true);
        try {
            const response = await fetch('/api/admin/cancel-da-applications', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ applicationIds: Array.from(selectedIds) }),
            });

            const result = await response.json();
            if (result.success) {
                const succeededCount = result.results?.succeeded?.length || 0;
                const failedCount = result.results?.failed?.length || 0;

                if (failedCount === 0 && succeededCount > 0) {
                    // All succeeded
                    alert(`Successfully cancelled ${succeededCount} application(s) and enrolment(s).`);
                } else if (succeededCount > 0 && failedCount > 0) {
                    // Partial success
                    const failedList = result.results.failed.map((f: any) => `  - ${f.application_id}`).join('\n');
                    alert(
                        `${succeededCount} application(s) cancelled successfully.\n\n` +
                        `${failedCount} application(s) failed to cancel:\n${failedList}\n\n` +
                        `Please try again or cancel the failed enrolment(s) manually via the SSG portal.`
                    );
                } else {
                    // All failed
                    const failedIds = result.results?.failed?.map((f: any) => f.application_id).join(', ') || '';
                    alert(
                        `Enrolment cancellation failed for all ${failedCount} application(s).\n\n` +
                        (failedIds ? `Application IDs: ${failedIds}\n\n` : '') +
                        `No changes were made. Please try again or cancel manually via the SSG portal.`
                    );
                }
                setSelectedIds(new Set());
                fetchApplications(); // Refresh data
            } else {
                throw new Error(result.error);
            }
        } catch (err) {
            alert(`Failed to cancel: ${err instanceof Error ? err.message : 'Unknown error'}`);
        } finally {
            setIsCancelling(false);
        }
    };

    // Delete rows handler
    const handleDeleteRows = async () => {
        if (selectedIds.size === 0) return;

        const confirmDelete = window.confirm(
            `Are you sure you want to permanently delete ${selectedIds.size} application(s)? This action cannot be undone.`
        );
        if (!confirmDelete) return;

        setIsDeleting(true);
        try {
            const response = await fetch('/api/admin/delete-da-applications', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ applicationIds: Array.from(selectedIds) }),
            });

            const result = await response.json();
            if (result.success) {
                alert(`Successfully deleted ${result.deleted} application(s).`);
                setSelectedIds(new Set());
                fetchApplications(); // Refresh data
            } else {
                throw new Error(result.error);
            }
        } catch (err) {
            alert(`Failed to delete: ${err instanceof Error ? err.message : 'Unknown error'}`);
        } finally {
            setIsDeleting(false);
        }
    };

    // Trigger Direct Application Enrolment workflow
    const handleEnrolment = async () => {
        // Get selected applications that are Confirmed with empty enrolment_status
        const toEnrollApps = applications.filter(app => {
            if (!selectedIds.has(app.application_id)) return false;
            const isConfirmed = (app.application_status || '').toLowerCase() === 'confirmed';
            const hasNoEnrolmentStatus = !app.enrolment_status || app.enrolment_status.trim() === '';
            return isConfirmed && hasNoEnrolmentStatus;
        });

        if (toEnrollApps.length === 0) {
            alert(
                'No eligible applications found to enroll.\n\n' +
                'Selected applications must meet both conditions:\n' +
                '• Application Status = Confirmed\n' +
                '• Enrolment Status = Empty\n\n' +
                'Tip: Use the "To be enrolled Learner(s)" filter to automatically select all eligible applications.'
            );
            return;
        }

        const confirmEnrol = window.confirm(
            `Are you sure you want to trigger enrolment for ${toEnrollApps.length} selected application(s)?\n\nThis will send them to the Direct Application Enrolment workflow.`
        );
        if (!confirmEnrol) return;

        setIsEnrolling(true);
        try {
            const response = await fetch('https://n8n.srv1231536.hstgr.cloud/webhook/b50f2b79-40f6-4590-bb67-b714e60d2854', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    applications: toEnrollApps.map(app => ({
                        ...app,
                        date_of_birth: app.date_of_birth ? String(app.date_of_birth).split('T')[0] : app.date_of_birth,
                    })),
                }),
            });

            const webhookBody = await response.json();

            // Webhook returns: { results: [{ application_id, result: "..." }, ...] }
            // Handle both "results" and "result" keys, or direct array
            let results: any[];
            if (webhookBody.results && Array.isArray(webhookBody.results)) {
                results = webhookBody.results;
            } else if (webhookBody.result && Array.isArray(webhookBody.result)) {
                results = webhookBody.result;
            } else if (Array.isArray(webhookBody)) {
                results = webhookBody;
            } else {
                results = [webhookBody];
            }

            const succeeded: { application_id: string }[] = [];
            const failed: { application_id: string; message: string }[] = [];

            for (const item of results) {
                const appId = item.application_id || '';

                // Parse the SSG result (stringified JSON)
                let ssgResponse: any = null;
                try {
                    ssgResponse = typeof item.result === 'string'
                        ? JSON.parse(item.result)
                        : item.result;
                } catch {
                    failed.push({ application_id: appId, message: 'Failed to parse SSG response' });
                    continue;
                }

                const status = ssgResponse?.status;

                if (status === 200 || status === '200') {
                    // Success - mark for DB update
                    succeeded.push({ application_id: appId });
                } else {
                    // Error - collect error details
                    let errorMsg = ssgResponse?.error?.message || 'Enrolment failed';
                    if (ssgResponse?.error?.details && Array.isArray(ssgResponse.error.details)) {
                        const details = ssgResponse.error.details
                            .map((d: { message?: string; field?: string }) => d.message || d.field || '')
                            .filter(Boolean)
                            .join('; ');
                        if (details) errorMsg += ` (${details})`;
                    }
                    failed.push({ application_id: appId, message: errorMsg });
                }
            }

            // Update enrolment_status = "Confirmed" in database for successful ones
            if (succeeded.length > 0) {
                await fetch('/api/admin/update-da-enrolment-status', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        updates: succeeded.map(s => ({
                            application_id: s.application_id,
                            enrolment_status: 'Confirmed',
                        })),
                    }),
                });
            }

            // Show summary to user
            let message = '';
            if (succeeded.length > 0) {
                message += `Enrolment created successfully for ${succeeded.length} application(s).`;
            }
            if (failed.length > 0) {
                if (message) message += '\n\n';
                message += `Failed for ${failed.length} application(s):`;
                failed.forEach(f => {
                    message += `\n• ${f.application_id}: ${f.message}`;
                });
            }
            if (!message) {
                message = 'No results returned from the enrolment webhook.';
            }

            alert(message);
            setSelectedIds(new Set());
            fetchApplications();
        } catch (err) {
            alert(`Failed to trigger enrolment: ${err instanceof Error ? err.message : 'Unknown error'}`);
        } finally {
            setIsEnrolling(false);
        }
    };

    // Apply column filter
    const applyFilter = () => {
        if (filterColumn && filterValue.trim()) {
            setActiveFilter({ column: filterColumn, value: filterValue.trim() });
        }
        setShowFilterDropdown(false);
    };

    const clearFilter = () => {
        setActiveFilter(null);
        setFilterColumn('');
        setFilterValue('');
    };

    // Fetch applications from database API
    const fetchApplications = async () => {
        setIsLoading(true);
        setError(null);

        try {
            console.log('🔍 Fetching DA applications from database...');
            const response = await fetch('/api/admin/fetch-all-da-applications');

            if (!response.ok) {
                if (response.status === 500) {
                    throw new Error('Server error. The service may be temporarily unavailable. Please try again later.');
                }
                throw new Error(`Unable to fetch applications (Error ${response.status}). Please try again.`);
            }

            const result = await response.json();
            console.log('✅ Fetched applications:', result);

            if (result.success && result.data) {
                setApplications(result.data);
                setSelectedIds(new Set()); // Clear selections on refresh
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

    // Filter applications based on search query, active filter, and toBeEnrolled filter
    const filteredApplications = applications.filter(app => {
        // Apply "To Be Enrolled" filter first (Confirmed status + empty enrolment_status)
        if (toBeEnrolledFilter) {
            const isConfirmed = (app.application_status || '').toLowerCase() === 'confirmed';
            const hasNoEnrolmentStatus = !app.enrolment_status || app.enrolment_status.trim() === '';
            if (!isConfirmed || !hasNoEnrolmentStatus) {
                return false;
            }
        }

        // Apply column-based filter
        if (activeFilter) {
            const fieldValue = (app[activeFilter.column] || '').toString().toLowerCase();
            if (!fieldValue.includes(activeFilter.value.toLowerCase())) {
                return false;
            }
        }

        // Then apply search query
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

    // Sort applications
    const sortedApplications = [...filteredApplications].sort((a, b) => {
        if (!sortColumn) return 0;

        const valA = (a[sortColumn] || '').toString().toLowerCase();
        const valB = (b[sortColumn] || '').toString().toLowerCase();

        if (valA < valB) return sortDirection === 'asc' ? -1 : 1;
        if (valA > valB) return sortDirection === 'asc' ? 1 : -1;
        return 0;
    });

    // Pagination calculations
    const totalPages = Math.ceil(sortedApplications.length / itemsPerPage);
    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;
    const paginatedApplications = sortedApplications.slice(startIndex, endIndex);

    // Reset to page 1 when search changes
    React.useEffect(() => {
        setCurrentPage(1);
    }, [searchQuery]);

    // Reset to page 1 when sort changes
    React.useEffect(() => {
        setCurrentPage(1);
    }, [sortColumn, sortDirection]);

    // Pagination controls with confirmation when rows are selected
    const goToPage = (page: number) => {
        if (page >= 1 && page <= totalPages && page !== currentPage) {
            // If "To be enrolled" filter is active, navigate freely to allow reviewing selections across pages
            if (toBeEnrolledFilter) {
                setCurrentPage(page);
            } else if (selectedIds.size > 0) {
                // If rows are selected outside enrolment mode, show confirmation modal
                setPendingPage(page);
                setShowPageModal(true);
            } else {
                setCurrentPage(page);
            }
        }
    };

    // Confirm page navigation (clear selections and navigate)
    const confirmPageNavigation = () => {
        if (pendingPage !== null) {
            setSelectedIds(new Set());
            setCurrentPage(pendingPage);
            setPendingPage(null);
            setShowPageModal(false);
        }
    };

    // Cancel page navigation
    const cancelPageNavigation = () => {
        setPendingPage(null);
        setShowPageModal(false);
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
                    <div className="p-6 border-b flex justify-between items-start">
                        <div>
                            <h3 className="text-xl font-bold">DA Applications</h3>
                            <p className="text-gray-500 mt-1">
                                Showing {startIndex + 1}-{Math.min(endIndex, filteredApplications.length)} of {filteredApplications.length} applications
                                {(searchQuery || toBeEnrolledFilter) && ` (filtered from ${applications.length} total)`}
                            </p>
                        </div>
                        <div className="flex items-center gap-3">
                            {/* To Enroll DA Learners Button */}
                            <button
                                onClick={handleEnrolment}
                                disabled={isEnrolling}
                                className={`inline-flex items-center px-4 py-2 text-sm font-medium rounded-lg transition-colors bg-blue-600 text-white hover:bg-blue-700 disabled:bg-blue-400 disabled:cursor-not-allowed`}
                            >
                                {isEnrolling ? (
                                    <>
                                        <svg className="animate-spin w-4 h-4 mr-2" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                        </svg>
                                        Enrolling...
                                    </>
                                ) : (
                                    <>
                                        <Icon name={IconName.Users} className="w-4 h-4 mr-2" />
                                        To Enroll DA Learners
                                    </>
                                )}
                            </button>
                        </div>
                    </div>

                    {/* Toolbar - Filter, Sort, Cancel */}
                    <div className="px-4 py-3 border-b bg-gray-50 dark:bg-gray-800 dark:border-gray-700 flex flex-wrap items-center gap-2">
                        {/* Filter Button */}
                        <div className="relative">
                            <button
                                onClick={() => { setShowFilterDropdown(!showFilterDropdown); setShowSortDropdown(false); }}
                                className="inline-flex items-center px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 hover:bg-gray-50 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200"
                            >
                                <Icon name={IconName.Eye} className="w-4 h-4 mr-1.5" />
                                Filter
                            </button>
                            {showFilterDropdown && (
                                <div className="absolute left-0 top-full mt-1 w-72 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg shadow-lg z-50 p-3">
                                    <div className="space-y-3">
                                        <div>
                                            <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">Column</label>
                                            <select
                                                value={filterColumn}
                                                onChange={(e) => setFilterColumn(e.target.value)}
                                                className="w-full px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-200"
                                            >
                                                <option value="">Select column...</option>
                                                {filterableColumns.map(col => (
                                                    <option key={col.value} value={col.value}>{col.label}</option>
                                                ))}
                                            </select>
                                        </div>
                                        <div>
                                            <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">Value</label>
                                            <input
                                                type="text"
                                                value={filterValue}
                                                onChange={(e) => setFilterValue(e.target.value)}
                                                placeholder="Enter a value..."
                                                className="w-full px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-200"
                                            />
                                        </div>
                                        <button
                                            onClick={applyFilter}
                                            disabled={!filterColumn || !filterValue.trim()}
                                            className="w-full px-3 py-1.5 text-sm bg-green-600 text-white rounded hover:bg-green-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
                                        >
                                            Apply filter
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Sort Button */}
                        <div className="relative">
                            <button
                                onClick={() => { setShowSortDropdown(!showSortDropdown); setShowFilterDropdown(false); }}
                                className="inline-flex items-center px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 hover:bg-gray-50 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200"
                            >
                                <Icon name={IconName.ChevronDown} className="w-4 h-4 mr-1.5" />
                                Sort
                            </button>
                            {showSortDropdown && (
                                <div className="absolute left-0 top-full mt-1 w-56 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg shadow-lg z-50 p-3">
                                    <div className="space-y-3">
                                        <div>
                                            <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">Column</label>
                                            <select
                                                value={sortColumn}
                                                onChange={(e) => setSortColumn(e.target.value)}
                                                className="w-full px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-200"
                                            >
                                                <option value="">Default order</option>
                                                {filterableColumns.map(col => (
                                                    <option key={col.value} value={col.value}>{col.label}</option>
                                                ))}
                                            </select>
                                        </div>
                                        <div className="flex gap-2">
                                            <button
                                                onClick={() => { setSortDirection('asc'); setShowSortDropdown(false); }}
                                                className={`flex-1 px-2 py-1 text-xs rounded border ${sortDirection === 'asc' ? 'bg-blue-100 dark:bg-blue-900 border-blue-400 dark:border-blue-600' : 'bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600'} dark:text-gray-200`}
                                            >
                                                Ascending
                                            </button>
                                            <button
                                                onClick={() => { setSortDirection('desc'); setShowSortDropdown(false); }}
                                                className={`flex-1 px-2 py-1 text-xs rounded border ${sortDirection === 'desc' ? 'bg-blue-100 dark:bg-blue-900 border-blue-400 dark:border-blue-600' : 'bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600'} dark:text-gray-200`}
                                            >
                                                Descending
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* To Be Enrolled Checkbox Filter */}
                        <div className="relative group">
                            <label className="inline-flex items-center gap-2 px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 hover:bg-gray-50 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={toBeEnrolledFilter}
                                    onChange={(e) => {
                                        const checked = e.target.checked;
                                        setToBeEnrolledFilter(checked);
                                        setCurrentPage(1); // Reset to page 1 to avoid showing empty table
                                        if (checked) {
                                            // Auto-select all eligible rows (Confirmed + empty enrolment_status)
                                            const eligibleIds = applications
                                                .filter(app => {
                                                    const isConfirmed = (app.application_status || '').toLowerCase() === 'confirmed';
                                                    const hasNoEnrolmentStatus = !app.enrolment_status || app.enrolment_status.trim() === '';
                                                    return isConfirmed && hasNoEnrolmentStatus;
                                                })
                                                .map(app => app.application_id);
                                            setSelectedIds(new Set(eligibleIds));
                                        } else {
                                            // Clear selections when filter is turned off
                                            setSelectedIds(new Set());
                                        }
                                    }}
                                    className="w-4 h-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
                                />
                                To be enrolled Learner(s)
                            </label>
                            {/* Tooltip */}
                            <div className="absolute left-0 top-full mt-2 w-64 p-3 bg-gray-900 text-white text-xs rounded-lg shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50">
                                <p className="font-semibold mb-1">Filter applications where:</p>
                                <ul className="list-disc list-inside space-y-0.5">
                                    <li>Application Status = <span className="text-green-400">Confirmed</span></li>
                                    <li>Enrolment Status = <span className="text-yellow-400">Empty</span></li>
                                </ul>
                                <div className="absolute -top-1.5 left-4 w-3 h-3 bg-gray-900 rotate-45"></div>
                            </div>
                        </div>

                        {/* Active Filter Badge */}
                        {activeFilter && (
                            <div className="inline-flex items-center px-2 py-1 text-xs bg-blue-100 text-blue-800 rounded border border-blue-200">
                                <span className="font-medium">{filterableColumns.find(c => c.value === activeFilter.column)?.label}:</span>
                                <span className="ml-1">{activeFilter.value}</span>
                                <button onClick={clearFilter} className="ml-1.5 hover:text-red-600">×</button>
                            </div>
                        )}

                        {/* Spacer */}
                        <div className="flex-1" />

                        {/* Selected Count & Action Buttons */}
                        {selectedIds.size > 0 && (
                            <>
                                <span className="text-sm text-gray-600">{selectedIds.size} row(s) selected</span>
                                <button
                                    onClick={handleCancelEnrolment}
                                    disabled={isCancelling || isDeleting}
                                    className="inline-flex items-center px-3 py-1.5 text-sm bg-red-600 text-white rounded hover:bg-red-700 disabled:bg-red-400"
                                >
                                    {isCancelling ? (
                                        <>
                                            <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-white mr-1.5"></div>
                                            Cancelling...
                                        </>
                                    ) : (
                                        'Cancel Enrolment'
                                    )}
                                </button>
                                <button
                                    onClick={handleDeleteRows}
                                    disabled={isDeleting || isCancelling}
                                    className="inline-flex items-center px-3 py-1.5 text-sm bg-gray-700 text-white rounded hover:bg-gray-800 disabled:bg-gray-400"
                                >
                                    {isDeleting ? (
                                        <>
                                            <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-white mr-1.5"></div>
                                            Deleting...
                                        </>
                                    ) : (
                                        'Delete Row'
                                    )}
                                </button>
                            </>
                        )}
                    </div>
                    {paginatedApplications.length > 0 ? (
                        <>
                            <div className="overflow-x-auto">
                                <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-600">
                                    <thead className="bg-gray-50 dark:bg-gray-800">
                                        <tr>
                                            <th className="px-3 py-3 w-10">
                                                <input
                                                    type="checkbox"
                                                    checked={paginatedApplications.length > 0 && paginatedApplications.every(app => selectedIds.has(app.application_id))}
                                                    onChange={toggleSelectAll}
                                                    className="w-4 h-4 text-blue-600 rounded border-gray-300"
                                                />
                                            </th>
                                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Application ID</th>
                                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Trainee ID Type</th>
                                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Trainee ID</th>
                                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">DOB</th>
                                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Trainee Name</th>
                                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Email</th>
                                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Phone</th>
                                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Course Title</th>
                                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Course Ref No.</th>
                                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Course Run ID</th>
                                            {/* <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Start Date</th>
                                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">End Date</th> */}
                                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Sponsorship</th>
                                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Payable Fee</th>
                                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Application Status</th>
                                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Enrolment Status</th>
                                        </tr>
                                    </thead>
                                    <tbody className="bg-white dark:bg-gray-700 divide-y divide-gray-200 dark:divide-gray-600">
                                        {paginatedApplications.map((app, index) => (
                                            <tr key={app.id || index} className={`hover:bg-gray-50 dark:hover:bg-gray-600 ${selectedIds.has(app.application_id) ? 'bg-blue-50 dark:bg-blue-900' : ''}`}>
                                                <td className="px-3 py-3">
                                                    <input
                                                        type="checkbox"
                                                        checked={selectedIds.has(app.application_id)}
                                                        onChange={() => toggleSelect(app.application_id)}
                                                        className="w-4 h-4 text-blue-600 rounded border-gray-300"
                                                    />
                                                </td>
                                                <td className="px-4 py-3 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-white">
                                                    {app.application_id || 'N/A'}
                                                </td>
                                                <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500 dark:text-gray-200">
                                                    {app.trainee_id_type || 'N/A'}
                                                </td>
                                                <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500 dark:text-gray-200">
                                                    {app.trainee_id || 'N/A'}
                                                </td>
                                                <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500 dark:text-gray-200">
                                                    {app.date_of_birth ? new Date(app.date_of_birth).toLocaleDateString('en-GB') : 'N/A'}
                                                </td>
                                                <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500 dark:text-gray-200">
                                                    {app.trainee_name || 'N/A'}
                                                </td>
                                                <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500 dark:text-gray-200">
                                                    {app.trainee_email || 'N/A'}
                                                </td>
                                                <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500 dark:text-gray-200">
                                                    {app.trainee_phone_country_code && app.trainee_phone
                                                        ? `+${app.trainee_phone_country_code} ${app.trainee_phone}`
                                                        : app.trainee_phone || 'N/A'}
                                                </td>
                                                <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500 dark:text-gray-200">
                                                    {app.course_title || 'N/A'}
                                                </td>
                                                <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500 dark:text-gray-200">
                                                    {app.course_reference_number || 'N/A'}
                                                </td>
                                                <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500 dark:text-gray-200">
                                                    {app.course_run_id || 'N/A'}
                                                </td>
                                                {/* <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500 dark:text-gray-200">
                                                    {app.course_start_date ? new Date(app.course_start_date).toLocaleDateString('en-GB') : 'N/A'}
                                                </td>
                                                <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500 dark:text-gray-200">
                                                    {app.course_end_date ? new Date(app.course_end_date).toLocaleDateString('en-GB') : 'N/A'}
                                                </td> */}
                                                <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500 dark:text-gray-200">
                                                    {app.sponsorship_type || 'N/A'}
                                                </td>
                                                <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500 dark:text-gray-200">
                                                    ${parseFloat(app.payable_fee || 0).toFixed(2)}
                                                </td>
                                                <td className="px-4 py-3 whitespace-nowrap">
                                                    <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full border ${getStatusColor(app.application_status || 'Pending')}`}>
                                                        {app.application_status || 'Pending'}
                                                    </span>
                                                </td>
                                                <td className="px-4 py-3 whitespace-nowrap">
                                                    {app.enrolment_status && app.enrolment_status.trim() !== '' ? (
                                                        <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full border ${app.enrolment_status === 'Confirmed'
                                                            ? 'bg-green-100 text-green-800 border-green-200'
                                                            : app.enrolment_status === 'Not Found'
                                                                ? 'bg-orange-100 text-orange-800 border-orange-200'
                                                                : 'bg-red-100 text-red-800 border-red-200'
                                                            }`}>
                                                            {app.enrolment_status}
                                                        </span>
                                                    ) : (
                                                        <span className="text-gray-400">-</span>
                                                    )}
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
            )
            }
            {/* Page Navigation Confirmation Modal */}
            {showPageModal && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
                    <div className="bg-white rounded-lg shadow-xl w-full max-w-md mx-4">
                        <div className="flex items-center justify-between p-4 border-b">
                            <h3 className="text-lg font-semibold text-gray-900">
                                {pendingPage !== null && pendingPage > currentPage
                                    ? 'Confirm moving to next page'
                                    : 'Confirm moving to previous page'}
                            </h3>
                            <button
                                onClick={cancelPageNavigation}
                                className="text-gray-400 hover:text-gray-600"
                            >
                                <Icon name={IconName.Close} className="w-5 h-5" />
                            </button>
                        </div>
                        <div className="p-4">
                            <p className="text-gray-600">
                                The currently selected lines will be deselected, do you want to proceed?
                            </p>
                        </div>
                        <div className="flex gap-3 p-4 border-t">
                            <button
                                onClick={cancelPageNavigation}
                                className="flex-1 px-4 py-2.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={confirmPageNavigation}
                                className="flex-1 px-4 py-2.5 text-sm font-medium text-white bg-green-600 rounded-md hover:bg-green-700"
                            >
                                Confirm
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div >
    );
};
