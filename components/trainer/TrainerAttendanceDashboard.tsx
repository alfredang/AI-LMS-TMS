import React, { useState } from 'react';

// --- Mock data for static UI ---
const MOCK_CLASSES = [
  { value: 'AAD-AIS-123-04MAR26-IPZ8097P', label: 'AAD-AIS-123-04MAR26-IPZ8097P' },
  { value: 'AAD-BIS-456-11MAR26-IPZ1234A', label: 'AAD-BIS-456-11MAR26-IPZ1234A' },
];

const MOCK_SESSIONS = ['S1', 'S2', 'S3'];

const MOCK_INSTRUCTORS = [
  { name: 'ALFRED ANG', type: 'Main Instructor' },
];

const MOCK_STUDENTS = [
  { no: 1, name: 'ANG SOON RONG SYLVESTER', nric: 'SXXXX164D', type: 'Student', sfcBalance: '0.00', midCareerBalance: '0.00' },
  { no: 2, name: 'CHEUNG CHUN MING',        nric: 'SXXXX744E', type: 'Student', sfcBalance: '0.00', midCareerBalance: '500.00' },
  { no: 3, name: 'GOH CHANG YUAN',           nric: 'SXXXX787E', type: 'Student', sfcBalance: '649.80', midCareerBalance: '0.00' },
  { no: 4, name: 'LEE WEI MING',             nric: 'SXXXX321F', type: 'Student', sfcBalance: '200.00', midCareerBalance: '0.00' },
  { no: 5, name: 'TAN BOON KEAT',            nric: 'SXXXX999G', type: 'Student', sfcBalance: '0.00', midCareerBalance: '350.00' },
];

const ABSENCE_REASONS = ['', 'Medical', 'Personal', 'Work Commitment', 'No Show', 'Others'];

const TrainerAttendanceDashboard: React.FC = () => {
  const [selectedClass, setSelectedClass]               = useState(MOCK_CLASSES[0].value);
  const [selectedSession, setSelectedSession]           = useState(MOCK_SESSIONS[0]);
  const [instructorAttended, setInstructorAttended]     = useState<Record<number, boolean>>({});
  const [studentMarked, setStudentMarked]               = useState<Record<number, boolean>>({});
  const [absenceReasons, setAbsenceReasons]             = useState<Record<number, string>>({});
  const [qrFile, setQrFile]                             = useState<File | null>(null);
  const [activeTab, setActiveTab]                       = useState<'qr' | 'elist'>('qr');

  const toggleInstructor = (idx: number) =>
    setInstructorAttended(prev => ({ ...prev, [idx]: !prev[idx] }));

  const toggleStudent = (idx: number) =>
    setStudentMarked(prev => ({ ...prev, [idx]: !prev[idx] }));

  const setReason = (idx: number, val: string) =>
    setAbsenceReasons(prev => ({ ...prev, [idx]: val }));

  const markedCount = Object.values(studentMarked).filter(Boolean).length;

  return (
    <div className="space-y-4">

      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-on-surface">Attendance (Bulk)</h1>
          <nav className="text-sm text-on-surface-secondary mt-1">
            <span className="hover:text-primary cursor-pointer">Home</span>
            <span className="mx-1">/</span>
            <span className="hover:text-primary cursor-pointer">Dashboard</span>
            <span className="mx-1">/</span>
            <span className="text-on-surface font-medium">Attendance (Bulk)</span>
          </nav>
        </div>
        <button className="px-4 py-2 bg-primary text-white rounded text-sm font-medium hover:bg-primary-hover transition-colors">
          Class-end Refund
        </button>
      </div>

      {/* Select Class Card */}
      <div className="bg-surface rounded-lg border border-default p-4 shadow-sm">
        <h2 className="text-base font-semibold text-on-surface mb-3">Select Class</h2>
        <div className="flex flex-wrap items-center gap-3">

          {/* Class dropdown */}
          <div className="relative flex-1 min-w-[260px]">
            <select
              value={selectedClass}
              onChange={e => setSelectedClass(e.target.value)}
              className="input-themed w-full border rounded px-3 py-2 text-sm pr-8 appearance-none focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
            >
              {MOCK_CLASSES.map(c => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
            {selectedClass && (
              <button
                onClick={() => setSelectedClass('')}
                className="absolute right-7 top-1/2 -translate-y-1/2 text-muted hover:text-on-surface text-lg leading-none"
              >×</button>
            )}
            <span className="absolute right-2 top-1/2 -translate-y-1/2 text-muted pointer-events-none text-xs">▼</span>
          </div>

          {/* Session dropdown */}
          <div className="relative w-28">
            <select
              value={selectedSession}
              onChange={e => setSelectedSession(e.target.value)}
              className="input-themed w-full border rounded px-3 py-2 text-sm appearance-none focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
            >
              {MOCK_SESSIONS.map(s => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            <span className="absolute right-2 top-1/2 -translate-y-1/2 text-muted pointer-events-none text-xs">▼</span>
          </div>

          {/* Save button */}
          <button className="flex items-center gap-2 px-5 py-2 bg-primary text-white rounded text-sm font-medium hover:bg-primary-hover transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
            </svg>
            Save
          </button>
        </div>

        {/* Course Run info */}
        {selectedClass && (
          <p className="mt-3 text-sm text-on-surface-secondary">
            <span className="font-medium text-on-surface">Course Run Id:</span>{' '}
            <span className="text-primary font-semibold">1256225</span>
            <span className="mx-2 text-muted">|</span>
            <span className="font-medium text-on-surface">Module Type:</span>{' '}
            <span>SCTP Non-WSQ</span>
          </p>
        )}
      </div>

      {/* Main attendance section — two columns */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">

        {/* Left column (2/3 width) */}
        <div className="xl:col-span-2 space-y-4">

          {/* Instructor Attendance Table */}
          <div className="bg-surface rounded-lg border border-default shadow-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-surface-elevated border-b border-default">
                <tr>
                  <th className="px-4 py-3 text-left font-semibold text-on-surface-secondary w-20">Attended</th>
                  <th className="px-4 py-3 text-left font-semibold text-on-surface-secondary">Instructor Name</th>
                  <th className="px-4 py-3 text-left font-semibold text-on-surface-secondary">Type</th>
                  <th className="px-4 py-3 text-center font-semibold text-on-surface-secondary w-12">No</th>
                  <th className="px-4 py-3 text-left font-semibold text-on-surface-secondary">Instructor Name</th>
                  <th className="px-4 py-3 text-left font-semibold text-on-surface-secondary">NRIC</th>
                </tr>
              </thead>
              <tbody>
                {MOCK_INSTRUCTORS.map((inst, idx) => (
                  <tr key={idx} className="border-b border-default bg-surface-hover:hover">
                    <td className="px-4 py-3 text-center">
                      <input
                        type="checkbox"
                        checked={!!instructorAttended[idx]}
                        onChange={() => toggleInstructor(idx)}
                        className="w-4 h-4 accent-[var(--primary)]"
                      />
                    </td>
                    <td className="px-4 py-3 text-on-surface font-medium">{inst.name}</td>
                    <td className="px-4 py-3 text-on-surface-secondary">{inst.type}</td>
                    <td className="px-4 py-3 text-center text-muted">—</td>
                    <td className="px-4 py-3 text-muted">—</td>
                    <td className="px-4 py-3 text-muted">—</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* QR / E-Attendance Tabs */}
          <div className="bg-surface rounded-lg border border-default shadow-sm p-4">
            <div className="flex gap-2 mb-4">
              <button
                onClick={() => setActiveTab('qr')}
                className={`px-4 py-2 rounded text-sm font-medium transition-colors ${
                  activeTab === 'qr'
                    ? 'bg-primary text-white'
                    : 'bg-surface-elevated text-on-surface-secondary hover:text-on-surface'
                }`}
              >
                QR Attendance
              </button>
              <button
                onClick={() => setActiveTab('elist')}
                className={`px-4 py-2 rounded text-sm font-medium transition-colors ${
                  activeTab === 'elist'
                    ? 'bg-primary text-white'
                    : 'bg-surface-elevated text-on-surface-secondary hover:text-on-surface'
                }`}
              >
                E-Attendance List
              </button>
            </div>

            {activeTab === 'qr' && (
              <div>
                <p className="text-sm font-medium text-on-surface mb-2">Upload QR Attendance Screenshot</p>
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-2 px-3 py-2 border border-default rounded text-sm text-on-surface-secondary cursor-pointer hover:bg-surface-elevated transition-colors">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                    </svg>
                    Choose file
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={e => setQrFile(e.target.files?.[0] || null)}
                    />
                  </label>
                  <span className="text-sm text-muted">
                    {qrFile ? qrFile.name : 'No file chosen'}
                  </span>
                </div>
              </div>
            )}

            {activeTab === 'elist' && (
              <p className="text-sm text-muted italic">E-Attendance list feature coming soon.</p>
            )}
          </div>

          {/* Student Attendance Table */}
          <div className="bg-surface rounded-lg border border-default shadow-sm overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-elevated border-b border-default">
                <tr>
                  <th className="px-3 py-3 text-center font-semibold text-on-surface-secondary w-10">No.</th>
                  <th className="px-3 py-3 text-left font-semibold text-on-surface-secondary">Name</th>
                  <th className="px-3 py-3 text-left font-semibold text-on-surface-secondary">NRIC</th>
                  <th className="px-3 py-3 text-left font-semibold text-on-surface-secondary">Type</th>
                  <th className="px-3 py-3 text-center font-semibold text-on-surface-secondary w-14">Mark</th>
                  <th className="px-3 py-3 text-left font-semibold text-on-surface-secondary min-w-[160px]">Reason of Absence</th>
                  <th className="px-3 py-3 text-right font-semibold text-on-surface-secondary whitespace-nowrap">SFC Balance (Estimate)</th>
                  <th className="px-3 py-3 text-right font-semibold text-on-surface-secondary whitespace-nowrap">Mid-Career SFC Balance (Estimate)</th>
                </tr>
              </thead>
              <tbody>
                {MOCK_STUDENTS.map((s, idx) => (
                  <tr key={idx} className="border-b border-default hover:bg-surface-elevated transition-colors">
                    <td className="px-3 py-3 text-center text-on-surface-secondary">{s.no}</td>
                    <td className="px-3 py-3 font-medium text-on-surface">{s.name}</td>
                    <td className="px-3 py-3 text-on-surface-secondary">{s.nric}</td>
                    <td className="px-3 py-3 text-on-surface-secondary">{s.type}</td>
                    <td className="px-3 py-3 text-center">
                      <input
                        type="checkbox"
                        checked={!!studentMarked[idx]}
                        onChange={() => toggleStudent(idx)}
                        className="w-4 h-4 accent-[var(--primary)]"
                      />
                    </td>
                    <td className="px-3 py-3">
                      <select
                        value={absenceReasons[idx] || ''}
                        onChange={e => setReason(idx, e.target.value)}
                        disabled={!!studentMarked[idx]}
                        className="input-themed w-full border rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-primary/20 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {ABSENCE_REASONS.map(r => (
                          <option key={r} value={r}>{r || '—'}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-3 text-right text-on-surface-secondary">{s.sfcBalance}</td>
                    <td className="px-3 py-3 text-right text-on-surface-secondary">{s.midCareerBalance}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Right column (1/3 width) */}
        <div className="space-y-4">

          {/* QR Attendees panel */}
          <div className="bg-surface rounded-lg border border-default shadow-sm p-4">
            <h3 className="text-sm font-semibold text-on-surface mb-3">
              QR Attendees{' '}
              <span className="text-muted font-normal">(From Saved)</span>
            </h3>
            <div className="space-y-2 text-sm">
              <p>
                <span className="font-medium text-on-surface">Mode of Training:</span>{' '}
                <span className="text-muted italic">—</span>
              </p>
              <p>
                <span className="font-medium text-on-surface">Time:</span>{' '}
                <span className="text-muted italic">—</span>
              </p>
            </div>
            <div className="mt-4 border-t border-default pt-3">
              <p className="text-xs text-muted italic">No QR attendance data saved yet.</p>
            </div>
          </div>

          {/* Attendance Summary */}
          <div className="bg-surface rounded-lg border border-default shadow-sm p-4">
            <h3 className="text-sm font-semibold text-on-surface mb-3">Attendance Summary</h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between items-center">
                <span className="text-on-surface-secondary">Total Students</span>
                <span className="font-semibold text-on-surface">{MOCK_STUDENTS.length}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-on-surface-secondary">Marked Present</span>
                <span className="font-semibold" style={{ color: 'var(--success)' }}>
                  {markedCount}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-on-surface-secondary">Absent</span>
                <span className="font-semibold" style={{ color: 'var(--error)' }}>
                  {MOCK_STUDENTS.length - markedCount}
                </span>
              </div>
              {/* Progress bar */}
              <div className="mt-2 pt-2 border-t border-default">
                <div className="flex justify-between text-xs text-muted mb-1">
                  <span>Attendance Rate</span>
                  <span>{MOCK_STUDENTS.length > 0 ? Math.round((markedCount / MOCK_STUDENTS.length) * 100) : 0}%</span>
                </div>
                <div className="w-full bg-surface-elevated rounded-full h-2">
                  <div
                    className="bg-primary rounded-full h-2 transition-all duration-300"
                    style={{ width: `${MOCK_STUDENTS.length > 0 ? (markedCount / MOCK_STUDENTS.length) * 100 : 0}%` }}
                  />
                </div>
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
};

export default TrainerAttendanceDashboard;
