import type { FieldValues, Path, UseFormSetError } from "react-hook-form";
import { ApiError } from "./api";

/**
 * Map an API failure onto a react-hook-form: field-level VALIDATION_ERRORs land on their inputs,
 * everything else is returned as a message for the form-level alert.
 */
export function applyApiError<T extends FieldValues>(err: unknown, setError: UseFormSetError<T>): string | null {
  if (!(err instanceof ApiError)) return "Something went wrong. Check your connection and try again.";
  if (err.code === "VALIDATION_ERROR") {
    let mapped = false;
    for (const [field, msgs] of Object.entries(err.fieldErrors)) {
      if (msgs?.[0]) {
        setError(field as Path<T>, { message: msgs[0] });
        mapped = true;
      }
    }
    if (mapped) return null;
  }
  return err.message;
}
