 

import * as React from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"

const tones = [
  {
    id: "professional",
    title: "Professional",
    description: "Formal and polished",
  },
  {
    id: "enthusiastic",
    title: "Enthusiastic",
    description: "Energetic and passionate",
  },
  {
    id: "concise",
    title: "Concise",
    description: "Short and to the point",
  },
  {
    id: "storytelling",
    title: "Storytelling",
    description: "Narrative and personal",
  },
]

interface ToneSelectionProps {
  className?: string;
  onSelect?: (tone: string) => void;
}

export function ToneSelection({ className, onSelect }: ToneSelectionProps) {
  const [selectedTone, setSelectedTone] = React.useState("professional")

  const handleToneChange = (value: string) => {
    setSelectedTone(value)
    onSelect?.(value)
  }

  return (
    <Card className={cn("w-full shadow-none border-border/50", className)}>
      <CardHeader className="py-4 px-6 border-b border-border/40">
        <CardTitle className="text-sm font-semibold text-foreground/90">
          Tone
        </CardTitle>
      </CardHeader>
      <CardContent className="p-6">
        <RadioGroup
          value={selectedTone}
          onValueChange={handleToneChange}
          className="grid grid-cols-1 md:grid-cols-2 gap-4"
        >
          {tones.map((tone) => (
            <div key={tone.id}>
              <RadioGroupItem
                value={tone.id}
                id={tone.id}
                className="peer sr-only"
              />
              <Label
                htmlFor={tone.id}
                className={cn(
                  "flex items-start gap-4 p-4 rounded-xl border border-border/40 cursor-pointer transition-all hover:bg-muted/30 peer-data-[state=checked]:border-foreground/20 peer-data-[state=checked]:bg-foreground/5",
                  "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                )}
              >
                <div className={cn(
                  "mt-1 shrink-0 flex h-4 w-4 items-center justify-center rounded-full border border-muted-foreground/30",
                  "peer-data-[state=checked]:border-foreground peer-data-[state=checked]:text-foreground"
                )}>
                  {selectedTone === tone.id && (
                    <div className="h-2 w-2 rounded-full bg-foreground" />
                  )}
                </div>
                <div className="space-y-1">
                  <p className="text-sm font-semibold leading-none text-foreground/90">
                    {tone.title}
                  </p>
                  <p className="text-xs text-muted-foreground/70">
                    {tone.description}
                  </p>
                </div>
              </Label>
            </div>
          ))}
        </RadioGroup>
      </CardContent>
    </Card>
  )
}
