import React, { useEffect, useRef, useState } from 'react';

/**
 * SearchableSelect — a freeform-search input combined with a filtered dropdown, for
 * picking one option from a long list (e.g. trainers). Typing filters by label; clearing
 * the field selects nothing. Shared across the admin trainer-selection surfaces.
 */
const SearchableSelect: React.FC<{
  options: { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}> = ({ options, value, onChange, placeholder = '— Search or select —', className }) => {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const selectedOption = options.find((o) => o.value === value);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const filtered = query
    ? options.filter((o) => o.label.toLowerCase().includes(query.toLowerCase()))
    : options;

  return (
    <div ref={ref} className="relative">
      <input
        type="text"
        className={className}
        placeholder={selectedOption ? selectedOption.label : placeholder}
        value={open ? query : (selectedOption ? selectedOption.label : '')}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); if (!e.target.value) onChange(''); }}
        onFocus={() => { setOpen(true); setQuery(''); }}
      />
      {open && (
        <div className="absolute z-50 mt-1 w-full max-h-48 overflow-y-auto bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md shadow-lg">
          {filtered.length === 0 ? (
            <div className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400 italic">No results found</div>
          ) : (
            filtered.map((o) => (
              <div
                key={o.value}
                className={`px-3 py-2 text-sm cursor-pointer hover:bg-blue-50 dark:hover:bg-blue-900/30 ${o.value === value ? 'bg-blue-100 dark:bg-blue-900/50 font-medium' : 'text-gray-900 dark:text-gray-100'}`}
                onMouseDown={(e) => { e.preventDefault(); onChange(o.value); setQuery(''); setOpen(false); }}
              >
                {o.label}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
};

export default SearchableSelect;
