// Structured-output schema for the extractor (mvp.md §5 step 3 / §13).
// One source-of-truth shape, expressed twice:
//   - extractionJsonSchema: raw JSON Schema sent to the API via output_config.format
//     (kept within structured-output limits: additionalProperties:false, required,
//      no min/max/length constraints).
//   - ExtractionResultZ: Zod schema used to validate every model response.
// Missing person/due_date are represented as "" (not omitted) so the strict schema
// stays simple; the orchestrator converts "" → undefined when storing.
import { z } from "zod";

export const extractionJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    commitments: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          source_event_ids: { type: "array", items: { type: "string" } },
          direction: { type: "string", enum: ["i_owe", "owed_to_me"] },
          statement: { type: "string" },
          person: { type: "string" },
          due_date: { type: "string" },
          due_date_quality: { type: "string", enum: ["explicit", "relative", "vague", "none"] },
          confidence: { type: "number" },
          evidence_text: { type: "string" },
          reason: { type: "string" },
        },
        required: [
          "source_event_ids",
          "direction",
          "statement",
          "person",
          "due_date",
          "due_date_quality",
          "confidence",
          "evidence_text",
          "reason",
        ],
      },
    },
  },
  required: ["commitments"],
} as const;

export const CommitmentZ = z.object({
  source_event_ids: z.array(z.string()),
  direction: z.enum(["i_owe", "owed_to_me"]),
  statement: z.string(),
  person: z.string(),
  due_date: z.string(),
  due_date_quality: z.enum(["explicit", "relative", "vague", "none"]),
  confidence: z.number(),
  evidence_text: z.string(),
  reason: z.string(),
});

export const ExtractionResultZ = z.object({ commitments: z.array(CommitmentZ) });
export type WireCommitment = z.infer<typeof CommitmentZ>;
