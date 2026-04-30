import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Icon, IconName } from './ui/Icon';

export interface SearchPaletteItem {
  id: string;
  label: string;
  section: string;
  keywords?: string[];
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  items: SearchPaletteItem[];
  onSelect: (item: SearchPaletteItem) => void;
  placeholder?: string;
}

const scoreItem = (item: SearchPaletteItem, query: string): number => {
  const q = query.trim().toLowerCase();
  if (!q) return 0;
  const labelLc = item.label.toLowerCase();
  const haystack = [item.label, item.section, ...(item.keywords ?? [])].join(' ').toLowerCase();
  if (labelLc === q) return 1000;
  if (labelLc.startsWith(q)) return 500 - item.label.length;
  if (labelLc.includes(q)) return 300 - item.label.length;
  if (haystack.includes(q)) return 100;
  const words = q.split(/\s+/).filter(Boolean);
  return words.every(w => haystack.includes(w)) ? 50 : 0;
};

const SearchPalette: React.FC<Props> = ({ isOpen, onClose, items, onSelect, placeholder }) => {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const results = useMemo(() => {
    if (!query.trim()) return items.slice(0, 12);
    return items
      .map(item => ({ item, score: scoreItem(item, query) }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 25)
      .map(({ item }) => item);
  }, [query, items]);

  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setActiveIndex(0);
      const id = window.setTimeout(() => inputRef.current?.focus(), 30);
      return () => window.clearTimeout(id);
    }
  }, [isOpen]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${activeIndex}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, results.length]);

  if (!isOpen) return null;

  const handleSelect = (item: SearchPaletteItem) => {
    onSelect(item);
    onClose();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIndex(i => Math.min(i + 1, Math.max(results.length - 1, 0))); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIndex(i => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (results[activeIndex]) handleSelect(results[activeIndex]); }
    else if (e.key === 'Escape') { e.preventDefault(); onClose(); }
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center pt-20 sm:pt-24 px-4 bg-black/50"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Search functions"
    >
      <div
        className="w-full max-w-xl bg-surface rounded-xl shadow-2xl border border-default overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center px-4 py-3 border-b border-default">
          <Icon name={IconName.Search} className="w-5 h-5 text-on-surface-secondary mr-3 flex-shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={placeholder ?? 'Search functions'}
            className="flex-1 bg-transparent text-on-surface placeholder:text-on-surface-secondary outline-none text-base"
          />
          <kbd className="hidden sm:inline-flex items-center px-1.5 py-0.5 text-[10px] font-mono text-on-surface-secondary border border-default rounded ml-2">ESC</kbd>
        </div>
        <ul ref={listRef} className="max-h-80 overflow-y-auto py-1">
          {results.length === 0 ? (
            <li className="px-4 py-6 text-sm text-center text-on-surface-secondary">No matches</li>
          ) : results.map((item, idx) => (
            <li key={item.id}>
              <button
                data-idx={idx}
                onMouseEnter={() => setActiveIndex(idx)}
                onClick={() => handleSelect(item)}
                className={`w-full flex items-center justify-between gap-3 text-left px-4 py-2.5 text-sm transition-colors ${
                  idx === activeIndex
                    ? 'bg-primary/10 text-primary'
                    : 'text-on-surface hover:bg-surface-elevated'
                }`}
              >
                <span className="font-medium truncate">{item.label}</span>
                <span className="text-xs text-on-surface-secondary truncate">{item.section}</span>
              </button>
            </li>
          ))}
        </ul>
        <div className="flex items-center justify-between px-4 py-2 text-[11px] text-on-surface-secondary border-t border-default bg-surface-elevated">
          <span>↑↓ navigate · ↵ open</span>
          <span>{results.length} result{results.length === 1 ? '' : 's'}</span>
        </div>
      </div>
    </div>
  );
};

export default SearchPalette;
