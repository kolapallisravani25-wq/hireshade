import {
  Mail,
  MessageCircle,
  FileQuestion,
  ExternalLink,
  Clock,
  CheckCircle2,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

const faqs = [
  {
    q: "How do credits work?",
    a: "Credits are consumed when you use AI features like live interview assistance, resume tailoring, and ATS analysis. You can top up anytime from the Credits page — they never expire.",
  },
  {
    q: "Can I use HireShade on any browser?",
    a: "Yes. The web app works on any modern browser (Chrome, Firefox, Edge, Safari). For live interview overlay features with global shortcuts, download the desktop app.",
  },
  {
    q: "What happens if I run out of credits mid-session?",
    a: "Your active session continues, but AI responses will pause until you top up. Your transcript and session data are never lost.",
  },
  {
    q: "How do I upload and use my resume?",
    a: "Go to Resume → Upload, then upload a PDF or DOCX file. Once uploaded, you can attach it to any interview session so HireShade generates personalised answers.",
  },
  {
    q: "Is my data private?",
    a: "Yes. Your transcripts, resumes, and session data are stored securely and are only accessible to you. We never share your data with third parties.",
  },
  {
    q: "How do I cancel or change my plan?",
    a: "HireShade uses one-time credit packs — there are no recurring subscriptions to cancel. Simply don't purchase more credits when you run out.",
  },
];

export default function Support() {
  return (
    <div className="space-y-8 animate-in fade-in duration-500 pb-10 max-w-5xl">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Support</h1>
        <p className="mt-1 text-muted-foreground text-sm">
          We're here to help. Reach out or browse common questions below.
        </p>
      </div>

      {/* Contact cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card className="border-border/50 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base font-semibold">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand/10 text-brand">
                <Mail className="h-4 w-4" />
              </div>
              Email Support
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Send us an email and we'll get back to you within one business day.
            </p>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Clock className="h-3.5 w-3.5" />
              Response within 24 hours
            </div>
            <Button
              variant="outline"
              size="sm"
              className="w-full mt-1"
              onClick={() => window.open("mailto:support@hireshade.org", "_blank")}
            >
              <Mail className="h-3.5 w-3.5 mr-2" />
              support@hireshade.org
            </Button>
          </CardContent>
        </Card>

        <Card className="border-border/50 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base font-semibold">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-100 text-violet-600">
                <MessageCircle className="h-4 w-4" />
              </div>
              Community
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Join our Discord community to ask questions, share tips, and connect with other users.
            </p>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
              Active community
            </div>
            <Button
              variant="outline"
              size="sm"
              className="w-full mt-1"
              onClick={() => window.open("https://discord.gg/hireshade", "_blank")}
            >
              <ExternalLink className="h-3.5 w-3.5 mr-2" />
              Join Discord
            </Button>
          </CardContent>
        </Card>

        <Card className="border-border/50 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base font-semibold">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-100 text-amber-600">
                <FileQuestion className="h-4 w-4" />
              </div>
              Report a Bug
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Found something that's not working? Let us know and we'll prioritise a fix.
            </p>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Clock className="h-3.5 w-3.5" />
              Investigated within 48 hours
            </div>
            <Button
              variant="outline"
              size="sm"
              className="w-full mt-1"
              onClick={() => window.open("mailto:bugs@hireshade.org?subject=Bug Report", "_blank")}
            >
              <Mail className="h-3.5 w-3.5 mr-2" />
              bugs@hireshade.org
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* FAQ */}
      <div>
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Frequently Asked Questions</h2>
        <div className="space-y-3">
          {faqs.map((faq, i) => (
            <Card key={i} className="border-border/50 shadow-sm">
              <CardContent className="py-4 px-5">
                <p className="text-sm font-semibold text-gray-900 mb-1">{faq.q}</p>
                <p className="text-sm text-muted-foreground leading-relaxed">{faq.a}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
