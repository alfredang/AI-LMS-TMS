type JsonObject = Record<string, any>;

const asObject = (value: unknown): JsonObject | null => {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonObject
    : null;
};

/**
 * SSG has returned the course run at more than one nesting level across
 * credential profiles/API versions. Keep that variation at the API boundary
 * instead of making every consumer understand each response shape.
 */
export const extractCourseRun = (response: unknown): JsonObject | null => {
  const root = asObject(response);
  if (!root) return null;

  const data = asObject(root.data);
  const dataCourse = asObject(data?.course);
  const rootCourse = asObject(root.course);

  return asObject(dataCourse?.run)
    ?? asObject(data?.run)
    ?? asObject(rootCourse?.run)
    ?? asObject(root.run)
    ?? null;
};

/**
 * Return the response with the run available at the canonical path used by
 * the LMS: data.course.run. Responses without a run are left unchanged so
 * the caller can report the upstream error accurately.
 */
export const normalizeCourseRunResponse = <T>(response: T): T => {
  const root = asObject(response);
  const run = extractCourseRun(response);
  if (!root || !run) return response;

  const data = asObject(root.data) ?? {};
  const course = asObject(data.course) ?? {};

  return {
    ...root,
    data: {
      ...data,
      course: {
        ...course,
        run,
      },
    },
  } as T;
};

export const toHttpErrorStatus = (status: unknown, fallback = 502): number => {
  return typeof status === 'number' && Number.isInteger(status) && status >= 400 && status <= 599
    ? status
    : fallback;
};
