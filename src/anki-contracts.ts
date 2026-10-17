import { z } from "zod";

const id = z.string().regex(/^\d+$/);
export const AnkiRequest = z.discriminatedUnion("op", [
  z
    .object({ op: z.literal("review-visibility"), visible: z.boolean() })
    .strict(),
  z.object({ op: z.literal("status") }).strict(),
  z
    .object({
      op: z.literal("browse"),
      query: z.string().max(500),
      deck: id.optional(),
      offset: z.number().int().min(0).max(1000000).optional(),
    })
    .strict(),
  z
    .object({
      op: z.literal("rename-deck"),
      deck: id,
      name: z.string().trim().min(1).max(100),
    })
    .strict(),
  z.object({ op: z.literal("move"), id, deck: id }).strict(),
  z.object({ op: z.literal("delete-note"), id }).strict(),
  z.object({ op: z.literal("backup") }).strict(),
  z.object({ op: z.literal("folder") }).strict(),
  z.object({ op: z.literal("card"), id }).strict(),
  z.object({ op: z.literal("next"), deck: id }).strict(),
  z
    .object({
      op: z.literal("answer"),
      token: z.string().max(100),
      rating: z.number().int().min(1).max(4),
    })
    .strict(),
  z.object({ op: z.literal("undo") }).strict(),
  z
    .object({
      op: z.literal("edit"),
      id,
      fields: z.array(z.string().max(100000)).min(1).max(100),
      tags: z.array(z.string().max(100)).max(100),
    })
    .strict(),
  z.object({ op: z.literal("suspend"), id, suspended: z.boolean() }).strict(),
  z.object({ op: z.literal("import"), scheduling: z.boolean() }).strict(),
  z
    .object({ op: z.literal("export"), deck: id, scheduling: z.boolean() })
    .strict(),
  z
    .object({
      op: z.literal("generate"),
      doc: z.string().max(100),
      deck: z.string().trim().min(1).max(100),
    })
    .strict(),
]);
export type AnkiCommand = z.infer<typeof AnkiRequest>;
export type AnkiCard = {
  id: string;
  note: string;
  deck: string;
  question: string;
  answer: string;
  css: string;
  fields: { name: string; value: string }[];
  tags: string[];
  suspended: boolean;
};
export type AnkiStatus = {
  version: string;
  protocol: number;
  decks: {
    id: string;
    name: string;
    count: number;
    due: number;
    new: number;
    suspended: number;
  }[];
  total: number;
  reviewed: number;
  studied: number;
  undoable: boolean;
};
export type AnkiReview = {
  card: AnkiCard | null;
  token?: string;
  intervals?: string[];
  counts: { new: number; learning: number; review: number };
};
