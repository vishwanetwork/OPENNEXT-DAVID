import { z } from 'zod';

/** Nullable, optional number — the backend sends `null` for unknown figures. */
export const num = z.number().nullable().optional();
/** Nullable, optional string. */
export const str = z.string().nullable().optional();
/** Numbers that some legacy records serialise as strings. */
export const numberOrString = z.union([z.number(), z.string()]);

/**
 * A list whose invalid rows are dropped instead of failing the whole response (public feeds
 * mix curated and generated rows). The output is fully typed.
 */
export const lenientArray = <T extends z.ZodTypeAny>(schema: T) =>
  z
    .array(z.unknown())
    .default([])
    .transform((rows) =>
      rows.flatMap((row) => {
        const parsed = schema.safeParse(row);
        return parsed.success ? [parsed.data as z.infer<T>] : [];
      }),
    );
