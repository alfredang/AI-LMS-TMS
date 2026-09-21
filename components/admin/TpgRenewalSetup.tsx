import React, { useRef } from 'react';

export default function TpgRenewalSetup({ version, local }: { version: string | null; local: boolean }) {
  const base = `/downloads/tpg-renewal${local ? '/local' : ''}`;
  const dialog = useRef<HTMLDialogElement>(null);
  return <>
    <button type="button" onClick={() => dialog.current?.showModal()}
      className="px-3 py-1.5 text-xs font-medium rounded border border-purple-400 text-purple-700 dark:text-purple-200 hover:bg-purple-50 dark:hover:bg-purple-900/30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-purple-500">
      Setup &amp; Download
    </button>
    <dialog ref={dialog} aria-labelledby="tpg-setup-title"
      className="w-[calc(100%-2rem)] max-w-2xl max-h-[90vh] overflow-auto rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 p-6 shadow-2xl backdrop:bg-black/60">
      <div className="flex items-start justify-between gap-4">
        <div><h2 id="tpg-setup-title" className="text-lg font-semibold">Set up TPG renewal updates</h2>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">Chrome extension for {local ? 'the localhost Docker trial' : 'TIA course renewal updates'}.</p></div>
        <button type="button" autoFocus onClick={() => dialog.current?.close()} aria-label="Close setup guide"
          className="min-h-11 min-w-11 rounded hover:bg-gray-100 dark:hover:bg-gray-800 focus-visible:outline focus-visible:outline-2">×</button>
      </div>
      <p className="mt-4 text-sm">Extension: <strong>{version ? `Connected (v${version})` : 'Not detected'}</strong> · Package: v0.1.6</p>
      <div className="mt-4 flex flex-wrap gap-3">
        <a href={`${base}/tia-tpg-renewal-sync-${local ? 'local' : 'staff'}-v0.1.6.zip`} download
          className="inline-flex min-h-11 items-center rounded bg-purple-700 px-4 py-2 text-sm font-semibold text-white hover:bg-purple-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-purple-500">Download extension ZIP</a>
        <a href={`${base}/setup-guide.html`} target="_blank" rel="noopener noreferrer"
          className="inline-flex min-h-11 items-center rounded border border-gray-300 dark:border-gray-600 px-4 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-800 focus-visible:outline focus-visible:outline-2">Full guide (new tab)</a>
      </div>
      <h3 className="mt-6 font-semibold">Set up once</h3>
      <ol className="mt-2 list-decimal space-y-2 pl-5 text-sm leading-6">
        <li>Extract the ZIP to a permanent folder in Documents.</li>
        <li>Open <code>chrome://extensions</code>, enable <strong>Developer mode</strong>, then choose <strong>Load unpacked</strong>.</li>
        <li>Select the extracted <code>extension</code> folder containing <code>manifest.json</code>. Refresh TIA.</li>
      </ol>
      <p className="mt-3 text-sm text-gray-600 dark:text-gray-300">Already installed? Replace its files, click Reload in Chrome’s extensions page, then refresh TIA. Keep only one copy enabled.</p>
      <h3 className="mt-6 font-semibold">Use each time</h3>
      <ol className="mt-2 list-decimal space-y-2 pl-5 text-sm leading-6">
        <li>Sign in to TPG in the same Chrome profile. Open Courses and check the organisation.</li>
        <li>Click <strong>Refresh from TPG{local ? ' (Trial)' : ''}</strong>. Leave both tabs open while capture runs.</li>
        <li>Review the proposed changes, then <strong>Confirm &amp; Apply</strong>. Wait for the verified completion message.</li>
      </ol>
      <p className="mt-4 text-sm">Checks WSQ courses expiring today through three months ahead. No ChatGPT subscription is needed.</p>
      <p className="mt-4 rounded bg-amber-50 dark:bg-amber-900/20 p-3 text-sm text-amber-900 dark:text-amber-200">{local ? 'This package works at localhost:3000 on the computer running the trial. ' : 'Use your own authorised TPG account in the same Chrome profile. '}Preview is read-only; Apply updates the live TIA database.</p>
    </dialog>
  </>;
}
