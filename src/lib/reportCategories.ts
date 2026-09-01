// Shared between the client-side Reports UI and the server-side validation
// schema (src/lib/validation.ts) so the two can never drift apart on what
// counts as a valid category for a given report type.

export const REPORT_TYPES = ['bug', 'crash', 'user'] as const;
export type ReportType = (typeof REPORT_TYPES)[number];

export const REPORT_TYPE_LABELS: Record<ReportType, string> = {
  bug: 'Bug',
  crash: 'Crash',
  user: 'User report',
};

interface CategoryOption {
  value: string;
  label: string;
}

export const BUG_CATEGORIES: readonly CategoryOption[] = [
  { value: 'responsive_issue', label: 'Responsive issue' },
  { value: 'ui_issue', label: 'UI issue' },
  { value: 'broken_button', label: 'Broken button' },
  { value: 'navigation_issue', label: 'Navigation issue' },
  { value: 'store_switching_issue', label: 'Store switching issue' },
  { value: 'data_not_displaying', label: 'Data not displaying' },
  { value: 'incorrect_data', label: 'Incorrect data' },
  { value: 'authentication_issue', label: 'Authentication issue' },
  { value: 'integration_issue', label: 'Integration issue' },
  { value: 'performance_issue', label: 'Performance issue' },
  { value: 'other', label: 'Other' },
];

export const CRASH_CATEGORIES: readonly CategoryOption[] = [
  { value: 'web_app_crash', label: 'Web app crash' },
  { value: 'page_crash', label: 'Page crash' },
  { value: 'blank_screen', label: 'Blank screen' },
  { value: 'error_after_click', label: 'Error after clicking something' },
  { value: 'app_unresponsive', label: 'Application became unresponsive' },
  { value: 'integration_api_failure', label: 'Integration/API failure' },
  { value: 'other', label: 'Other' },
];

export const USER_REPORT_CATEGORIES: readonly CategoryOption[] = [
  { value: 'feedback', label: 'Feedback' },
  { value: 'feature_request', label: 'Feature request' },
  { value: 'question', label: 'Question' },
  { value: 'other', label: 'Other' },
];

export const REPORT_SEVERITIES: readonly CategoryOption[] = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'critical', label: 'Critical' },
];

export function categoriesForType(type: ReportType): readonly CategoryOption[] {
  if (type === 'bug') return BUG_CATEGORIES;
  if (type === 'crash') return CRASH_CATEGORIES;
  return USER_REPORT_CATEGORIES;
}

export function categoryValuesForType(type: ReportType): string[] {
  return categoriesForType(type).map((c) => c.value);
}
