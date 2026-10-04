import { useId } from 'react'
import type { ContactFieldDef, ContactIssue } from '../types/contact'
import './FormField.css'

/** Fallback virtual-keyboard type derived from the HTML input type. */
const INPUT_MODES: Record<string, 'text' | 'email' | 'tel' | 'url'> = {
  email: 'email',
  tel: 'tel',
}

type FormFieldProps = {
  def: ContactFieldDef
  value: string
  onChange: (value: string) => void
  issues: ContactIssue[]
  /**
   * Whether the form has been submitted at least once. Validation messages are
   * always associated with the field, but `aria-invalid` is only applied after a
   * submit so a half-typed field is not announced as invalid on every keypress.
   */
  submitted?: boolean
}

/**
 * One labelled field on the review form. Validation messages are wired to the
 * input with `aria-describedby` so screen readers announce them with the field.
 */
export function FormField({ def, value, onChange, issues, submitted = false }: FormFieldProps) {
  const id = useId()
  const issuesId = `${id}-issues`
  const hasIssues = issues.length > 0
  const showInvalid = submitted

  const sharedProps = {
    id,
    name: def.key,
    value,
    autoComplete: def.autoComplete,
    enterKeyHint: def.enterKeyHint ?? 'next',
    placeholder: def.placeholder,
    /*
     * Only reported as invalid once the form has actually been submitted.
     * Setting it while the user is still typing made a field announce itself as
     * invalid on every keystroke.
     */
    'aria-invalid': showInvalid && hasIssues && issues.some((i) => i.severity === 'error'),
    'aria-describedby': hasIssues ? issuesId : undefined,
    onChange: (
      event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
    ) => onChange(event.target.value),
  }

  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {def.label}
      </label>

      {def.multiline === true ? (
        <textarea
          {...sharedProps}
          className="field__control field__control--multiline"
          rows={3}
        />
      ) : (
        <input
          {...sharedProps}
          className="field__control"
          type={def.type}
          inputMode={def.inputMode ?? INPUT_MODES[def.type]}
        />
      )}

      {hasIssues && (
        <ul className="field__issues" id={issuesId}>
          {issues.map((issue) => (
            <li
              key={`${issue.severity}-${issue.message}`}
              className={`field__issue field__issue--${issue.severity}`}
            >
              {issue.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
