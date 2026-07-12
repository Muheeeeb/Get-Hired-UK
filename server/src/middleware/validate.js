/** Zod validation middleware. Replaces req.body/query/params with parsed values. */
export function validate(schema, source = 'body') {
  return (req, res, next) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: result.error.issues.map((i) => ({
          path: i.path.join('.'),
          message: i.message,
        })),
      });
    }
    req[source === 'body' ? 'body' : source === 'query' ? 'validatedQuery' : 'validatedParams'] =
      result.data;
    next();
  };
}
