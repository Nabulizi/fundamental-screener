import type { Gloss } from '@/lib/explain/glosses';

// Presentational disclosure for one concept gloss. Native <details> — collapsed
// by default, accessible by default, zero client JS, valid in both server and
// client components. Neutral: states what a number means, never a verdict.
export default function Explain({ gloss }: { gloss: Gloss }) {
  return (
    <details className="explain">
      <summary>
        {gloss.term}
        <span className="explain-mark" aria-hidden="true">?</span>
      </summary>
      <div className="explain-body">
        <p>{gloss.define}</p>
        {gloss.read && <p>{gloss.read}</p>}
      </div>
    </details>
  );
}
