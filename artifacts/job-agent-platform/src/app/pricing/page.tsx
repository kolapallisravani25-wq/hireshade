import { formatMoney, plans, type Currency } from "@/lib/billing/pricing";

const currencies: Currency[] = ["INR", "USD", "EUR"];

export default function PricingPage() {
  return (
    <section className="page-section">
      <h1>Pricing</h1>
      <p>Regional fixed pricing; credits are charged only for confirmed successful submissions.</p>
      <div className="pricing-grid">
        {plans.map((plan) => (
          <article className="plan" key={plan.id}>
            <h2>{plan.name}</h2>
            <p>{plan.credits} confirmed-application credits per month</p>
            <ul>
              {currencies.map((currency) => (
                <li key={currency}>{formatMoney(plan.monthly[currency], currency)} / month</li>
              ))}
            </ul>
          </article>
        ))}
      </div>
    </section>
  );
}
