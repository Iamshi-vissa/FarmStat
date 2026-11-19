import { Fragment } from 'react';
import './BlurText.css';

// Ported from React Bits BlurText (David Haz, MIT + Commons Clause; see LICENSE.md): the words come into focus one
// after another. FarmStat changes: a CSS animation instead of the `motion` library, run once when the text appears
// (give it a new `key` to run again); screen readers get the whole sentence, and reduced motion shows it at once.
export default function BlurText({ text, as: Tag = 'span', className = '', stagger = 60 }) {
  const words = String(text).split(' ');
  return (
    <Tag className={`blur-text ${className}`.trim()} aria-label={text}>
      {words.map((w, i) => (
        <Fragment key={i}>
          <span className="blur-text__word" style={{ animationDelay: `${i * stagger}ms` }} aria-hidden="true">{w}</span>
          {i < words.length - 1 ? ' ' : null}
        </Fragment>
      ))}
    </Tag>
  );
}
