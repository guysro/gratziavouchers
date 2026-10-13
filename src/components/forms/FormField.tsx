import type {
  ChangeEvent,
  InputHTMLAttributes,
} from "react";

interface FormFieldProps
  extends Omit<
    InputHTMLAttributes<HTMLInputElement>,
    "className" | "id" | "onChange" | "value"
  > {
  id: string;
  label: string;
  value: string;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  error?: string;
}

export default function FormField({
  id,
  label,
  value,
  onChange,
  error,
  ...inputProps
}: FormFieldProps) {
  const errorId = `${id}-error`;

  return (
    <div className="form-group">
      <label htmlFor={id}>{label}</label>
      <input
        {...inputProps}
        id={id}
        className={`form-control ${error ? "is-invalid" : ""}`}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? errorId : undefined}
        value={value}
        onChange={onChange}
      />
      {error && (
        <div id={errorId} className="error-message">
          {error}
        </div>
      )}
    </div>
  );
}
