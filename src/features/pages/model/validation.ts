import { z } from "zod";
import { uuidSchema } from "@/features/auth/validation";

const segmenter = new Intl.Segmenter("pt-BR", { granularity: "grapheme" });
export const pageMetadataSchema = z.object({
  title: z.string().max(500),
  icon: z
    .string()
    .max(16)
    .refine(
      (value) =>
        value === "" ||
        ([...segmenter.segment(value)].length === 1 &&
          /[\p{Extended_Pictographic}\p{Regional_Indicator}]/u.test(value)),
      "Escolha um único emoji.",
    ),
});
export const pageSummarySchema = z.object({
  id: uuidSchema,
  title: z.string(),
  icon: z.string(),
  parent_id: uuidSchema.nullable(),
  position: z.string(),
  revision: z.coerce.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
});
export type PageSummary = z.infer<typeof pageSummarySchema>;
export const pageDetailSchema = pageSummarySchema.extend({
  workspace_id: uuidSchema,
  cover_file_id: uuidSchema.nullable(),
});
export const pageListSchema = z.object({ items: z.array(pageSummarySchema).max(50), more: z.boolean() });
export type PageList = z.infer<typeof pageListSchema>;
export const breadcrumbSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  depth: z.number().int().nonnegative(),
});
export type PageActionState = {
  createdPageId?: string;
  error?: string;
  message?: string;
  requiresConfirmation?: boolean;
  affectedPages?: number;
  previewHash?: string;
};
