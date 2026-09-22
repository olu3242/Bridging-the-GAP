"use client";
import { useState } from "react";

const FAQS = [
  {
    question: "Who is BTG AI actually for?",
    answer:
      "BTG AI is built primarily for Nigerian university students who want practical, usable AI skills — whatever they're studying. You don't need a computer science background to start; you need curiosity and a willingness to build.",
  },
  {
    question: "Do I need to know how to code?",
    answer:
      "No. Your path starts from a diagnostic, not an assumption. Non-technical tracks focus on applying AI to research, writing, analysis, and business problems. If you want to go deeper, a technical track covering programming and applied AI development is there when you're ready.",
  },
  {
    question: 'How is a "verified skill" different from a certificate?',
    answer:
      "A verified skill is tied to evidence — a submission, a project, a reviewed piece of work — not just to finishing a video or passing a quiz. Mentors and reviewers sign off on it, so it means something to the person reading your portfolio.",
  },
  {
    question: "Is BTG AI free to use?",
    answer:
      "Core learning paths are free to get started. Sponsored access is available through participating universities and programs, and premium tracks and credentials exist for learners who want to go further.",
  },
  {
    question: "Can my university or organization partner with BTG AI?",
    answer:
      "Yes. Universities, employers, and sponsor organizations can all work with BTG AI — from sponsoring a cohort to contributing real challenges. Reach out through the contact details in the footer and we'll take it from there.",
  },
  {
    question: "How does BTG AI use my data and my work?",
    answer:
      "You control what's visible on your portfolio and to whom — private, institution-visible, partner-visible, or public. We only collect what's needed to personalize your learning and never share your work without your say-so.",
  },
];

/**
 * Single-open accordion, matching js/script.js: opening one item closes any
 * other. The panel height is a stylesheet concern rather than a measured DOM
 * value, so the canonical 0.25s ease transition survives without JS reaching
 * into layout.
 */
export function Faq() {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  return (
    <section className="section section-tint" id="faq">
      <div className="wrap wrap-narrow">
        <div className="section-head">
          <h2>Questions, answered</h2>
          <p>Can&apos;t find what you&apos;re looking for? Reach out — we&apos;re happy to walk through it.</p>
        </div>

        <div className="faq-list">
          {FAQS.map((faq, index) => {
            const isOpen = openIndex === index;
            return (
              <div className={`faq-item${isOpen ? " is-open" : ""}`} key={faq.question}>
                <button
                  className="faq-question"
                  aria-expanded={isOpen}
                  aria-controls={`faq-answer-${index}`}
                  id={`faq-question-${index}`}
                  onClick={() => setOpenIndex(isOpen ? null : index)}
                >
                  {faq.question}
                  <span className="faq-icon" aria-hidden="true" />
                </button>
                <div
                  className="faq-answer"
                  id={`faq-answer-${index}`}
                  role="region"
                  aria-labelledby={`faq-question-${index}`}
                >
                  <p>{faq.answer}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
