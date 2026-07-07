import { z } from "zod";

const kebab = z
  .string()
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "must be a kebab-case slug");

// Scenes/concepts named after paper sections are a hard failure per spec:
// the tool extracts ideas, never document structure.
const SECTION_NAMES =
  /^(introduction|background|methods?|methodology|results?|discussion|conclusions?|abstract|executive summary|summary|references|appendix|the funding round|overview)$/i;

const notSectionName = (label: string) =>
  z.string().min(1).refine((s) => !SECTION_NAMES.test(s.trim()), {
    message: `${label} is named after a document section — name the idea, not the structure`,
  });

export const ConceptMapSchema = z.object({
  paper: z.object({
    title: z.string().min(1),
    authors: z.array(z.string()),
    oneSentenceClaim: z.string().min(1),
  }),
  prerequisites: z.array(z.string()),
  concepts: z
    .array(
      z.object({
        id: kebab,
        name: notSectionName("concept name"),
        whyItMatters: z.string().min(1),
        coreMechanism: z.string().min(1),
        keyEquation: z.string().optional(),
        keyFigureRef: z.string().optional(),
        misconception: z.string().optional(),
      })
    )
    .min(1),
});
export type ConceptMap = z.infer<typeof ConceptMapSchema>;

export const StoryboardSceneSchema = z.object({
  id: kebab,
  conceptId: kebab,
  title: notSectionName("scene title"),
  caption: z.string().min(1),
  visualMetaphor: z.string().min(1),
  animatedVariable: z.object({
    name: z.string().min(1),
    control: z.enum(["slider", "buttons", "toggle", "play-pause"]),
    range: z.string().min(1),
    whatChangesOnScreen: z.string().min(1),
  }),
  quantitativeAnchor: z.string().optional(),
  physicsChecks: z.array(z.string().min(1)).min(1),
});
export type StoryboardScene = z.infer<typeof StoryboardSceneSchema>;

export const StoryboardSchema = z.object({
  title: z.string().min(1),
  hook: z.string().min(1),
  scenes: z.array(StoryboardSceneSchema).min(1),
});
export type Storyboard = z.infer<typeof StoryboardSchema>;

export const QaReportSchema = z.object({
  pass: z.boolean(),
  failures: z.array(
    z.object({
      kind: z.enum(["layout", "physics", "readability", "interaction"]),
      detail: z.string(),
    })
  ),
});
export type QaReport = z.infer<typeof QaReportSchema>;

export const AudienceProfileSchema = z.object({
  background: z.string(),
  assumeKnown: z.array(z.string()),
  doNotAssume: z.array(z.string()),
  tone: z.string(),
});
export type AudienceProfile = z.infer<typeof AudienceProfileSchema>;
