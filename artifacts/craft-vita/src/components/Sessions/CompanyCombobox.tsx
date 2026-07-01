import * as React from "react";
import { Check, ChevronsUpDown, Pencil } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { COMPANIES } from "@/lib/companies";

interface CompanyComboboxProps {
  value: string;
  onChange: (value: string) => void;
  className?: string;
}

const OTHERS_VALUE = "__others__";

export function CompanyCombobox({
  value,
  onChange,
  className,
}: CompanyComboboxProps) {
  const [open, setOpen] = React.useState(false);
  const [manualMode, setManualMode] = React.useState(
    () => value.length > 0 && !COMPANIES.includes(value),
  );

  if (manualMode) {
    return (
      <div className={cn("flex gap-2", className)}>
        <Input
          autoFocus
          placeholder="Type company name…"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-11 rounded-xl bg-background border-border/80 focus:ring-primary/20 transition-all font-medium text-sm"
        />
        <Button
          type="button"
          variant="outline"
          className="h-11 rounded-xl px-3 shrink-0"
          onClick={() => {
            setManualMode(false);
            onChange("");
          }}
        >
          Choose from list
        </Button>
      </div>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn(
            "h-11 w-full justify-between rounded-xl bg-background border-border/80 font-medium text-sm",
            !value && "text-muted-foreground font-normal",
            className,
          )}
        >
          {value || "Select a company…"}
          <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0">
        <Command>
          <CommandInput placeholder="Search companies…" />
          <CommandList>
            <CommandEmpty>
              <button
                type="button"
                className="flex w-full items-center gap-2 px-2 py-1.5 text-sm rounded-sm hover:bg-accent hover:text-accent-foreground"
                onClick={() => {
                  setManualMode(true);
                  onChange("");
                  setOpen(false);
                }}
              >
                <Pencil className="h-4 w-4 opacity-60" />
                Not listed — type it manually
              </button>
            </CommandEmpty>
            <CommandGroup>
              {COMPANIES.map((company) => (
                <CommandItem
                  key={company}
                  value={company}
                  onSelect={() => {
                    onChange(company);
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn(
                      "h-4 w-4",
                      value === company ? "opacity-100" : "opacity-0",
                    )}
                  />
                  {company}
                </CommandItem>
              ))}
              <CommandItem
                key={OTHERS_VALUE}
                value="Others"
                onSelect={() => {
                  setManualMode(true);
                  onChange("");
                  setOpen(false);
                }}
              >
                <Pencil className="h-4 w-4 opacity-60" />
                Others — type manually
              </CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
