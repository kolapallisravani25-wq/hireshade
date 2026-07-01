import { useMemo, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { COMPANIES } from "@/lib/companies";
import { cn } from "@/lib/utils";

interface Props {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}

/**
 * Lightweight company autosuggest for the compact launcher widget.
 * Unlike CompanyCombobox (web), the field stays a free-text input the whole
 * time — the dropdown is purely an assist, so there's no separate
 * "manual entry" mode to fall back into.
 */
export function CompanyAutocomplete({ value, onChange, placeholder, className }: Props) {
  const [open, setOpen] = useState(false);
  const blurTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const suggestions = useMemo(() => {
    const q = value.trim().toLowerCase();
    if (!q) return [];
    return COMPANIES.filter((c) => c.toLowerCase().includes(q)).slice(0, 6);
  }, [value]);

  return (
    <div className="relative">
      <Input
        placeholder={placeholder}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          // Delay so a click on a suggestion registers before the list unmounts.
          blurTimeoutRef.current = setTimeout(() => setOpen(false), 120);
        }}
        className={className}
        autoComplete="off"
      />
      {open && suggestions.length > 0 && (
        <div className="absolute z-50 mt-1 w-full max-h-[160px] overflow-y-auto rounded-xl border border-zinc-200 bg-white shadow-lg py-1">
          {suggestions.map((company) => (
            <button
              key={company}
              type="button"
              onMouseDown={(e) => {
                // Prevent the input's onBlur from closing the list before this fires.
                e.preventDefault();
                clearTimeout(blurTimeoutRef.current);
                onChange(company);
                setOpen(false);
              }}
              className={cn(
                "w-full text-left px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50 transition-colors",
              )}
            >
              {company}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
