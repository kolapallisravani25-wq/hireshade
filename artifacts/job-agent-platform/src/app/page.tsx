import Link from "next/link";

export default function HomePage() {
  return (
    <section className="hero">
      <div>
        <h1>Apply with evidence, not guesswork.</h1>
        <p>
          Discover suitable roles, verify vacancies, tailor truthful resumes, submit through supported channels,
          and track every response in one accessible workspace.
        </p>
        <div className="actions">
          <Link className="button" href="/pricing">View plans</Link>
          <a className="button secondary" href="mailto:support@example.com">Request pilot access</a>
        </div>
      </div>
      <dl className="proof" aria-label="Product safeguards">
        <div><dt>Vacancy trust</dt><dd>Checked before auto-apply</dd></div>
        <div><dt>Resume truth</dt><dd>Verified facts remain locked</dd></div>
        <div><dt>Automation</dt><dd>Time-boxed and stoppable</dd></div>
      </dl>
    </section>
  );
}
