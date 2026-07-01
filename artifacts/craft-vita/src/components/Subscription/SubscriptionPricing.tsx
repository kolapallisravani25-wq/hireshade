 ;

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Check, RotateCcw, TimerOff, Link, ArrowRight } from "lucide-react";

type SubscriptionPlan = {
  title: string;
  price: string;
  period: string;
  features: string[];
  isPopular?: boolean;
  buttonText: string;
  gradient?: string;
};

const plans: SubscriptionPlan[] = [
  {
    title: "Starter",
    price: "₹1,999",
    period: "/month",
    features: [
      "Live: 3 hours (6×30-min max)",
      "Resume/JD Analyses: 10",
      "Cover Letters: 5",
      "Question Sets from JD: 10",
      "Detailed Feedback Reports: 3",
      "Stored Interviews: 5",
      "Analytics Level: Basic",
    ],
    buttonText: "Get Started",
  },
  {
    title: "Plus",
    price: "₹4,499",
    period: "/month",
    isPopular: true,
    features: [
      "Live: 8 hours (16×30-min max)",
      "Resume/JD Analyses: 30",
      "Cover Letters: 15",
      "Question Sets from JD: 25",
      "Detailed Feedback Reports: 8",
      "Stored Interviews: 20",
      "Analytics Level: Intermediate",
    ],
    buttonText: "Upgrade to Plus",
    gradient: "from-brand to-brand-hover",
  },
  {
    title: "Pro",
    price: "₹6,999",
    period: "/month",
    features: [
      "Live: 15 hours (30×30-min max)",
      "Resume/JD Analyses: 50",
      "Cover Letters: 25",
      "Question Sets from JD: 50",
      "Detailed Feedback Reports: 15",
      "Stored Interviews: 50",
      "Analytics Level: Advanced + exports",
    ],
    buttonText: "Go Pro",
  },
];

function PricingCard({ plan }: { plan: SubscriptionPlan }) {
  return (
    <div
      className={cn(
        "relative flex flex-col p-8 rounded-xl transition-all duration-500 h-full group overflow-hidden cursor-default",
        plan.isPopular
          ? "text-white shadow-glow-lg scale-105 z-10 border border-white/20 hover:scale-[1.08] hover:shadow-[0_30px_70px_-10px_rgba(69,143,255,0.4)]"
          : "bg-brand-muted/30 dark:bg-card/50 backdrop-blur-md border border-brand/10 text-foreground hover:border-brand/30 hover:shadow-glow hover:scale-[1.04] hover:-translate-y-2",
      )}
      style={
        plan.isPopular
          ? {
              background: "linear-gradient(to right, #458fff, #004680)",
            }
          : {}
      }
    >
      {/* Shimmer Effect */}
      <div className="absolute inset-0 -translate-x-full group-hover:translate-x-full transition-transform duration-1000 bg-linear-to-r from-transparent via-white/10 to-transparent skew-x-[-20deg]" />

      {/* Popular Badge */}
      {/* {plan.isPopular && (
        <div className="absolute -top-4 left-1/2 -translate-x-1/2 bg-white text-brand px-4 py-1.5 rounded-full text-xs font-bold flex items-center gap-1.5 shadow-lg whitespace-nowrap group-hover:scale-110 transition-transform duration-500 z-20">
          <Sparkles className="w-3.5 h-3.5" />
          MOST POPULAR
        </div>
      )} */}

      {/* Header */}
      <div className="mb-8 relative z-10">
        <h3
          className={cn(
            "text-xl font-bold mb-2 transition-colors",
            plan.isPopular ? "text-white" : "text-brand-text dark:text-brand",
          )}
        >
          {plan.title}
        </h3>
        <div className="flex items-baseline gap-1">
          <span className="text-4xl font-extrabold tracking-tight">
            {plan.price}
          </span>
          <span
            className={cn(
              "text-sm font-medium opacity-70",
              plan.isPopular ? "text-white" : "text-muted-foreground",
            )}
          >
            {plan.period}
          </span>
        </div>
      </div>

      {/* Features */}
      <div className="grow space-y-4 mb-10 relative z-10">
        {plan.features.map((feature, i) => (
          <div key={i} className="flex items-start gap-3 group/item text-sm">
            <div
              className={cn(
                "mt-0.5 rounded-full p-0.5 shrink-0 transition-transform duration-300 group-hover/item:scale-125",
                plan.isPopular
                  ? "bg-white/20 text-white"
                  : "bg-brand/10 text-brand",
              )}
            >
              <Check className="w-3.5 h-3.5" />
            </div>
            <span
              className={cn(
                "leading-relaxed transition-colors",
                plan.isPopular
                  ? "text-white/90"
                  : "text-foreground/80 group-hover:text-foreground",
              )}
            >
              {feature}
            </span>
          </div>
        ))}
      </div>

      {/* CTA */}
      <div className="mt-auto relative z-10">
        <Button
          className={cn(
            "w-full h-12 rounded-lg text-base font-bold transition-all duration-300 transform active:scale-95 cursor-pointer shadow-md",
            plan.isPopular
              ? "bg-white text-brand hover:bg-gray-50 hover:shadow-xl hover:scale-[1.02]"
              : "text-white hover:opacity-90 shadow-glow hover:scale-[1.02]",
          )}
          style={
            !plan.isPopular
              ? {
                  background: "linear-gradient(to right, #458fff, #004680)",
                }
              : {}
          }
        >
          {plan.buttonText}
        </Button>
      </div>
    </div>
  );
}

export function SubscriptionPricing() {
  return (
    <div className="w-full py-12">
      <div className="text-center mb-16">
        {/* Trust Bar */}
        <div className="flex flex-wrap items-center justify-center gap-4 md:gap-8 py-3 px-6 md:px-10 bg-brand-muted/30 dark:bg-white/5 rounded-full border border-brand/10 max-w-fit mx-auto mb-16 text-[13px] md:text-sm font-medium text-foreground/70 shadow-sm backdrop-blur-sm">
          <div className="flex items-center gap-2.5">
            <RotateCcw className="w-4 h-4 text-brand" />
            <span>30-Day Money Back</span>
          </div>
          <div className="hidden md:block w-px h-4 bg-brand/10" />
          <div className="flex items-center gap-2.5">
            <TimerOff className="w-4 h-4 text-brand" />
            <span>Credits Never Expire</span>
          </div>
          <div className="hidden md:block w-px h-4 bg-brand/10" />
          <div className="flex items-center gap-2.5 group cursor-default">
            <Link className="w-4 h-4 text-brand" />
            <span>1 Credit = 1h Call</span>
            <ArrowRight className="w-3.5 h-3.5 ml-0.5 group-hover:translate-x-1 transition-transform" />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-7xl mx-auto px-4">
        {plans.map((plan) => (
          <PricingCard key={plan.title} plan={plan} />
        ))}
      </div>
    </div>
  );
}
