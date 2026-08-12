import { Check, ChevronDown, Search } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';

export interface SelectOption {
  value: string;
  label: string;
}

interface SelectMenuProps {
  label: string;
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  searchable?: boolean;
  searchPlaceholder?: string;
  className?: string;
  compact?: boolean;
}

export function SelectMenu({
  label,
  value,
  options,
  onChange,
  searchable = false,
  searchPlaceholder = '搜索',
  className = '',
  compact = false,
}: SelectMenuProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const selected = options.find((option) => option.value === value) ?? options[0];
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle
      ? options.filter((option) => option.label.toLowerCase().includes(needle))
      : options;
  }, [options, query]);

  useEffect(() => {
    if (!open) return;
    const selectedIndex = filtered.findIndex((option) => option.value === value);
    setActiveIndex(Math.max(0, selectedIndex));
    if (searchable) requestAnimationFrame(() => searchRef.current?.focus());

    const closeOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', closeOutside);
    return () => document.removeEventListener('pointerdown', closeOutside);
  }, [open, searchable]);

  useEffect(() => {
    setActiveIndex((index) => Math.min(index, Math.max(0, filtered.length - 1)));
  }, [filtered.length]);

  const choose = (next: string) => {
    onChange(next);
    setOpen(false);
    setQuery('');
    requestAnimationFrame(() => rootRef.current?.querySelector<HTMLButtonElement>('.select-menu-trigger')?.focus());
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape' && open) {
      event.preventDefault();
      setOpen(false);
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      const direction = event.key === 'ArrowDown' ? 1 : -1;
      setActiveIndex((index) => Math.max(0, Math.min(filtered.length - 1, index + direction)));
      return;
    }
    if (event.key === 'Enter' && open && filtered[activeIndex]) {
      event.preventDefault();
      choose(filtered[activeIndex]!.value);
    }
  };

  return (
    <div
      className={`select-menu${open ? ' open' : ''}${compact ? ' compact' : ''}${className ? ` ${className}` : ''}`}
      ref={rootRef}
      onKeyDown={onKeyDown}
    >
      <button
        type="button"
        className="select-menu-trigger"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => {
          setOpen((current) => !current);
          setQuery('');
        }}
      >
        <span>{selected?.label ?? label}</span>
        <ChevronDown size={14} />
      </button>

      {open && (
        <div className="select-menu-popover">
          {searchable && (
            <div className="select-menu-search">
              <Search size={13} />
              <input
                ref={searchRef}
                value={query}
                placeholder={searchPlaceholder}
                aria-label={searchPlaceholder}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setActiveIndex(0);
                }}
              />
            </div>
          )}
          <div className="select-menu-options" id={listId} role="listbox" aria-label={label}>
            {filtered.map((option, index) => (
              <button
                type="button"
                role="option"
                aria-selected={option.value === value}
                className={`${option.value === value ? 'selected' : ''}${index === activeIndex ? ' active' : ''}`}
                key={option.value || '__all'}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => choose(option.value)}
              >
                <span>{option.label}</span>
                {option.value === value && <Check size={14} />}
              </button>
            ))}
            {!filtered.length && <div className="select-menu-empty">没有匹配项</div>}
          </div>
        </div>
      )}
    </div>
  );
}
