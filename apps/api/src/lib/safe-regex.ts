const MAX_REGEX_LENGTH = 120;
const MAX_INPUT_SAMPLE_LENGTH = 1000;
const NESTED_QUANTIFIER_PATTERN = /(\([^)]*[+*][^)]*\)[+*?{])|(\.\*){2,}/;

export function safeRegexTest(pattern: string, input: string): boolean {
  if (!pattern || pattern.length > MAX_REGEX_LENGTH) {
    return false;
  }
  if (NESTED_QUANTIFIER_PATTERN.test(pattern)) {
    return false;
  }
  try {
    const compiled = new RegExp(pattern, 'i');
    return compiled.test(input.slice(0, MAX_INPUT_SAMPLE_LENGTH));
  } catch {
    return false;
  }
}
