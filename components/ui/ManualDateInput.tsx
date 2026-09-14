import React, { useState } from 'react';
import {
  displayDateToIso,
  formatManualDateInput,
  isoDateToDisplayValue,
} from '@lib/manualDateInput';

interface ManualDateInputProps {
  id: string;
  name: string;
  value: string;
  onChange: (value: string) => void;
  className: string;
  calendarLabel: string;
  validationAttempted?: boolean;
}

/** Text entry in DD/MM/YYYY with a native calendar picker on the right. */
const ManualDateInput: React.FC<ManualDateInputProps> = ({
  id,
  name,
  value,
  onChange,
  className,
  calendarLabel,
  validationAttempted = false,
}) => {
  const [touched, setTouched] = useState(false);
  const isoValue = displayDateToIso(value);
  const invalid = value.trim() !== '' && isoValue === null;
  const showError = invalid && (touched || validationAttempted);
  const errorId = `${id}-error`;

  return (
    <div>
      <div className="relative">
        <input
          type="text"
          inputMode="numeric"
          autoComplete="off"
          id={id}
          name={name}
          value={value}
          onChange={(event) => onChange(formatManualDateInput(event.target.value))}
          onBlur={() => setTouched(true)}
          placeholder="dd/mm/yyyy"
          maxLength={10}
          aria-invalid={showError}
          aria-describedby={showError ? errorId : undefined}
          className={`${className} min-h-11 pr-12 ${showError ? 'border-red-500 focus:ring-red-500' : ''}`}
        />

        <div className="absolute inset-y-0 right-0 flex w-12 items-center justify-center">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            className="pointer-events-none h-5 w-5 text-gray-500 dark:text-gray-300"
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M7 3v3m10-3v3M4 9h16M5 5h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z" />
          </svg>
          <input
            type="date"
            value={isoValue || ''}
            onChange={(event) => {
              onChange(isoDateToDisplayValue(event.target.value));
              setTouched(false);
            }}
            aria-label={calendarLabel}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          />
        </div>
      </div>
      {showError && (
        <p id={errorId} className="mt-1 text-xs text-red-600 dark:text-red-400">
          Enter a valid date in dd/mm/yyyy format.
        </p>
      )}
    </div>
  );
};

export default ManualDateInput;
