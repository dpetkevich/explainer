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
        foundational: z.boolean().optional(),
      })
    )
    .min(1),
});
export type ConceptMap = z.infer<typeof ConceptMapSchema>;

export const StoryboardSceneSchema = z.object({
  id: kebab,
  conceptId: kebab,
  /** Part (section) title this scene belongs to — must match an entry in Storyboard.parts. */
  part: z.string().min(1).optional(),
  title: notSectionName("scene title"),
  teaches: z.string().min(1),
  requires: z.array(kebab),
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

export const StoryboardSchema = z
  .object({
    title: z.string().min(1),
    hook: z.string().min(1),
    /** Ordered sections; each has a one-line lede explaining what it builds on. */
    parts: z
      .array(z.object({ title: z.string().min(1), lede: z.string().min(1) }))
      .optional(),
    scenes: z.array(StoryboardSceneSchema).min(1),
  })
  .superRefine((board, ctx) => {
    // The ramp invariant: a scene may only build on scenes that come before it.
    const earlier = new Set<string>();
    board.scenes.forEach((scene, i) => {
      for (const req of scene.requires) {
        if (!earlier.has(req)) {
          ctx.addIssue({
            code: "custom",
            path: ["scenes", i, "requires"],
            message: `scene "${scene.id}" requires "${req}", which is not an earlier scene`,
          });
        }
      }
      earlier.add(scene.id);
    });
    // Part invariants: every scene.part exists, and scenes appear grouped in part order.
    if (board.parts) {
      const order = new Map(board.parts.map((p, i) => [p.title, i]));
      let last = -1;
      board.scenes.forEach((scene, i) => {
        if (scene.part === undefined) return;
        const idx = order.get(scene.part);
        if (idx === undefined) {
          ctx.addIssue({
            code: "custom",
            path: ["scenes", i, "part"],
            message: `scene "${scene.id}" names unknown part "${scene.part}"`,
          });
          return;
        }
        if (idx < last) {
          ctx.addIssue({
            code: "custom",
            path: ["scenes", i, "part"],
            message: `scene "${scene.id}" is out of part order — scenes must be grouped by part`,
          });
        }
        last = idx;
      });
    }
  });
export type Storyboard = z.infer<typeof StoryboardSchema>;

export const QaReportSchema = z.object({
  pass: z.boolean(),
  failures: z.array(
    z.object({
      kind: z.enum(["layout", "physics", "readability", "interaction", "comprehension"]),
      detail: z.string(),
    })
  ),
});
export type QaReport = z.infer<typeof QaReportSchema>;

export const EndorsementSchema = z.object({
  name: z.string().min(1),
  title: z.string().min(1),
  affiliation: z.string().min(1),
  /** Public identity the reader can check (homepage, Scholar, X, …). */
  link: z.string().url(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD"),
  /** Optional one-line quote from the endorser. */
  note: z.string().optional(),
});
export const EndorsementsSchema = z.array(EndorsementSchema);
export type Endorsement = z.infer<typeof EndorsementSchema>;

export const PaperMetaSchema = z.object({
  title: z.string().min(1),
  authors: z.array(z.string()),
  oneSentenceClaim: z.string().min(1),
  /** Source of the paper (arXiv URL, article URL, …). */
  source: z.string().min(1),
  /** GitHub org hosting this explanation repo (used to fetch release bundles). */
  org: z.string().min(1),
  slug: z.string().min(1),
  audienceName: z.string().min(1),
  tool: z.object({ repo: z.string(), ref: z.string() }),
});
export type PaperMeta = z.infer<typeof PaperMetaSchema>;

export const AudienceProfileSchema = z.object({
  background: z.string(),
  assumeKnown: z.array(z.string()),
  doNotAssume: z.array(z.string()),
  tone: z.string(),
});
export type AudienceProfile = z.infer<typeof AudienceProfileSchema>;
