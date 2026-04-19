import React, { useState } from 'react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Icon, IconName } from '../ui/Icon';
import { inferIdType } from '@/lib/utils/id-type';
import { useLms } from '@contexts/LmsContext';

// Helper function to format error messages in a user-friendly way with React component
const ErrorMessageDisplay: React.FC<{ error: any }> = ({ error }) => {
    if (!error) return <span>An error occurred</span>;

    console.log('🔴 ErrorMessageDisplay received error:', error);

    // If error has details array, format them as a list
    if (error.details && Array.isArray(error.details) && error.details.length > 0) {
        return (
            <div className="p-4 bg-red-50 dark:bg-red-900/20 border-l-4 border-red-500 dark:border-red-600 rounded-r-lg shadow-sm">
                <div className="flex items-center gap-2 mb-3">
                    <Icon name={IconName.X} className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0" />
                    <div className="font-semibold text-red-900 dark:text-red-200">
                        {error.message || 'Enrolment Created Unsuccessfully'}
                    </div>
                </div>
                <div className="pl-7 space-y-1.5">
                    {error.details.map((detail: any, idx: number) => {
                        let message = detail.message || JSON.stringify(detail);
                        return (
                            <div key={idx} className="text-sm text-red-800 dark:text-red-300 font-mono bg-red-100 dark:bg-red-900/40 px-2 py-1 rounded inline-block">
                                {message}
                            </div>
                        );
                    })}
                </div>
            </div>
        );
    }

    // Fallback to error message if no details
    if (error.message) {
        return (
            <div className="space-y-2 p-4 bg-red-50 dark:bg-red-900/20 border-l-4 border-red-500 dark:border-red-600 rounded-r-lg shadow-sm">
                <div className="flex items-center gap-2">
                    <Icon name={IconName.X} className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0" />
                    <div className="font-semibold text-red-900 dark:text-red-200">
                        Enrolment Created Unsuccessfully
                    </div>
                </div>
                <div className="pl-7 text-sm text-red-800 dark:text-red-300">
                    {error.message}
                </div>
            </div>
        );
    }

    return <span>An error occurred during enrolment</span>;
};

// Excel template column name constants (must match Enrolment_Upload_Template.xlsx headers after trimming)
const COL = {
    traineeIdType:            'Trainee ID Type *',
    traineeId:                'Trainee ID *',
    traineeDob:               'Date of Birth (DD-MM-YYYY or DD/MM/YYYY format) *',
    traineeName:              'Trainee Name (as on government ID)',
    courseRefCode:            'Course Reference Code*',
    courseRun:                'Course Run*',
    traineeEmail:             'Trainee Email *',
    phoneCountryCode:         'Trainee Phone Country Code (+xx) *',
    phoneAreaCode:            'Trainee Phone Area Code',
    traineePhone:             'Trainee Phone *',
    sponsorshipType:          'Sponsorship Type *',
    employerUen:              'Employer UEN (mandatory if sponsorship type = employer)',
    employerContactName:      'Employer Contact Name (mandatory if sponsorship type = employer)',
    employerPhoneCountryCode: 'Employer Phone Country Code (+xx) (mandatory if sponsorship type = employer)',
    employerPhoneAreaCode:    'Employer Phone Area Code',
    employerPhone:            'Employer Phone (mandatory if sponsorship type = employer)',
    employerContactEmail:     'Employer Contact Email (mandatory if sponsorship type = employer)',
    feeDiscountAmount:        'Course Fee Discount Amount (where applicable)',
    feeCollectionStatus:      'Fee Collection Status',
    bundleCode:               'Bundle Code (mandatory if sponsorship type = individual for SCTP course)',
} as const;

export const BulkUploadEnrolmentView: React.FC = () => {
    const { trainingProviderProfile } = useLms();
    const [file, setFile] = useState<File | null>(null);
    const [isUploading, setIsUploading] = useState(false);
    const [uploadResult, setUploadResult] = useState<any>(null);
    const [error, setError] = useState<string | null>(null);
    const [isDragOver, setIsDragOver] = useState(false);
    const [resultsPage, setResultsPage] = useState(1);
    const [dbInsertErrors, setDbInsertErrors] = useState<{ row: number; email: string; error: string }[]>([]);
    const resultsPerPage = 10;

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

    const normalizeDateFormat = (dateStr: string | number): string => {
        if (!dateStr) return dateStr as string;

        const str = String(dateStr).trim();

        // Already in ISO -> return as is
        if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
             return str;
        }

        // Try to parse as Excel serial date (numeric value)
        const numValue = Number(str);
        if (!isNaN(numValue) && numValue > 1000) {
            const excelEpoch = new Date(1899, 11, 30);
            const date = new Date(excelEpoch.getTime() + numValue * 86400000);
            const day = String(date.getDate()).padStart(2, '0');
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const year = date.getFullYear();
            return `${year}-${month}-${day}`; // ISO format immediately
        }

        const parts = str.split(/[/-]/);
        if (parts.length === 3) {
            let part1 = parseInt(parts[0], 10);
            let part2 = parseInt(parts[1], 10);
            let part3 = parseInt(parts[2], 10);

            let day = 1, month = 1, year = 2000;

            // Is year first? (YYYY-MM-DD or YYYY/MM/DD)
            if (parts[0].length === 4) {
                year = part1;
                month = part2;
                day = part3;
            } else {
                // Year is last
                year = part3;
                if (year < 100) {
                    year += year > 30 ? 1900 : 2000;
                }

                // Singapore defaults to DD/MM/YYYY. If part1 > 12, it MUST be the day.
                // If part2 > 12, it MUST be the day (which means input was MM/DD/YYYY).
                if (part2 > 12) {
                    day = part2;
                    month = part1;
                } else {
                    // Default to DD/MM/YYYY for SG format
                    day = part1;
                    month = part2;
                }
            }

            // Ensure valid month/day ranges
            if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
                return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            }
        }

        return str;
    };

    const parseExcelFile = async (file: File): Promise<any[]> => {
        const XLSX = await import('xlsx');

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

                    const rawRows: any[][] = XLSX.utils.sheet_to_json(worksheet, {
                        header: 1,
                        blankrows: false,
                    });

                    console.log('🧪 Raw Excel rows count:', rawRows.length);
                    console.log('🧪 First 3 rows:', rawRows.slice(0, 3));

                    if (!rawRows.length) {
                        throw new Error(
                            'Excel file is empty.\n\n' +
                            'The first sheet contains no data. Please check if the correct sheet is selected.'
                        );
                    }

                    if (rawRows.length === 1) {
                        throw new Error(
                            'Only headers found, no data rows.\n\n' +
                            'This happens because:\n' +
                            '• The Excel file is opened in Protected View after being downloaded from the TPG portal.\n\n' +
                            '• Protected View blocks access to the data rows.\n\n' +
                            'Solution: Open the file in Excel, ensure data is visible, save it, and upload again.'
                        );
                    }

                    const jsonData = XLSX.utils.sheet_to_json(worksheet, {
                        defval: '',
                        raw: false,
                    });

                    // Normalize column headers by removing extra spaces and trimming
                    const normalizedData = jsonData.map(row => {
                        const normalizedRow: any = {};
                        Object.keys(row as object).forEach(key => {
                            // Replace multiple spaces with single space and trim
                            const normalizedKey = key.replace(/\s+/g, ' ').trim();
                            normalizedRow[normalizedKey] = (row as any)[key];
                        });
                        return normalizedRow;
                    });

                    console.log('✅ Parsed', normalizedData.length, 'data rows');
                    if (normalizedData.length > 0) {
                        console.log('🔑 Normalized column headers:', Object.keys(normalizedData[0] as object));
                        console.log('📋 First row data:', normalizedData[0]);
                    }

                    resolve(normalizedData);
                } catch (err) {
                    console.error('❌ Parse error:', err);
                    reject(err);
                }
            };

            reader.onerror = (err) => {
                console.error('❌ FileReader error:', err);
                reject(new Error('Failed to read the file. Please try again.'));
            };

            reader.readAsArrayBuffer(file);
        });
    };

    const handleUpload = async () => {
        if (!file) return;

        setIsUploading(true);
        setUploadResult(null);
        setError(null);

        try {
            console.log('📊 Parsing Excel file:', file.name);
            const excelData = await parseExcelFile(file);
            console.log('✅ Parsed Excel data:', excelData.length, 'rows');

            // Normalize date fields to DD/MM/YYYY format
            const dateFields = [
                'Enrolment Date',
                'Course Start Date',
                'Course End Date',
                'Birth Date',
                'Date of Birth',
                'DOB',
                'Training Start Date',
                'Training End Date',
                'Assessment Date',
                'Completion Date'
            ];

            const normalizedData = excelData.map((row, index) => {
                const normalizedRow = { ...row };
                Object.keys(normalizedRow).forEach(key => {
                    // Check if this field is a date field (by name matching)
                    const keyLower = key.toLowerCase();
                    const isDateField = dateFields.some(dateField =>
                        keyLower.includes(dateField.toLowerCase())
                    ) || keyLower.includes('date') || keyLower.includes('birth') || keyLower.includes('dob');

                    if (isDateField && normalizedRow[key]) {
                        const originalValue = normalizedRow[key];
                        const normalizedValue = normalizeDateFormat(originalValue);
                        normalizedRow[key] = normalizedValue;

                        // Special logging for Date of Birth field
                        if (keyLower.includes('birth') || keyLower.includes('dob')) {
                            console.log(`📅 Row ${index + 1} - ${key}: "${originalValue}" → "${normalizedValue}"`);
                        } else if (originalValue !== normalizedValue) {
                            console.log(`🗓️  Normalized ${key}: "${originalValue}" → "${normalizedValue}"`);
                        }
                    }
                });
                return normalizedRow;
            });

            console.log('✅ Normalized date formats in', normalizedData.length, 'rows');
            if (normalizedData.length > 0) {
                console.log('📅 Sample normalized row (first entry):', normalizedData[0]);
                console.log('🔑 Column keys in first row:', Object.keys(normalizedData[0]));
            }

            console.log('🔄 Processing', normalizedData.length, 'enrolments via SSG API directly...');

            // Convert DOB from DD/MM/YYYY or DD-MM-YYYY → YYYY-MM-DD for SSG API
            // Note: Since normalizeDateFormat now returns strict YYYY-MM-DD, we just pass through.
            const convertDobToISO = (dob: string): string => {
                if (!dob) return '';
                const parts = dob.split(/[\/\-]/);
                
                // If it's already YYYY-MM-DD 
                if (parts.length === 3 && parts[0].length === 4) {
                    return dob;
                }
                
                // Fallback (though normalizeDateFormat should have already fixed it)
                if (parts.length === 3 && parts[2].length === 4) {
                    return `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
                }
                return dob;
            };

            const trainingPartnerUen = (trainingProviderProfile?.uen || process.env.NEXT_PUBLIC_TRAINING_PARTNER_UEN || '').trim();
            const trainingPartnerCode = trainingPartnerUen ? `${trainingPartnerUen}-01` : (process.env.NEXT_PUBLIC_TRAINING_PARTNER_CODE || '').trim();

            const allItems: any[] = [];

            for (let i = 0; i < normalizedData.length; i++) {
                const row = normalizedData[i] as any;
                const rawSponsorship = (row[COL.sponsorshipType] || 'INDIVIDUAL').toUpperCase().trim();
                const sponsorshipType = rawSponsorship.includes('EMPLOYER') ? 'EMPLOYER' : 'INDIVIDUAL';

                const trainee: any = {
                    id: String(row[COL.traineeId] || '').trim(),
                    idType: { type: inferIdType(String(row[COL.traineeId] || '').trim(), (row[COL.traineeIdType] || '').trim()) },
                    fullName: (row[COL.traineeName] || '').trim(),
                    dateOfBirth: convertDobToISO(row[COL.traineeDob] || ''),
                    emailAddress: (row[COL.traineeEmail] || '').trim(),
                    contactNumber: {
                        countryCode: (row[COL.phoneCountryCode] || '65').replace('+', '').trim(),
                        phoneNumber: String(row[COL.traineePhone] || '').trim(),
                        areaCode: row[COL.phoneAreaCode] ? String(row[COL.phoneAreaCode]).trim() : ''
                    },
                    enrolmentDate: new Date().toISOString().split('T')[0],
                    sponsorshipType,
                    fees: {
                        discountAmount: Number(row[COL.feeDiscountAmount]) || 0,
                        collectionStatus: (row[COL.feeCollectionStatus] || 'Pending Payment').trim()
                    }
                };

                if (sponsorshipType === 'EMPLOYER') {
                    trainee.employer = {
                        uen: (row[COL.employerUen] || '').trim(),
                        contact: {
                            fullName: (row[COL.employerContactName] || '').trim(),
                            emailAddress: (row[COL.employerContactEmail] || '').trim(),
                            contactNumber: {
                                countryCode: (row[COL.employerPhoneCountryCode] || '65').replace('+', '').trim(),
                                phoneNumber: String(row[COL.employerPhone] || '').trim(),
                                areaCode: row[COL.employerPhoneAreaCode] ? String(row[COL.employerPhoneAreaCode]).trim() : ''
                            }
                        }
                    };
                }

                if (row[COL.bundleCode] && String(row[COL.bundleCode]).trim()) {
                    trainee.bundle = { id: String(row[COL.bundleCode]).trim() };
                }

                const payload = {
                    enrolment: {
                        trainingPartner: { code: trainingPartnerCode, uen: trainingPartnerUen },
                        course: {
                            referenceNumber: (row[COL.courseRefCode] || '').trim(),
                            run: { id: String(row[COL.courseRun] || '').trim() }
                        },
                        trainee
                    }
                };

                if (!payload.enrolment.trainingPartner.uen) {
                    throw new Error(`Row ${i + 1}: Training Provider UEN is missing. Please check your profile or environment variables.`);
                }

                console.log(`📤 sending SSG payload for row ${i + 1}:`, JSON.stringify(payload, null, 2));

                let itemResult: any;
                try {
                    const resp = await fetch('/api/enrolment/create', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload)
                    });
                    itemResult = await resp.json();
                    console.log(`✅ Row ${i + 1} SSG result:`, itemResult);
                } catch (rowErr) {
                    const errMsg = rowErr instanceof Error ? rowErr.message : 'Network error';
                    itemResult = { success: false, error: errMsg };
                    console.error(`❌ Row ${i + 1} error:`, rowErr);
                }

                allItems.push({
                    traineeId: String(row[COL.traineeId] || '').trim(),
                    traineeName: (row[COL.traineeName] || '').trim(),
                    traineeEmail: (row[COL.traineeEmail] || '').trim(),
                    courseRunId: String(row[COL.courseRun] || '').trim(),
                    courseReferenceNumber: (row[COL.courseRefCode] || '').trim(),
                    sponsorshipType,
                    parsedResult: itemResult
                });
            }

            // Save successful enrolments to local database
            const rowDbErrors: { row: number; email: string; error: string }[] = [];

            for (let i = 0; i < allItems.length; i++) {
                const item = allItems[i];
                const parsedResult = item.parsedResult;

                const ssgStatus = parsedResult?.data?.enrolment?.status ?? parsedResult?.data?.status;
                const ssgRefNumber =
                    parsedResult?.data?.enrolment?.referenceNumber ?? parsedResult?.data?.referenceNumber;
                const ssgHardError = !parsedResult?.success;

                if (!ssgHardError) {
                    if (parsedResult?.localEnrollmentSynced) {
                        console.log(`✅ Row ${i + 1}: DB insert handled automatically by SSG server sync.`);
                        continue;
                    }

                    const enrolmentStatus = ssgStatus || 'Pending';
                    console.log(`💾 Row ${i + 1}: email="${item.traineeEmail}" courseRun="${item.courseRunId}" status="${enrolmentStatus}" enrolmentId="${ssgRefNumber || ''}" (Manual DB Sync)`);

                    try {
                        const dbResponse = await fetch('/api/enrolments/bulk-create', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                enrolment: {
                                    traineeEmail: item.traineeEmail,
                                    traineeName: item.traineeName,
                                    traineeNric: item.traineeId,
                                    courseCode: item.courseReferenceNumber,
                                    courseTitle: '',
                                    courseRunId: item.courseRunId,
                                    courseReferenceNumber: item.courseReferenceNumber,
                                    trainingPartnerCode: trainingProviderProfile?.uen ? `${trainingProviderProfile.uen}-01` : '',
                                    sponsorshipType: item.sponsorshipType,
                                    enrolmentDate: new Date().toISOString().split('T')[0],
                                    enrolmentStatus,
                                    enrolmentId: ssgRefNumber || '',
                                    ssgData: parsedResult?.data?.enrolment ?? parsedResult?.data ?? null,
                                }
                            })
                        });

                        if (dbResponse.ok) {
                            const dbResult = await dbResponse.json();
                            console.log(`✅ Row ${i + 1} inserted to database:`, dbResult);
                        } else {
                            const dbError = await dbResponse.json().catch(() => ({}));
                            const errMsg = dbError?.error?.message || dbError?.error || JSON.stringify(dbError);
                            console.error(`❌ Row ${i + 1} DB insert failed (${dbResponse.status}):`, dbError);
                            rowDbErrors.push({ row: i + 1, email: item.traineeEmail, error: errMsg });
                        }
                    } catch (dbErr) {
                        const errMsg = dbErr instanceof Error ? dbErr.message : 'Network error';
                        console.error(`❌ Row ${i + 1} DB insert exception:`, dbErr);
                        rowDbErrors.push({ row: i + 1, email: item.traineeEmail, error: errMsg });
                    }
                } else {
                    console.warn('⚠️ Skipping DB insert due to SSG error for:', item.traineeEmail, parsedResult?.error);
                }
            }

            if (rowDbErrors.length > 0) {
                setDbInsertErrors(rowDbErrors);
            }
            console.log('✅ Database insertion process completed');

            // Auto-sync calendar flags for newly enrolled learners
            const successCount = allItems.filter(item => item.parsedResult?.success).length;
            if (successCount > 0) {
                console.log(`📅 Auto-syncing calendar for ${successCount} successful enrolments...`);
                try {
                    const calRes = await fetch('/api/admin/enrolment-actions', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ action: 'sync-calendar' }),
                    });
                    const calJson = await calRes.json();
                    if (calJson.success) {
                        console.log(`📅 Calendar sync complete: checked=${calJson.checked}, matched=${calJson.matched}`);
                    } else {
                        console.warn('📅 Calendar sync returned error (non-blocking):', calJson.error);
                    }
                } catch (calErr) {
                    console.warn('📅 Calendar sync failed (non-blocking):', calErr);
                }
            }

            setUploadResult({ results: allItems });

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
        setResultsPage(1);
        setDbInsertErrors([]);
    };

    const UploadStep = () => (
        <Card className="p-6">
            <div className="text-center mb-4">
                <h3 className="text-xl font-bold dark:text-white">Bulk Upload Enrolments</h3>
                <p className="text-gray-500 dark:text-gray-400 mt-1">Submit enrolment data in bulk by uploading an Excel file.</p>
            </div>

            <div
                onDragOver={(e) => handleDragEvents(e, true)}
                onDragLeave={(e) => handleDragEvents(e, false)}
                onDrop={handleDrop}
                className={`p-10 border-2 border-dashed rounded-lg text-center cursor-pointer transition-colors ${isDragOver ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20' : 'border-gray-300 dark:border-gray-600 hover:border-blue-500 dark:hover:border-blue-400'}`}
            >
                <input
                    type="file"
                    id="file-upload-enrolment"
                    className="hidden"
                    accept=".xlsx, .xls"
                    onChange={(e) => handleFileChange(e.target.files?.[0])}
                />
                <label htmlFor="file-upload-enrolment" className="cursor-pointer">
                    <Icon name={IconName.Upload} className="w-12 h-12 mx-auto text-gray-400 dark:text-gray-500" />
                    <p className="mt-2 font-semibold text-gray-900 dark:text-white">
                        {file ? file.name : 'Drag & drop your file here, or click to browse'}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                        XLSX or XLS file format
                    </p>
                </label>
            </div>

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
                        onClick={() => setError(null)}
                        className="flex-shrink-0 text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300"
                    >
                        <Icon name={IconName.Close} className="w-5 h-5" />
                    </button>
                </div>
            )}

            <div className="flex justify-between items-center mt-6">
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                        const link = document.createElement('a');
                        link.href = '/ssg_templates/Enrolment_Upload_Template.xlsx';
                        link.download = 'Enrolment_Upload_Template.xlsx';
                        document.body.appendChild(link);
                        link.click();
                        document.body.removeChild(link);
                    }}
                >
                    <Icon name={IconName.Download} className="w-4 h-4 mr-2" />
                    Enrolment Template
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

    const ResultsStep = () => {
        // Parse results - handle different response formats
        let results: any[] = [];

        console.log('📦 uploadResult:', uploadResult);

        // Handle nested results structure: [{results: [{result: "..."}, ...]}]
        if (Array.isArray(uploadResult) && uploadResult[0]?.results) {
            const nestedResults = uploadResult[0].results;
            results = nestedResults.map((item: any) => {
                // Parse nested result string if it exists
                if (item?.result && typeof item.result === 'string') {
                    try {
                        const parsed = JSON.parse(item.result);
                        return { ...item, parsedResult: parsed };
                    } catch {
                        return item;
                    }
                }
                return item;
            });
        } else if (uploadResult?.results && Array.isArray(uploadResult.results)) {
            console.log('📋 Found uploadResult.results array');
            results = uploadResult.results.map((item: any) => {
                console.log('🔍 Processing item:', item);
                if (item?.result && typeof item.result === 'string') {
                    try {
                        const parsed = JSON.parse(item.result);
                        console.log('✅ Parsed result for item:', parsed);
                        return { ...item, parsedResult: parsed };
                    } catch (e) {
                        console.log('❌ Failed to parse result:', item.result, e);
                        return item;
                    }
                }
                console.log('⚠️ Item has no result string:', item);
                return item;
            });
        } else if (uploadResult?.result && Array.isArray(uploadResult.result)) {
            results = uploadResult.result;
        } else if (Array.isArray(uploadResult)) {
            results = uploadResult.map((item: any) => {
                if (item?.result && typeof item.result === 'string') {
                    try {
                        const parsed = JSON.parse(item.result);
                        return { ...item, parsedResult: parsed };
                    } catch {
                        return item;
                    }
                } else if (item?.result && typeof item.result === 'object') {
                    return { ...item, parsedResult: item.result };
                }
                return item;
            });
        } else if (uploadResult) {
            results = [uploadResult];
        }

        const isRecordSuccess = (r: any) => {
            const pr = r.parsedResult;
            return pr?.success === true;
        };

        const successCount = results.filter(r => isRecordSuccess(r)).length;
        const failedCount = results.filter(r => !isRecordSuccess(r)).length;

        const totalPages = Math.ceil(results.length / resultsPerPage);
        const paginatedResults = results.slice((resultsPage - 1) * resultsPerPage, resultsPage * resultsPerPage);

        return (
            <Card>
                <div className="p-6 border-b dark:border-gray-700">
                    <h3 className="text-xl font-bold dark:text-white">Bulk Enrolment Results</h3>
                    <p className="text-gray-500 dark:text-gray-400 mt-1">SSG response for each enrolment record.</p>
                </div>
                <div className="p-6">
                    {dbInsertErrors.length > 0 && (
                        <div className="mb-4 p-4 bg-orange-50 dark:bg-orange-900/20 border border-orange-300 dark:border-orange-700 rounded-lg">
                            <div className="font-semibold text-orange-900 dark:text-orange-200 mb-2">
                                ⚠️ {dbInsertErrors.length} row(s) failed to save to database
                            </div>
                            <div className="space-y-1">
                                {dbInsertErrors.map((e, idx) => (
                                    <div key={idx} className="text-sm text-orange-800 dark:text-orange-300">
                                        Row {e.row} ({e.email || 'unknown email'}): {e.error}
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                    {results.length > 0 ? (
                        <div className="space-y-6">
                            <div className={`border rounded-lg p-4 ${successCount > 0 && failedCount === 0 ? 'bg-green-50 dark:bg-green-900/30 border-green-200 dark:border-green-800' : failedCount > 0 && successCount === 0 ? 'bg-red-50 dark:bg-red-900/30 border-red-200 dark:border-red-800' : 'bg-yellow-50 dark:bg-yellow-900/30 border-yellow-200 dark:border-yellow-800'}`}>
                                <h4 className={`font-bold ${successCount > 0 && failedCount === 0 ? 'text-green-800 dark:text-green-300' : failedCount > 0 && successCount === 0 ? 'text-red-800 dark:text-red-300' : 'text-yellow-800 dark:text-yellow-300'}`}>
                                    {successCount > 0 && `${successCount} Successful`}
                                    {successCount > 0 && failedCount > 0 && ', '}
                                    {failedCount > 0 && `${failedCount} Failed`}
                                </h4>
                                <p className={`text-sm ${successCount > 0 && failedCount === 0 ? 'text-green-700 dark:text-green-400' : failedCount > 0 && successCount === 0 ? 'text-red-700 dark:text-red-400' : 'text-yellow-700 dark:text-yellow-400'}`}>
                                    Total: {results.length} record(s) processed
                                </p>
                            </div>

                            <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
                                <div className="bg-gray-100 dark:bg-gray-800 px-4 py-3">
                                    <h4 className="font-semibold text-gray-800 dark:text-gray-200">Enrolment Results ({results.length})</h4>
                                </div>
                                <div className="overflow-x-auto">
                                    <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-600">
                                        <thead className="bg-gray-50 dark:bg-gray-800">
                                            <tr>
                                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">#</th>
                                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Trainee ID</th>
                                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Trainee Name</th>
                                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Trainee Email</th>
                                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Course Run ID</th>
                                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Course Reference</th>
                                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Sponsorship Type</th>
                                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Status</th>
                                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">SSG Response</th>
                                            </tr>
                                        </thead>
                                        <tbody className="bg-white dark:bg-gray-700 divide-y divide-gray-200 dark:divide-gray-600">
                                            {paginatedResults.map((record: any, index: number) => {
                                                console.log(`🎯 Rendering record ${index}:`, record);
                                                console.log(`   - parsedResult:`, record.parsedResult);
                                                console.log(`   - parsedResult?.error:`, record.parsedResult?.error);
                                                console.log(`   - parsedResult?.status:`, record.parsedResult?.status);

                                                const isSuccess = isRecordSuccess(record);
                                                const statusColor = isSuccess ? 'bg-green-100 text-green-800 border-green-200 dark:bg-green-900/30 dark:text-green-300 dark:border-green-700' : 'bg-red-100 text-red-800 border-red-200 dark:bg-red-900/30 dark:text-red-300 dark:border-red-700';

                                                return (
                                                    <tr key={index} className="hover:bg-gray-50 dark:hover:bg-gray-600">
                                                        <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500 dark:text-gray-200">
                                                            {(resultsPage - 1) * resultsPerPage + index + 1}
                                                        </td>
                                                        <td className="px-4 py-3 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-white">
                                                            {record.traineeId || 'N/A'}
                                                        </td>
                                                        <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500 dark:text-gray-200">
                                                            {record.traineeName || 'N/A'}
                                                        </td>
                                                        <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500 dark:text-gray-200">
                                                            {record.traineeEmail || 'N/A'}
                                                        </td>
                                                        <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500 dark:text-gray-200">
                                                            {record.courseRunId || 'N/A'}
                                                        </td>
                                                        <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500 dark:text-gray-200">
                                                            {record.courseReferenceNumber || 'N/A'}
                                                        </td>
                                                        <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500 dark:text-gray-200">
                                                            {record.sponsorshipType || 'N/A'}
                                                        </td>
                                                        <td className="px-4 py-3 whitespace-nowrap">
                                                            <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full border ${statusColor}`}>
                                                                {isSuccess ? 'Success' : 'Failed'}
                                                            </span>
                                                        </td>
                                                        <td className="px-4 py-3 text-sm text-gray-500 dark:text-gray-200">
                                                            <div className="min-w-[280px]">
                                                                {(() => {
                                                                    if (isSuccess) {
                                                                        const pr = record.parsedResult;
                                                                        const enrolmentRef = pr?.data?.enrolment?.referenceNumber || 'N/A';
                                                                        const enrolmentStatus = pr?.data?.enrolment?.status || 'Confirmed';
                                                                        return (
                                                                            <div className="space-y-2 p-4 bg-green-50 dark:bg-green-900/20 border-l-4 border-green-500 dark:border-green-600 rounded-r-lg shadow-sm">
                                                                                <div className="flex items-center gap-2">
                                                                                    <Icon name={IconName.CheckCircle} className="w-5 h-5 text-green-600 dark:text-green-400 flex-shrink-0" />
                                                                                    <div className="text-sm text-green-800 dark:text-green-200 font-semibold">Enrolment created successfully</div>
                                                                                </div>
                                                                                <div className="pl-7 space-y-1">
                                                                                    <div className="text-xs text-green-700 dark:text-green-300">
                                                                                        <span className="font-medium">Reference:</span> <span className="font-mono bg-green-100 dark:bg-green-900/40 px-2 py-0.5 rounded">{enrolmentRef}</span>
                                                                                    </div>
                                                                                    <div className="text-xs text-green-700 dark:text-green-300">
                                                                                        <span className="font-medium">Status:</span> <span className="font-medium">{enrolmentStatus}</span>
                                                                                    </div>
                                                                                </div>
                                                                            </div>
                                                                        );
                                                                    } else if (record.parsedResult && !record.parsedResult.success) {
                                                                        // Error case
                                                                        const errPayload = {
                                                                            message: typeof record.parsedResult.error === 'string' 
                                                                                ? record.parsedResult.error 
                                                                                : (record.parsedResult.error?.message || 'An error occurred'),
                                                                            details: record.parsedResult.details || record.parsedResult.error?.details
                                                                        };
                                                                        return <ErrorMessageDisplay error={errPayload} />;
                                                                    } else if (record.parsedResult) {
                                                                        // parsedResult exists but no clear error or data - show parsed result
                                                                        return <pre className="text-xs bg-gray-100 dark:bg-gray-800 p-2 rounded">{JSON.stringify(record.parsedResult, null, 2)}</pre>;
                                                                    } else if (record.result && typeof record.result === 'string' && record.result.startsWith('{')) {
                                                                        // If result is JSON string but not parsed, try to parse it here
                                                                        try {
                                                                            const parsed = JSON.parse(record.result);
                                                                            const isSuccessParsed = (parsed.status >= 200 && parsed.status < 300) ||
                                                                                (parsed.data && Object.keys(parsed.data).length > 0);
                                                                            const hasErrorParsed = (parsed.error?.details?.length > 0) ||
                                                                                (parsed.error?.message) ||
                                                                                (parsed.status >= 400);

                                                                            if (isSuccessParsed && !hasErrorParsed) {
                                                                                const enrolmentRef = parsed.data?.enrolment?.referenceNumber || 'N/A';
                                                                                const enrolmentStatus = parsed.data?.enrolment?.status || 'Confirmed';
                                                                                return (
                                                                                    <div className="space-y-2 p-4 bg-green-50 dark:bg-green-900/20 border-l-4 border-green-500 dark:border-green-600 rounded-r-lg shadow-sm">
                                                                                        <div className="flex items-center gap-2">
                                                                                            <Icon name={IconName.CheckCircle} className="w-5 h-5 text-green-600 dark:text-green-400 flex-shrink-0" />
                                                                                            <div className="text-sm text-green-800 dark:text-green-200 font-semibold">Enrolment created successfully</div>
                                                                                        </div>
                                                                                        <div className="pl-7 space-y-1">
                                                                                            <div className="text-xs text-green-700 dark:text-green-300">
                                                                                                <span className="font-medium">Reference:</span> <span className="font-mono bg-green-100 dark:bg-green-900/40 px-2 py-0.5 rounded">{enrolmentRef}</span>
                                                                                            </div>
                                                                                            <div className="text-xs text-green-700 dark:text-green-300">
                                                                                                <span className="font-medium">Status:</span> <span className="font-medium">{enrolmentStatus}</span>
                                                                                            </div>
                                                                                        </div>
                                                                                    </div>
                                                                                );
                                                                            } else if (hasErrorParsed) {
                                                                                return <ErrorMessageDisplay error={parsed.error} />;
                                                                            }
                                                                            return <pre className="text-xs bg-gray-100 dark:bg-gray-800 p-2 rounded">{JSON.stringify(parsed, null, 2)}</pre>;
                                                                        } catch (e) {
                                                                            return (
                                                                                <div className="flex items-center gap-2 p-3 bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 rounded-lg">
                                                                                    <Icon name={IconName.InfoCircle} className="w-4 h-4 text-orange-600 dark:text-orange-400 flex-shrink-0" />
                                                                                    <span className="text-sm text-orange-700 dark:text-orange-300">Failed to parse response</span>
                                                                                </div>
                                                                            );
                                                                        }
                                                                    } else if (record.message) {
                                                                        return <span className="text-sm">{record.message}</span>;
                                                                    } else if (record.result && typeof record.result === 'string' && !record.result.startsWith('{') && !record.result.startsWith('[')) {
                                                                        return <span className="text-sm">{record.result}</span>;
                                                                    } else {
                                                                        return (
                                                                            <div className="flex items-center gap-2 p-3 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg">
                                                                                <Icon name={IconName.InfoCircle} className="w-4 h-4 text-gray-400 dark:text-gray-500 flex-shrink-0" />
                                                                                <span className="text-sm text-gray-500 dark:text-gray-400">No response</span>
                                                                            </div>
                                                                        );
                                                                    }
                                                                })()}
                                                            </div>
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                                {results.length > resultsPerPage && (
                                    <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-800 border-t dark:border-gray-700">
                                        <p className="text-sm text-gray-500 dark:text-gray-400">
                                            Showing {(resultsPage - 1) * resultsPerPage + 1}-{Math.min(resultsPage * resultsPerPage, results.length)} of {results.length}
                                        </p>
                                        <div className="flex items-center gap-1">
                                            <button
                                                onClick={() => setResultsPage(p => Math.max(1, p - 1))}
                                                disabled={resultsPage === 1}
                                                className="px-3 py-1 text-sm border dark:border-gray-600 rounded hover:bg-gray-100 dark:hover:bg-gray-700 dark:text-gray-200 disabled:opacity-50 disabled:cursor-not-allowed"
                                            >
                                                Previous
                                            </button>
                                            {Array.from({ length: totalPages }, (_, i) => i + 1).map(page => (
                                                <button
                                                    key={page}
                                                    onClick={() => setResultsPage(page)}
                                                    className={`px-3 py-1 text-sm border rounded ${resultsPage === page ? 'bg-blue-500 text-white border-blue-500' : 'hover:bg-gray-100 dark:hover:bg-gray-700 dark:border-gray-600 dark:text-gray-200'}`}
                                                >
                                                    {page}
                                                </button>
                                            ))}
                                            <button
                                                onClick={() => setResultsPage(p => Math.min(totalPages, p + 1))}
                                                disabled={resultsPage === totalPages}
                                                className="px-3 py-1 text-sm border dark:border-gray-600 rounded hover:bg-gray-100 dark:hover:bg-gray-700 dark:text-gray-200 disabled:opacity-50 disabled:cursor-not-allowed"
                                            >
                                                Next
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    ) : (
                        <div className="bg-yellow-50 dark:bg-yellow-900/30 border border-yellow-200 dark:border-yellow-800 rounded-lg p-8 text-center">
                            <Icon name={IconName.InfoCircle} className="w-12 h-12 mx-auto text-yellow-500 dark:text-yellow-400 mb-3" />
                            <h4 className="text-lg font-bold text-yellow-800 dark:text-yellow-300 mb-2">No Results</h4>
                            <p className="text-yellow-700 dark:text-yellow-400">
                                The webhook did not return any results.
                            </p>
                        </div>
                    )}
                </div>
                <div className="p-4 border-t dark:border-gray-700 text-right">
                    <Button onClick={resetView}>Start a New Upload</Button>
                </div>
            </Card>
        );
    };

    return (
        <div>
            <h2 className="text-3xl font-bold mb-6">Bulk Upload Enrolments</h2>
            {isUploading ? (
                <div className="flex justify-center py-20">
                    <div className="text-center">
                        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto"></div>
                        <p className="mt-4 text-gray-600 dark:text-gray-300">Processing bulk enrolment...</p>
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
