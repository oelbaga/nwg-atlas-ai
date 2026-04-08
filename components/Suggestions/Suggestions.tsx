"use client";

import { useState } from "react";
import styles from "./Suggestions.module.scss";

interface SuggestionsProps {
  onSelect: (text: string) => void;
}

// One question template per slot — applied to clients in order
const TEMPLATES = [
  (c: string) => `How many leads did ${c} get in the last 7 days?`,
  (c: string) => `Show me the last 10 leads for ${c}`,
  (c: string) => `How much traffic did ${c} receive last 7 days?`,
  (c: string) => `How many leads did ${c} get this month?`,
  (c: string) => `Did john@example.com submit a lead for ${c}?`,
  (c: string) => `Show me leads by source for ${c} this month`,
];

const FALLBACK_CLIENTS = [
  "Aviva",
  "Hudson House",
  "505 Summit",
  "Southend Lofts",
  "Lia By Vermella",
  "The Alary",
];

export default function Suggestions({ onSelect }: SuggestionsProps) {
  const [suggestions, setSuggestions] = useState<string[]>(() =>
    FALLBACK_CLIENTS.map((c, i) => TEMPLATES[i](c)),
  );

  return (
    <div className={styles.wrapper}>
      <div className={styles.intro}>
        <div className={styles.iconWrap}>
          <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
            <rect
              width="28"
              height="28"
              rx="8"
              fill="var(--accent)"
              opacity="0.12"
            />
            <path
              d="M14 6v16M6 14h16"
              stroke="var(--accent)"
              strokeWidth="2"
              strokeLinecap="round"
              opacity="0"
            />
            <path
              d="M8 10l4 4-4 4M13 18h7"
              stroke="var(--accent)"
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
        <h2 className={styles.heading}>What would you like to know?</h2>
        <p className={styles.sub}>
          Ask about leads or traffic for any client website. Try one
          of&nbsp;these:
        </p>
      </div>
      <div className={styles.grid}>
        {suggestions.map((text) => (
          <button
            key={text}
            className={styles.chip}
            onClick={() => onSelect(text)}
          >
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}
