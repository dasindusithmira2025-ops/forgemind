import { z } from "zod";

/**
 * The project intake contract, defined once and used on both sides.
 *
 * The client uses it to give immediate field-level feedback. The server uses it
 * as the actual gate — client validation is a convenience and is never trusted,
 * so every field is re-checked and length-capped before anything is done with
 * it.
 */

export const projectTypes = [
  "Product engineering",
  "AI systems",
  "Automation",
  "Experience engineering",
  "Infrastructure",
  "Technology strategy",
  "Not sure yet",
] as const;

export const projectStages = [
  "An idea we are testing",
  "Specified, not started",
  "In progress",
  "Live and needs work",
] as const;

export const timelines = [
  "As soon as possible",
  "Within a quarter",
  "This year",
  "Exploring options",
] as const;

export const budgetBands = [
  "Not established yet",
  "Under $25k",
  "$25k – $75k",
  "$75k – $200k",
  "Over $200k",
] as const;

export const intakeSchema = z.object({
  name: z.string().trim().min(2, "Tell us who you are.").max(120),
  email: z.string().trim().email("That email address does not look right.").max(200),
  company: z.string().trim().max(160).optional().or(z.literal("")),
  projectType: z.enum(projectTypes),
  stage: z.enum(projectStages),
  timeline: z.enum(timelines),
  budget: z.enum(budgetBands),
  message: z
    .string()
    .trim()
    .min(30, "Give us at least a couple of sentences — it saves a round trip.")
    .max(4000, "Keep it under 4000 characters; we can go deeper on a call."),
  // Never shown, never focusable. A filled value means a script filled it.
  website: z.string().max(0).optional().or(z.literal("")),
});

export type IntakeInput = z.infer<typeof intakeSchema>;

/** Anything larger than this is rejected before the body is parsed at all. */
export const MAX_INTAKE_BYTES = 16 * 1024;
