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

// Webhook URL for DA Application
const WEBHOOK_URL = 'https://n8n.srv923061.hstgr.cloud/webhook/ee651990-29fd-4a1b-a28b-1ca8a674007f';

export const UploadDirectApplicationView: React.FC = () => {
    const [file, setFile] = useState<File | null>(null);
    const [isUploading, setIsUploading] = useState(false);
    const [uploadResult, setUploadResult] = useState<any>(null);
    const [error, setError] = useState<string | null>(null);
    const [isDragOver, setIsDragOver] = useState(false);

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

        return new Promise((resolve, reject) => {
            const reader = new FileReader();

            reader.onload = (e) => {
                try {
                    const data = new Uint8Array(e.target?.result as ArrayBuffer);
                    const workbook = XLSX.read(data, { type: 'array' });

                    const sheetName = workbook.SheetNames[0];
                    const worksheet = workbook.Sheets[sheetName];

                    // 🔍 DEBUG: read raw rows (including headers)
                    const rawRows: any[][] = XLSX.utils.sheet_to_json(worksheet, {
                        header: 1,
                        blankrows: false,
                    });

                    console.log('🧪 Raw Excel rows:', rawRows);

                    // ❌ No rows at all
                    if (!rawRows.length) {
                        throw new Error('Excel file is empty.');
                    }

                    // ❌ Header only → very likely Excel Protected View
                    if (rawRows.length === 1) {
                        throw new Error(
                            'This Excel file is opened in Protected View or read-only mode.\n\n' +
                            'Please open the file, click "Enable Editing", save it, and upload again.'
                        );
                    }


                    // ✅ Convert to JSON using headers
                    const jsonData = XLSX.utils.sheet_to_json(worksheet, {
                        defval: '',
                        raw: false,
                    });

                    resolve(jsonData);
                } catch (err) {
                    reject(err);
                }
            };

            reader.onerror = reject;

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

            // Send data to n8n webhook
            console.log('🔄 Sending data to n8n webhook:', WEBHOOK_URL);
            const response = await fetch(WEBHOOK_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    action: 'upload',
                    excelData: excelData,
                    fileName: file.name,
                    timestamp: new Date().toISOString(),
                    source: 'admin-upload-direct-application'
                })
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
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
    };

    const UploadStep = () => (
        <Card className="p-6">
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

            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mt-4">
                <h4 className="font-semibold text-blue-800 mb-2">Expected Excel Columns:</h4>
                <div className="text-sm text-blue-700 grid grid-cols-2 gap-1">
                    <span>• Trainee ID Type</span>
                    <span>• Trainee ID</span>
                    <span>• Date of Birth</span>
                    <span>• Trainee Name</span>
                    <span>• Course Run ID</span>
                    <span>• Trainee Email</span>
                    <span>• Phone Country Code</span>
                    <span>• Trainee Phone</span>
                    <span>• Sponsorship Type</span>
                    <span>• Application ID</span>
                    <span>• Payable Fee</span>
                    <span>• Application Status</span>
                    <span>• Course Title</span>
                    <span>• Course Reference Number</span>
                    <span>• Course Start Date</span>
                    <span>• Course End Date</span>
                    <span>• Enrolment/Grant</span>
                </div>
            </div>

            <div className="flex justify-between items-center mt-6">
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => alert('Downloading DA Application template...')}
                >
                    <Icon name={IconName.Download} className="w-4 h-4 mr-2" />
                    Download Template
                </Button>
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
                {uploadResult?.newRecords && uploadResult.newRecords.length > 0 ? (
                    <div className="space-y-4">
                        <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                            <h4 className="font-bold text-green-800">
                                {uploadResult.newRecords.length} New Record(s) Inserted
                            </h4>
                            <p className="text-sm text-green-700">
                                {uploadResult.duplicates?.length || 0} duplicate(s) were skipped
                            </p>
                        </div>

                        <div className="overflow-x-auto">
                            <table className="min-w-full divide-y divide-gray-200">
                                <thead className="bg-gray-50">
                                    <tr>
                                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Application ID</th>
                                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Trainee Name</th>
                                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Course Title</th>
                                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                                    </tr>
                                </thead>
                                <tbody className="bg-white divide-y divide-gray-200">
                                    {uploadResult.newRecords.slice(0, 10).map((record: any, index: number) => (
                                        <tr key={index} className="hover:bg-gray-50">
                                            <td className="px-4 py-3 whitespace-nowrap text-sm font-medium text-gray-900">
                                                {record.application_id || record['Application ID'] || 'N/A'}
                                            </td>
                                            <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                                                {record.trainee_name || record['Trainee Name'] || 'N/A'}
                                            </td>
                                            <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                                                {record.course_title || record['Course Title'] || 'N/A'}
                                            </td>
                                            <td className="px-4 py-3 whitespace-nowrap">
                                                <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full border ${getStatusColor(record.application_status || record['Application Status'] || 'Pending')}`}>
                                                    {record.application_status || record['Application Status'] || 'Inserted'}
                                                </span>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                            {uploadResult.newRecords.length > 10 && (
                                <p className="text-sm text-gray-500 p-4">
                                    Showing first 10 of {uploadResult.newRecords.length} records...
                                </p>
                            )}
                        </div>
                    </div>
                ) : (
                    <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-8 text-center">
                        <Icon name={IconName.InfoCircle} className="w-12 h-12 mx-auto text-yellow-500 mb-3" />
                        <h4 className="text-lg font-bold text-yellow-800 mb-2">No New Records</h4>
                        <p className="text-yellow-700">
                            All records in the uploaded file already exist in the database.
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
            <h2 className="text-3xl font-bold mb-6">Upload Direct Application</h2>
            {isUploading ? (
                <div className="flex justify-center py-20">
                    <div className="text-center">
                        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto"></div>
                        <p className="mt-4 text-gray-600">Processing your file with n8n...</p>
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
    const [hasFetched, setHasFetched] = useState(false);

    const fetchApplications = async () => {
        setIsLoading(true);
        setError(null);

        try {
            console.log('🔍 Fetching DA applications from n8n...');
            const response = await fetch(WEBHOOK_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    action: 'fetch',
                    timestamp: new Date().toISOString(),
                    source: 'admin-view-direct-application'
                })
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const result = await response.json();
            console.log('✅ Fetched applications:', result);

            // Handle different response structures
            const data = result.data || result.applications || result || [];
            setApplications(Array.isArray(data) ? data : []);
            setHasFetched(true);

        } catch (err) {
            console.error('❌ Fetch error:', err);
            setError(err instanceof Error ? err.message : 'Failed to fetch applications');
        } finally {
            setIsLoading(false);
        }
    };

    const filteredApplications = applications.filter(app => {
        if (!searchQuery.trim()) return true;
        const query = searchQuery.toLowerCase();
        return (
            (app.trainee_name || app['Trainee Name'] || '').toLowerCase().includes(query) ||
            (app.application_id || app['Application ID'] || '').toLowerCase().includes(query) ||
            (app.course_title || app['Course Title'] || '').toLowerCase().includes(query) ||
            (app.trainee_email || app['Trainee Email'] || '').toLowerCase().includes(query)
        );
    });

    return (
        <div>
            <h2 className="text-3xl font-bold mb-6">View Direct Applications</h2>

            {/* Search and Fetch Controls */}
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
                                Fetch Applications
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
                        <p className="mt-4 text-gray-600">Fetching DA applications from n8n...</p>
                    </div>
                </div>
            )}

            {/* Results Table */}
            {!isLoading && hasFetched && (
                <Card className="p-0">
                    <div className="p-6 border-b">
                        <h3 className="text-xl font-bold">DA Applications</h3>
                        <p className="text-gray-500 mt-1">
                            Showing {filteredApplications.length} of {applications.length} applications
                        </p>
                    </div>
                    {filteredApplications.length > 0 ? (
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
                                    {filteredApplications.map((app, index) => (
                                        <tr key={index} className="hover:bg-gray-50">
                                            <td className="px-4 py-3 whitespace-nowrap text-sm font-medium text-gray-900">
                                                {app.application_id || app['Application ID'] || 'N/A'}
                                            </td>
                                            <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                                                {app.trainee_name || app['Trainee Name'] || 'N/A'}
                                            </td>
                                            <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                                                {app.trainee_id || app['Trainee ID'] || 'N/A'}
                                            </td>
                                            <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                                                {app.course_title || app['Course Title'] || 'N/A'}
                                            </td>
                                            <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                                                {app.course_run_id || app['Course Run ID'] || 'N/A'}
                                            </td>
                                            <td className="px-4 py-3 whitespace-nowrap">
                                                <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full border ${getStatusColor(app.application_status || app['Application Status'] || 'Pending')}`}>
                                                    {app.application_status || app['Application Status'] || 'Pending'}
                                                </span>
                                            </td>
                                            <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                                                ${parseFloat(app.payable_fee || app['Payable Fee'] || 0).toFixed(2)}
                                            </td>
                                            <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                                                {app.sponsorship_type || app['Sponsorship Type'] || 'N/A'}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    ) : (
                        <div className="p-12 text-center text-gray-500">
                            <Icon name={IconName.FileText} className="w-16 h-16 mx-auto mb-4 text-gray-400" />
                            <p className="text-lg font-medium">No applications found</p>
                            <p className="text-sm mt-2">
                                {searchQuery ? 'Try adjusting your search query' : 'Click "Fetch Applications" to load data'}
                            </p>
                        </div>
                    )}
                </Card>
            )}

            {/* Empty State - Before First Fetch */}
            {!isLoading && !hasFetched && (
                <Card className="p-12">
                    <div className="text-center text-gray-500">
                        <Icon name={IconName.FileText} className="w-16 h-16 mx-auto mb-4 text-gray-400" />
                        <p className="text-lg font-medium">View DA Application Records</p>
                        <p className="text-sm mt-2">Click the "Fetch Applications" button to load data from the database</p>
                    </div>
                </Card>
            )}
        </div>
    );
};
