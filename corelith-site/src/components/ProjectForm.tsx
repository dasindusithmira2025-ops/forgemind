"use client";

import { useId, useRef, useState } from "react";
import {
  budgetBands,
  intakeSchema,
  projectStages,
  projectTypes,
  timelines,
  type IntakeInput,
} from "@/lib/intake";
import { site } from "@/content/site";
import { Arrow } from "@/components/primitives";

/**
 * Project intake, set as a specification sheet.
 *
 * Every row is a labelled line the way a drawing's title block is, which keeps
 * eight fields reading as one document rather than as eight questions. The
 * long-form field is the one that matters and is given the room to show it; the
 * selects exist so the first reply can be useful rather than a list of
 * questions back.
 */

type Status =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "sent" }
  | { kind: "failed"; message: string; fallbackEmail?: string };

const empty: IntakeInput = {
  name: "",
  email: "",
  company: "",
  projectType: "Not sure yet",
  stage: "An idea we are testing",
  timeline: "Exploring options",
  budget: "Not established yet",
  message: "",
  website: "",
};

export function ProjectForm() {
  const id = useId();
  const [values, setValues] = useState<IntakeInput>(empty);
  const [errors, setErrors] = useState<Partial<Record<keyof IntakeInput, string>>>({});
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const liveRegion = useRef<HTMLParagraphElement>(null);

  const set = <K extends keyof IntakeInput>(key: K, value: IntakeInput[K]) => {
    setValues((previous) => ({ ...previous, [key]: value }));
    if (errors[key]) setErrors((previous) => ({ ...previous, [key]: undefined }));
  };

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (status.kind === "sending") return;

    const parsed = intakeSchema.safeParse(values);
    if (!parsed.success) {
      const next: Partial<Record<keyof IntakeInput, string>> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as keyof IntakeInput;
        if (key && !next[key]) next[key] = issue.message;
      }
      setErrors(next);
      const first = Object.keys(next)[0];
      document.getElementById(`${id}-${first}`)?.focus();
      return;
    }

    setStatus({ kind: "sending" });
    const subject = `Project inquiry from ${parsed.data.name}`;
    const body = [
      `Name: ${parsed.data.name}`,
      `Email: ${parsed.data.email}`,
      parsed.data.company ? `Company: ${parsed.data.company}` : null,
      `Work type: ${parsed.data.projectType}`,
      `Stage: ${parsed.data.stage}`,
      `Timeline: ${parsed.data.timeline}`,
      `Budget: ${parsed.data.budget}`,
      "",
      parsed.data.message,
    ]
      .filter(Boolean)
      .join("\n");

    window.location.href = `mailto:${site.email.general}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    setStatus({ kind: "sent" });
    setValues(empty);
  };

  if (status.kind === "sent") {
    return (
      <div
        className="border p-8"
        style={{ borderColor: "var(--hair-strong)", backgroundColor: "var(--surface)" }}
      >
        <p className="mono text-[var(--ink-3)]">Received</p>
        <h2 className="mt-4 text-[length:var(--step-head)]">Your email draft is ready.</h2>
        <p className="mt-5 max-w-[52ch] text-[length:var(--step-lead)] leading-[1.5] text-[var(--ink-2)]">
          Send the draft from your mail app and someone who can actually answer the technical
          question will read it. If your mail app did not open, write to {site.email.general}.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      <div className="border-t" style={{ borderColor: "var(--hair-strong)" }}>
        <Row label="Your name" htmlFor={`${id}-name`} error={errors.name} index="01">
          <input
            id={`${id}-name`}
            name="name"
            className="field"
            autoComplete="name"
            value={values.name}
            aria-invalid={Boolean(errors.name)}
            aria-describedby={errors.name ? `${id}-name-error` : undefined}
            onChange={(event) => set("name", event.target.value)}
          />
        </Row>

        <Row label="Work email" htmlFor={`${id}-email`} error={errors.email} index="02">
          <input
            id={`${id}-email`}
            name="email"
            type="email"
            inputMode="email"
            className="field"
            autoComplete="email"
            value={values.email}
            aria-invalid={Boolean(errors.email)}
            aria-describedby={errors.email ? `${id}-email-error` : undefined}
            onChange={(event) => set("email", event.target.value)}
          />
        </Row>

        <Row label="Company" htmlFor={`${id}-company`} hint="Optional" index="03">
          <input
            id={`${id}-company`}
            name="company"
            className="field"
            autoComplete="organization"
            value={values.company}
            onChange={(event) => set("company", event.target.value)}
          />
        </Row>

        <Row label="What kind of work" htmlFor={`${id}-projectType`} index="04">
          <select
            id={`${id}-projectType`}
            name="projectType"
            className="field"
            value={values.projectType}
            onChange={(event) => set("projectType", event.target.value as IntakeInput["projectType"])}
          >
            {projectTypes.map((option) => (
              <option key={option}>{option}</option>
            ))}
          </select>
        </Row>

        <Row label="Where it stands" htmlFor={`${id}-stage`} index="05">
          <select
            id={`${id}-stage`}
            name="stage"
            className="field"
            value={values.stage}
            onChange={(event) => set("stage", event.target.value as IntakeInput["stage"])}
          >
            {projectStages.map((option) => (
              <option key={option}>{option}</option>
            ))}
          </select>
        </Row>

        <Row label="When you need it" htmlFor={`${id}-timeline`} index="06">
          <select
            id={`${id}-timeline`}
            name="timeline"
            className="field"
            value={values.timeline}
            onChange={(event) => set("timeline", event.target.value as IntakeInput["timeline"])}
          >
            {timelines.map((option) => (
              <option key={option}>{option}</option>
            ))}
          </select>
        </Row>

        <Row
          label="Budget"
          htmlFor={`${id}-budget`}
          hint="A range is enough. It changes what we propose, not whether we reply."
          index="07"
        >
          <select
            id={`${id}-budget`}
            name="budget"
            className="field"
            value={values.budget}
            onChange={(event) => set("budget", event.target.value as IntakeInput["budget"])}
          >
            {budgetBands.map((option) => (
              <option key={option}>{option}</option>
            ))}
          </select>
        </Row>

        <Row
          label="What are you trying to build"
          htmlFor={`${id}-message`}
          hint="The problem, not the solution, if you can. Constraints are useful."
          error={errors.message}
          index="08"
        >
          <textarea
            id={`${id}-message`}
            name="message"
            rows={8}
            className="field resize-y"
            value={values.message}
            aria-invalid={Boolean(errors.message)}
            aria-describedby={errors.message ? `${id}-message-error` : undefined}
            onChange={(event) => set("message", event.target.value)}
          />
        </Row>
      </div>

      {/* Not display:none — some bots fill only what they can see is hidden by
          that one property. Off-canvas, unfocusable, and hidden from AT. */}
      <div
        aria-hidden="true"
        className="absolute h-px w-px overflow-hidden"
        style={{ left: "-9999px" }}
      >
        <label htmlFor={`${id}-website`}>Website</label>
        <input
          id={`${id}-website`}
          name="website"
          tabIndex={-1}
          autoComplete="off"
          value={values.website}
          onChange={(event) => set("website", event.target.value)}
        />
      </div>

      <div className="mt-10 flex flex-wrap items-center gap-5">
        <button type="submit" className="btn btn-primary" disabled={status.kind === "sending"}>
          {status.kind === "sending" ? "Preparing…" : "Prepare email"}
          {status.kind === "sending" ? null : <Arrow />}
        </button>
        <p className="mono-plain max-w-[38ch] text-[var(--ink-3)]">
          We reply to everything. No mailing list, no follow-up sequence.
        </p>
      </div>

      <p ref={liveRegion} role="status" aria-live="polite" className="mt-6">
        {status.kind === "failed" ? (
          <span className="block max-w-[56ch] text-[15px] leading-[1.55] text-[var(--accent)]">
            {status.message}
            {status.fallbackEmail ? (
              <>
                {" "}
                <a href={`mailto:${status.fallbackEmail}`} className="link">
                  {status.fallbackEmail}
                </a>
              </>
            ) : null}
          </span>
        ) : null}
      </p>
    </form>
  );
}

function Row({
  label,
  htmlFor,
  hint,
  error,
  index,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  error?: string;
  index: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className="grid grid-cols-1 gap-x-10 gap-y-3 border-b py-6 md:grid-cols-12"
      style={{ borderColor: "var(--hair)" }}
    >
      <div className="md:col-span-4">
        <div className="flex items-baseline gap-3">
          <span className="mono text-[var(--ink-3)]">{index}</span>
          <label htmlFor={htmlFor} className="text-[16px] font-medium text-[var(--ink)]">
            {label}
          </label>
        </div>
        {hint ? (
          <p className="mt-2 max-w-[30ch] pl-8 text-[14px] leading-[1.5] text-[var(--ink-3)]">
            {hint}
          </p>
        ) : null}
      </div>
      <div className="md:col-span-8">
        {children}
        {error ? (
          <p id={`${htmlFor}-error`} className="mt-2 text-[14px] text-[var(--accent)]">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}
