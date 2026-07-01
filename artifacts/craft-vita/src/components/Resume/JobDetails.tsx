 

import * as React from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"

interface JobDetailsProps {
  className?: string;
  onChange?: (details: { role: string; company: string; description: string }) => void;
}

export function JobDetails({ className, onChange }: JobDetailsProps) {
  const [role, setRole] = React.useState("")
  const [company, setCompany] = React.useState("")
  const [description, setDescription] = React.useState("")

  React.useEffect(() => {
    onChange?.({ role, company, description })
  }, [role, company, description, onChange])

  return (
    <Card className={cn("w-full shadow-none border-border/50", className)}>
      <CardHeader className="py-4 px-6 border-b border-border/40">
        <CardTitle className="text-sm font-semibold text-foreground/90">
          Job Details
        </CardTitle>
      </CardHeader>
      <CardContent className="p-6 space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-2">
            <Label htmlFor="job-role" className="text-xs font-medium text-muted-foreground/80">
              Job Role
            </Label>
            <Input
              id="job-role"
              placeholder="e.g. Senior Frontend Engineer"
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="h-11 rounded-xl bg-muted/30 border-border/40 focus:bg-background transition-all"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="company" className="text-xs font-medium text-muted-foreground/80">
              Company
            </Label>
            <Input
              id="company"
              placeholder="e.g. Stripe"
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              className="h-11 rounded-xl bg-muted/30 border-border/40 focus:bg-background transition-all"
            />
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="job-description" className="text-xs font-medium text-muted-foreground/80">
            Job Description <span className="text-muted-foreground/50 font-normal">(optional)</span>
          </Label>
          <Textarea
            id="job-description"
            placeholder="Paste the job description for a more tailored letter..."
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="min-h-[120px] rounded-xl bg-muted/30 border-border/40 focus:bg-background transition-all resize-none"
          />
        </div>
      </CardContent>
    </Card>
  )
}
