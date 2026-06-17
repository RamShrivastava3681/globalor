import { Request, Response, NextFunction } from "express";
import { z, ZodSchema } from "zod";

type ValidationSchemas = {
  body?: ZodSchema;
  query?: ZodSchema;
  params?: ZodSchema;
};

/**
 * Middleware factory that validates request body, query, and/or params
 * against Zod schemas. Returns 400 with a descriptive error on failure.
 *
 * Usage:
 *   router.post("/", validate({ body: createUserSchema }), handler);
 *   router.get("/", validate({ query: paginationSchema }), handler);
 *   router.patch("/:id", validate({ body: updateSchema, params: idParamSchema }), handler);
 */
export function validate(schemas: ValidationSchemas) {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      if (schemas.body) {
        req.body = schemas.body.parse(req.body);
      }
      if (schemas.query) {
        req.query = schemas.query.parse(req.query) as any;
      }
      if (schemas.params) {
        req.params = schemas.params.parse(req.params) as any;
      }
      next();
    } catch (err) {
      if (err instanceof z.ZodError) {
        const first = err.errors[0];
        const message = first
          ? `${first.path.join(".")}: ${first.message}`
          : "Validation failed";
        res.status(400).json({ error: message });
        return;
      }
      next(err);
    }
  };
}

/**
 * Common param schemas
 */
export const uuidParam = z.object({
  id: z.string().uuid({ message: "Invalid UUID" }),
});

export const idParam = z.object({
  id: z.string().min(1, { message: "ID is required" }),
});
